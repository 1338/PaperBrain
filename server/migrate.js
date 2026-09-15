import { pool } from './db.js';
import { audioMetadata } from './media.js';

const migration = `
  CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    email VARCHAR(180) NOT NULL UNIQUE,
    roles JSONB NOT NULL DEFAULT '["ROLE_USER"]'::jsonb,
    password VARCHAR(255) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    email_verified BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT TRUE;

  CREATE TABLE IF NOT EXISTS app_settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  INSERT INTO app_settings (key, value) VALUES
    ('registration', '{"publicSignup": true, "requireEmailVerification": false}'::jsonb),
    ('smtp', '{"host": "", "port": 587, "secure": false, "user": "", "encryptedPassword": "", "from": ""}'::jsonb),
    ('storage', '{"provider": "local", "endpoint": "", "region": "us-east-1", "bucket": "", "accessKey": "", "encryptedSecretKey": "", "forcePathStyle": true}'::jsonb)
  ON CONFLICT (key) DO NOTHING;

  CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS email_verification_user_idx ON email_verification_tokens(user_id);

  UPDATE users SET roles = roles || '["ROLE_ADMIN"]'::jsonb
  WHERE id = (SELECT id FROM users ORDER BY created_at ASC, id ASC LIMIT 1)
    AND NOT EXISTS (SELECT 1 FROM users WHERE roles @> '["ROLE_ADMIN"]'::jsonb);

  CREATE TABLE IF NOT EXISTS library_items (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(500),
    author VARCHAR(500),
    original_filename VARCHAR(500),
    epub_path TEXT,
    pdf_path TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'converting',
    error_message TEXT,
    total_pages INTEGER,
    current_page INTEGER NOT NULL DEFAULT 0,
    last_read_at TIMESTAMPTZ,
    media_type VARCHAR(20) NOT NULL DEFAULT 'epub',
    source_path TEXT,
    media_path TEXT,
    progress_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
    duration_seconds DOUBLE PRECISION,
    isbn VARCHAR(13),
    storage_provider VARCHAR(20) NOT NULL DEFAULT 'local',
    source_key TEXT,
    pdf_key TEXT,
    media_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  ALTER TABLE library_items ADD COLUMN IF NOT EXISTS title VARCHAR(500);
  ALTER TABLE library_items ADD COLUMN IF NOT EXISTS manually_finished BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE library_items ALTER COLUMN status SET DEFAULT 'processing';
  ALTER TABLE library_items ADD COLUMN IF NOT EXISTS author VARCHAR(500);
  ALTER TABLE library_items ADD COLUMN IF NOT EXISTS original_filename VARCHAR(500);
  ALTER TABLE library_items ADD COLUMN IF NOT EXISTS epub_path TEXT;
  ALTER TABLE library_items ADD COLUMN IF NOT EXISTS pdf_path TEXT;
  ALTER TABLE library_items ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'converting';
  ALTER TABLE library_items ADD COLUMN IF NOT EXISTS error_message TEXT;
  ALTER TABLE library_items ADD COLUMN IF NOT EXISTS total_pages INTEGER;
  ALTER TABLE library_items ADD COLUMN IF NOT EXISTS current_page INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE library_items ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ;
  ALTER TABLE library_items ADD COLUMN IF NOT EXISTS media_type VARCHAR(20) NOT NULL DEFAULT 'epub';
  ALTER TABLE library_items ADD COLUMN IF NOT EXISTS source_path TEXT;
  ALTER TABLE library_items ADD COLUMN IF NOT EXISTS media_path TEXT;
  ALTER TABLE library_items ADD COLUMN IF NOT EXISTS progress_seconds DOUBLE PRECISION NOT NULL DEFAULT 0;
  ALTER TABLE library_items ADD COLUMN IF NOT EXISTS duration_seconds DOUBLE PRECISION;
  ALTER TABLE library_items ADD COLUMN IF NOT EXISTS isbn VARCHAR(13);
  ALTER TABLE library_items ADD COLUMN IF NOT EXISTS storage_provider VARCHAR(20) NOT NULL DEFAULT 'local';
  ALTER TABLE library_items ADD COLUMN IF NOT EXISTS source_key TEXT;
  ALTER TABLE library_items ADD COLUMN IF NOT EXISTS pdf_key TEXT;
  ALTER TABLE library_items ADD COLUMN IF NOT EXISTS media_key TEXT;
  CREATE INDEX IF NOT EXISTS library_conversion_queue_idx ON library_items(created_at)
    WHERE status IN ('queued', 'converting') AND media_type IN ('epub', 'mobi');

  UPDATE library_items SET source_path = epub_path
  WHERE source_path IS NULL AND epub_path IS NOT NULL;

  ALTER TABLE library_items ALTER COLUMN current_page SET DEFAULT 0;
  UPDATE library_items SET current_page = 0
  WHERE last_read_at IS NULL AND current_page = 1;

  CREATE INDEX IF NOT EXISTS library_items_user_id_idx ON library_items(user_id);
`;

try {
  await pool.query(migration);
  const audioItems = await pool.query(
    `SELECT id, media_path FROM library_items
     WHERE media_type = 'audio' AND duration_seconds IS NULL AND media_path IS NOT NULL`
  );
  for (const item of audioItems.rows) {
    try {
      const metadata = await audioMetadata(item.media_path);
      await pool.query(
        `UPDATE library_items SET duration_seconds = $1,
         title = COALESCE($2, title), author = COALESCE($3, author) WHERE id = $4`,
        [metadata.duration, metadata.title, metadata.author, item.id]
      );
    } catch (error) {
      console.warn(`Could not read metadata for audio item ${item.id}: ${error.message}`);
    }
  }
  console.log('Database schema is up to date.');
} finally {
  await pool.end();
}
