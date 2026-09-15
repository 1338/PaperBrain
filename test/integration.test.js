import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PDFDocument } from 'pdf-lib';

test('HTTP lifecycle, ownership, settings and account revocation', {
  skip: !process.env.TEST_DATABASE_URL,
  timeout: 60000
}, async (t) => {
  // Only opt-in disposable databases are used; never fall back to the local .env.
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.NODE_ENV = 'test';
  process.env.STORAGE_PATH = await mkdtemp(path.join(os.tmpdir(), 'paperbrain-integration-'));
  process.env.SESSION_SECRET = 'integration-only-secret-never-use-in-production';
  execFileSync(process.execPath, ['server/migrate.js'], { env: process.env });
  const { default: app } = await import('../server/app.js');
  const { pool } = await import('../server/db.js');
  assert.equal(Number((await pool.query('SELECT COUNT(*) FROM users')).rows[0].count), 0,
    'Use a fresh disposable test database');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await pool.end();
    await rm(process.env.STORAGE_PATH, { recursive: true, force: true });
  });
  const base = 'http://127.0.0.1:' + server.address().port + '/api';
  function user() {
    let cookie = '';
    let csrf = '';
    return async (url, method = 'GET', body, expected = 200, extra = {}) => {
      const response = await fetch(base + url, {
        method,
        headers: { Cookie: cookie, 'X-CSRF-Token': csrf,
          ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
          ...extra },
        body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined
      });
      cookie = response.headers.getSetCookie()[0]?.split(';')[0] || cookie;
      const data = response.headers.get('content-type')?.includes('application/json')
        ? await response.json() : new Uint8Array(await response.arrayBuffer());
      assert.equal(response.status, expected, JSON.stringify(data));
      if (data.csrfToken) csrf = data.csrfToken;
      return data;
    };
  }
  const admin = user();
  const member = user();
  const anonymous = user();
  await anonymous('/library', 'GET', undefined, 401);
  const register = email => ({ email, displayName: email, password: 'test-password-123', agreeTerms: true });
  const first = await admin('/register', 'POST', register('admin@example.test'), 201);
  assert.ok(first.user.roles.includes('ROLE_ADMIN'));
  await admin('/session');
  const second = await member('/register', 'POST', register('member@example.test'), 201);
  await member('/session');
  await member('/logout', 'POST');
  await member('/login', 'POST', { email: 'member@example.test', password: 'test-password-123' });
  await member('/session');
  await member('/admin', 'GET', undefined, 403);
  await admin('/library/123/progress', 'PATCH', { page: 1 }, 403, { 'X-CSRF-Token': 'invalid' });
  const pdf = await PDFDocument.create();
  pdf.setTitle('Integration book');
  pdf.setAuthor('Test author');
  pdf.addPage(); pdf.addPage();
  const form = new FormData();
  form.append('file', new Blob([await pdf.save()], { type: 'application/pdf' }), 'book.pdf');
  const uploaded = (await admin('/library', 'POST', form, 201)).item;
  assert.equal(uploaded.title, 'Integration book');
  assert.equal(uploaded.progress, 0);
  assert.equal(uploaded.hasProgress, false);
  const edit = { title: 'Corrected title', author: 'Corrected author', isbn: '978-0-306-40615-7' };
  await member('/library/' + uploaded.id + '/metadata', 'PATCH', edit, 404);
  await admin('/library/' + uploaded.id + '/metadata', 'PATCH', { ...edit, isbn: '123' }, 400);
  const corrected = await admin('/library/' + uploaded.id + '/metadata', 'PATCH', edit);
  assert.equal(corrected.item.isbn, '9780306406157');
  assert.equal(corrected.item.title, edit.title);
  await member('/library/' + uploaded.id + '/progress', 'PATCH', { action: 'finish' }, 404);
  assert.equal((await admin('/library/' + uploaded.id + '/progress', 'PATCH', { action: 'finish' })).item.progress, 100);
  const reset = (await admin('/library/' + uploaded.id + '/progress', 'PATCH', { action: 'reset' })).item;
  assert.equal(reset.progress, 0);
  assert.equal(reset.currentPage, 0);
  assert.equal(reset.hasProgress, false);
  await member('/library/' + uploaded.id + '/pdf', 'GET', undefined, 404);
  await member('/library/' + uploaded.id + '/progress', 'PATCH', { page: 2 }, 404);
  await admin('/library/' + uploaded.id + '/pdf', 'GET', undefined, 206, { Range: 'bytes=0-9' });
  const saved = await admin('/library/' + uploaded.id + '/progress', 'PATCH', { page: 2 });
  assert.equal(saved.item.progress, 100);
  const wave = Buffer.alloc(44 + 4000);
  wave.write('RIFF'); wave.writeUInt32LE(wave.length - 8, 4);
  wave.write('WAVEfmt ', 8); wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(8000, 24); wave.writeUInt32LE(16000, 28);
  wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34);
  wave.write('data', 36); wave.writeUInt32LE(4000, 40);
  const audioForm = new FormData();
  audioForm.append('file', new Blob([wave], { type: 'audio/wav' }), 'short.wav');
  const audio = (await admin('/library', 'POST', audioForm, 201)).item;
  const audioSaved = await admin('/library/' + audio.id + '/progress', 'PATCH',
    { seconds: 0.125, duration: 0.25, started: true });
  assert.equal(audioSaved.item.progress, 50);
  assert.equal((await admin('/library/' + audio.id + '/progress', 'PATCH', { action: 'finish' })).item.progress, 100);
  assert.equal((await admin('/library/' + audio.id + '/progress', 'PATCH', { action: 'reset' })).item.hasProgress, false);
  await member('/library/' + audio.id + '/audio', 'GET', undefined, 404);
  await admin('/library/' + audio.id, 'DELETE');
  const archive = new JSZip();
  archive.file('mimetype', 'application/epub+zip');
  archive.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>');
  archive.file('book.opf', '<package><metadata><dc:title>Queued book</dc:title></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/></spine></package>');
  archive.file('one.xhtml', '<html><body><h1>One</h1><p>Background conversion.</p></body></html>');
  const epubForm = new FormData();
  epubForm.append('file', new Blob([await archive.generateAsync({ type: 'nodebuffer' })]), 'queued.epub');
  const queued = (await admin('/library', 'POST', epubForm, 202)).item;
  assert.equal(queued.status, 'queued');
  const { startConversionQueue } = await import('../server/conversion-queue.js');
  let stopQueue = startConversionQueue({ timeoutMs: 10000, intervalMs: 100 });
  t.after(() => stopQueue());
  async function waitStatus(status) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const row = (await pool.query('SELECT * FROM library_items WHERE id = $1', [queued.id])).rows[0];
      if (row.status === status) return row;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.fail('Queue did not reach ' + status);
  }
  assert.equal((await waitStatus('ready')).title, 'Queued book');
  stopQueue();
  // Simulate an interrupted conversion; it must resume after a runner restart.
  await pool.query("UPDATE library_items SET status = 'converting' WHERE id = $1", [queued.id]);
  stopQueue = startConversionQueue({ timeoutMs: 10000, intervalMs: 100 });
  await waitStatus('ready');
  stopQueue();
  const stalledWorker = path.join(process.env.STORAGE_PATH, 'stalled.cjs');
  await writeFile(stalledWorker, `process.send({id:${JSON.stringify(queued.id)}});setInterval(()=>{},1000);`);
  await pool.query("UPDATE library_items SET status = 'converting' WHERE id = $1", [queued.id]);
  stopQueue = startConversionQueue({ timeoutMs: 500, intervalMs: 100, jobUrl: pathToFileURL(stalledWorker) });
  assert.match((await waitStatus('failed')).error_message, /timed out/);
  stopQueue();
  await admin('/library/' + queued.id + '/retry', 'POST', undefined, 202);
  stopQueue = startConversionQueue({ timeoutMs: 10000, intervalMs: 100 });
  await waitStatus('ready');
  stopQueue();
  await admin('/library/' + queued.id, 'DELETE');
  // Failed cleanup must preserve both account and file keys for a later retry.
  const { deleteLibraryRecords } = await import('../server/deletion.js');
  for (const deleteUser of [false, true]) {
    await assert.rejects(deleteLibraryRecords(pool, {
      userId: first.user.id, itemId: uploaded.id, deleteUser
    }, async () => { throw new Error('Simulated storage outage'); }), /storage outage/);
    assert.equal((await pool.query('SELECT id FROM users WHERE id = $1', [first.user.id])).rowCount, 1);
    assert.equal((await pool.query('SELECT id FROM library_items WHERE id = $1', [uploaded.id])).rowCount, 1);
  }
  const settings = (await admin('/admin')).settings;
  await admin('/admin/settings', 'PUT', { ...settings, publicSignup: false });
  await anonymous('/register', 'POST', register('closed@example.test'), 403);
  execFileSync(process.execPath, ['server/recover-account.js', 'member@example.test'], {
    env: process.env, input: 'recovered-password-123\n'
  });
  await member('/library', 'GET', undefined, 401);
  await member('/login', 'POST', { email: 'member@example.test', password: 'test-password-123' }, 401);
  await member('/login', 'POST', { email: 'member@example.test', password: 'recovered-password-123' });
  await admin('/admin/users/' + second.user.id, 'PATCH', { active: false });
  await member('/library', 'GET', undefined, 403);
  await admin('/library/' + uploaded.id, 'DELETE');
  await admin('/admin/users/' + second.user.id, 'DELETE');
  assert.equal((await admin('/library')).items.length, 0);
  await admin('/logout', 'POST');
  await admin('/library', 'GET', undefined, 401);
});
