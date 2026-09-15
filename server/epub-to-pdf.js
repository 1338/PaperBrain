import fs from 'node:fs';
import { finished } from 'node:stream/promises';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { convert as htmlToText } from 'html-to-text';
import JSZip from 'jszip';
import PDFDocument from 'pdfkit';
import { extractIsbn } from './isbn.js';

const maxExpandedSize = 200 * 1024 * 1024;
const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  isArray: (_name, jPath) => [
    'package.manifest.item',
    'package.spine.itemref'
  ].includes(jPath)
});

function textValue(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return value?.['#text'] ? String(value['#text']) : '';
}

function metadataText(value) {
  return (Array.isArray(value) ? value : [value]).map(textValue).join(' ');
}

function zipPath(base, relative) {
  return path.posix.normalize(path.posix.join(path.posix.dirname(base), relative));
}

async function parseEpub(epubPath) {
  const archive = await JSZip.loadAsync(await fs.promises.readFile(epubPath), {
    checkCRC32: true,
    createFolders: false
  });
  const expandedSize = Object.values(archive.files).reduce(
    (total, entry) => total + (entry.dir ? 0 : (entry._data?.uncompressedSize || 0)),
    0
  );

  if (expandedSize > maxExpandedSize) {
    throw new Error('The expanded EPUB is too large to convert safely.');
  }

  const containerFile = archive.file('META-INF/container.xml');
  if (!containerFile) throw new Error('The file is not a valid EPUB.');
  const container = xml.parse(await containerFile.async('string'));
  const rootfiles = container?.container?.rootfiles?.rootfile;
  const packagePath = (Array.isArray(rootfiles) ? rootfiles[0] : rootfiles)?.['full-path'];
  const packageFile = packagePath && archive.file(packagePath);
  if (!packageFile) throw new Error('The EPUB package document is missing.');

  const packageDocument = xml.parse(await packageFile.async('string')).package;
  const metadata = packageDocument?.metadata || {};
  const manifest = new Map(
    (packageDocument?.manifest?.item || []).map((entry) => [entry.id, entry])
  );
  const chapters = [];

  for (const reference of packageDocument?.spine?.itemref || []) {
    const item = manifest.get(reference.idref);
    if (!item?.href) continue;
    const chapterPath = zipPath(packagePath, item.href.split('#')[0]);
    const chapterFile = archive.file(chapterPath);
    if (!chapterFile) continue;
    const html = await chapterFile.async('string');
    chapters.push({
      html,
      title: textValue(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]).trim()
    });
  }

  return {
    title: textValue(metadata['dc:title']).trim() || 'Untitled book',
    author: textValue(metadata['dc:creator']).trim() || 'Unknown author',
    isbn: extractIsbn(metadataText(metadata['dc:identifier'])),
    chapters
  };
}

export function chapterText(html) {
  return htmlToText(html, {
    wordwrap: false,
    selectors: [
      { selector: 'img', format: 'skip' },
      { selector: 'a', options: { ignoreHref: true } }
    ]
  }).replace(/\n{3,}/g, '\n\n').trim();
}

export async function renderChaptersToPdf(book, pdfPath) {
  const document = new PDFDocument({
    size: 'A4',
    margins: { top: 64, right: 64, bottom: 72, left: 64 },
    bufferPages: true,
    info: { Title: book.title, Author: book.author }
  });
  const output = fs.createWriteStream(pdfPath);
  document.pipe(output);

  document.font('Helvetica-Bold').fontSize(28).text(book.title, { align: 'center' });
  document.moveDown();
  document.font('Helvetica').fontSize(15).fillColor('#555555').text(book.author, { align: 'center' });
  document.addPage();

  let includedChapters = 0;
  for (const chapter of book.chapters) {
    const text = chapterText(chapter.html);
    if (!text) continue;
    if (includedChapters > 0) document.addPage();
    if (chapter.title && chapter.title !== book.title) {
      document.font('Helvetica-Bold').fontSize(20).fillColor('#202722').text(chapter.title);
      document.moveDown();
    }
    document.font('Times-Roman').fontSize(11.5).fillColor('#202722').text(text, {
      align: 'justify',
      lineGap: 3,
      paragraphGap: 7
    });
    includedChapters += 1;
  }

  if (includedChapters === 0) {
    document.end();
    await finished(output);
    await fs.promises.unlink(pdfPath).catch(() => {});
    throw new Error('The ebook does not contain any readable chapters.');
  }

  const pages = document.bufferedPageRange().count;
  for (let page = 0; page < pages; page += 1) {
    document.switchToPage(page);
    document.font('Helvetica').fontSize(9).fillColor('#777777')
      .text(`${page + 1} / ${pages}`, 64, 805, { width: 467, align: 'center', lineBreak: false });
  }
  document.end();
  await finished(output);

  return { title: book.title, author: book.author, isbn: book.isbn, pages };
}

export async function convertEpubToPdf(epubPath, pdfPath) {
  return renderChaptersToPdf(await parseEpub(epubPath), pdfPath);
}
