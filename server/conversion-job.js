import path from 'node:path';
import { pool } from './db.js';
import { convertLibraryItem, persistToConfiguredStorage } from './processing.js';

// One conversion per database, including across multiple application instances.
const disconnected = () => process.exit(1);
process.on('disconnect', disconnected);
const client = await pool.connect();
let item;
try {
  const lock = await client.query('SELECT pg_try_advisory_lock(7241931) AS acquired');
  if (lock.rows[0].acquired) {
    const claimed = await client.query(`UPDATE library_items SET status = 'converting'
      WHERE id = (SELECT id FROM library_items WHERE status IN ('queued', 'converting')
      AND media_type IN ('epub', 'mobi') ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING *`);
    item = claimed.rows[0];
    if (item) {
      process.send?.({ id: item.id });
      if (!(item.storage_provider === 's3' && item.pdf_key)) {
        const converted = await convertLibraryItem(item, item.user_id);
        await persistToConfiguredStorage(converted, item.user_id, path.extname(item.original_filename).toLowerCase());
      }
      await client.query("UPDATE library_items SET status = 'ready', error_message = NULL WHERE id = $1", [item.id]);
    }
  }
} catch (error) {
  if (item) await client.query("UPDATE library_items SET status = 'failed', error_message = $1 WHERE id = $2",
    [String(error.message).slice(0, 1000), item.id]);
} finally {
  await client.query('SELECT pg_advisory_unlock(7241931)');
  client.release();
  await pool.end();
  process.removeListener('disconnect', disconnected);
  process.disconnect?.();
}
