# AgroLink Marketplace

AgroLink is a Node.js, Express, MongoDB, Mongoose, and EJS marketplace that connects approved farmers with approved buyers. It includes produce listings, order requests, pickup or delivery scheduling, farmer-issued receipts, internal messaging, notifications, reports, audit records, and administrator review tools.

## Core capabilities

- Buyer and farmer registration with mandatory profile details, TIN documents, and business-registration certificates
- Administrator approval workflow for buyer and farmer accounts
- Secure session-based authentication with CSRF protection, rate limits, temporary login lockouts, password reset, session invalidation after password changes, and fresh administrator reauthentication for sensitive pages
- Produce listings with image uploads, availability controls, VAT settings, stock-card history, and soft removal
- Buyer marketplace search and product-detail pages
- Order requests, stock reservation, cancellations, pickup or delivery scheduling, farmer-issued receipts, and printable order records
- Internal messages, replies, product enquiries, notifications, and notification badges
- Reports, complaints, evidence uploads, administrator review actions, CSV exports, and print-friendly pages
- Audit logging for security-sensitive and business-critical actions
- PWA assets with hashed filenames, an offline page, a service worker, and a dedicated maskable icon

## Requirements

- Node.js 22 or newer
- npm
- MongoDB Atlas or another compatible MongoDB deployment
- For production uploads: ClamAV command-line scanner
- For production PDF inspection: qpdf

Optional for local development:

- Visual Studio Code
- Windows PowerShell if you want to generate a local self-signed HTTPS certificate

## First-time local setup

Install dependencies using the committed lock file:

```bash
npm ci
```

Create a local environment file:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Edit `.env` and provide at least a valid MongoDB connection string:

```env
MONGODB_URI=mongodb+srv://YOUR_USERNAME:YOUR_PASSWORD@YOUR_CLUSTER.mongodb.net/agrolink?retryWrites=true&w=majority
```

Build the browser assets and start the development server:

```bash
npm run build
npm run dev
```

Open:

```text
http://localhost:3000
```

## Create the first administrator

Add local administrator values to `.env`:

```env
ADMIN_NAME=AgroLink Admin
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=replace-with-a-strong-local-password
```

Run:

```bash
npm run create-admin
```

Then sign in and open:

```text
/dashboard/admin
```

## Environment variables

Use `.env.example` as the template. Never commit a real `.env` file.

### Application and database

```env
NODE_ENV=development
PORT=3000
APP_NAME=AgroLink
APP_URL=http://localhost:3000
MONGODB_URI=
SESSION_SECRET=
COOKIE_SECRET=
TRUST_PROXY_HOPS=0
```

For production, `APP_URL` must be an HTTPS URL. Set `TRUST_PROXY_HOPS` only after verifying the real reverse-proxy path used by your deployment.

Generate a random secret with Node.js:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Generate separate values for `SESSION_SECRET` and `COOKIE_SECRET`.

# Production logging: debug, info, warn, or error
LOG_LEVEL=info

Railway receives newline-delimited JSON production logs.
Use @level:error, @event:http.request.failed, or @requestId:<value>
in the Railway log explorer to filter structured records.

### Login, password reset, and administrator reauthentication

```env
MAX_FAILED_LOGIN_ATTEMPTS=5
LOGIN_LOCKOUT_MINUTES=15
PASSWORD_RESET_WINDOW_MINUTES=15
PASSWORD_RESET_MAX_REQUESTS=5
PASSWORD_RESET_ACCOUNT_MAX_REQUESTS=3
ADMIN_REAUTH_MINUTES=15
```

`PASSWORD_RESET_MAX_REQUESTS` is the network-level limit. `PASSWORD_RESET_ACCOUNT_MAX_REQUESTS` is the additional per-account limit.

### SMTP for password-reset emails

```env
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=
```

SMTP is currently used for password-reset emails. Marketplace messages and normal activity notifications remain inside AgroLink.

### Upload security

```env
UPLOAD_VIRUS_SCAN_REQUIRED=false
CLAMSCAN_PATH=clamscan
UPLOAD_VIRUS_SCAN_TIMEOUT_MS=120000
UPLOAD_VIRUS_SCAN_STARTUP_TIMEOUT_MS=180000
UPLOAD_VIRUS_SCAN_MAX_CONCURRENT=2
UPLOAD_VIRUS_SCAN_MAX_QUEUED=10
REJECT_ENCRYPTED_UPLOADS=true
PDF_SECURITY_CHECK_REQUIRED=false
QPDF_PATH=qpdf
PDF_SECURITY_CHECK_TIMEOUT_MS=15000
```

In production, set:

```env
UPLOAD_VIRUS_SCAN_REQUIRED=true
PDF_SECURITY_CHECK_REQUIRED=true
```

The production server refuses to start if these required tools are unavailable.

### Optional local HTTPS

```env
HTTPS_ENABLED=false
HTTPS_PFX_PATH=certs/agrolink-local.pfx
HTTPS_PFX_PASSPHRASE=
```

For local HTTPS testing on Windows, review the local-only passphrase inside `create-local-cert.ps1`, change it before use, then run:

```powershell
.\create-local-cert.ps1
```

Set `HTTPS_ENABLED=true`, use the generated `.pfx` path, and set the matching local passphrase in `.env`. Do not share or deploy the generated `certs/` directory.

### Optional demo banner

```env
DEMO_MODE=false
DEMO_NOTICE=Demo Mode: This platform is currently being tested. Please use test information only.
```

## Available npm scripts

