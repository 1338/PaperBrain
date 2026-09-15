import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import JSZip from 'jszip';
import { chapterText, convertEpubToPdf } from '../server/epub-to-pdf.js';

test('chapterText produces readable plain text', () => {
  assert.equal(
    chapterText('<h1>Chapter One</h1><p>Hello <em>reader</em>.</p>'),
    'CHAPTER ONE\n\nHello reader.'
  );
});

test('converts a minimal EPUB into a paginated PDF', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'paperbrain-epub-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const epubPath = path.join(directory, 'book.epub');
  const pdfPath = path.join(directory, 'book.pdf');
  const archive = new JSZip();

  archive.file('mimetype', 'application/epub+zip');
  archive.file('META-INF/container.xml', `<?xml version="1.0"?>
    <container>
      <rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles>
    </container>`);
  archive.file('OEBPS/content.opf', `<?xml version="1.0"?>
    <package xmlns:dc="http://purl.org/dc/elements/1.1/">
      <metadata>
        <dc:title>Test Book</dc:title>
        <dc:creator>Test Author</dc:creator>
        <dc:identifier>urn:isbn:978-0-306-40615-7</dc:identifier>
      </metadata>
      <manifest>
        <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine><itemref idref="chapter"/></spine>
    </package>`);
  archive.file('OEBPS/chapter.xhtml',
    '<html><head><title>Opening</title></head><body><h1>Opening</h1><p>Hello world.</p></body></html>');
  await fs.writeFile(epubPath, await archive.generateAsync({ type: 'nodebuffer' }));

  const result = await convertEpubToPdf(epubPath, pdfPath);
  const pdf = await fs.readFile(pdfPath);

  assert.equal(result.title, 'Test Book');
  assert.equal(result.author, 'Test Author');
  assert.equal(result.isbn, '9780306406157');
  assert.ok(result.pages >= 2);
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
});
