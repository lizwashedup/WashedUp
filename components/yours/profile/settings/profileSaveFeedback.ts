const RETAINED_DRAFT = 'Your changes are still here. Try saving again.';

/** Staged save feedback only. Never turn an arbitrary transport or database
 * message into UI copy; recognized conflicts get a useful next step. Local
 * required-name and content validation continue in the form before saving.
 */
export function profileSaveFeedback(error: unknown): string {
  const failure = error as { code?: unknown; message?: unknown; details?: unknown } | null;
  const message = typeof failure?.message === 'string' ? failure.message : '';
  const details = typeof failure?.details === 'string' ? failure.details : '';
  const handleConflict = failure?.code === '23505' && /\bhandle\b|profiles_handle/i.test(`${message} ${details}`);
  const knownHandleMessage = /^(?:this )?handle (?:is )?(?:already (?:used|taken|in use)|taken)[.!]?$/i.test(message.trim());
  if (handleConflict || knownHandleMessage) return 'This handle is taken. Choose another one.';
  if (message === 'Please enter a display name.' || message === 'Name required') return 'Please enter a display name.';
  return RETAINED_DRAFT;
}
