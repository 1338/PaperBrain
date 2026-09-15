import app from './app.js';
import { config } from './config.js';
import { startConversionQueue } from './conversion-queue.js';

const stopQueue = startConversionQueue();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  stopQueue();
  process.exit(0);
});

app.listen(config.port, () => {
  console.log(`PaperBrain API listening on http://localhost:${config.port}`);
});
