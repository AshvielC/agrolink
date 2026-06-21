const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..', '..');

function writeFile(filePath, content = 'test') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

test('release cleaner removes local certificates and preserves upload placeholders', () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'agrolink-clean-package-')
  );

  const copiedScript = path.join(
    tempRoot,
    'src',
    'scripts',
    'cleanPackage.js'
  );

  fs.mkdirSync(path.dirname(copiedScript), {
    recursive: true
  });

  fs.copyFileSync(
    path.join(projectRoot, 'src', 'scripts', 'cleanPackage.js'),
    copiedScript
  );

  writeFile(path.join(tempRoot, '.env'), 'SECRET=test');
  writeFile(path.join(tempRoot, 'certs', 'agrolink-local.pfx'));
  writeFile(path.join(tempRoot, 'certs', 'agrolink-local.cer'));
  writeFile(path.join(tempRoot, 'public', 'uploads', 'products', 'product.jpg'));
  writeFile(path.join(tempRoot, 'public', 'uploads', 'profiles', 'profile.jpg'));
  writeFile(path.join(tempRoot, 'storage', 'user-documents', 'document.pdf'));
  writeFile(path.join(tempRoot, 'storage', 'report-evidence', 'evidence.pdf'));

  execFileSync(process.execPath, [copiedScript], {
    cwd: tempRoot,
    stdio: 'pipe'
  });

  assert.equal(fs.existsSync(path.join(tempRoot, '.env')), false);
  assert.equal(fs.existsSync(path.join(tempRoot, 'certs')), false);

  for (const relativePath of [
    'public/uploads/products/.gitkeep',
    'public/uploads/profiles/.gitkeep',
    'storage/user-documents/.gitkeep',
    'storage/report-evidence/.gitkeep'
  ]) {
    assert.equal(
      fs.existsSync(path.join(tempRoot, relativePath)),
      true,
      `${relativePath} should exist after cleanup`
    );
  }

  fs.rmSync(tempRoot, {
    recursive: true,
    force: true
  });
});