```text
npm run dev                         Start the development server with nodemon
npm start                           Start the server with Node.js
npm run build                       Generate hashed browser assets and PWA files
npm run check                       Run JavaScript syntax checks
npm run security:audit              Audit production dependencies
npm run security:check              Run syntax checks and the production dependency audit
npm run create-admin                Create or update the administrator account from .env
npm run db:indexes:user-identities  Apply unique email and non-empty phone-number indexes
npm run prepack:clean               Remove sensitive local files from a copied release folder
```

## Health endpoints

## Local monitoring

AgroLink exposes:

- `/healthz` for process-level liveness checks
- `/readyz` for database-backed readiness checks

Run the local health checker with:

```bash
npm run monitor:local

## Front-end build output

Readable browser source files remain under:

```text
public/js/
public/css/
public/images/
public/videos/
```

Run:

```bash
npm run build
```

The build script writes generated hashed assets under:

```text
public/dist/assets/
```

It also regenerates:

```text
public/asset-manifest.json
public/manifest.webmanifest
public/service-worker.js
public/offline.html
```

Do not edit generated files manually. The JavaScript obfuscation seed is derived from the source content so repeated builds remain stable when the source has not changed.

The maskable icon source is separate from the regular icon:

```text
public/images/icons/icon-512.png
public/images/icons/icon-maskable-512.png
```

Keep the important maskable artwork inside the safe center area.

## Upload storage

AgroLink stores local files in:

```text
public/uploads/products/
public/uploads/profiles/
storage/user-documents/
storage/report-evidence/
```

Product and profile images are re-encoded before storage. Verification documents and report evidence are stored outside the public web folder and served only through protected routes.

Use persistent storage or managed object storage before relying on uploads in a production hosting environment.

## Database indexes

Production disables automatic Mongoose index creation. Before a public launch, apply the identity indexes deliberately:

```bash
npm run db:indexes:user-identities
```

The script checks for duplicate email addresses and phone numbers before it creates the unique indexes. Resolve any reported duplicates before running it again.

## Security checks before deployment

Run:

```bash
npm ci
npm run build
npm run security:check
```

Confirm that:

```text
1. NODE_ENV=production is set in the deployed service.
2. APP_URL uses the real HTTPS domain.
3. SESSION_SECRET and COOKIE_SECRET are separate strong random values.
4. TRUST_PROXY_HOPS matches the verified deployment proxy path.
5. SMTP values are configured so password-reset emails can be sent.
6. ClamAV and qpdf are installed and reachable at the configured command paths.
7. UPLOAD_VIRUS_SCAN_REQUIRED=true and PDF_SECURITY_CHECK_REQUIRED=true are set.
8. /readyz returns HTTP 200 after MongoDB is connected.
9. Upload directories use persistent storage or managed object storage.
10. The real .env file and local certificate files are not included in Git or a shared ZIP.
```

## Railway deployment settings

Recommended Railway service settings:

```text
Build command:  npm run build
Start command:  npm start
Healthcheck:     /readyz
```

Add production environment variables in the Railway service Variables tab. Verify `TRUST_PROXY_HOPS` against the real Railway request path after deployment rather than assuming a value.

## Safe release packaging

The cleanup script is destructive. Run it only inside a copied release folder:

```bash
npm run prepack:clean
```

It removes:

```text
.env
.vs/
.vscode/
certs/
uploaded product images
uploaded profile images
private user documents
report evidence
```

After cleaning the copied folder, scan it before creating a ZIP:

```powershell
Get-ChildItem -Recurse -File -Include *.pfx,*.p12,*.pem,*.key,*.crt,*.cer,*.csr
```

The scan should not list any private certificate or key files.

## Main routes

Public routes:

```text
GET /                 Home page
GET /contact          Contact page
GET /signup           Choose buyer or farmer signup
GET /signup/:role     Signup form
GET /login            Login form
GET /forgot-password  Password-reset request form
```

Authenticated users start at:

```text
/dashboard
```

Important user areas:

```text
/dashboard/buyer/marketplace
/dashboard/buyer/orders
/dashboard/farmer/products
/dashboard/farmer/orders
/dashboard/messages
/dashboard/notifications
/dashboard/reports
```

Important administrator areas:

```text
/dashboard/admin
/dashboard/admin/users
/dashboard/admin/products
/dashboard/admin/orders
/dashboard/admin/messages
/dashboard/admin/reports
/dashboard/admin/audit
/dashboard/admin/security
/dashboard/admin/exports
```

Sensitive administrator pages require a recent administrator password confirmation.

## Git hygiene

Keep these items out of source control and shared ZIP files:

```text
.env
certs/
node_modules/
public/uploads/products/
public/uploads/profiles/
storage/user-documents/
storage/report-evidence/
```

Keep `package-lock.json` committed so repeat installs use the recorded dependency tree.

Automated checks

Run the complete local verification suite before pushing code:

npm run ci

This command performs:

The hashed frontend asset build
JavaScript syntax checks
Automated Node.js regression tests
A production dependency vulnerability audit

Run the regression tests independently with:

npm test

The GitHub Actions workflow in .github/workflows/ci.yml automatically runs the same CI command for pushes and pull requests targeting main.

## Production monitoring

AgroLink uses:

- `/healthz` for process-level liveness checks
- `/readyz` for database-backed readiness checks
- Railway `/readyz` deployment healthchecks
- external continuous monitoring of `/readyz`
- Railway observability widgets and structured-log filters
- Railway deployment and usage alerts

See `docs/monitoring-runbook.md` for incident-response steps.
