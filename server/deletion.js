// Keep records (and storage keys) until cleanup succeeds, so deletion is retryable.
// Storage deletion must be idempotent: a failed attempt may have removed some files.
export async function deleteLibraryRecords(pool, { userId, itemId, deleteUser = false }, cleanup) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const owner = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!owner.rows.length) {
      await client.query('ROLLBACK');
      return false;
    }
    const books = await client.query(
      `SELECT id, status, storage_provider, source_key, pdf_key, media_key FROM library_items
       WHERE user_id = $1${deleteUser ? '' : ' AND id = $2'} FOR UPDATE`,
      deleteUser ? [userId] : [userId, itemId]
    );
    if (!deleteUser && !books.rows.length) {
      await client.query('ROLLBACK');
      return false;
    }
    if (books.rows.some(book => ['processing', 'converting'].includes(book.status))) {
      const error = new Error('Wait for processing to finish before deleting this item or account.');
      error.status = 409;
      error.exposed = true;
      throw error;
    }
    for (const book of books.rows) await cleanup(book);
    await client.query(deleteUser
      ? 'DELETE FROM users WHERE id = $1'
      : 'DELETE FROM library_items WHERE id = $1', [deleteUser ? userId : itemId]);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
