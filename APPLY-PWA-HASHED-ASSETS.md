# Apply the AgroLink hashed-asset PWA patch

## Back up first
Copy your AgroLink project folder before applying this patch.

## Copy the replacement files
Copy this ZIP's contents into the root of your AgroLink project and allow Windows to replace matching files.

If this older file still exists, delete it after copying:

```text
public/videos/Agrolink7.mp4
```

The replacement source file uses lowercase consistently:

```text
public/videos/agrolink7.mp4
```

## Build and validate
From your AgroLink folder run:

```cmd
npm install
npm run build
npm run check
npm start
```

`npm run build` creates content-hashed assets under:

```text
public/dist/assets
```

It also regenerates:

```text
public/asset-manifest.json
public/manifest.webmanifest
public/offline.html
public/service-worker.js
```

## Chrome / Edge refresh after applying the patch
Open AgroLink, then use:

```text
F12 → Application → Service Workers → Unregister
F12 → Application → Storage → Clear site data
```

Close the tab, reopen AgroLink, and refresh once.

## Railway deployment commands
Use:

```text
Build Command: npm run build
Start Command: npm start
```

The stable PWA control files are revalidated. Only generated content-hashed files under `public/dist/assets` receive long-term immutable caching.
