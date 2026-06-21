const multer = require('multer');
const {
  ALLOWED_PRODUCT_IMAGE_MIME_TYPES,
  MAX_PRODUCT_IMAGE_SIZE_BYTES
} = require('../config/productLimits');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_PRODUCT_IMAGE_SIZE_BYTES,
    files: 1
  },
  fileFilter(req, file, callback) {
    if (!ALLOWED_PRODUCT_IMAGE_MIME_TYPES.includes(file.mimetype)) {
      return callback(new Error('Product image must be a JPG, PNG, or WebP file.'));
    }

    return callback(null, true);
  }
});

function productImageUpload(req, res, next) {
  upload.single('productImage')(req, res, (error) => {
    if (error) {
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        req.fileValidationError = 'Product image must be 10MB or smaller.';
        return next();
      }

      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_COUNT') {
        req.fileValidationError = 'Each product can have only one image.';
        return next();
      }

      req.fileValidationError = error.message || 'The product image could not be uploaded.';
      return next();
    }

    return next();
  });
}

module.exports = {
  productImageUpload
};
