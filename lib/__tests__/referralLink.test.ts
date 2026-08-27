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
import { resolveAndConnect } from '../yours/referralLink';

const rpc = supabase.rpc as jest.Mock;

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
