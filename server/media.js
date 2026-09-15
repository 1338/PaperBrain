import fs from 'node:fs/promises';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractIsbn } from './isbn.js';

const extensions = new Map([
  ['.epub', 'epub'],
  ['.mobi', 'mobi'],
  ['.pdf', 'pdf'],
  ['.mp3', 'audio'],
  ['.wav', 'audio']
]);

function invalid(message) {
  return Object.assign(new Error(message), { status: 415, exposed: true });
}

export async function inspectUpload(filePath, originalName) {
  const extension = path.extname(originalName).toLowerCase();
  const mediaType = extensions.get(extension);
  if (!mediaType) throw invalid('Upload an EPUB, MOBI, PDF, MP3, or WAV file.');

  const handle = await fs.open(filePath, 'r');
  const signature = Buffer.alloc(68);
  try {
    await handle.read(signature, 0, signature.length, 0);
  } finally {
    await handle.close();
  }

  const valid = extension === '.pdf'
    ? signature.subarray(0, 5).toString() === '%PDF-'
    : extension === '.wav'
      ? signature.subarray(0, 4).toString() === 'RIFF' && signature.subarray(8, 12).toString() === 'WAVE'
      : extension === '.mp3'
        ? signature.subarray(0, 3).toString() === 'ID3' || (signature[0] === 0xff && (signature[1] & 0xe0) === 0xe0)
        : extension === '.mobi'
          ? signature.subarray(60, 68).toString() === 'BOOKMOBI'
          : signature[0] === 0x50 && signature[1] === 0x4b;

  if (!valid) throw invalid(`The selected file is not a valid ${extension.slice(1).toUpperCase()} file.`);
  return { mediaType, extension };
}

export async function pdfMetadata(filePath) {
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await fs.readFile(filePath)),
    disableWorker: true
  });
  try {
    const document = await loadingTask.promise;
    const metadata = await document.getMetadata().catch(() => null);
    const xmp = metadata?.metadata;
    const title = String(metadata?.info?.Title || xmp?.get?.('dc:title') || '').trim() || null;
    const author = String(metadata?.info?.Author || xmp?.get?.('dc:creator') || '').trim() || null;
    const text = [JSON.stringify(metadata?.info || {}), JSON.stringify(metadata?.metadata?.getAll?.() || {})];
    for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, 12); pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      text.push(content.items.map((item) => item.str || '').join(' '));
    }
    return { pages: document.numPages, title, author, isbn: extractIsbn(text.join('\n')) };
  } finally {
    await loadingTask.destroy();
  }
}

export async function pdfPageCount(filePath) {
  return (await pdfMetadata(filePath)).pages;
}

export async function audioMetadata(filePath) {
  const metadata = await parseFile(filePath, { duration: true });
  return {
    duration: Number.isFinite(metadata.format.duration) ? metadata.format.duration : null,
    title: metadata.common.title?.trim() || null,
    author: metadata.common.artist?.trim() || metadata.common.albumartist?.trim() || null,
    isbn: extractIsbn(JSON.stringify({
      barcode: metadata.common.barcode,
      catalog: metadata.common.catalogNo,
      comment: metadata.common.comment
    }))
  };
}
