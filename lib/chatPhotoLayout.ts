export type PhotoSize = { width: number; height: number };

export function validPhotoSize(size: PhotoSize | null | undefined): size is PhotoSize {
  return !!size && Number.isFinite(size.width) && Number.isFinite(size.height)
    && size.width > 0 && size.height > 0;
}

/** Fit the entire asset, including extreme portraits/panoramas. Never crop. */
export function fitChatPhoto(size: PhotoSize | null, bounds: PhotoSize): PhotoSize {
  const source = validPhotoSize(size) ? size : { width: 4, height: 3 };
  const limit = validPhotoSize(bounds) ? bounds : { width: 240, height: 320 };
  const factor = Math.min(limit.width / source.width, limit.height / source.height);
  return { width: source.width * factor, height: source.height * factor };
}

export function boundPhotoOffset(offset: number, imageLength: number, viewportLength: number, scale: number) {
  'worklet';
  const limit = Math.max(0, (imageLength * scale - viewportLength) / 2);
  if (limit === 0) return 0;
  return Math.max(-limit, Math.min(limit, offset));
}
