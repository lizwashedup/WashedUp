import { isTransportErrorMessage } from './friendlyError';

/** Describe only what the password provider confirmed. Never display its raw response. */
export function emailSignInFeedback(error: unknown): string {
  const fallback = 'could not sign in. please try again.';
  if (!error || typeof error !== 'object') return fallback;
  const { code, status, name, message } = error as Record<string, unknown>;
  if (status === 429 || code === 'over_request_rate_limit') return 'too many sign-in attempts. wait a while, then try again.';
  if (typeof status === 'number' && status >= 500) return 'sign-in is temporarily unavailable. try again shortly.';
  if (code === 'email_not_confirmed') return 'confirm your email before signing in. check your inbox.';
  if (code === 'invalid_credentials' || (!code && message === 'Invalid login credentials')) return 'wrong email or password';
  if ((name === 'AuthRetryableFetchError' && status === 0) || (typeof message === 'string' && isTransportErrorMessage(message))) {
    return 'could not connect. check your connection and try again.';
  }
  return fallback;
}
