import assert from 'node:assert/strict';
import test from 'node:test';
import { extractIsbn, validIsbn } from '../server/isbn.js';

test('validates ISBN-10 and ISBN-13 check digits', () => {
  assert.equal(validIsbn('0-306-40615-2'), true);
  assert.equal(validIsbn('978-0-306-40615-7'), true);
  assert.equal(validIsbn('978-0-306-40615-8'), false);
});

test('extracts and normalizes a labelled ISBN', () => {
  assert.equal(extractIsbn('Copyright page — ISBN-13: 978-0-306-40615-7'), '9780306406157');
  assert.equal(extractIsbn('No publication identifier here'), null);
});
