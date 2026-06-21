const assert = require('node:assert/strict');
const test = require('node:test');

process.env.MONGODB_URI ||=
  'mongodb://127.0.0.1:27017/agrolink-test';

const {
  sanitizeValue,
  scrubText
} = require('../../src/services/loggerService');

const {
  sanitizeRequestPath
} = require('../../src/middleware/requestLogger');

test('structured logger redacts sensitive metadata keys', () => {
  const value = sanitizeValue({
    password: 'do-not-log-this',
    tokenHash: 'do-not-log-this-either',
    nested: {
      cookie: 'agrolink.sid=private',
      safe: 'visible'
    }
  });

  assert.equal(value.password, '[REDACTED]');
  assert.equal(value.tokenHash, '[REDACTED]');
  assert.equal(value.nested.cookie, '[REDACTED]');
  assert.equal(value.nested.safe, 'visible');
});

test('structured logger scrubs MongoDB credentials from free text', () => {
  const value = scrubText(
    'Failed mongodb+srv://user:password@example.mongodb.net/agrolink'
  );

  assert.doesNotMatch(value, /user:password/);
  assert.match(value, /\[REDACTED\]/);
});

test('request logger removes password-reset token values from paths', () => {
  assert.equal(
    sanitizeRequestPath('/reset-password/abcdef123456'),
    '/reset-password/:token'
  );
});
