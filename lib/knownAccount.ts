/**
 * "Someone was signed in on this device."
 *
 * When a session dies on its own (a refresh that could not complete, a
 * revoked token) the app has always dropped the user on /phone-entry, the
 * cold acquisition screen, identical to what a stranger sees. Known users
 * read that as "make an account" and do exactly that: 43 emails and 7 phones
 * on prod each hold two accounts, one from before phone-only login and one
 * born after a session loss, with their history split across the two.
 *
 * This marker is the memory that makes the difference. It is deliberately
 * NOT the session: no token, no id, nothing that grants access. It is one
 * phone number, on this device, so a returning user can be sent back to the
 * same account instead of starting a new one.
 *
 * Written on every successful sign-in. Cleared ONLY on a deliberate sign-out
 * (log out, delete account, an abandoned onboarding), so choosing to leave
 * still returns you to the cold screen. An involuntary sign-out keeps it.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'wu.knownAccount.v1';

export interface KnownAccount {
  /** E.164, the number this device last signed in with */
  phone: string;
  /** epoch ms of that sign-in */
  lastAuthAt: number;
}

export async function rememberAccount(phone: string | null | undefined): Promise<void> {
  const e164 = (phone ?? '').trim();
  // A user with no phone on file (a legacy email-era account mid-migration)
  // leaves no marker rather than a useless one.
  if (!e164) return;
  const payload: KnownAccount = { phone: e164, lastAuthAt: Date.now() };
  try { await AsyncStorage.setItem(KEY, JSON.stringify(payload)); } catch { /* best-effort */ }
}

export async function getKnownAccount(): Promise<KnownAccount | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<KnownAccount>;
    return typeof parsed?.phone === 'string' && parsed.phone
      ? { phone: parsed.phone, lastAuthAt: Number(parsed.lastAuthAt) || 0 }
      : null;
  } catch {
    return null;
  }
}

export async function forgetAccount(): Promise<void> {
  try { await AsyncStorage.removeItem(KEY); } catch { /* best-effort */ }
}

/**
 * The last four digits only, for a screen that says "this is the number you
 * used" without printing someone's phone number back at them in full.
 * Returns null when there is nothing recognisable to show.
 */
export function lastFour(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

/** the ten national digits, for prefilling the entry field (US numbers). */
export function nationalDigits(phone: string | null | undefined): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits.length === 10 ? digits : '';
}
