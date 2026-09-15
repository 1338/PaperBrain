import { fork } from 'node:child_process';
import { pool } from './db.js';

export function startConversionQueue({ timeoutMs = Number(process.env.CONVERSION_TIMEOUT_SECONDS || 300) * 1000,
  intervalMs = 2000, jobUrl = new URL('./conversion-job.js', import.meta.url) } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new Error('Invalid conversion timeout');
  let stopped = false;
  let child;
  let timer;
  let next;
  const run = async () => {
    if (stopped) return;
    try {
      const pending = await pool.query("SELECT 1 FROM library_items WHERE status IN ('queued', 'converting') AND media_type IN ('epub', 'mobi') LIMIT 1");
      if (!pending.rows.length) { if (!stopped) next = setTimeout(run, intervalMs); return; }
    } catch (error) {
      console.error('Conversion queue unavailable:', error.message);
      if (!stopped) next = setTimeout(run, intervalMs);
      return;
    }
    if (stopped) return;
    let id;
    let timedOut = false;
    child = fork(jobUrl, [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      execArgv: ['--max-old-space-size=512'] });
    child.on('message', message => { id = message.id; });
    child.on('error', error => console.error('Conversion worker failed:', error.message));
    timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.on('exit', async (code) => {
      clearTimeout(timer);
      try {
        if (!stopped && id && (timedOut || code !== 0)) {
          await pool.query(`UPDATE library_items SET status = 'failed', error_message = $1
            WHERE id = $2 AND status = 'converting'`,
          [timedOut ? 'Conversion timed out. Try a smaller book or increase CONVERSION_TIMEOUT_SECONDS.' : 'Conversion worker stopped. Retry processing.', id]);
        }
      } catch (error) { console.error('Could not record conversion failure:', error.message); }
      if (!stopped) next = setTimeout(run, intervalMs);
    });
  };
  run();
  return () => { stopped = true; clearTimeout(next); clearTimeout(timer); child?.kill('SIGKILL'); };
}
