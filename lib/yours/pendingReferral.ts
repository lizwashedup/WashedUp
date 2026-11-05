import AsyncStorage from '@react-native-async-storage/async-storage';
import { requestWithDeadline } from '../requestWithDeadline';
import { supabase } from '../supabase';

const KEY = 'pendingReferral.v1';
const LEGACY_KEY = 'pendingReferralCode';
const validCode = (code: unknown): code is string => typeof code === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(code);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
type PendingReferral = { version: 1; code: string; ownerId: string | null };
export type PendingReferralScope = { userId: string; isCurrent(): boolean };

// Keep owned records outside the legacy plain-code key. Older app versions
// cannot understand ownership and must not consume these retries on rollback.
function decode(value: string | null): PendingReferral | null {
  try {
    const row = JSON.parse(value ?? 'null');
    return row?.version === 1 && validCode(row.code) && (row.ownerId === null || typeof row.ownerId === 'string') ? row : null;
  } catch { return null; }
}

let revision = 0;
let mutationTail: Promise<unknown> = Promise.resolve();
function mutate<T>(action: () => Promise<T>): Promise<T> {
  const result = mutationTail.then(action, action);
  mutationTail = result.catch(() => undefined);
  return result;
}
const consuming = new Map<string, { scope: PendingReferralScope; promise: Promise<void> }>();

export async function stashPendingReferral(code: string): Promise<void> {
  if (!validCode(code)) return;
  revision += 1;
  try {
    await mutate(async () => {
      await AsyncStorage.setItem(KEY, JSON.stringify({ version: 1, code, ownerId: null } satisfies PendingReferral));
      await AsyncStorage.removeItem(LEGACY_KEY);
    });
  } catch { /* Best-effort capture retains the existing nonblocking contract. */ }
}

export function consumePendingReferral(scope: PendingReferralScope): Promise<void> {
  if (!scope.userId || !scope.isCurrent()) return Promise.resolve();
  const startRevision = revision;
  const key = `${scope.userId}:${startRevision}`;
  const existing = consuming.get(key);
  if (existing?.scope.isCurrent()) return existing.promise;
  const current = () => revision === startRevision && scope.isCurrent();
  const run = async () => {
    try {
      const pending = await mutate(async () => {
        if (!current()) return null;
        const saved = await requestWithDeadline(AsyncStorage.getItem(KEY), 12_000);
        const legacy = saved === null
          ? await requestWithDeadline(AsyncStorage.getItem(LEGACY_KEY), 12_000)
          : null;
        const row = saved === null && validCode(legacy)
          ? { version: 1 as const, code: legacy, ownerId: null }
          : decode(saved);
        if (!row || !current() || (row.ownerId && row.ownerId !== scope.userId)) return null;
        const bound = { ...row, ownerId: scope.userId };
        // Persist ownership before sending. Failed/uncertain claims survive
        // app restart, while a later account cannot claim them automatically.
        await AsyncStorage.setItem(KEY, JSON.stringify(bound));
        // Remove the old unowned pointer before dispatch. If this fails, keep
        // the owned copy and retry migration without making a server request.
        await AsyncStorage.removeItem(LEGACY_KEY);
        return current() ? bound : null;
      });
      if (!pending || !current()) return;
      const session = await requestWithDeadline(supabase.auth.getSession(), 12_000);
      if (!current() || session.error || session.data.session?.user.id !== scope.userId || !session.data.session.access_token) return;
      const result = await requestWithDeadline(supabase.rpc('claim_referral_invite', { p_code: pending.code })
        .setHeader('Authorization', `Bearer ${session.data.session.access_token}`), 12_000);
      if (!current()) return;
      const terminal = result.error?.code === 'P0001' && ['invalid_referral_code', 'invalid_recipient', 'blocked', 'cannot_re_request'].includes(result.error.message);
      if (!(uuid(result.data) && !result.error) && !terminal) return;
      await mutate(async () => {
        if (!current()) return;
        const row = decode(await requestWithDeadline(AsyncStorage.getItem(KEY), 12_000));
        if (current() && row?.code === pending.code && row.ownerId === scope.userId) await AsyncStorage.removeItem(KEY);
      });
    } catch { /* Keep the owned pointer for a later sign-in retry. */ }
  };
  const record = { scope, promise: Promise.resolve() };
  record.promise = run().finally(() => { if (consuming.get(key) === record) consuming.delete(key); });
  consuming.set(key, record);
  return record.promise;
}
