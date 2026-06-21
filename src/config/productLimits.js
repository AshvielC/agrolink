const path = require('path');

const MAX_PRODUCTS_PER_FARMER = 10;
const MAX_PRODUCT_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_PROFILE_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_USER_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_REPORT_EVIDENCE_SIZE_BYTES = 10 * 1024 * 1024;

const UPLOAD_ROOT_DIR = process.env.UPLOAD_ROOT_DIR || '';

const PRODUCT_IMAGE_UPLOAD_DIR = UPLOAD_ROOT_DIR
  ? path.join(UPLOAD_ROOT_DIR, 'products')
  : path.join(__dirname, '..', '..', 'public', 'uploads', 'products');

const PROFILE_IMAGE_UPLOAD_DIR = UPLOAD_ROOT_DIR
  ? path.join(UPLOAD_ROOT_DIR, 'profiles')
  : path.join(__dirname, '..', '..', 'public', 'uploads', 'profiles');

const USER_DOCUMENT_UPLOAD_DIR = UPLOAD_ROOT_DIR
  ? path.join(UPLOAD_ROOT_DIR, 'user-documents')
  : path.join(__dirname, '..', '..', 'storage', 'user-documents');

const REPORT_EVIDENCE_UPLOAD_DIR = UPLOAD_ROOT_DIR
  ? path.join(UPLOAD_ROOT_DIR, 'report-evidence')
  : path.join(__dirname, '..', '..', 'storage', 'report-evidence');

const PRODUCT_IMAGE_PUBLIC_PATH = '/uploads/products';
const PROFILE_IMAGE_PUBLIC_PATH = '/uploads/profiles';

const ALLOWED_PRODUCT_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_USER_DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_REPORT_EVIDENCE_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

module.exports = {
  MAX_PRODUCTS_PER_FARMER,
  MAX_PRODUCT_IMAGE_SIZE_BYTES,
  PRODUCT_IMAGE_UPLOAD_DIR,
  PRODUCT_IMAGE_PUBLIC_PATH,
  ALLOWED_PRODUCT_IMAGE_MIME_TYPES,
  MAX_PROFILE_IMAGE_SIZE_BYTES,
  PROFILE_IMAGE_UPLOAD_DIR,
  PROFILE_IMAGE_PUBLIC_PATH,
  MAX_USER_DOCUMENT_SIZE_BYTES,
  USER_DOCUMENT_UPLOAD_DIR,
  ALLOWED_USER_DOCUMENT_MIME_TYPES,
  MAX_REPORT_EVIDENCE_SIZE_BYTES,
  REPORT_EVIDENCE_UPLOAD_DIR,
  ALLOWED_REPORT_EVIDENCE_MIME_TYPES
};
