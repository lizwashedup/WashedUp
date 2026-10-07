import React from 'react';
import { act, create } from 'react-test-renderer';

const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockGetSession = jest.fn();
const mockSignInWithOtp = jest.fn();
const mockGetProfile = jest.fn();
const mockNeedsPhone = jest.fn();

jest.mock('expo-router', () => ({ router: { replace: (...args: unknown[]) => mockReplace(...args), push: (...args: unknown[]) => mockPush(...args) } }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('../../../components/auth/PhoneInput', () => ({ __esModule: true, default: 'PhoneInput' }));
jest.mock('../../../lib/supabase', () => ({ supabase: { auth: {
  getSession: (...args: unknown[]) => mockGetSession(...args), signInWithOtp: (...args: unknown[]) => mockSignInWithOtp(...args),
} } }));
jest.mock('../../../lib/authGate', () => ({ fetchNeedsPhoneMigration: (...args: unknown[]) => mockNeedsPhone(...args) }));
jest.mock('../../../hooks/useProfile', () => ({ getAuthProfile: (...args: unknown[]) => mockGetProfile(...args) }));
jest.mock('../../../lib/queryClient', () => ({ queryClient: {} }));
jest.mock('../../../lib/haptics', () => ({ hapticLight: jest.fn(), hapticError: jest.fn() }));
jest.mock('../../../lib/navState', () => ({ wasOtpRecentlySent: () => false, markOtpSent: jest.fn() }));
jest.mock('../../../lib/knownAccount', () => ({
  getKnownAccount: async () => null, lastFour: () => '', nationalDigits: () => '',
}));

import PhoneEntryScreen from '../phone-entry';

const session = (id: string | null) => ({ data: { session: id ? { user: { id } } : null } });
const completeProfile = { onboarding_status: 'complete', referral_source: 'friend', phone_number: '+12135550101' };

describe('returning phone member continuation', () => {
  let tree: ReturnType<typeof create>;
  beforeEach(async () => {
    jest.useFakeTimers();
    jest.resetAllMocks();
    mockGetSession.mockResolvedValue(session('member-a'));
    mockSignInWithOtp.mockResolvedValue({ error: null });
    mockGetProfile.mockResolvedValue(completeProfile);
    mockNeedsPhone.mockResolvedValue(false);
    await act(async () => { tree = create(<PhoneEntryScreen />); });
    await act(async () => {
      tree.root.findByType('PhoneInput' as any).props.onChangeText('2135550101');
    });
  });
  afterEach(async () => {
    await act(async () => { tree.unmount(); });
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  const continueEntry = async () => {
    await act(async () => {
      await tree.root.findByType('PhoneInput' as any).props.onSubmitEditing();
    });
  };

  it('returns a registered member to Plans without the add-number page or another OTP', async () => {
    await continueEntry();
    expect(mockGetProfile).toHaveBeenCalledWith({}, 'member-a');
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/plans');
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
  });

  it('retains the existing onboarding destination for an unfinished account', async () => {
    mockGetProfile.mockResolvedValue({ ...completeProfile, onboarding_status: 'waitlisted' });
    await continueEntry();
    expect(mockReplace).toHaveBeenCalledWith('/onboarding/waitlisted');
  });

  it('requires the existing same-account flow when the server confirms a genuinely missing phone', async () => {
    mockNeedsPhone.mockResolvedValue(true);
    await continueEntry();
    expect(mockReplace).toHaveBeenCalledWith('/migration-gate');
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
  });

  it('leaves an unresolved profile retryable without inventing onboarding or creating another account', async () => {
    mockGetProfile.mockResolvedValue(null);
    await continueEntry();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
    expect(tree.root.findByType('PhoneInput' as any).props.error).toBe('something went wrong. try again.');
  });

  it('does not navigate using a previous account after an account change', async () => {
    mockGetSession.mockResolvedValueOnce(session('member-a')).mockResolvedValueOnce(session('member-b'));
    await continueEntry();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
  });

  it('keeps normal OTP verification for a signed-out member', async () => {
    mockGetSession.mockResolvedValue(session(null));
    await continueEntry();
    expect(mockSignInWithOtp).toHaveBeenCalledWith({ phone: '+12135550101' });
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/verify-code', params: { phone: '2135550101' } });
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('does not navigate when the entry screen closes while the account read is pending', async () => {
    let finish!: (value: typeof completeProfile) => void;
    mockGetProfile.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    let pending!: Promise<void>;
    await act(async () => {
      pending = tree.root.findByType('PhoneInput' as any).props.onSubmitEditing();
    });
    await act(async () => { tree.unmount(); });
    await act(async () => { finish(completeProfile); await pending; });
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
  });

  it('makes a stalled account read retryable without redirecting or sending an OTP', async () => {
    mockGetProfile.mockImplementation(() => new Promise(() => {}));
    let pending!: Promise<void>;
    await act(async () => {
      pending = tree.root.findByType('PhoneInput' as any).props.onSubmitEditing();
    });
    await act(async () => { jest.advanceTimersByTime(4000); await pending; });
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
    expect(tree.root.findByType('PhoneInput' as any).props.error).toBe('something went wrong. try again.');
  });
});
