require('dotenv').config();

const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const config = require('../config/env');
const User = require('../models/User');

async function main() {
  if (!config.admin.email || !config.admin.password) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env before running npm run create-admin.');
  }

  if (config.admin.password.length < 8 || !/[A-Za-z]/.test(config.admin.password) || !/\d/.test(config.admin.password)) {
    throw new Error('ADMIN_PASSWORD must be at least 8 characters and include at least one letter and one number.');
  }

  await mongoose.connect(config.mongoUri);

  const passwordHash = await bcrypt.hash(config.admin.password, 12);
  const email = config.admin.email.toLowerCase().trim();

  const admin = await User.findOneAndUpdate(
    { email },
    {
      $set: {
        name: config.admin.name,
        email,
        passwordHash,
        role: 'admin',
        accountStatus: 'active',
        approvedAt: new Date(),
        suspendedAt: null
      }
    },
    {
      upsert: true,
      new: true,
      runValidators: true,
      setDefaultsOnInsert: true
    }
  );

  console.log(`Admin account ready: ${admin.email}`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
