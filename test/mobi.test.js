import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { convertMobiToPdf } from '../server/mobi-to-pdf.js';
import { pdfMetadata } from '../server/media.js';

function fixture(encryption = 0) {
  const html = Buffer.from('<html><head><title>Chapter</title></head><body><h1>Chapter</h1><p>A readable MOBI book.</p></body></html>');
  const title = Buffer.from('MOBI fixture');
  const header = Buffer.alloc(94);
  header.write('BOOKMOBI', 60);
  header.writeUInt16BE(2, 76);
  header.writeUInt32BE(94, 78);
  header.writeUInt32BE(94 + 260 + title.length, 86);
  const record = Buffer.alloc(248);
  record.writeUInt16BE(1, 0);
  record.writeUInt32BE(html.length, 4);
  record.writeUInt16BE(1, 8);
  record.writeUInt16BE(4096, 10);
  record.writeUInt16BE(encryption, 12);
  record.write('MOBI', 16);
  record.writeUInt32BE(232, 20);
  record.writeUInt32BE(2, 24);
  record.writeUInt32BE(65001, 28);
  record.writeUInt32BE(6, 36);
  record.writeUInt32BE(260, 84);
  record.writeUInt32BE(title.length, 88);
  record.writeUInt32BE(0xffffffff, 108);
  record.writeUInt32BE(0xffffffff, 244);
  record.writeUInt32BE(64, 128);
  const exth = Buffer.alloc(12);
  exth.write('EXTH');
  exth.writeUInt32BE(12, 4);
  return Buffer.concat([header, record, exth, title, html]);
}

test('converts classic MOBI and rejects DRM and truncated files', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'paperbrain-mobi-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source.mobi');
  const output = path.join(directory, 'book.pdf');
  const resources = path.join(directory, 'resources');
  await fs.writeFile(source, fixture());
  const result = await convertMobiToPdf(source, output, resources);
  assert.equal(result.title, 'MOBI fixture');
  assert.ok((await pdfMetadata(output)).pages >= 2);
  await fs.writeFile(source, fixture(2));
  await assert.rejects(convertMobiToPdf(source, output, resources), /DRM/);
  await fs.writeFile(source, fixture().subarray(0, 100));
  await assert.rejects(convertMobiToPdf(source, output, resources), /truncated/);
});
