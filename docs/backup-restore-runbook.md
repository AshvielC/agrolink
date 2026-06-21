# AgroLink backup and restore runbook

## Current status

AgroLink is currently being prepared locally. Production backup storage, scheduling, and off-site retention will be configured later during deployment.

## What must be backed up

AgroLink has two backup parts:

1. MongoDB database data
2. Uploaded application files

The uploaded files are currently stored under:

- `public/uploads/products`
- `public/uploads/profiles`
- `storage/user-documents`
- `storage/report-evidence`

## Local backup command

```powershell
npm run backup:local
```

The script creates a timestamped folder under:

```text
backups/
```

Each backup contains:

- `mongodb.archive.gz`
- `uploads-and-storage.zip`
- `manifest.json`

## Local restore-test command

Set a separate restore-test MongoDB database URI in `.env`:

```env
RESTORE_TEST_MONGODB_URI=mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/agrolink_restore_test?retryWrites=true&w=majority
```

Then run:

```powershell
npm run restore:test -- -BackupPath .\backups\agrolink-YYYYMMDD-HHMMSS
```

The restore-test script refuses to restore into the production URI and refuses database names that do not contain `test`, `restore`, or `sandbox`.

## Never do this

Do not restore a backup directly into the production database while testing.

Do not commit backup archives to Git.

Do not email unencrypted backups.

Do not store backups in the same location as the only running app copy.

## Deployment tasks for later

When deployed, configure:

1. Scheduled database backups
2. Off-site storage
3. Backup retention policy
4. Restore testing schedule
5. Alert if a scheduled backup fails
6. Alert if a restore test is overdue
7. Storage monitoring for backup growth

## Restore-test evidence

Every restore test writes:

```text
restore-test-report.json
```

inside the tested backup folder. Keep this report with the backup records.
