const nodemailer = require('nodemailer');
const config = require('../config/env');

let transporter = null;
const {
    logger
} = require('./loggerService');
const {
    recordSmtpFailure
} = require(
    './operationalMonitoringService'
);


function isEmailConfigured() {
  return Boolean(config.smtp.host && config.smtp.user && config.smtp.pass && config.email.from);
}

function getTransporter() {
  if (!isEmailConfigured()) {
    return null;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass
      }
    });
  }

  return transporter;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function absoluteUrl(path = '') {
  const base = config.appUrl || '';
  if (!base) return path || '';
  if (!path) return base;
  if (/^https?:\/\//i.test(path)) return path;
  return `${base.replace(/\/$/, '')}/${String(path).replace(/^\//, '')}`;
}

async function sendEmail({ to, replyTo, subject, text, html }) {
    const activeTransporter = getTransporter();

    if (!activeTransporter) {
        if (!config.isProduction) {
            logger.debug(
                'Email skipped because SMTP is not configured.',
                {
                    event:
                        'email.skipped.smtp_unconfigured'
                }
            );
        }

        return {
            skipped: true,
            messageId: null
        };
    }

    try {
        const result =
            await activeTransporter.sendMail({
                from: config.email.from,
                to,
                replyTo,
                subject,
                text,
                html
            });

        return {
            skipped: false,
            messageId:
                result.messageId || null
        };
    } catch (error) {
        recordSmtpFailure(error);

        throw error;
    }
}
function buildActionEmail({ heading, body, actionUrl = '', actionLabel = 'Open AgroLink' }) {
  const url = absoluteUrl(actionUrl);
  const text = [
    heading,
    '',
    body,
    '',
    url ? `${actionLabel}: ${url}` : '',
    '',
    `This message was sent by ${config.appName}.`
  ].filter(Boolean).join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2937;max-width:640px;margin:0 auto;padding:20px;">
      <h2 style="margin:0 0 12px;color:#14532d;">${escapeHtml(heading)}</h2>
      <p>${escapeHtml(body).replaceAll('\n', '<br>')}</p>
      ${url ? `<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#166534;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px;">${escapeHtml(actionLabel)}</a></p>` : ''}
      <p style="font-size:12px;color:#6b7280;">This message was sent by ${escapeHtml(config.appName)}.</p>
    </div>
  `;

  return { text, html };
}

async function sendSystemEmail({ to, replyTo, subject, heading, body, actionUrl = '', actionLabel = 'Open AgroLink' }) {
  const content = buildActionEmail({ heading, body, actionUrl, actionLabel });

  return sendEmail({
    to,
    replyTo,
    subject,
    text: content.text,
    html: content.html
  });
}

async function sendPasswordResetEmail({ to, name, resetUrl, expiresMinutes = 15 }) {
  const safeName = name || 'AgroLink user';
  const body = [
    `Hello ${safeName},`,
    '',
    'We received a request to reset your AgroLink password.',
    '',
    `Use the reset button or link within ${expiresMinutes} minutes to create a new password.`,
    '',
    'If you did not request this password reset, you can ignore this email. Your password will not change unless the link is used.',
    '',
    'For security, this link expires automatically and can only be used once.'
  ].join('\n');

  return sendSystemEmail({
    to,
    subject: 'Reset your AgroLink password',
    heading: 'Reset your AgroLink password',
    body,
    actionUrl: resetUrl,
    actionLabel: 'Reset password'
  });
}

module.exports = {
  sendEmail,
  sendSystemEmail,
  sendPasswordResetEmail,
  isEmailConfigured,
  absoluteUrl,
  escapeHtml
};
