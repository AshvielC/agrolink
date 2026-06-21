const mongoose = require('mongoose');

const config = require('../config/env');
const connectDB = require('../config/db');
const {
  processNotificationOutboxBatch
} = require('../services/notificationOutboxWorker');

async function main() {
  await connectDB();

  const result = await processNotificationOutboxBatch();

  console.log(
    `Notification outbox processed ${result.processed} item(s), delivered ${result.delivered}.`
  );
}

main()
  .catch((error) => {
    console.error('Unable to process notification outbox:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
