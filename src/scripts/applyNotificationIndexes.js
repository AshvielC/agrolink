const mongoose = require('mongoose');

const config = require('../config/env');
const Notification = require('../models/Notification');
const NotificationOutbox = require('../models/NotificationOutbox');

async function main() {
  await mongoose.connect(config.mongoUri, {
    autoIndex: false
  });

  await Notification.syncIndexes();
  await NotificationOutbox.syncIndexes();

  console.log('Notification and notification outbox indexes are ready.');
}

main()
  .catch((error) => {
    console.error('Unable to apply notification indexes:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
