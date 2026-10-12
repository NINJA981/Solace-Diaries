/**
 * Upload pipeline for photos: trust the bytes, not the client. The file type is sniffed
 * from magic numbers, then the image is fully re-encoded, which drops EXIF/GPS metadata
 * and anything smuggled alongside the pixels.
 */
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { badRequest } from '../http/errors';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const MAX_SIDE = 2560;
/** Refuse decompression bombs: 40 MP is well above any phone camera. */
const MAX_INPUT_PIXELS = 40_000_000;

export type ProcessedImage = { bytes: Buffer; mime: 'image/webp'; width: number; height: number };

export async function processImage(input: Buffer): Promise<ProcessedImage> {
  const type = await fileTypeFromBuffer(input);
  if (!type || !ALLOWED.has(type.mime)) {
    throw badRequest('Only JPEG, PNG, WebP or HEIC photos are supported.', {
      file: 'Unsupported file type',
    });
  }
  try {
    const { data, info } = await sharp(input, {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: 'error',
    })
      .rotate() // apply EXIF orientation before metadata is stripped
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return { bytes: data, mime: 'image/webp', width: info.width, height: info.height };
  } catch {
    throw badRequest("We couldn't read that photo. Try a JPEG or PNG.", {
      file: 'Unreadable image',
    });
  }
}
