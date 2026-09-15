import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { audioMetadata, inspectUpload, pdfMetadata, pdfPageCount } from '../server/media.js';

function waveFile(seconds = 0.25, sampleRate = 8000) {
  const dataLength = Math.floor(seconds * sampleRate) * 2;
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);
  return buffer;
}

test('recognizes PDF, MP3, WAV, EPUB, and MOBI signatures', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'paperbrain-media-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const mobi = Buffer.alloc(68);
  mobi.write('BOOKMOBI', 60);
  const fixtures = [
    ['book.pdf', Buffer.from('%PDF-1.7'), 'pdf'],
    ['audio.mp3', Buffer.from('ID3\x04\x00\x00'), 'audio'],
    ['audio.wav', Buffer.from('RIFF\x00\x00\x00\x00WAVE'), 'audio'],
    ['book.epub', Buffer.from([0x50, 0x4b, 0x03, 0x04]), 'epub'],
    ['book.mobi', mobi, 'mobi']
  ];

  for (const [name, contents, expected] of fixtures) {
    const file = path.join(directory, name);
    await fs.writeFile(file, contents);
    assert.equal((await inspectUpload(file, name)).mediaType, expected);
  }
});

test('rejects a file whose contents do not match its extension', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'paperbrain-invalid-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'fake.pdf');
  await fs.writeFile(file, 'not a PDF');
  await assert.rejects(inspectUpload(file, 'fake.pdf'), /not a valid PDF/);
});

test('counts pages in an uploaded PDF', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'paperbrain-pdf-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'book.pdf');
  const document = await PDFDocument.create();
  document.setTitle('Metadata Title');
  document.setAuthor('Metadata Author');
  document.addPage();
  document.addPage();
  await fs.writeFile(file, await document.save());
  assert.equal(await pdfPageCount(file), 2);
  const metadata = await pdfMetadata(file);
  assert.equal(metadata.title, 'Metadata Title');
  assert.equal(metadata.author, 'Metadata Author');
});

test('reads sub-minute audio duration during upload', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'paperbrain-audio-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'short.wav');
  await fs.writeFile(file, waveFile());
  const metadata = await audioMetadata(file);
  assert.ok(metadata.duration > 0.2 && metadata.duration < 0.3);
});
