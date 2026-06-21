const fs = require('fs');
const path = require('path');
const https = require('https');
const {
    logger
} = require('./services/loggerService');
const app = require('./app');
const connectDB = require('./config/db');
const config = require('./config/env');
const {
    assertUploadScannerReady
} = require('./services/uploadScannerService');

const {
    assertPdfSecurityToolReady
} = require('./services/pdfSecurityService');
const {
    startNotificationOutboxWorker,
    stopNotificationOutboxWorker
} = require('./services/notificationOutboxWorker');
const mongoose = require('mongoose');
const {
    startOperationalMonitoring,
    stopOperationalMonitoring
} = require(
    './services/operationalMonitoringService'
);
function isEnabled(value) {
    return ['true', '1', 'yes', 'on'].includes(
        String(value || '').trim().toLowerCase()
    );
}

function createServer() {
    const httpsEnabled = isEnabled(process.env.HTTPS_ENABLED);

    if (!httpsEnabled) {
        return app.listen(config.port, () => {
            logger.info(
                'Web server started.',
                {
                    event: 'server.started',
                    protocol: 'http',
                    port: config.port
                }
            );
        });
    }

    const pfxPath = path.resolve(
        process.cwd(),
        String(process.env.HTTPS_PFX_PATH || '').trim()
    );

    const passphrase = String(
        process.env.HTTPS_PFX_PASSPHRASE || ''
    );

    if (!process.env.HTTPS_PFX_PATH) {
        throw new Error(
            'HTTPS_ENABLED=true but HTTPS_PFX_PATH is missing from .env.'
        );
    }

    if (!passphrase) {
        throw new Error(
            'HTTPS_ENABLED=true but HTTPS_PFX_PASSPHRASE is missing from .env.'
        );
    }

    if (!fs.existsSync(pfxPath)) {
        throw new Error(`HTTPS certificate file was not found: ${pfxPath}`);
    }

    const tlsOptions = {
        pfx: fs.readFileSync(pfxPath),
        passphrase,
        minVersion: 'TLSv1.2'
    };

    return https.createServer(tlsOptions, app).listen(config.port, () => {
        logger.info(
            'Web server started.',
            {
                event: 'server.started',
                protocol: 'https',
                port: config.port
            }
        );
    });
}

async function startServer() {
    try {
        await assertUploadScannerReady();
        await assertPdfSecurityToolReady();

        await connectDB();

        startNotificationOutboxWorker();
        startOperationalMonitoring();

        const server = createServer();

        let shuttingDown = false;

        const shutdown = async (signal) => {
            if (shuttingDown) return;

            shuttingDown = true;

            logger.info(
                'Shutdown signal received.',
                {
                    event: 'server.shutdown.received',
                    signal
                }
            );

            const forceExitTimer = setTimeout(() => {
                logger.error(
                    'Forced shutdown after timeout.',
                    {
                        event: 'server.shutdown.timeout',
                        timeoutMs: 10000
                    }
                );

                process.exit(1);
            }, 10000);

            forceExitTimer.unref();

            try {
                await stopNotificationOutboxWorker();
                stopOperationalMonitoring();

                logger.info(
                    'Notification outbox worker stopped.',
                    {
                        event: 'notification_outbox_worker.stopped'
                    }
                );
            } catch (error) {
                logger.warn(
                    'Could not stop notification outbox worker cleanly.',
                    {
                        event: 'notification_outbox_worker.stop.failed',
                        error
                    }
                );
            }

            server.close(async (closeError) => {
                try {
                    if (closeError) {
                        throw closeError;
                    }

                    logger.info(
                        'Web server closed.',
                        {
                            event: 'server.closed'
                        }
                    );
                    connectDB.expectDatabaseDisconnect?.();
                    await mongoose.disconnect();

                    logger.info(
                        'MongoDB connection closed.',
                        {
                            event: 'database.connection_closed'
                        }
                    );

                    clearTimeout(forceExitTimer);

                    process.exit(0);
                } catch (error) {
                    clearTimeout(forceExitTimer);

                    logger.error(
                        'Shutdown error.',
                        {
                            event: 'server.shutdown.failed',
                            error
                        }
                    );

                    process.exit(1);
                }
            });
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));
    } catch (error) {
        logger.error(
            'Failed to start server.',
            {
                event: 'server.start.failed',
                error
            }
        );
        process.exit(1);
    }
}

startServer();