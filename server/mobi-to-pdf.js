import fs from 'node:fs/promises';
import { initMobiFile } from '@lingo-reader/mobi-parser';
import { extractIsbn } from './isbn.js';
import { renderChaptersToPdf } from './epub-to-pdf.js';

function htmlTitle(html) {
  return String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?.replace(/<[^>]+>/g, '').trim() || '';
}

export async function convertMobiToPdf(mobiPath, pdfPath, resourceDirectory) {
  await fs.mkdir(resourceDirectory, { recursive: true });
  const data = await fs.readFile(mobiPath);
  if (data.length < 86 || data.subarray(60, 68).toString() !== 'BOOKMOBI') {
    throw new Error('The MOBI file header is invalid.');
  }
  const firstRecord = data.readUInt32BE(78);
  if (firstRecord + 248 > data.length) throw new Error('The MOBI file is truncated.');
  if (data.readUInt16BE(firstRecord + 12) !== 0) {
    throw new Error('DRM-protected MOBI files are not supported.');
  }
  if (data.readUInt32BE(firstRecord + 36) >= 8) {
    throw new Error('KF8-only books are not supported yet. Convert this book to EPUB before uploading.');
  }
  const mobi = await initMobiFile(new Uint8Array(data), resourceDirectory);
  try {
    const metadata = mobi.getMetadata();
    const chapters = mobi.getSpine().map((entry) => {
      const loaded = mobi.loadChapter(entry.id);
      return { html: loaded?.html || entry.text || '', title: htmlTitle(loaded?.html || entry.text) };
    });
    return await renderChaptersToPdf({
      title: metadata.title?.trim() || 'Untitled book',
      author: metadata.author?.filter(Boolean).join(', ') || 'Unknown author',
      isbn: extractIsbn(JSON.stringify(metadata)) || extractIsbn(data.subarray(0, 1024 * 1024).toString('latin1')),
      chapters
    }, pdfPath);
  } finally {
    mobi.destroy();
  }
}
