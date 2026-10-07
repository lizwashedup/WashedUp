export type AccountEmailScope = { userId: string; isCurrent(): boolean };
export type AccountEmailState = {
  userId: string; email: string | null; verified: boolean;
  pendingEmail: string | null; sentAt: string | null;
};
export class AccountEmailFailure extends Error {
  constructor(public readonly kind: 'read' | 'unknown' | 'rate_limit' | 'invalid' | 'unavailable', message: string) { super(message); }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function normalizeAccountEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AccountEmailFailure('invalid', 'Enter a valid email address.');
  }
  return email;
}
export function readAccountEmail(value: unknown, userId: string): AccountEmailState {
  const user = value as Record<string, unknown> | null;
  if (!user || !uuid.test(userId) || user.id !== userId) throw new AccountEmailFailure('read', 'Could not check your account email.');
  const optionalEmail = (v: unknown): string | null => {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v !== 'string') throw new AccountEmailFailure('read', 'Could not check your account email.');
    return normalizeAccountEmail(v);
  };
  const timestamp = (v: unknown): string | null => {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v !== 'string' || !Number.isFinite(Date.parse(v))) throw new AccountEmailFailure('read', 'Could not check your account email.');
    return v;
  };
  const email = optionalEmail(user.email), confirmedAt = timestamp(user.email_confirmed_at);
  if (confirmedAt && !email) throw new AccountEmailFailure('read', 'Could not check your account email.');
  return { userId, email, verified: !!email && !!confirmedAt,
    pendingEmail: optionalEmail(user.new_email), sentAt: timestamp(user.email_change_sent_at) };
}
export function createAccountEmailApi(config: {
  url: string; anonKey: string; fetch: typeof fetch;
  authorization(scope: AccountEmailScope): Promise<string>;
}) {
  function current(scope: AccountEmailScope) {
    if (!uuid.test(scope.userId) || !scope.isCurrent()) throw new AccountEmailFailure('unavailable', 'This account visit has ended.');
  }
  async function request(scope: AccountEmailScope, method: 'GET' | 'PUT', email?: string, returnUrl?: string): Promise<AccountEmailState> {
    current(scope);
    const authorization = await config.authorization(scope); current(scope);
    const url = new URL(config.url.replace(/\/$/, '') + '/auth/v1/user');
    if (returnUrl) url.searchParams.set('redirect_to', returnUrl);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
    try {
      // Pin the initiating account. Never save a returned session, sign in/out,
      // rotate refresh tokens, or change phone/profile fields from this path.
      const response = await config.fetch(url.toString(), { method, signal: controller.signal,
        headers: { apikey: config.anonKey, Authorization: authorization, 'Content-Type': 'application/json' },
        ...(method === 'PUT' ? { body: JSON.stringify({ email }) } : {}) });
      current(scope);
      if (!response.ok) {
        if (response.status === 429) throw new AccountEmailFailure('rate_limit', 'Please wait before requesting another link.');
        if (method === 'PUT' && [400,422].includes(response.status)) throw new AccountEmailFailure('invalid', 'That email could not be used. Check it and try again.');
        throw new AccountEmailFailure(method === 'GET' ? 'read' : 'unknown', method === 'GET' ? 'Could not check your account email.' : 'The request could not be confirmed. Check its status before trying again.');
      }
      const value = await response.json(); current(scope);
      return readAccountEmail(value, scope.userId);
    } catch (error) {
      if (error instanceof AccountEmailFailure) throw error;
      throw new AccountEmailFailure(method === 'GET' ? 'read' : 'unknown', method === 'GET' ? 'Could not check your account email.' : 'The request could not be confirmed. Check its status before trying again.');
    } finally { clearTimeout(timer); }
  }
  async function requestLink(email: string, scope: AccountEmailScope, returnUrl: string, resend = false): Promise<AccountEmailState> {
    const address = normalizeAccountEmail(email);
    let redirect: URL;
    try { redirect = new URL(returnUrl); } catch {
      throw new AccountEmailFailure('invalid', 'Email verification is not configured for this build.');
    }
    if ((redirect.protocol !== 'https:' && !(redirect.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(redirect.hostname)))
      || redirect.username || redirect.password || redirect.pathname !== '/email-confirmation' || redirect.search || redirect.hash) {
      throw new AccountEmailFailure('invalid', 'Email verification is not configured for this build.');
    }
    const before = await request(scope, 'GET');
    // This bounded path adds/verifies a missing email. It never replaces an
    // already verified login identity or adopts an email-link session.
    if (before.verified) return before;
    if (!resend && before.pendingEmail === address && before.sentAt) return before;
    current(scope);
    const after = await request(scope, 'PUT', address, redirect.toString());
    if (after.pendingEmail !== address && !(after.verified && after.email === address)) {
      throw new AccountEmailFailure('unknown', 'The request could not be confirmed. Check its status before trying again.');
    }
    return after;
  }
  return { load: (scope: AccountEmailScope) => request(scope, 'GET'), requestLink };
}
