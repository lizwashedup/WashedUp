import type { MemberInviteStatus } from './memberInvites';

/** Expiration is time-based even when the stored status has not been updated. */
export function effectiveMemberInviteStatus(status: MemberInviteStatus, expiresAt: string, now = Date.now()): MemberInviteStatus {
  return (status === 'pending' || status === 'viewed') && Date.parse(expiresAt) <= now ? 'expired' : status;
}

export function memberInviteExpiryLabel(expiresAt: string, now = Date.now()): string {
  const ms = Date.parse(expiresAt) - now;
  if (!Number.isFinite(ms)) return 'Expiry unavailable';
  if (ms <= 0) return 'Expired';
  if (ms < 3_600_000) return 'Less than an hour left';
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} left`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} left`;
}
