const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const {
    REPORT_EVIDENCE_UPLOAD_DIR,
    ALLOWED_REPORT_EVIDENCE_MIME_TYPES
} = require('../config/productLimits');

const {
    detectImageType
} = require('./imageTypeService');

const {
    scanBufferWithClamAv
} = require('./uploadScannerService');

const {
    validatePdfBuffer
} = require('./pdfSecurityService');

const {
    reencodeImageToWebp
} = require('./imageProcessingService');

const REPORT_EVIDENCE_KEY_PREFIX =
    'report-evidence/';

function detectPdf(buffer) {
    if (!buffer || buffer.length < 5) {
        return null;
    }

    if (
        buffer.toString('ascii', 0, 5) === '%PDF-'
    ) {
        return {
            mimetype: 'application/pdf',
            extension: 'pdf'
        };
    }

    return null;
}

function detectEvidenceType(file) {
    const detected =
        detectImageType(file.buffer) ||
        detectPdf(file.buffer);

    if (
        !detected ||
        !ALLOWED_REPORT_EVIDENCE_MIME_TYPES.includes(
            detected.mimetype
        )
    ) {
        throw new Error(
            'Evidence files must be PDF, JPG, PNG, or WebP files.'
        );
    }

    return detected;
}

function buildReportEvidenceStorageKey(filename) {
    return `${REPORT_EVIDENCE_KEY_PREFIX}${filename}`;
}

function isReportEvidencePathSafe(filePath) {
    const root = path.resolve(
        REPORT_EVIDENCE_UPLOAD_DIR
    );

    const candidate = path.resolve(
        String(filePath || '')
    );

    return (
        candidate === root ||
        candidate.startsWith(`${root}${path.sep}`)
    );
}

function resolveReportEvidencePath(
    evidence = {}
) {
    const storageKey = String(
        evidence.storageKey || ''
    ).replace(/\\/g, '/');

    if (storageKey) {
        if (
            !storageKey.startsWith(
                REPORT_EVIDENCE_KEY_PREFIX
            )
        ) {
            return '';
        }

        const filename = storageKey.slice(
            REPORT_EVIDENCE_KEY_PREFIX.length
        );

        if (
            !filename ||
            filename.includes('/') ||
            filename.includes('\\')
        ) {
            return '';
        }

        return path.join(
            REPORT_EVIDENCE_UPLOAD_DIR,
            path.basename(filename)
        );
    }

    if (evidence.filename) {
        return path.join(
            REPORT_EVIDENCE_UPLOAD_DIR,
            path.basename(evidence.filename)
        );
    }

    // Temporary compatibility for legacy local records.
    if (evidence.storagePath) {
        return path.resolve(
            String(evidence.storagePath)
        );
    }

    return '';
}

async function saveReportEvidence(file) {
    const detected = detectEvidenceType(file);

    await scanBufferWithClamAv(
        file.buffer,
        file.originalname ||
        'report-evidence'
    );

    let storedBuffer = file.buffer;
    let storedMimetype = detected.mimetype;
    let storedExtension = detected.extension;

    if (detected.mimetype === 'application/pdf') {
        await validatePdfBuffer(
            file.buffer,
            file.originalname ||
            'report-evidence.pdf'
        );
    } else {
        storedBuffer = await reencodeImageToWebp(
            file.buffer,
            {
                width: 2400,
                height: 2400,
                quality: 88,
                timeoutSeconds: 20
            }
        );

        storedMimetype = 'image/webp';
        storedExtension = 'webp';
    }

    await fs.mkdir(
        REPORT_EVIDENCE_UPLOAD_DIR,
        {
            recursive: true
        }
    );

    const filename =
        `evidence-${Date.now()}-` +
        `${crypto.randomBytes(16).toString('hex')}.` +
        storedExtension;

    const absolutePath = path.join(
        REPORT_EVIDENCE_UPLOAD_DIR,
        filename
    );

    await fs.writeFile(
        absolutePath,
        storedBuffer,
        {
            flag: 'wx'
        }
    );

    return {
        filename,
        storageKey:
            buildReportEvidenceStorageKey(filename),

        // Kept empty for new records.
        // Existing legacy records may still contain an old path.
        storagePath: '',

        mimetype: storedMimetype,
        size: storedBuffer.length,
        originalName: file.originalname || '',
        uploadedAt: new Date()
    };
}

async function deleteReportEvidence(evidence = []) {
    const files = Array.isArray(evidence)
        ? evidence
        : [evidence];

    for (const item of files) {
        const absolutePath =
            resolveReportEvidencePath(item);

        if (
            !absolutePath ||
            !isReportEvidencePathSafe(absolutePath)
        ) {
            continue;
        }

        try {
            await fs.unlink(absolutePath);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }
    }
}

module.exports = {
    saveReportEvidence,
    deleteReportEvidence,
    resolveReportEvidencePath,
    isReportEvidencePathSafe
};