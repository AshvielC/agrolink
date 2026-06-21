const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const {
  PRODUCT_IMAGE_UPLOAD_DIR,
  PRODUCT_IMAGE_PUBLIC_PATH
} = require('../config/productLimits');

const { detectImageType } = require('./imageTypeService');
const { reencodeImageToWebp } = require('./imageProcessingService');
const {
    logger
} = require('./loggerService');
async function saveProductImage(file) {
  if (!file) return null;

  const detected = detectImageType(file.buffer);

  if (!detected || detected.mimetype !== file.mimetype) {
    throw new Error('Product image content must be a valid JPG, PNG, or WebP file.');
  }

  const sanitizedBuffer = await reencodeImageToWebp(file.buffer, {
    width: 1600,
    height: 1600,
    quality: 82
  });

  await fs.mkdir(PRODUCT_IMAGE_UPLOAD_DIR, { recursive: true });

  const filename = `${Date.now()}-${crypto.randomUUID()}.webp`;
  const absolutePath = path.join(PRODUCT_IMAGE_UPLOAD_DIR, filename);
  await fs.writeFile(absolutePath, sanitizedBuffer, { flag: 'wx' });

  return {
    filename,
    path: `${PRODUCT_IMAGE_PUBLIC_PATH}/${filename}`,
    mimetype: 'image/webp',
    size: sanitizedBuffer.length,
    originalName: String(file.originalname || '').slice(0, 180)
  };
}

async function deleteProductImage(image) {
  if (!image || !image.filename) return;

  const safeFilename = path.basename(image.filename);
  const absolutePath = path.join(PRODUCT_IMAGE_UPLOAD_DIR, safeFilename);

  try {
    await fs.unlink(absolutePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
        logger.warn(
            'Could not delete product image.',
            {
                event: 'product_image.delete.failed',
                error
            }
        );
    }
  }
}

module.exports = {
  saveProductImage,
  deleteProductImage
};
