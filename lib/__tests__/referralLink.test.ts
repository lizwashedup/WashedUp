jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('../supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    auth: { getSession: jest.fn() },
  },
}));

import { supabase } from '../supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { handleReferralUrl, parseReferralCode, resolveAndConnect } from '../yours/referralLink';

const rpc = supabase.rpc as jest.Mock;

describe('referral URL boundary', () => {
  beforeEach(() => jest.clearAllMocks());
  it.each([
    'https://washedup.app/r/JZJAAJU',
    'http://washedup.app/r/JZJAAJU',
    'https://www.washedup.app/r/JZJAAJU',
    'http://www.washedup.app/r/JZJAAJU',
    'HTTPS://WASHEDUP.APP/r/JZJAAJU',
    'washedupapp://r/JZJAAJU',
    'WASHEDUPAPP://r/JZJAAJU',
    'https://washedup.app/r/JZJAAJU/',
    'washedupapp://r/JZJAAJU/?from=qr#invite',
    'https://washedup.app/r/JZJAAJU?from=message#invite',
  ])('retains the established own-link form %s', url => {
    expect(parseReferralCode(url)).toBe('JZJAAJU');
  });
  it('preserves case and the full server code alphabet and length', () => {
    expect(parseReferralCode('https://washedup.app/r/aB_09-z')).toBe('aB_09-z');
    expect(parseReferralCode(`https://washedup.app/r/${'A'.repeat(64)}`)).toBe('A'.repeat(64));
    expect(parseReferralCode('washedupapp://r/a')).toBe('a');
  });
  it.each([
    'https://washedup.app.evil.test/r/JZJAAJU',
    'https://evil.test/washedup.app/r/JZJAAJU',
    'https://evil.test/?next=https://washedup.app/r/JZJAAJU',
    'https://washedup.app@evil.test/r/JZJAAJU',
    'https://person@washedup.app/r/JZJAAJU',
    'https://washedup.app:3000/r/JZJAAJU',
    'https://sub.washedup.app/r/JZJAAJU',
    'https://washedup.app./r/JZJAAJU',
    'https://washedup.app/r/JZJAAJU/extra',
    'https://washedup.app/r/JZJAAJU//',
    'https://washedup.app/R/JZJAAJU',
    'https://washedup.app/elsewhere/r/JZJAAJU',
    'https://washedup.app/r/JZJAAJU.evil',
    'https://washedup.app/r/JZJAAJU%2Fextra',
    'https://washedup.app/r/',
    `https://washedup.app/r/${'A'.repeat(65)}`,
    'washedupapp://evil.test/r/JZJAAJU',
    'washedup://r/JZJAAJU',
    'washedupapp:///r/JZJAAJU',
    'ftp://washedup.app/r/JZJAAJU',
    '//washedup.app/r/JZJAAJU',
    'https://washedup.app/r/JZJAAJU\n',
    ' https://washedup.app/r/JZJAAJU',
    '',
  ])('rejects %s before session reads, claims or pending storage', async url => {
    expect(parseReferralCode(url)).toBeNull();
    await expect(handleReferralUrl(url)).resolves.toBe(false);
    expect(supabase.auth.getSession).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });
});

describe('referral claim direction', () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it('claims one server-side inviter-to-recipient request', async () => {
    const inviterId = '11111111-1111-1111-1111-111111111111';
    rpc.mockResolvedValue({ data: inviterId, error: null });

    await expect(resolveAndConnect('JZJAAJU')).resolves.toBe(inviterId);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('claim_referral_invite', {
      p_code: 'JZJAAJU',
    });
  });

  it('returns null when the server rejects or cannot resolve the code', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'invalid_referral_code' } });

    await expect(resolveAndConnect('BADCODE')).resolves.toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
