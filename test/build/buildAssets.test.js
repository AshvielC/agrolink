const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..', '..');

function runBuild() {
  execFileSync(
    process.execPath,
    ['src/scripts/buildAssets.js'],
    {
      cwd: projectRoot,
      stdio: 'pipe'
    }
  );

  return {
    manifest: JSON.parse(
      fs.readFileSync(
        path.join(projectRoot, 'public', 'asset-manifest.json'),
        'utf8'
      )
    ),
    serviceWorker: fs.readFileSync(
      path.join(projectRoot, 'public', 'service-worker.js'),
      'utf8'
    )
  };
}

function sha256(filePath) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}

test('repeated builds keep the same JavaScript hash and service-worker cache id', () => {
  const first = runBuild();
  const second = runBuild();

  assert.equal(
    first.manifest['/js/main.js'],
    second.manifest['/js/main.js']
  );

  assert.equal(first.serviceWorker, second.serviceWorker);
});

test('the maskable icon is not byte-for-byte identical to the regular icon', () => {
  const iconDir = path.join(
    projectRoot,
    'public',
    'images',
    'icons'
  );

  assert.notEqual(
    sha256(path.join(iconDir, 'icon-512.png')),
    sha256(path.join(iconDir, 'icon-maskable-512.png'))
  );
});
