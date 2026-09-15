import bcrypt from 'bcryptjs';
import { pool } from './db.js';
import { validEmail, validPassword } from './validation.js';

// Server access is the authority for this operation. Never accept a password in argv.
const email = process.argv[2]?.trim().toLowerCase();
try {
  if (!validEmail(email) || process.argv.length !== 3 || process.stdin.isTTY) {
    throw new Error('Usage: npm run account:recover -- user@example.com (supply the new password on standard input)');
  }
  let password = '';
  for await (const chunk of process.stdin) {
    password += chunk;
    if (password.length > 4098) throw new Error('Password is too long.');
  }
  password = password.replace(/\r?\n$/, '');
  if (!validPassword(password) || password.length < 12 || /[\r\n]/.test(password)) {
    throw new Error('Use a password of 12–4096 characters on a single line.');
  }
  const hash = await bcrypt.hash(password, 12);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('UPDATE users SET password = $1 WHERE email = $2 RETURNING id', [hash, email]);
    if (!result.rows.length) throw new Error('Account not found.');
    const exists = await client.query("SELECT to_regclass('public.session') AS name");
    if (exists.rows[0].name) await client.query("DELETE FROM session WHERE sess->>'userId' = $1", [String(result.rows[0].id)]);
    await client.query('COMMIT');
    console.log('Password replaced and existing sessions revoked. Roles and verification status unchanged.');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { await pool.end(); }
