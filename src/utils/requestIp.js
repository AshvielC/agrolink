const net = require('node:net');

function normalizeIpAddress(value) {
    const candidate =
        String(value || '').trim();

    if (!candidate) return '';

    return net.isIP(candidate)
        ? candidate
        : '';
}

function getClientIp(req) {
    return (
        normalizeIpAddress(req?.ip) ||
        normalizeIpAddress(
            req?.socket?.remoteAddress
        )
    );
}

module.exports = {
    getClientIp,
    normalizeIpAddress
};