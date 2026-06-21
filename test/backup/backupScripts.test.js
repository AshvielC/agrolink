const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('local backup script includes database and uploaded file locations', () => {
  const script = read('scripts/backup-agrolink-local.ps1');

  assert.match(script, /mongodump/);
  assert.match(script, /mongodb\.archive\.gz/);
  assert.match(script, /uploads-and-storage\.zip/);
  assert.match(script, /public\/uploads\/products/);
  assert.match(script, /public\/uploads\/profiles/);
  assert.match(script, /storage\/user-documents/);
  assert.match(script, /storage\/report-evidence/);
});

test('restore test script refuses unsafe restore targets', () => {
  const script = read('scripts/restore-test-agrolink-local.ps1');

  assert.match(script, /RESTORE_TEST_MONGODB_URI/);
  assert.match(script, /must not equal MONGODB_URI/);
  assert.match(script, /test\|restore\|sandbox/);
  assert.match(script, /mongorestore/);
  assert.match(script, /--drop/);
});
