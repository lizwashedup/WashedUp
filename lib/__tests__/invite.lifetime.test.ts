import { Linking, Platform, Share } from 'react-native';
import { buildInviteText, buildReferralLink, openInviteComposer } from '../yours/invite';

jest.mock('react-native', () => ({ Linking: { canOpenURL: jest.fn(), openURL: jest.fn() }, Platform: { OS: 'ios' }, Share: { share: jest.fn() } }));
const canOpen = Linking.canOpenURL as jest.Mock, open = Linking.openURL as jest.Mock, share = Share.share as jest.Mock;
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
beforeEach(() => { jest.clearAllMocks(); canOpen.mockReset().mockResolvedValue(true); open.mockReset().mockResolvedValue(undefined); share.mockReset().mockResolvedValue({ action: 'sharedAction' }); (Platform as any).OS = 'ios'; });

it.each(['ios', 'android'])('preserves the %s native SMS intent and never claims a send receipt', async os => {
  (Platform as any).OS = os; await expect(openInviteComposer('JZJAAJU')).resolves.toBeUndefined();
  const url = `sms:${os === 'ios' ? '&' : '?'}body=${encodeURIComponent(buildInviteText('JZJAAJU'))}`;
  expect(canOpen).toHaveBeenCalledWith(url); expect(open).toHaveBeenCalledWith(url); expect(share).not.toHaveBeenCalled();
});
it('does not launch or validate an already-retired action', async () => {
  await openInviteComposer('JZJAAJU', () => false); expect(canOpen).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled(); expect(share).not.toHaveBeenCalled();
});
it.each([true, false])('does not open any external composer after retirement during canOpenURL (%s)', async available => {
  const gate = deferred<boolean>(); let current = true; canOpen.mockReturnValueOnce(gate.promise);
  const result = openInviteComposer('JZJAAJU', () => current); current = false; gate.resolve(available); await result;
  expect(open).not.toHaveBeenCalled(); expect(share).not.toHaveBeenCalled();
});
it('does not fall back after a capability error from an obsolete visit', async () => {
  const gate = deferred<boolean>(); let current = true; canOpen.mockReturnValueOnce(gate.promise);
  const result = openInviteComposer('JZJAAJU', () => current); current = false; gate.reject(new Error('capability failed')); await result;
  expect(open).not.toHaveBeenCalled(); expect(share).not.toHaveBeenCalled();
});
it('does not fall back after a failed SMS launch from an obsolete visit', async () => {
  const gate = deferred<void>(); let current = true; open.mockReturnValueOnce(gate.promise);
  const result = openInviteComposer('JZJAAJU', () => current); await Promise.resolve(); expect(open).toHaveBeenCalledTimes(1);
  current = false; gate.reject(new Error('open failed')); await result; expect(share).not.toHaveBeenCalled();
});
it.each(['unavailable', 'capability-error', 'open-error'])('preserves the share fallback for a current %s result', async kind => {
  if (kind === 'unavailable') canOpen.mockResolvedValueOnce(false);
  if (kind === 'capability-error') canOpen.mockRejectedValueOnce(new Error('unavailable'));
  if (kind === 'open-error') open.mockRejectedValueOnce(new Error('unavailable'));
  await openInviteComposer('JZJAAJU', () => true);
  expect(share).toHaveBeenCalledTimes(1); expect(share).toHaveBeenCalledWith({ message: buildInviteText('JZJAAJU') });
});
it('does not reopen or retry a dismissed share sheet', async () => {
  canOpen.mockResolvedValueOnce(false); share.mockResolvedValueOnce({ action: 'dismissedAction' });
  await openInviteComposer('JZJAAJU'); expect(share).toHaveBeenCalledTimes(1); expect(open).not.toHaveBeenCalled();
});
it('propagates a current share failure so the screen can show retry', async () => {
  const error = new Error('share unavailable'); canOpen.mockResolvedValueOnce(false); share.mockRejectedValueOnce(error);
  await expect(openInviteComposer('JZJAAJU')).rejects.toBe(error);
});
it('rejects malformed codes before any external capability check', async () => {
  await expect(openInviteComposer('bad/code')).rejects.toThrow('Invalid referral code');
  expect(canOpen).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled(); expect(share).not.toHaveBeenCalled();
});
it('retains valid mixed-case link codes without interpolation of path or query data', () => {
  expect(buildReferralLink('a_B-09')).toBe('https://washedup.app/r/a_B-09');
  expect(() => buildInviteText('code?to=elsewhere')).toThrow('Invalid referral code');
});
