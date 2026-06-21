const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(
    path.join(projectRoot, relativePath),
    'utf8'
  );
}

function position(source, text) {
  const index = source.indexOf(text);

  assert.notEqual(
    index,
    -1,
    `Expected to find ${text}`
  );

  return index;
}

test('app exposes separate liveness and readiness endpoints', () => {
  const appSource = read('src/app.js');

  assert.match(appSource, /app\.get\(['"]\/healthz['"]/);
  assert.match(appSource, /app\.get\(['"]\/readyz['"]/);
});

test('session validation and selective CSRF attachment run before notification queries', () => {
  const appSource = read('src/app.js');

  const validationIndex = position(
    appSource,
    'app.use(validateSessionUser)'
  );

  const csrfIndex = position(
    appSource,
    'app.use(attachCsrfTokenForAuthenticatedUser)'
  );

  const notificationsIndex = position(
    appSource,
    'app.use(attachNotificationLocals)'
  );

  assert.ok(validationIndex < notificationsIndex);
  assert.ok(csrfIndex < notificationsIndex);
});

test('source code no longer reads x-forwarded-for directly', () => {
  const srcRoot = path.join(projectRoot, 'src');
  const matches = [];

  function walk(directory) {
    for (const entry of fs.readdirSync(directory, {
      withFileTypes: true
    })) {
      const filePath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        walk(filePath);
        continue;
      }

      if (!entry.name.endsWith('.js')) continue;

      const source = fs.readFileSync(filePath, 'utf8');

      if (/x-forwarded-for/i.test(source)) {
        matches.push(path.relative(projectRoot, filePath));
      }
    }
  }

  walk(srcRoot);

  assert.deepEqual(matches, []);
});
