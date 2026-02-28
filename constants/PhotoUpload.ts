/**
 * Supported photo formats for uploads.
 * ImageManipulator converts these to JPEG before upload.
 */
export const SUPPORTED_PHOTO_FORMATS = ['JPEG', 'PNG', 'HEIC'] as const;

export const PHOTO_FORMAT_ERROR_MESSAGE =
  `Image must be ${SUPPORTED_PHOTO_FORMATS.join(', ')}.`;
