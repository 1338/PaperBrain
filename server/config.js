import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL || 'postgresql://app:ChangeMe@localhost:5432/app',
  databaseSsl: process.env.DATABASE_SSL === 'true',
  sessionSecret: process.env.SESSION_SECRET || 'development-only-change-me',
  production: process.env.NODE_ENV === 'production',
  secureCookies: process.env.COOKIE_SECURE === 'true',
  storagePath: process.env.STORAGE_PATH || './storage',
  maxUploadSize: Number(process.env.MAX_UPLOAD_SIZE_MB || process.env.MAX_EPUB_SIZE_MB || 100) * 1024 * 1024,
  adminEmail: process.env.ADMIN_EMAIL?.trim().toLowerCase() || ''
};

if (config.production && (
  config.sessionSecret === 'development-only-change-me' ||
  config.sessionSecret === 'replace-with-a-long-random-value' ||
  config.sessionSecret.length < 32
)) {
  throw new Error('SESSION_SECRET must be set to a random value of at least 32 characters in production.');
}
