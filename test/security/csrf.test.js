const test = require('node:test');
const assert = require('node:assert/strict');

const {
  attachCsrfToken,
  attachCsrfTokenForAuthenticatedUser,
  verifyCsrfToken
} = require('../../src/middleware/csrf');

function createResponse() {
  return { locals: {} };
}

test('public informational requests do not receive a session-backed CSRF token', () => {
  const req = { session: {} };
  const res = createResponse();
  let continued = false;

  attachCsrfTokenForAuthenticatedUser(req, res, () => {
    continued = true;
  });

  assert.equal(continued, true);
  assert.equal(req.session.csrfToken, undefined);
  assert.equal(res.locals.csrfToken, null);
});

test('authenticated requests receive a session-backed CSRF token', () => {
  const req = {
    session: {
      user: { id: 'user-id' }
    }
  };
  const res = createResponse();

  attachCsrfTokenForAuthenticatedUser(req, res, () => {});

  assert.match(req.session.csrfToken, /^[a-f0-9]{64}$/);
  assert.equal(res.locals.csrfToken, req.session.csrfToken);
});

test('public form routes can explicitly attach a CSRF token', () => {
  const req = { session: {} };
  const res = createResponse();

  attachCsrfToken(req, res, () => {});

  assert.match(req.session.csrfToken, /^[a-f0-9]{64}$/);
  assert.equal(res.locals.csrfToken, req.session.csrfToken);
});

test('verifyCsrfToken accepts the matching token', () => {
  const req = {
    session: { csrfToken: 'abc123' },
    body: { _csrf: 'abc123' },
    get: () => undefined
  };

  let error;

  verifyCsrfToken(req, {}, (nextError) => {
    error = nextError;
  });

  assert.equal(error, undefined);
});

test('verifyCsrfToken rejects an invalid token', () => {
  const req = {
    session: { csrfToken: 'abc123' },
    body: { _csrf: 'different' },
    get: () => undefined
  };

  let error;

  verifyCsrfToken(req, {}, (nextError) => {
    error = nextError;
  });

  assert.equal(error.status, 403);
});
