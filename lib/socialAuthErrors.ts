type AnyError = { code?: unknown; message?: unknown } | unknown;

function codeOf(e: AnyError): string | null {
  if (e && typeof e === 'object' && 'code' in e) {
    const c = (e as { code?: unknown }).code;
    if (typeof c === 'string') return c;
  }
  return null;
}

const GOOGLE_GENERIC = "Google sign in didn't work. Please try email or try again later.";
const APPLE_GENERIC = "Apple sign in didn't work. Please try email or try again later.";

export function friendlyGoogleError(e: AnyError): string {
  switch (codeOf(e)) {
    case 'IN_PROGRESS':
      return 'Hang on, still working on the last attempt.';
    case 'PLAY_SERVICES_NOT_AVAILABLE':
      return 'Update Google Play services on your device, then try again.';
    default:
      return GOOGLE_GENERIC;
  }
}

export function friendlyAppleError(_e: AnyError): string {
  return APPLE_GENERIC;
}
