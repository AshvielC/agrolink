const multer = require('multer');
const {
  ALLOWED_REPORT_EVIDENCE_MIME_TYPES,
  MAX_REPORT_EVIDENCE_SIZE_BYTES
} = require('../config/productLimits');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_REPORT_EVIDENCE_SIZE_BYTES,
    files: 3
  },
  fileFilter(req, file, callback) {
    if (!ALLOWED_REPORT_EVIDENCE_MIME_TYPES.includes(file.mimetype)) {
      return callback(new Error('Evidence uploads must be PDF, JPG, PNG, or WebP files.'));
    }
    return callback(null, true);
  }
});

function reportEvidenceUpload(req, res, next) {
  upload.array('evidence', 3)(req, res, (error) => {
    if (error) {
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        req.fileValidationError = 'Each evidence file must be 10MB or smaller.';
        return next();
      }
      if (error instanceof multer.MulterError && (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE')) {
        req.fileValidationError = 'You can upload up to 3 evidence files per report.';
        return next();
      }
      req.fileValidationError = error.message || 'The evidence upload could not be processed.';
      return next();
    }
    return next();
  });
}

module.exports = {
  reportEvidenceUpload
};
