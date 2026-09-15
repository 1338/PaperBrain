import assert from 'node:assert/strict';
import test from 'node:test';
import { api } from '../client/api.js';

test('JSON mutations retain both content type and CSRF headers', async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (_url, options) => {
    captured = options;
    return { ok: true, json: async () => ({ ok: true }) };
  };

  try {
    await api.saveAdminSettings({ publicSignup: true, smtp: {} }, 'csrf-token');
    assert.equal(captured.headers['Content-Type'], 'application/json');
    assert.equal(captured.headers['X-CSRF-Token'], 'csrf-token');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
