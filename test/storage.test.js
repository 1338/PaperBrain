import test from 'node:test';
import assert from 'node:assert/strict';
import { testStorage } from '../server/storage.js';

test('local storage health check does not require an object store', async () => {
  await assert.doesNotReject(() => testStorage({ provider: 'local' }));
});
