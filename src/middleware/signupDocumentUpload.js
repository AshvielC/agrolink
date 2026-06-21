const multer = require('multer');
const {
  ALLOWED_USER_DOCUMENT_MIME_TYPES,
  MAX_USER_DOCUMENT_SIZE_BYTES
} = require('../config/productLimits');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_USER_DOCUMENT_SIZE_BYTES,
    files: 2
  },
  fileFilter(req, file, callback) {
    if (!ALLOWED_USER_DOCUMENT_MIME_TYPES.includes(file.mimetype)) {
      return callback(new Error('TIN and business registration uploads must be PDF, JPG, PNG, or WebP files.'));
    }

    return callback(null, true);
  }
});

function signupDocumentUpload(req, res, next) {
  upload.fields([
    { name: 'tinDocument', maxCount: 1 },
    { name: 'businessRegistrationCertificate', maxCount: 1 }
  ])(req, res, (error) => {
    if (error) {
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        req.fileValidationError = 'Each TIN or business registration document must be 10MB or smaller.';
        return next();
      }

      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_COUNT') {
        req.fileValidationError = 'Only one TIN file and one business registration certificate can be uploaded.';
        return next();
      }

      req.fileValidationError = error.message || 'The document upload could not be processed.';
      return next();
    }

    return next();
  });
}

module.exports = {
  signupDocumentUpload
};
