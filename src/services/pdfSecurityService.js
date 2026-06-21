const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const config = require('../config/env');
const { runCommand } = require('./commandRunnerService');
const {
    logger
} = require('./loggerService');
const {
    recordQpdfFailure
} = require(
    './operationalMonitoringService'
);

function safeLabel(value = 'upload.pdf') {
    return path
        .basename(String(value || 'upload.pdf'))
        .replace(/[\r\n\t]/g, ' ')
        .slice(0, 160);
}

async function assertPdfSecurityToolReady() {
    if (!config.security.pdfSecurityCheckRequired) {
        return;
    }

    const result = await runCommand(
        config.security.qpdfPath,
        ['--version'],
        {
            timeoutMs: config.security.pdfSecurityCheckTimeoutMs
        }
    );

    if (result.code !== 0) {
        const error = new Error(
            `PDF security tool readiness check failed: ${result.stderr ||
            result.stdout ||
            `exit code ${result.code}`
            }`
        );

        recordQpdfFailure(
            'startup',
            error
        );

        throw error;
    }

    logger.info(
        'PDF security tool is ready.',
        {
            event: 'pdf_security_tool.ready'
        }
    );
}

async function validatePdfBuffer(
    buffer,
    filename = 'upload.pdf'
) {
    if (!config.security.pdfSecurityCheckRequired) {
        return {
            checked: false,
            valid: true
        };
    }

    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new Error(
            'PDF upload rejected because the file is empty.'
        );
    }

    const tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'agrolink-pdf-')
    );

    const tempPath = path.join(
        tempDir,
        `${crypto.randomBytes(16).toString('hex')}.pdf`
    );

    try {
        await fs.writeFile(tempPath, buffer, {
            flag: 'wx'
        });

        const encryptionResult = await runCommand(
            config.security.qpdfPath,
            ['--is-encrypted', tempPath],
            {
                timeoutMs:
                    config.security.pdfSecurityCheckTimeoutMs
            }
        );

        if (encryptionResult.code === 0) {
            throw new Error(
                'Encrypted or password-protected PDF files are not accepted. Please upload an unencrypted PDF or an image.'
            );
        }

        if (encryptionResult.code !== 2) {
            recordQpdfFailure(
                'encryption_status',
                new Error(
                    encryptionResult.stderr ||
                    encryptionResult.stdout ||
                    `exit code ${encryptionResult.code}`
                ),
                {
                    resultCode:
                        encryptionResult.code
                }
            );

            logger.error(
                'Unable to determine PDF encryption status.',
                {
                    event: 'pdf.encryption_status.failed',
                    resultCode: encryptionResult.code,
                    toolOutput:
                        encryptionResult.stderr ||
                        encryptionResult.stdout ||
                        `exit code ${encryptionResult.code}`
                }
            );

            throw new Error(
                'PDF upload could not be inspected safely. Please export a new unencrypted PDF and try again.'
            );
        }

        const checkResult = await runCommand(
            config.security.qpdfPath,
            ['--check', tempPath],
            {
                timeoutMs:
                    config.security.pdfSecurityCheckTimeoutMs
            }
        );

        if (
            checkResult.code !== 0 &&
            checkResult.code !== 3
        ) {
            recordQpdfFailure(
                'structure_check',
                new Error(
                    checkResult.stderr ||
                    checkResult.stdout ||
                    `exit code ${checkResult.code}`
                ),
                {
                    resultCode:
                        checkResult.code
                }
            );

            throw new Error(
                'PDF security check failed.'
            );
        }

        if (checkResult.code === 3) {
            logger.warn(
                'PDF security tool completed with warnings.',
                {
                    event: 'pdf_security_tool.warning',
                    stage: 'structure_check',
                    resultCode: checkResult.code
                }
            );
        }

        return {
            checked: true,
            valid: true,
            encrypted: false
        };
    } finally {
        await fs.rm(tempDir, {
            recursive: true,
            force: true
        });
    }
}

module.exports = {
    assertPdfSecurityToolReady,
    validatePdfBuffer
};