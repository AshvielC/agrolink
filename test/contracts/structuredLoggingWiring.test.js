const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(
    path.join(root, relativePath),
    'utf8'
  );
}

test('app mounts structured request logging for production', () => {
  const source = read('src/app.js');

  assert.match(
    source,
    /attachStructuredRequestLogger/
  );

  assert.match(
    source,
    /if\s*\(config\.isProduction\)\s*\{[\s\S]*attachStructuredRequestLogger/
  );
});

test('error handler uses the structured logger', () => {
  const source = read(
    'src/middleware/errorHandler.js'
  );

  assert.match(source, /logger\.error/);
  assert.doesNotMatch(source, /console\.error/);
});
