const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const {
    USER_DOCUMENT_UPLOAD_DIR,
    ALLOWED_USER_DOCUMENT_MIME_TYPES
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

const USER_DOCUMENT_KEY_PREFIX =
    'verification-documents/';

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

function detectDocumentType(file) {
    const detectedImage = detectImageType(file.buffer);
    const detectedPdf = detectPdf(file.buffer);
    const detected = detectedImage || detectedPdf;

    if (
        !detected ||
        !ALLOWED_USER_DOCUMENT_MIME_TYPES.includes(
            detected.mimetype
        )
    ) {
        throw new Error(
            'Documents must be PDF, JPG, PNG, or WebP files.'
        );
    }

    return detected;
}

function buildUserDocumentStorageKey(filename) {
    return `${USER_DOCUMENT_KEY_PREFIX}${filename}`;
}

function isUserDocumentPathSafe(filePath) {
    const root = path.resolve(
        USER_DOCUMENT_UPLOAD_DIR
    );

    const candidate = path.resolve(
        String(filePath || '')
    );

    return (
        candidate === root ||
        candidate.startsWith(`${root}${path.sep}`)
    );
}

function resolveUserDocumentPath(document) {
    if (
        !document ||
        typeof document !== 'object'
    ) {
        return '';
    }
    const storageKey = String(
        document.storageKey || ''
    ).replace(/\\/g, '/');

    if (storageKey) {
        if (
            !storageKey.startsWith(
                USER_DOCUMENT_KEY_PREFIX
            )
        ) {
            return '';
        }

        const filename = storageKey.slice(
            USER_DOCUMENT_KEY_PREFIX.length
        );

        if (
            !filename ||
            filename.includes('/') ||
            filename.includes('\\')
        ) {
            return '';
        }

        return path.join(
            USER_DOCUMENT_UPLOAD_DIR,
            path.basename(filename)
        );
    }

    if (document.filename) {
        return path.join(
            USER_DOCUMENT_UPLOAD_DIR,
            path.basename(document.filename)
        );
    }

    // Temporary compatibility for legacy local records.
    if (document.storagePath) {
        return path.resolve(
            String(document.storagePath)
        );
    }

    return '';
}

async function saveUserDocument(file, kind) {
    const detected = detectDocumentType(file);

    await scanBufferWithClamAv(
        file.buffer,
        file.originalname || `${kind}-document`
    );

    let storedBuffer = file.buffer;
    let storedMimetype = detected.mimetype;
    let storedExtension = detected.extension;

    if (detected.mimetype === 'application/pdf') {
        await validatePdfBuffer(
            file.buffer,
            file.originalname ||
            `${kind}-document.pdf`
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

    await fs.mkdir(USER_DOCUMENT_UPLOAD_DIR, {
        recursive: true
    });

    const filename =
        `${kind}-${Date.now()}-` +
        `${crypto.randomBytes(16).toString('hex')}.` +
        storedExtension;

    const absolutePath = path.join(
        USER_DOCUMENT_UPLOAD_DIR,
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
            buildUserDocumentStorageKey(filename),

        // Kept empty for new records.
        // Existing legacy records may still contain an old path.
        storagePath: '',

        mimetype: storedMimetype,
        size: storedBuffer.length,
        originalName: file.originalname || '',
        uploadedAt: new Date(),
        status: 'pending',
        reviewedAt: null,
        reviewedBy: null,
        rejectionReason: ''
    };
}

async function deleteUserDocument(document) {
    if (
        !document ||
        typeof document !== 'object'
    ) {
        return;
    }

    const absolutePath =
        resolveUserDocumentPath(document);

    if (
        !absolutePath ||
        !isUserDocumentPathSafe(absolutePath)
    ) {
        return;
    }

    try {
        await fs.unlink(absolutePath);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }
}

module.exports = {
    saveUserDocument,
    deleteUserDocument,
    resolveUserDocumentPath,
    isUserDocumentPathSafe
};