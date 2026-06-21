# AgroLink notification outbox patch

Copy these files into the root of your AgroLink project, replacing existing files when prompted.

## Files changed

- package.json
- src/config/env.js
- src/server.js
- src/controllers/messageController.js
- src/models/Notification.js
- src/models/NotificationOutbox.js
- src/services/notificationService.js
- src/services/notificationOutboxWorker.js
- src/scripts/applyNotificationIndexes.js
- src/scripts/processNotificationOutboxOnce.js

## After copying

Run:

```cmd
npm install
npm run check
npm run db:indexes:notifications
npm start
```

Optional one-off worker test:

```cmd
npm run notifications:process-once
```

## Optional environment variables

```env
NOTIFICATION_OUTBOX_ENABLED=true
NOTIFICATION_OUTBOX_POLL_INTERVAL_MS=5000
NOTIFICATION_OUTBOX_BATCH_SIZE=25
NOTIFICATION_OUTBOX_LOCK_STALE_MS=300000
NOTIFICATION_OUTBOX_BASE_RETRY_DELAY_MS=30000
NOTIFICATION_OUTBOX_MAX_RETRY_DELAY_MS=1800000
```

If omitted, the defaults above are used.
