const sharp = require('sharp');

const MAX_IMAGE_PIXELS = 24_000_000;

async function reencodeImageToWebp(
    buffer,
    options = {}
) {
    const width = options.width || 1600;
    const height = options.height || 1600;
    const quality = options.quality || 82;

    const timeoutSeconds = Math.max(
        1,
        Number(options.timeoutSeconds) || 15
    );

    return sharp(buffer, {
        failOn: 'error',
        limitInputPixels: MAX_IMAGE_PIXELS
    })
        .rotate()
        .resize({
            width,
            height,
            fit: 'inside',
            withoutEnlargement: true
        })
        .webp({ quality })
        .timeout({
            seconds: timeoutSeconds
        })
        .toBuffer();
}

module.exports = {
    reencodeImageToWebp
};