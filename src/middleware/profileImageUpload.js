const multer = require('multer');
const {
  ALLOWED_PRODUCT_IMAGE_MIME_TYPES,
  MAX_PROFILE_IMAGE_SIZE_BYTES
} = require('../config/productLimits');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_PROFILE_IMAGE_SIZE_BYTES,
    files: 1
  },
  fileFilter(req, file, callback) {
    if (!ALLOWED_PRODUCT_IMAGE_MIME_TYPES.includes(file.mimetype)) {
      return callback(new Error('Profile image must be a JPG, PNG, or WebP file.'));
    }

    return callback(null, true);
  }
});

function profileImageUpload(req, res, next) {
  upload.single('profileImage')(req, res, (error) => {
    if (error) {
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        req.fileValidationError = 'Profile image must be 5MB or smaller.';
        return next();
      }

      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_COUNT') {
        req.fileValidationError = 'Each profile can have only one image.';
        return next();
      }

      req.fileValidationError = error.message || 'The profile image could not be uploaded.';
      return next();
    }

    return next();
  });
}

module.exports = {
  profileImageUpload
};
