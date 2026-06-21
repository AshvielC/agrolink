const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getClientIp,
  normalizeIpAddress
} = require('../../src/utils/requestIp');

test('getClientIp uses Express req.ip instead of reading a raw forwarded header', () => {
  const req = {
    ip: '203.0.113.10',
    socket: { remoteAddress: '127.0.0.1' },
    headers: {
      'x-forwarded-for': '198.51.100.77'
    }
  };

  assert.equal(getClientIp(req), '203.0.113.10');
});

test('getClientIp falls back to the socket address when req.ip is malformed', () => {
  const req = {
    ip: '198.51.100.77, attacker-controlled-text',
    socket: { remoteAddress: '127.0.0.1' }
  };

  assert.equal(getClientIp(req), '127.0.0.1');
});

test('normalizeIpAddress rejects non-IP text and accepts IPv6', () => {
  assert.equal(normalizeIpAddress('not-an-ip-address'), '');
  assert.equal(normalizeIpAddress('::1'), '::1');
});
