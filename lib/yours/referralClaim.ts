import { requestWithDeadline } from '../requestWithDeadline';
import { supabase } from '../supabase';

export type ReferralClaimResult =
  | { status: 'connected'; inviterId: string }
  | { status: 'unavailable' | 'retry' | 'stale' };
export type ReferralClaimScope = { userId: string; isCurrent(): boolean };
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);

/** An unknown result is retryable; it does not prove that the invite expired. */
export async function claimReferralForRecipient(code: string, scope: ReferralClaimScope): Promise<ReferralClaimResult> {
  if (!scope.isCurrent()) return { status: 'stale' };
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(code)) return { status: 'unavailable' };
  try {
    const session = await requestWithDeadline(supabase.auth.getSession(), 12_000);
    if (!scope.isCurrent()) return { status: 'stale' };
    if (session.error || session.data.session?.user.id !== scope.userId || !session.data.session.access_token) return { status: 'retry' };
    const receipt = await requestWithDeadline(supabase.rpc('claim_referral_invite', { p_code: code })
      .setHeader('Authorization', `Bearer ${session.data.session.access_token}`), 12_000);
    if (!scope.isCurrent()) return { status: 'stale' };
    if (!receipt.error && uuid(receipt.data)) return { status: 'connected', inviterId: receipt.data };
    if (receipt.error?.code === 'P0001' && ['invalid_referral_code', 'invalid_recipient', 'blocked', 'cannot_re_request'].includes(receipt.error.message)) return { status: 'unavailable' };
    return { status: 'retry' };
  } catch { return { status: scope.isCurrent() ? 'retry' : 'stale' }; }
}
