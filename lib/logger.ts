import * as Sentry from '@sentry/react-native';

/**
 * Report a caught error to Sentry with an optional context tag. Use in catch
 * blocks where the failure is non-fatal but worth knowing about in production.
 *
 *   try { … } catch (err) { logError(err, 'profile.fetchProfile'); }
 *
 * In dev: also console.warn so the error is visible during development.
 * Never throws — failure to report should never block the calling code path.
 */
export function logError(err: unknown, context?: string): void {
  if (__DEV__) {
    console.warn(`[${context ?? 'app'}]`, err);
  }
  try {
    if (context) {
      Sentry.captureException(err, { tags: { context } });
    } else {
      Sentry.captureException(err);
    }
  } catch {
    // Sentry not initialized or capture failed — swallow.
  }
}
