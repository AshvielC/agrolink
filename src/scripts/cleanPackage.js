const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..');

const filesToRemove = [
  '.env'
];

const directoriesToRemove = [
    '.vs',
    '.vscode',
    'certs'
];

const uploadGlobs = [
  'public/uploads/products',
  'public/uploads/profiles',
  'storage/user-documents',
  'storage/report-evidence'
];

function removeFile(relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);
  if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
    fs.rmSync(absolutePath, { force: true });
    console.log(`Removed ${relativePath}`);
  }
}

function removeDirectory(relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);
  if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isDirectory()) {
    fs.rmSync(absolutePath, { recursive: true, force: true });
    console.log(`Removed ${relativePath}/`);
  }
}

function cleanUploads(relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);
  fs.mkdirSync(absolutePath, { recursive: true });

  for (const entry of fs.readdirSync(absolutePath)) {
    if (entry === '.gitkeep') continue;
    fs.rmSync(path.join(absolutePath, entry), { recursive: true, force: true });
    console.log(`Removed ${relativePath}/${entry}`);
  }

  const gitkeep = path.join(absolutePath, '.gitkeep');
  if (!fs.existsSync(gitkeep)) {
    fs.writeFileSync(gitkeep, '');
  }
}

filesToRemove.forEach(removeFile);
directoriesToRemove.forEach(removeDirectory);
uploadGlobs.forEach(cleanUploads);

console.log('Package cleanup complete.');
