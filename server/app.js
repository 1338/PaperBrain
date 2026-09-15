import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import connectPgSimple from 'connect-pg-simple';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import multer from 'multer';
import { config } from './config.js';
import { pool } from './db.js';
import { deleteLibraryRecords } from './deletion.js';
import { persistToConfiguredStorage } from './processing.js';
import { validIsbn } from './isbn.js';
import { audioMetadata, inspectUpload, pdfMetadata } from './media.js';
import { sendEmail, sendVerificationEmail } from './mailer.js';
import { encryptSecret, getSetting, setSetting } from './settings.js';
import {
  deleteStoredFiles,
  storageConfiguration,
  streamStoredFile,
  testStorage
} from './storage.js';
import { publicUser, validEmail, validPassword, validateRegistration } from './validation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PgStore = connectPgSimple(session);
const storageRoot = path.resolve(config.storagePath);
const incomingDirectory = path.join(storageRoot, 'incoming');
const booksDirectory = path.join(storageRoot, 'books');
await Promise.all([
  fs.mkdir(incomingDirectory, { recursive: true }),
  fs.mkdir(booksDirectory, { recursive: true })
]);
for (const temporaryFile of await fs.readdir(incomingDirectory)) {
  await fs.rm(path.join(incomingDirectory, temporaryFile), { force: true, recursive: true });
}
const upload = multer({
  dest: incomingDirectory,
  limits: { fileSize: config.maxUploadSize, files: 1 },
  fileFilter: (_request, file, done) => {
    const valid = ['.epub', '.mobi', '.pdf', '.mp3', '.wav'].includes(path.extname(file.originalname).toLowerCase());
    done(valid ? null : Object.assign(new Error('Upload an EPUB, MOBI, PDF, MP3, or WAV file.'), {
      status: 415,
      exposed: true
    }), valid);
  }
});

app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      'script-src': ["'self'"],
      'style-src': ["'self'"]
    }
  }
}));
// Accept text/plain JSON as a compatibility path for clients that were opened
// before the API header fix. Current clients send application/json.
app.use(express.json({ limit: '20kb', type: ['application/json', 'text/plain'] }));
app.use(session({
  store: new PgStore({
    pool,
    createTableIfMissing: true
  }),
  name: 'paperbrain.sid',
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    maxAge: null
  }
}));

function csrfToken(request) {
  request.session.csrfToken ||= crypto.randomBytes(32).toString('hex');
  return request.session.csrfToken;
}

function requireCsrf(request, response, next) {
  const supplied = request.get('X-CSRF-Token');
  const expected = request.session.csrfToken;

  if (!supplied || !expected || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
      !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return response.status(403).json({ error: 'Invalid CSRF token.' });
  }

  next();
}

async function requireUser(request, response, next) {
  if (!request.session.userId) {
    return response.status(401).json({ error: 'Log in to access your library.' });
  }
  try {
    const result = await pool.query(
      'SELECT id FROM users WHERE id = $1 AND is_active = TRUE AND email_verified = TRUE',
      [request.session.userId]
    );
    if (!result.rows.length) return response.status(403).json({ error: 'Your account cannot access this resource.' });
    next();
  } catch (error) {
    next(error);
  }
}

async function requireAdmin(request, response, next) {
  if (!request.session.userId) return response.status(401).json({ error: 'Log in to continue.' });
  try {
    const result = await pool.query('SELECT roles FROM users WHERE id = $1 AND is_active = TRUE', [request.session.userId]);
    if (!result.rows[0]?.roles?.includes('ROLE_ADMIN')) {
      return response.status(403).json({ error: 'Administrator access is required.' });
    }
    next();
  } catch (error) {
    next(error);
  }
}

async function createVerification(user, request) {
  const token = crypto.randomBytes(32).toString('base64url');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  await pool.query('DELETE FROM email_verification_tokens WHERE user_id = $1', [user.id]);
  await pool.query(
    `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '24 hours')`,
    [user.id, hash]
  );
  const url = `${request.protocol}://${request.get('host')}/verify-email?token=${encodeURIComponent(token)}`;
  await sendVerificationEmail(user, url);
}

