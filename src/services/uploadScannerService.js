const path = require('path');

const config = require('../config/env');
const {
    runCommand
} = require('./commandRunnerService');

const maxConcurrentScans = Math.max(
    1,
    Number(
        config.security.uploadVirusScanMaxConcurrent
    ) || 2
);

const maxQueuedScans = Math.max(
    0,
    Number(config.security.uploadVirusScanMaxQueued) ||
    0
);

let activeScans = 0;
const queuedScans = [];
const {
    logger
} = require('./loggerService');
const {
    recordScannerQueueOverflow,
    recordScannerStartupFailure
} = require(
    './operationalMonitoringService'
);

function safeLabel(value = 'upload.bin') {
    return path
        .basename(String(value || 'upload.bin'))
        .replace(/[\r\n\t]/g, ' ')
        .slice(0, 160);
}

function acquireScanSlot() {
    return new Promise((resolve, reject) => {
        if (activeScans < maxConcurrentScans) {
            activeScans += 1;
            resolve();
            return;
        }

        if (
            queuedScans.length >=
            maxQueuedScans
        ) {
            const error = new Error(
                'Upload scanning is busy. Please try again shortly.'
            );

            error.status = 503;

            recordScannerQueueOverflow({
                activeScans,
                queuedScans:
                    queuedScans.length,
                maxConcurrentScans,
                maxQueuedScans
            });

            reject(error);
            return;
        }

        queuedScans.push(resolve);
    });
}

function releaseScanSlot() {
    activeScans = Math.max(0, activeScans - 1);

    const next = queuedScans.shift();

    if (next) {
        activeScans += 1;
        next();
    }
}

async function withScanSlot(task) {
    await acquireScanSlot();

    try {
        return await task();
    } finally {
        releaseScanSlot();
    }
}

async function assertUploadScannerReady() {
    if (!config.security.uploadVirusScanRequired) {
        return;
    }

    const result = await runCommand(
        config.security.clamscanPath,
        ['--no-summary', '-'],
        {
            inputBuffer: Buffer.from(
                'AgroLink upload scanner readiness test.\n'
            ),
            timeoutMs:
                config.security
                    .uploadVirusScanStartupTimeoutMs
        }
    );

    if (result.code !== 0) {
        const error = new Error(
            `Upload virus scanner readiness check failed: ${result.stderr ||
            result.stdout ||
            `exit code ${result.code}`
            }`
        );

        recordScannerStartupFailure(
            error
        );

        throw error;
    }

    logger.info(
        'Upload virus scanner is ready.',
        {
            event: 'upload_scanner.ready'
        }
    );
}

async function scanBufferWithClamAv(
    buffer,
    filename = 'upload.bin'
) {
    if (!config.security.uploadVirusScanRequired) {
        return {
            scanned: false,
            clean: true
        };
    }

    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new Error(
            'Upload rejected because the file is empty.'
        );
    }

    const args = ['--no-summary'];

    if (config.security.rejectEncryptedUploads) {
        args.push('--alert-encrypted=yes');
    }

    args.push('-');

    const result = await withScanSlot(() =>
        runCommand(
            config.security.clamscanPath,
            args,
            {
                inputBuffer: buffer,
                timeoutMs:
                    config.security.uploadVirusScanTimeoutMs
            }
        )
    );

    if (result.code === 0) {
        return {
            scanned: true,
            clean: true,
            output: result.stdout
        };
    }

    const label = safeLabel(filename);

    if (result.code === 1) {
        logger.warn(
            'Upload rejected by malware scanner.',
            {
                event: 'upload_scanner.rejected',
                resultCode: result.code
            }
        );

        throw new Error(
            'Upload rejected because the file contains unsafe content or cannot be safely inspected.'
        );
    }

    logger.error(
        'Upload virus scan failed.',
        {
            event: 'upload_scanner.failed',
            resultCode: result.code,
            toolOutput:
                result.stderr ||
                result.stdout ||
                `exit code ${result.code}`
        }
    );

    throw new Error(
        'Upload could not be scanned safely. Please try again later.'
    );
}

module.exports = {
    assertUploadScannerReady,
    scanBufferWithClamAv
};