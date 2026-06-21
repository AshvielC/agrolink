const mongoose =
    require('mongoose');

const config =
    require('./env');

const {
    logger
} = require('../services/loggerService');

const {
    recordMongoDisconnected
} = require(
    '../services/operationalMonitoringService'
);

let monitoringListenersAttached =
    false;
let expectedDatabaseDisconnect = false;

function expectDatabaseDisconnect() {
    expectedDatabaseDisconnect = true;
}

function attachDatabaseMonitoring() {
    if (monitoringListenersAttached) {
        return;
    }

    monitoringListenersAttached = true;

    mongoose.connection.on(
        'disconnected',
        () => {
            if (expectedDatabaseDisconnect) {
                logger.info(
                    'MongoDB connection closed normally.',
                    {
                        event:
                            'database.connection_closed'
                    }
                );

                return;
            }

            logger.error(
                'MongoDB connection was lost.',
                {
                    event:
                        'database.disconnected'
                }
            );

            recordMongoDisconnected();
        }
    );

    mongoose.connection.on(
        'error',
        (error) => {
            logger.error(
                'MongoDB connection error.',
                {
                    event: 'database.error',
                    error
                }
            );
        }
    );

    mongoose.connection.on(
        'reconnected',
        () => {
            logger.info(
                'MongoDB connection restored.',
                {
                    event:
                        'database.reconnected'
                }
            );
        }
    );
}

async function connectDB() {
    mongoose.set(
        'strictQuery',
        true
    );

    attachDatabaseMonitoring();

    await mongoose.connect(
        config.mongoUri,
        {
            autoIndex:
                !config.isProduction
        }
    );

    logger.info(
        'MongoDB connected.',
        {
            event:
                'database.connected'
        }
    );
}

connectDB.expectDatabaseDisconnect =
    expectDatabaseDisconnect;

module.exports =
    connectDB;