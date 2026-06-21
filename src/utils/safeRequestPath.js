function sanitizeRequestPath(value = '') {
  return String(value || '')
    .replace(
      /\/reset-password\/[^/?#]+/gi,
      '/reset-password/:token'
    )
    .replace(
      /\/[a-f0-9]{24}(?=\/|$)/gi,
      '/:id'
    )
    .replace(
      /([?&](token|resetToken|_csrf|password|secret)=)[^&#]+/gi,
      '$1[REDACTED]'
    )
    .slice(0, 300);
}

module.exports = {
  sanitizeRequestPath
};
