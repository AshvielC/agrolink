const mongoose = require('mongoose');

const config = require('../config/env');

async function findDuplicates(users, field) {
    return users
        .aggregate([
            {
                $match: {
                    [field]: {
                        $type: 'string',
                        $gt: ''
                    }
                }
            },
            {
                $group: {
                    _id: `$${field}`,
                    count: { $sum: 1 },
                    accounts: {
                        $push: {
                            id: '$_id',
                            email: '$email'
                        }
                    }
                }
            },
            {
                $match: {
                    count: { $gt: 1 }
                }
            }
        ])
        .toArray();
}

async function main() {
    await mongoose.connect(config.mongoUri, {
        autoIndex: false
    });

    const users =
        mongoose.connection.collection('users');

    const duplicateEmails =
        await findDuplicates(users, 'email');

    const duplicatePhones =
        await findDuplicates(users, 'phone');

    if (duplicateEmails.length || duplicatePhones.length) {
        console.error(
            'Duplicate identities must be resolved before unique indexes can be created.'
        );

        if (duplicateEmails.length) {
            console.error(
                'Duplicate email addresses:',
                JSON.stringify(duplicateEmails, null, 2)
            );
        }

        if (duplicatePhones.length) {
            console.error(
                'Duplicate phone numbers:',
                JSON.stringify(duplicatePhones, null, 2)
            );
        }

        process.exitCode = 1;
        return;
    }

    const indexes = await users.indexes();

    for (const index of indexes) {
        const keys = Object.keys(index.key || {});

        const isOldPhoneOnlyIndex =
            keys.length === 1 &&
            index.key.phone === 1 &&
            index.name !== 'phone_unique_non_empty';

        if (isOldPhoneOnlyIndex) {
            console.log(
                `Dropping old phone index: ${index.name}`
            );

            await users.dropIndex(index.name);
        }
    }

    await users.createIndex(
        { email: 1 },
        {
            name: 'email_1',
            unique: true
        }
    );

    await users.createIndex(
        { phone: 1 },
        {
            name: 'phone_unique_non_empty',
            unique: true,
            partialFilterExpression: {
                $and: [
                    { phone: { $type: 'string' } },
                    { phone: { $gt: '' } }
                ]
            }
        }
    );

    console.log(
        'Email and non-empty phone-number unique indexes are ready.'
    );
}

main()
    .catch((error) => {
        console.error(
            'Unable to apply user identity indexes:',
            error
        );

        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });