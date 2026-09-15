import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from './db.js';
import { config } from './config.js';
import { convertEpubToPdf } from './epub-to-pdf.js';
import { convertMobiToPdf } from './mobi-to-pdf.js';
import { storageConfiguration, putStoredFile, deleteStoredFiles } from './storage.js';
const booksDirectory = path.join(path.resolve(config.storagePath), 'books');

export async function convertLibraryItem(item, userId) {
  const bookDirectory = path.join(booksDirectory, String(item.id));
  const extension = item.media_type === 'mobi' ? '.mobi' : '.epub';
  const sourcePath = item.source_path || path.join(bookDirectory, `source${extension}`);
  const pdfPath = path.join(bookDirectory, 'book.pdf');
  await fs.mkdir(bookDirectory, { recursive: true });
  await fs.rm(pdfPath, { force: true });

  const converted = item.media_type === 'mobi'
    ? await convertMobiToPdf(sourcePath, pdfPath, path.join(bookDirectory, 'resources'))
    : await convertEpubToPdf(sourcePath, pdfPath);
  const updated = await pool.query(
    `UPDATE library_items
     SET title = $1, author = $2, isbn = $3,
         epub_path = CASE WHEN media_type = 'epub' THEN $4 ELSE NULL END,
         source_path = $4, pdf_path = $5,
         total_pages = $6, current_page = LEAST(current_page, $6),
         status = 'converting', error_message = NULL
     WHERE id = $7 AND user_id = $8 RETURNING *`,
    [converted.title, converted.author, converted.isbn, sourcePath, pdfPath, converted.pages, item.id, userId]
  );
  return updated.rows[0];
}

export async function persistToConfiguredStorage(item, userId, extension) {
  const storage = await storageConfiguration();
  if (storage.provider !== 's3') return item;
  if (!storage.bucket) throw new Error('S3 storage is selected but no bucket is configured.');

  const base = `users/${userId}/items/${item.id}`;
  const sourceKey = `${base}/source${extension}`;
  let pdfKey = null;
  let mediaKey = null;
  // Record intended keys before network writes so a killed worker cannot leave
  // untracked objects. Deletion can clean these even before provider is committed.
  pdfKey = ['epub', 'mobi'].includes(item.media_type) ? `${base}/book.pdf`
    : item.media_type === 'pdf' ? sourceKey : null;
  mediaKey = item.media_type === 'audio' ? sourceKey : null;
  await pool.query('UPDATE library_items SET source_key = $1, pdf_key = $2, media_key = $3 WHERE id = $4',
    [sourceKey, pdfKey, mediaKey, item.id]);
  const uploaded = [];
  try {
    await putStoredFile(storage, item.source_path, sourceKey,
      item.media_type === 'pdf' ? 'application/pdf' : item.media_type === 'audio'
        ? (extension === '.wav' ? 'audio/wav' : 'audio/mpeg')
        : item.media_type === 'mobi' ? 'application/x-mobipocket-ebook' : 'application/epub+zip');
    uploaded.push(sourceKey);
    if (['epub', 'mobi'].includes(item.media_type)) {
      pdfKey = `${base}/book.pdf`;
      await putStoredFile(storage, item.pdf_path, pdfKey, 'application/pdf');
      uploaded.push(pdfKey);
    } else if (item.media_type === 'pdf') {
      pdfKey = sourceKey;
    } else {
      mediaKey = sourceKey;
    }
    const result = await pool.query(
      `UPDATE library_items SET storage_provider = 's3', source_key = $1, pdf_key = $2, media_key = $3
       WHERE id = $4 AND user_id = $5 RETURNING *`,
      [sourceKey, pdfKey, mediaKey, item.id, userId]
    );
    // The database now points to S3. Failure to remove the local cache must not
    // delete the committed remote objects or make the book unavailable.
    await fs.rm(path.join(booksDirectory, String(item.id)), { recursive: true, force: true })
      .catch(error => console.warn(`Could not remove local cache for item ${item.id}:`, error.message));
    return result.rows[0];
  } catch (error) {
    await deleteStoredFiles(storage, uploaded).catch(() => {});
    throw error;
  }
}
