import { effectiveMemberInviteStatus, memberInviteExpiryLabel } from '../memberInvitePresentation';
const now = Date.parse('2026-11-03T12:00:00Z');
const at = (ms: number) => new Date(now + ms).toISOString();
it('expires pending/viewed links at the boundary without overwriting accepted/canceled history', () => {
 expect(effectiveMemberInviteStatus('pending', at(0), now)).toBe('expired');
 expect(effectiveMemberInviteStatus('viewed', at(-1), now)).toBe('expired');
 expect(effectiveMemberInviteStatus('pending', at(1), now)).toBe('pending');
 expect(effectiveMemberInviteStatus('accepted', at(-1), now)).toBe('accepted');
 expect(effectiveMemberInviteStatus('revoked', at(-1), now)).toBe('revoked');
});
it('never calls an expired link expiring soon or rounds time up to a whole extra day', () => {
 expect(memberInviteExpiryLabel(at(-1), now)).toBe('Expired');
 expect(memberInviteExpiryLabel(at(1), now)).toBe('Less than an hour left');
 expect(memberInviteExpiryLabel(at(23.9 * 3600000), now)).toBe('23 hours left');
 expect(memberInviteExpiryLabel(at(47 * 3600000), now)).toBe('1 day left');
 expect(memberInviteExpiryLabel('bad', now)).toBe('Expiry unavailable');
});
