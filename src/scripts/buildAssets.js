const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
let JavaScriptObfuscator = null;

try {
  JavaScriptObfuscator = require('javascript-obfuscator');
} catch (error) {
  console.warn('javascript-obfuscator is unavailable; building a hashed main.js without obfuscation.');
}

const rootDir = path.resolve(__dirname, '..', '..');
const publicDir = path.join(rootDir, 'public');
const outputDir = path.join(publicDir, 'dist', 'assets');

function readFile(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath));
}

function readFirstExisting(relativePaths) {
  for (const relativePath of relativePaths) {
    const absolutePath = path.join(rootDir, relativePath);

    if (fs.existsSync(absolutePath)) {
      return fs.readFileSync(absolutePath);
    }
  }

  throw new Error(`Missing required asset. Checked: ${relativePaths.join(', ')}`);
}

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
}

function writeHashedAsset(assetManifest, sourceWebPath, outputStem, extension, content) {
  const hash = hashContent(content);
  const fileName = `${outputStem}.${hash}${extension}`;
  const outputPath = path.join(outputDir, fileName);
  const publicPath = `/dist/assets/${fileName}`;

  fs.writeFileSync(outputPath, content);
  assetManifest[sourceWebPath] = publicPath;

  return publicPath;
}

function replaceAll(template, replacements) {
  return Object.entries(replacements).reduce(
    (result, [token, value]) => result.split(token).join(value),
    template
  );
}

function buildServiceWorker(buildId, precacheUrls) {
  return `const STATIC_CACHE = 'agrolink-offline-${buildId}';

const PRECACHE_URLS = ${JSON.stringify(precacheUrls, null, 2)};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith('agrolink-offline-') && cacheName !== STATIC_CACHE)
          .map((cacheName) => caches.delete(cacheName))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const offlinePage = await caches.match('/offline.html');

        return offlinePage || new Response('AgroLink is offline. Please reconnect and try again.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      })
    );

    return;
  }

  if (!PRECACHE_URLS.includes(url.pathname)) return;

  event.respondWith(
    caches.match(request).then((cachedResponse) => cachedResponse || fetch(request))
  );
});
`;
}

function main() {
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const assetManifest = {};

    const mainSource = readFile('public/js/main.js').toString('utf8');
    const mainSourceHash = hashContent(Buffer.from(mainSource));

    const builtMain = JavaScriptObfuscator
        ? JavaScriptObfuscator.obfuscate(mainSource, {
            compact: true,
            controlFlowFlattening: true,
            deadCodeInjection: true,
            stringArray: true,
            stringArrayEncoding: ['base64'],
            stringArrayRotate: true,
            seed: mainSourceHash
        }).getObfuscatedCode()
        : mainSource;

  writeHashedAsset(assetManifest, '/css/styles.css', 'styles', '.css', readFile('public/css/styles.css'));
  writeHashedAsset(assetManifest, '/js/main.js', 'main', '.js', Buffer.from(builtMain));
  writeHashedAsset(assetManifest, '/js/pwa.js', 'pwa', '.js', readFile('public/js/pwa.js'));
  writeHashedAsset(assetManifest, '/css/offline.css', 'offline', '.css', readFile('public/css/offline.css'));
  writeHashedAsset(assetManifest, '/js/offline.js', 'offline', '.js', readFile('public/js/offline.js'));

  writeHashedAsset(assetManifest, '/images/icons/favicon.png', 'favicon', '.png', readFile('public/images/icons/favicon.png'));
  writeHashedAsset(assetManifest, '/images/icons/apple-touch-icon.png', 'apple-touch-icon', '.png', readFile('public/images/icons/apple-touch-icon.png'));
  writeHashedAsset(assetManifest, '/images/icons/icon-192.png', 'icon-192', '.png', readFile('public/images/icons/icon-192.png'));
  writeHashedAsset(assetManifest, '/images/icons/icon-512.png', 'icon-512', '.png', readFile('public/images/icons/icon-512.png'));
  writeHashedAsset(assetManifest, '/images/icons/icon-maskable-512.png', 'icon-maskable-512', '.png', readFile('public/images/icons/icon-maskable-512.png'));

  writeHashedAsset(
    assetManifest,
    '/videos/agrolink7.mp4',
    'agrolink7',
    '.mp4',
    readFirstExisting(['public/videos/agrolink7.mp4', 'public/videos/Agrolink7.mp4'])
  );

  writeHashedAsset(assetManifest, '/videos/about_us/for_farmers1.mp4', 'for-farmers1', '.mp4', readFile('public/videos/about_us/for_farmers1.mp4'));
  writeHashedAsset(assetManifest, '/videos/about_us/for_buyers1.mp4', 'for-buyers1', '.mp4', readFile('public/videos/about_us/for_buyers1.mp4'));
  writeHashedAsset(assetManifest, '/videos/about_us/secure_foundation1.mp4', 'secure-foundation1', '.mp4', readFile('public/videos/about_us/secure_foundation1.mp4'));
  writeHashedAsset(assetManifest, '/videos/about_us/ready_to_expand1.mp4', 'ready-to-expand1', '.mp4', readFile('public/videos/about_us/ready_to_expand1.mp4'));

  const sourceManifestPath = path.join(publicDir, 'manifest.source.webmanifest');
  const webManifest = JSON.parse(fs.readFileSync(sourceManifestPath, 'utf8'));

  webManifest.icons = webManifest.icons.map((icon) => ({
    ...icon,
    src: assetManifest[icon.src] || icon.src
  }));

  fs.writeFileSync(
    path.join(publicDir, 'manifest.webmanifest'),
    `${JSON.stringify(webManifest, null, 2)}\n`
  );

  const offlineTemplate = fs.readFileSync(path.join(publicDir, 'offline.template.html'), 'utf8');
  const offlineHtml = replaceAll(offlineTemplate, {
    '{{OFFLINE_CSS}}': assetManifest['/css/offline.css'],
    '{{OFFLINE_JS}}': assetManifest['/js/offline.js']
  });

  fs.writeFileSync(path.join(publicDir, 'offline.html'), offlineHtml);

  const buildId = hashContent(Buffer.from(JSON.stringify(assetManifest)));
  const precacheUrls = [
    '/offline.html',
    assetManifest['/css/offline.css'],
    assetManifest['/js/offline.js'],
    assetManifest['/images/icons/icon-192.png'],
    assetManifest['/images/icons/icon-512.png'],
    assetManifest['/images/icons/icon-maskable-512.png'],
    assetManifest['/images/icons/apple-touch-icon.png']
  ];

  fs.writeFileSync(
    path.join(publicDir, 'service-worker.js'),
    buildServiceWorker(buildId, precacheUrls)
  );

  fs.writeFileSync(
    path.join(publicDir, 'asset-manifest.json'),
    `${JSON.stringify(assetManifest, null, 2)}\n`
  );

  fs.rmSync(path.join(publicDir, 'dist', 'main.js'), { force: true });

  console.log(`Built ${Object.keys(assetManifest).length} hashed assets.`);
  console.log(`Asset manifest: public/asset-manifest.json`);
  console.log(`Service worker cache: agrolink-offline-${buildId}`);
}

main();