function libraryItem(row) {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    mediaType: row.media_type || 'epub',
    fileType: path.extname(row.original_filename || '').slice(1).toUpperCase(),
    originalFilename: row.original_filename,
    isbn: row.isbn,
    status: row.status,
    error: row.error_message,
    totalPages: row.total_pages,
    currentPage: row.current_page,
    progressSeconds: row.progress_seconds || 0,
    durationSeconds: row.duration_seconds,
    hasProgress: Boolean(row.last_read_at),
    progress: row.manually_finished ? 100 : row.media_type === 'audio'
      ? (row.duration_seconds ? Math.round((row.progress_seconds / row.duration_seconds) * 100) : 0)
      : (row.last_read_at && row.total_pages ? Math.round((row.current_page / row.total_pages) * 100) : 0),
    createdAt: row.created_at,
    lastReadAt: row.last_read_at
  };
}

app.get('/api/health/live', (_request, response) => {
  response.json({ status: 'ok' });
});

app.get('/api/health/ready', async (_request, response) => {
  try {
    await pool.query('SELECT 1');
    response.json({ status: 'ready' });
  } catch {
    response.status(503).json({ status: 'unavailable' });
  }
});

app.get('/api/config', async (_request, response, next) => {
  try {
    const registration = await getSetting('registration');
    const count = await pool.query('SELECT COUNT(*)::int AS count FROM users');
    response.json({
      publicSignup: count.rows[0].count === 0 || registration?.publicSignup !== false,
      requireEmailVerification: Boolean(registration?.requireEmailVerification)
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/session', async (request, response, next) => {
  try {
    const result = request.session.userId
      ? await pool.query('SELECT id, email, roles, display_name, email_verified, is_active FROM users WHERE id = $1 AND is_active = TRUE', [request.session.userId])
      : { rows: [] };

    response.json({
      user: publicUser(result.rows[0]),
      csrfToken: csrfToken(request)
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/register', async (request, response, next) => {
  const validationError = validateRegistration(request.body);

  if (validationError) {
    return response.status(400).json({ error: validationError });
  }

  const displayName = request.body.displayName.trim();
  const email = request.body.email.trim().toLowerCase();

  try {
    const [registration, countResult] = await Promise.all([
      getSetting('registration'),
      pool.query('SELECT COUNT(*)::int AS count FROM users')
    ]);
    const firstUser = countResult.rows[0].count === 0;
    if (!firstUser && registration?.publicSignup === false) {
      return response.status(403).json({ error: 'Public account registration is disabled.' });
    }
    const isAdmin = firstUser || (config.adminEmail && email === config.adminEmail);
    const requiresVerification = !isAdmin && Boolean(registration?.requireEmailVerification);
    const password = await bcrypt.hash(request.body.password, 12);
    const result = await pool.query(
      `INSERT INTO users (email, password, display_name, roles, email_verified)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, roles, display_name, email_verified, is_active`,
      [email, password, displayName,
        JSON.stringify(isAdmin ? ['ROLE_USER', 'ROLE_ADMIN'] : ['ROLE_USER']),
        !requiresVerification]
    );
    if (requiresVerification) {
      await createVerification(result.rows[0], request);
      return response.status(201).json({ requiresVerification: true });
    }
    request.session.userId = result.rows[0].id;
    response.status(201).json({ user: publicUser(result.rows[0]), requiresVerification: false });
  } catch (error) {
    if (error.code === '23505') {
      return response.status(409).json({ error: 'There is already an account with this email.' });
    }
    next(error);
  }
});

app.post('/api/login', async (request, response, next) => {
  const email = request.body.email?.trim().toLowerCase();
  const password = request.body.password;

  if (!email || typeof password !== 'string') {
    return response.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const result = await pool.query(
      'SELECT id, email, roles, password, display_name, email_verified, is_active FROM users WHERE email = $1',
      [email]
    );
    const user = result.rows[0];

    if (!user || !await bcrypt.compare(password, user.password)) {
      return response.status(401).json({ error: 'Invalid email or password.' });
    }
    if (!user.is_active) return response.status(403).json({ error: 'This account has been disabled.' });
    if (!user.email_verified) return response.status(403).json({ error: 'Verify your email address before logging in.' });

    await new Promise((resolve, reject) => request.session.regenerate((error) => error ? reject(error) : resolve()));
    request.session.userId = user.id;
    request.session.cookie.maxAge = request.body.rememberMe ? 7 * 24 * 60 * 60 * 1000 : null;
    response.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/verify-email', async (request, response, next) => {
  const token = request.body.token;
  if (typeof token !== 'string' || token.length < 20) return response.status(400).json({ error: 'Invalid verification link.' });
  try {
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const result = await pool.query(
      `DELETE FROM email_verification_tokens WHERE token_hash = $1 AND expires_at > NOW()
       RETURNING user_id`,
      [hash]
    );
    if (!result.rows[0]) return response.status(400).json({ error: 'This verification link is invalid or expired.' });
    await pool.query('UPDATE users SET email_verified = TRUE WHERE id = $1', [result.rows[0].user_id]);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/logout', requireCsrf, (request, response, next) => {
  request.session.destroy((error) => {
    if (error) {
      return next(error);
    }
    response.clearCookie('paperbrain.sid');
    response.json({ ok: true });
  });
});

app.patch('/api/profile', requireUser, requireCsrf, async (request, response, next) => {
  const body = request.body || {};
  const displayName = String(body.displayName || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const newPassword = body.newPassword ? String(body.newPassword) : '';

  if (!displayName || displayName.length > 255) {
    return response.status(400).json({ error: 'Enter a display name of no more than 255 characters.' });
  }
  if (!validEmail(email)) return response.status(400).json({ error: 'Enter a valid email address.' });
  if (newPassword && !validPassword(newPassword)) {
    return response.status(400).json({ error: 'New password must be between 6 and 4,096 characters.' });
  }

  try {
    const result = await pool.query(
      'SELECT id, email, password, roles, display_name, email_verified, is_active FROM users WHERE id = $1',
      [request.session.userId]
    );
    const user = result.rows[0];
    const emailChanged = email !== user.email;
    const sensitiveChange = emailChanged || Boolean(newPassword);
    if (sensitiveChange && (!body.currentPassword || !await bcrypt.compare(String(body.currentPassword), user.password))) {
      return response.status(403).json({ error: 'Enter your current password to change your email or password.' });
    }

    const registration = await getSetting('registration');
    const requiresVerification = emailChanged && Boolean(registration?.requireEmailVerification);
    const password = newPassword ? await bcrypt.hash(newPassword, 12) : user.password;
    const updated = await pool.query(
      `UPDATE users SET display_name = $1, email = $2, password = $3,
       email_verified = CASE WHEN $4 THEN FALSE ELSE email_verified END
       WHERE id = $5
       RETURNING id, email, roles, display_name, email_verified, is_active`,
      [displayName, email, password, requiresVerification, user.id]
    );

    if (requiresVerification) {
      await createVerification(updated.rows[0], request);
      return request.session.destroy((error) => {
        if (error) return next(error);
        response.clearCookie('paperbrain.sid');
        response.json({ user: null, requiresVerification: true });
      });
    }
    response.json({ user: publicUser(updated.rows[0]), requiresVerification: false });
  } catch (error) {
    if (error.code === '23505') return response.status(409).json({ error: 'That email address is already in use.' });
    next(error);
  }
});

app.get('/api/library', requireUser, async (request, response, next) => {
  try {
    const result = await pool.query(
      `SELECT id, title, author, isbn, media_type, original_filename, status, error_message,
              total_pages, current_page, progress_seconds, duration_seconds, created_at, last_read_at
       FROM library_items WHERE user_id = $1 ORDER BY created_at DESC`,
      [request.session.userId]
    );
    response.json({ items: result.rows.map(libraryItem) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/library', requireUser, requireCsrf, upload.single('file'), async (request, response, next) => {
  if (!request.file) {
    return response.status(400).json({ error: 'Choose an EPUB, MOBI, PDF, MP3, or WAV file to upload.' });
  }

  let item;
  try {
    const inspected = await inspectUpload(request.file.path, request.file.originalname);
    const result = await pool.query(
      `INSERT INTO library_items (user_id, original_filename, source_path, media_type, title)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [request.session.userId, request.file.originalname, request.file.path,
        inspected.mediaType, path.basename(request.file.originalname, path.extname(request.file.originalname))]
    );
    item = result.rows[0];
    const bookDirectory = path.join(booksDirectory, String(item.id));
    await fs.mkdir(bookDirectory, { recursive: true });
    const sourcePath = path.join(bookDirectory, `source${inspected.extension}`);
    await fs.rename(request.file.path, sourcePath);
    item.source_path = sourcePath;
    await pool.query(
      'UPDATE library_items SET source_path = $1 WHERE id = $2 AND user_id = $3',
      [sourcePath, item.id, request.session.userId]
    );

    let updated;
    if (['epub', 'mobi'].includes(inspected.mediaType)) {
      const queued = await pool.query("UPDATE library_items SET status = 'queued' WHERE id = $1 RETURNING *", [item.id]);
      return response.status(202).json({ item: libraryItem(queued.rows[0]) });
    } else if (inspected.mediaType === 'pdf') {
      const metadata = await pdfMetadata(sourcePath);
      const result = await pool.query(
        `UPDATE library_items SET source_path = $1, pdf_path = $1, total_pages = $2,
         title = COALESCE($3, title), author = COALESCE($4, author), isbn = $5,
         status = 'processing', error_message = NULL WHERE id = $6 AND user_id = $7 RETURNING *`,
        [sourcePath, metadata.pages, metadata.title, metadata.author, metadata.isbn,
          item.id, request.session.userId]
      );
      updated = result.rows[0];
    } else {
      const metadata = await audioMetadata(sourcePath);
      const result = await pool.query(
        `UPDATE library_items SET source_path = $1, media_path = $1,
         duration_seconds = $2, title = COALESCE($3, title), author = $4, isbn = $5,
         status = 'processing', error_message = NULL WHERE id = $6 AND user_id = $7 RETURNING *`,
        [sourcePath, metadata.duration, metadata.title, metadata.author, metadata.isbn, item.id, request.session.userId]
      );
      updated = result.rows[0];
    }
    updated = await persistToConfiguredStorage(updated, request.session.userId, inspected.extension);
    updated = (await pool.query("UPDATE library_items SET status = 'ready' WHERE id = $1 RETURNING *", [item.id])).rows[0];
    response.status(201).json({ item: libraryItem(updated) });
  } catch (error) {
    if (item) {
      await pool.query(
        `UPDATE library_items SET status = 'failed', error_message = $1
         WHERE id = $2 AND user_id = $3`,
        [error.message.slice(0, 1000), item.id, request.session.userId]
      ).catch(() => {});
    } else if (request.file?.path) {
      await fs.unlink(request.file.path).catch(() => {});
    }
    next(error);
  }
});

app.post('/api/library/:id/retry', requireUser, requireCsrf, async (request, response, next) => {
  try {
    const result = await pool.query(
      `UPDATE library_items SET status = 'processing', error_message = NULL
       WHERE id = $1 AND user_id = $2 AND status = 'failed' AND media_type IN ('epub', 'mobi', 'pdf') RETURNING *`,
      [request.params.id, request.session.userId]
    );
    const item = result.rows[0];
    if (!item) {
      return response.status(404).json({ error: 'Failed document not found.' });
    }

    try {
      const extension = item.media_type === 'epub' ? '.epub' : item.media_type === 'mobi' ? '.mobi' : '.pdf';
      const sourcePath = path.join(booksDirectory, String(item.id), `source${extension}`);
      item.source_path = sourcePath;
      let updated;
      if (['epub', 'mobi'].includes(item.media_type)) {
        const queued = await pool.query("UPDATE library_items SET status = 'queued' WHERE id = $1 RETURNING *", [item.id]);
        return response.status(202).json({ item: libraryItem(queued.rows[0]) });
      } else {
        const metadata = await pdfMetadata(sourcePath);
        const retried = await pool.query(
          `UPDATE library_items SET source_path = $1, pdf_path = $1, total_pages = $2,
           title = COALESCE($3, title), author = COALESCE($4, author), isbn = $5,
           status = 'processing', error_message = NULL WHERE id = $6 AND user_id = $7 RETURNING *`,
          [sourcePath, metadata.pages, metadata.title, metadata.author, metadata.isbn,
            item.id, request.session.userId]
        );
        updated = retried.rows[0];
      }
      updated = await persistToConfiguredStorage(updated, request.session.userId, extension);
      updated = (await pool.query("UPDATE library_items SET status = 'ready' WHERE id = $1 RETURNING *", [item.id])).rows[0];
      response.json({ item: libraryItem(updated) });
    } catch (error) {
      await pool.query(
        `UPDATE library_items SET status = 'failed', error_message = $1
         WHERE id = $2 AND user_id = $3`,
        [error.message.slice(0, 1000), item.id, request.session.userId]
      );
      next(error);
    }
  } catch (error) {
    next(error);
  }
});

app.delete('/api/library/:id', requireUser, requireCsrf, async (request, response, next) => {
  try {
    const deleted = await deleteLibraryRecords(pool, {
      userId: request.session.userId, itemId: request.params.id
    }, async (item) => {
      if (item.storage_provider === 's3' || item.source_key) {
        await deleteStoredFiles(await storageConfiguration(), [item.source_key, item.pdf_key, item.media_key]);
      }
      await fs.rm(path.join(booksDirectory, String(item.id)), { recursive: true, force: true });
    });
    if (!deleted) {
      return response.status(404).json({ error: 'Book not found.' });
    }
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/library/:id/pdf', requireUser, async (request, response, next) => {
  try {
    const result = await pool.query(
      `SELECT pdf_path, pdf_key, storage_provider, original_filename FROM library_items
       WHERE id = $1 AND user_id = $2 AND status = 'ready'`,
      [request.params.id, request.session.userId]
    );
    const item = result.rows[0];
    if (!item) {
      return response.status(404).json({ error: 'Book not found.' });
    }
    const filename = `${path.parse(item.original_filename).name}.pdf`;
    if (item.storage_provider === 's3') {
      await streamStoredFile(await storageConfiguration(), item.pdf_key, request, response, 'application/pdf', filename);
    } else {
      response.type('application/pdf');
      response.set('Content-Disposition', `inline; filename="${filename.replace(/["\\\\]/g, '')}"`);
      response.sendFile(path.resolve(item.pdf_path));
    }
  } catch (error) {
    next(error);
  }
});

app.get('/api/library/:id/audio', requireUser, async (request, response, next) => {
  try {
    const result = await pool.query(
      `SELECT media_path, media_key, storage_provider, original_filename FROM library_items
       WHERE id = $1 AND user_id = $2 AND status = 'ready' AND media_type = 'audio'`,
      [request.params.id, request.session.userId]
    );
    const item = result.rows[0];
    if (!item) return response.status(404).json({ error: 'Audio item not found.' });
    const contentType = path.extname(item.original_filename).toLowerCase() === '.wav' ? 'audio/wav' : 'audio/mpeg';
    if (item.storage_provider === 's3') {
      await streamStoredFile(await storageConfiguration(), item.media_key, request, response, contentType, item.original_filename);
    } else {
      response.type(contentType);
      response.set('Content-Disposition', 'inline');
      response.sendFile(path.resolve(item.media_path));
    }
  } catch (error) {
    next(error);
  }
});

app.patch('/api/library/:id/metadata', requireUser, requireCsrf, async (request, response, next) => {
  try {
    const { title, author = '', isbn = '' } = request.body || {};
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 500 ||
        typeof author !== 'string' || author.trim().length > 500 || typeof isbn !== 'string' ||
        (isbn.trim() && (!/^[\dXx\s-]+$/.test(isbn) || !validIsbn(isbn)))) {
      return response.status(400).json({ error: 'Provide a title (up to 500 characters), author (up to 500), and a valid ISBN or leave it blank.' });
    }
    const result = await pool.query(`UPDATE library_items SET title = $1, author = $2, isbn = $3
      WHERE id = $4 AND user_id = $5 AND status = 'ready' RETURNING *`,
    [title.trim(), author.trim() || null, isbn.replace(/[\s-]/g, '').toUpperCase() || null,
      request.params.id, request.session.userId]);
    if (!result.rows[0]) return response.status(404).json({ error: 'Ready item not found.' });
    response.json({ item: libraryItem(result.rows[0]) });
  } catch (error) { next(error); }
});

app.patch('/api/library/:id/progress', requireUser, requireCsrf, async (request, response, next) => {
  try {
    const body = request.body || {};
    if (body.action !== undefined) {
      if (!['finish', 'reset'].includes(body.action)) return response.status(400).json({ error: 'Invalid progress action.' });
      const finished = body.action === 'finish';
      const result = await pool.query(`UPDATE library_items SET manually_finished = $1,
        current_page = CASE WHEN $1 THEN COALESCE(total_pages, 0) ELSE 0 END,
        progress_seconds = CASE WHEN $1 THEN COALESCE(duration_seconds, 0) ELSE 0 END,
        last_read_at = CASE WHEN $1 THEN NOW() ELSE NULL END
        WHERE id = $2 AND user_id = $3 AND status = 'ready' RETURNING *`,
      [finished, request.params.id, request.session.userId]);
      if (!result.rows[0]) return response.status(404).json({ error: 'Ready item not found.' });
      return response.json({ item: libraryItem(result.rows[0]) });
    }
    const page = Number(body.page);
    const seconds = Number(body.seconds);
    const duration = Number(body.duration);
    const started = body.started !== false;
    const audioProgress = Number.isFinite(seconds) && seconds >= 0 && Number.isFinite(duration) && duration > 0;
    const pageProgress = Number.isInteger(page) && page >= 1;
    if (!audioProgress && !pageProgress) {
      return response.status(400).json({ error: 'Provide a valid page or audio position.' });
    }
    const result = audioProgress
      ? await pool.query(
        `UPDATE library_items SET manually_finished = FALSE, progress_seconds = LEAST($1::double precision, $2::double precision),
         duration_seconds = $2::double precision,
         last_read_at = CASE WHEN $3 THEN NOW() ELSE last_read_at END
         WHERE id = $4 AND user_id = $5 AND status = 'ready' AND media_type = 'audio' RETURNING *`,
        [seconds, duration, started, request.params.id, request.session.userId]
      )
      : await pool.query(
        `UPDATE library_items SET manually_finished = FALSE, current_page = LEAST($1, total_pages), last_read_at = NOW()
         WHERE id = $2 AND user_id = $3 AND status = 'ready' AND media_type IN ('epub', 'mobi', 'pdf') RETURNING *`,
        [page, request.params.id, request.session.userId]
      );
    if (!result.rows[0]) {
      return response.status(404).json({ error: 'Book not found.' });
    }
    response.json({ item: libraryItem(result.rows[0]) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin', requireAdmin, async (_request, response, next) => {
  try {
    const [registration, smtp, storage, users] = await Promise.all([
      getSetting('registration'),
      getSetting('smtp'),
      storageConfiguration(),
      pool.query(
        `SELECT id, email, display_name, roles, is_active, email_verified, created_at
         FROM users ORDER BY created_at ASC`
      )
    ]);
    response.json({
      settings: {
        publicSignup: registration?.publicSignup !== false,
        requireEmailVerification: Boolean(registration?.requireEmailVerification),
        smtp: {
          host: smtp?.host || '',
          port: smtp?.port || 587,
          secure: Boolean(smtp?.secure),
          user: smtp?.user || '',
          from: smtp?.from || '',
          passwordConfigured: Boolean(smtp?.encryptedPassword)
        },
        storage: {
          provider: storage?.provider === 's3' ? 's3' : 'local',
          endpoint: storage?.endpoint || '',
          region: storage?.region || 'us-east-1',
          bucket: storage?.bucket || '',
          accessKey: storage?.accessKey || '',
          secretKeyConfigured: Boolean(storage?.encryptedSecretKey),
          forcePathStyle: storage?.forcePathStyle !== false
        }
      },
      users: users.rows.map((user) => ({
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        roles: user.roles,
        active: user.is_active,
        emailVerified: user.email_verified,
        createdAt: user.created_at
      }))
    });
  } catch (error) {
    next(error);
  }
});

app.put('/api/admin/settings', requireAdmin, requireCsrf, async (request, response, next) => {
  try {
    const body = request.body || {};
    const [previousSmtp, previousStorage] = await Promise.all([getSetting('smtp'), storageConfiguration()]);
    const smtp = body.smtp || {};
    const storage = body.storage || {};
    const port = Number(smtp.port || 587);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return response.status(400).json({ error: 'Enter a valid SMTP port.' });
    }
    if (body.requireEmailVerification && (!String(smtp.host || '').trim() || !String(smtp.from || '').trim())) {
      return response.status(400).json({ error: 'Configure an SMTP host and from address before requiring email verification.' });
    }
    if (!['local', 's3'].includes(storage.provider)) {
      return response.status(400).json({ error: 'Choose local or S3-compatible file storage.' });
    }
    if (storage.provider === 's3' && (!String(storage.bucket || '').trim() || !String(storage.region || '').trim())) {
      return response.status(400).json({ error: 'Enter an S3 bucket and region.' });
    }
    const endpoint = String(storage.endpoint || '').trim().replace(/\/$/, '');
    const bucket = String(storage.bucket || '').trim();
    if ((endpoint !== (previousStorage.endpoint || '') || bucket !== (previousStorage.bucket || '')) &&
        (await pool.query("SELECT 1 FROM library_items WHERE storage_provider = 's3' OR source_key IS NOT NULL LIMIT 1")).rows.length) {
      return response.status(400).json({ error: 'Existing files use this S3 bucket. Move or delete those files before changing its endpoint or bucket.' });
    }
    await Promise.all([
      setSetting('registration', {
        publicSignup: Boolean(body.publicSignup),
        requireEmailVerification: Boolean(body.requireEmailVerification)
      }),
      setSetting('smtp', {
        host: String(smtp.host || '').trim(),
        port,
        secure: Boolean(smtp.secure),
        user: String(smtp.user || '').trim(),
        encryptedPassword: smtp.password
          ? encryptSecret(String(smtp.password))
          : (previousSmtp?.encryptedPassword || ''),
        from: String(smtp.from || '').trim()
      }),
      setSetting('storage', {
        provider: storage.provider,
        endpoint: String(storage.endpoint || '').trim().replace(/\/$/, ''),
        region: String(storage.region || 'us-east-1').trim(),
        bucket: String(storage.bucket || '').trim(),
        accessKey: String(storage.accessKey || '').trim(),
        encryptedSecretKey: storage.secretKey
          ? encryptSecret(String(storage.secretKey))
          : (previousStorage?.encryptedSecretKey || ''),
        forcePathStyle: Boolean(storage.forcePathStyle)
      })
    ]);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/settings/test-storage', requireAdmin, requireCsrf, async (request, response) => {
  try {
    const submitted = request.body?.storage || {};
    const previous = await storageConfiguration();
    const configuration = {
      provider: submitted.provider === 's3' ? 's3' : 'local',
      endpoint: String(submitted.endpoint || '').trim().replace(/\/$/, ''),
      region: String(submitted.region || 'us-east-1').trim(),
      bucket: String(submitted.bucket || '').trim(),
      accessKey: String(submitted.accessKey || '').trim(),
      encryptedSecretKey: submitted.secretKey
        ? encryptSecret(String(submitted.secretKey))
        : (previous?.encryptedSecretKey || ''),
      forcePathStyle: Boolean(submitted.forcePathStyle)
    };
    if (configuration.provider === 's3' && (!configuration.bucket || !configuration.region)) {
      return response.status(400).json({ error: 'Enter an S3 bucket and region before testing.' });
    }
    await testStorage(configuration);
    response.json({ ok: true });
  } catch (error) {
    response.status(400).json({ error: `Storage test failed: ${error.message}` });
  }
});

app.post('/api/admin/settings/test-email', requireAdmin, requireCsrf, async (request, response, next) => {
  try {
    const admin = await pool.query('SELECT email FROM users WHERE id = $1', [request.session.userId]);
    await sendEmail({
      to: admin.rows[0].email,
      subject: 'PaperBrain email test',
      text: 'Your PaperBrain SMTP configuration is working.',
      html: '<p>Your <strong>PaperBrain</strong> SMTP configuration is working.</p>'
    });
    response.json({ ok: true });
  } catch (error) {
    response.status(400).json({ error: `Test email failed: ${error.message}` });
  }
});

app.patch('/api/admin/users/:id', requireAdmin, requireCsrf, async (request, response, next) => {
  const body = request.body || {};
  if (String(request.params.id) === String(request.session.userId) && body.active === false) {
    return response.status(400).json({ error: 'You cannot disable your own account.' });
  }
  if (String(request.params.id) === String(request.session.userId) && body.admin === false) {
    return response.status(400).json({ error: 'You cannot remove your own administrator role.' });
  }
  try {
    const existing = await pool.query('SELECT roles FROM users WHERE id = $1', [request.params.id]);
    if (!existing.rows[0]) return response.status(404).json({ error: 'User not found.' });
    let roles = existing.rows[0].roles;
    if (typeof body.admin === 'boolean') {
      roles = body.admin
        ? [...new Set([...roles, 'ROLE_ADMIN'])]
        : roles.filter((role) => role !== 'ROLE_ADMIN');
    }
    const result = await pool.query(
      `UPDATE users SET roles = $1,
       is_active = COALESCE($2, is_active), email_verified = COALESCE($3, email_verified)
       WHERE id = $4 RETURNING id, email, display_name, roles, is_active, email_verified, created_at`,
      [JSON.stringify(roles),
        typeof body.active === 'boolean' ? body.active : null,
        typeof body.emailVerified === 'boolean' ? body.emailVerified : null,
        request.params.id]
    );
    response.json({ user: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/admin/users/:id', requireAdmin, requireCsrf, async (request, response, next) => {
  if (String(request.params.id) === String(request.session.userId)) {
    return response.status(400).json({ error: 'You cannot delete your own account.' });
  }
  try {
    const storage = await storageConfiguration();
    const deleted = await deleteLibraryRecords(pool, {
      userId: request.params.id, deleteUser: true
    }, async (book) => {
      if (book.storage_provider === 's3' || book.source_key) {
        await deleteStoredFiles(storage, [book.source_key, book.pdf_key, book.media_key]);
      }
      await fs.rm(path.join(booksDirectory, String(book.id)), { recursive: true, force: true });
    });
    if (!deleted) return response.status(404).json({ error: 'User not found.' });
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

if (config.production) {
  const dist = path.resolve(__dirname, '../dist');
  app.use(express.static(dist));
  app.get(/.*/, (_request, response) => response.sendFile(path.join(dist, 'index.html')));
}

app.use((error, _request, response, _next) => {
  console.error(error);
  if (response.headersSent) return _next(error);
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return response.status(413).json({ error: `Uploads may be at most ${config.maxUploadSize / 1024 / 1024} MB.` });
  }
  if (error.exposed) {
    return response.status(error.status || 400).json({ error: error.message });
  }
  response.status(500).json({ error: 'An unexpected server error occurred.' });
});

export default app;
