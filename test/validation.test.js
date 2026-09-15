import assert from 'node:assert/strict';
import test from 'node:test';
import { publicUser, validEmail, validPassword, validateRegistration } from '../server/validation.js';

const valid = {
  displayName: 'Ada',
  email: 'ada@example.com',
  password: 'correct horse',
  agreeTerms: true
};

test('accepts a valid registration', () => {
  assert.equal(validateRegistration(valid), null);
});

test('requires terms and a sufficiently long password', () => {
  assert.match(validateRegistration({ ...valid, agreeTerms: false }), /agree/);
  assert.match(validateRegistration({ ...valid, password: 'short' }), /between/);
});

test('rejects malformed email addresses', () => {
  assert.match(validateRegistration({ ...valid, email: 'not-an-email' }), /valid email/);
});

test('profile email and password validation use account limits', () => {
  assert.equal(validEmail('reader@example.com'), true);
  assert.equal(validEmail('invalid'), false);
  assert.equal(validPassword('sixsix'), true);
  assert.equal(validPassword('short'), false);
});

test('publicUser omits the password hash', () => {
  assert.deepEqual(publicUser({
    id: 1,
    email: 'ada@example.com',
    display_name: 'Ada',
    roles: ['ROLE_USER'],
    email_verified: true,
    is_active: true,
    password: 'secret hash'
  }), {
    id: 1,
    email: 'ada@example.com',
    displayName: 'Ada',
    roles: ['ROLE_USER'],
    emailVerified: true,
    active: true
  });
});
