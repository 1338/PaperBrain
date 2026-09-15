import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import { S3Client, CreateBucketCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { encryptSecret } from '../server/settings.js';
import { putStoredFile, streamStoredFile, deleteStoredFiles, testStorage } from '../server/storage.js';

test('S3 upload, authenticated proxy range response, and deletion after switching to local', {
  skip: !process.env.TEST_S3_ENDPOINT, timeout: 30000
}, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'paperbrain-s3-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const settings = {
    provider: 's3', endpoint: process.env.TEST_S3_ENDPOINT, region: 'us-east-1',
    bucket: 'paperbrain-test-' + Date.now(), forcePathStyle: true,
    accessKey: 'release-test', encryptedSecretKey: encryptSecret('release-test-password')
  };
  const s3 = new S3Client({
    endpoint: settings.endpoint, region: settings.region, forcePathStyle: true,
    credentials: { accessKeyId: settings.accessKey, secretAccessKey: 'release-test-password' }
  });
  await s3.send(new CreateBucketCommand({ Bucket: settings.bucket }));
  await testStorage(settings);
  const file = path.join(directory, 'source.pdf');
  await fs.writeFile(file, '%PDF-1.7 test contents');
  await putStoredFile(settings, file, 'book.pdf', 'application/pdf');
  const app = express();
  app.get('/file', async (req, res, next) => {
    try { await streamStoredFile(settings, 'book.pdf', req, res, 'application/pdf', 'book.pdf'); }
    catch (error) { next(error); }
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const result = await fetch('http://127.0.0.1:' + server.address().port + '/file', { headers: { Range: 'bytes=0-7' } });
  assert.equal(result.status, 206);
  assert.equal(await result.text(), '%PDF-1.7');
  assert.equal(result.headers.get('content-range'), 'bytes 0-7/22');
  await deleteStoredFiles({ ...settings, provider: 'local' }, ['book.pdf', 'book.pdf']);
  await assert.rejects(s3.send(new HeadObjectCommand({ Bucket: settings.bucket, Key: 'book.pdf' })),
    error => error.$metadata.httpStatusCode === 404);
});
