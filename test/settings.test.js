import assert from 'node:assert/strict';
import test from 'node:test';
import { decryptSecret, encryptSecret } from '../server/settings.js';

test('SMTP secrets are encrypted and decryptable', () => {
  const encrypted = encryptSecret('smtp-password');
  assert.notEqual(encrypted, 'smtp-password');
  assert.equal(decryptSecret(encrypted), 'smtp-password');
});
