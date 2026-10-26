import { queryClient } from '../queryClient';
import { readOnboardingStatus } from '../onboardingBasics';
import { seedAuthProfile, getAuthProfile, AUTH_PROFILE_KEY } from '../../hooks/useProfile';
import { authedDest } from '../authRouting';
import { supabase } from '../supabase';

jest.mock('../supabase', () => {
  const chain = {
    select: jest.fn(function (this: unknown) { return this; }),
    eq: jest.fn(function (this: unknown) { return this; }),
    maybeSingle: jest.fn(), single: jest.fn(),
  };
  return { supabase: { from: jest.fn(() => chain) } };
});

const completed = { onboarding_status: 'complete', referral_source: 'tiktok', phone_number: '+12025550100' };
const chain = () => supabase.from('profiles') as unknown as { maybeSingle: jest.Mock; single: jest.Mock };

beforeEach(() => {
  jest.useFakeTimers(); queryClient.clear(); jest.clearAllMocks();
  chain().maybeSingle.mockResolvedValue({ data: { onboarding_status: 'complete' }, error: null });
  chain().single.mockResolvedValue({ data: completed, error: null });
});
afterEach(() => { queryClient.clear(); jest.useRealTimers(); });

it.each(['pending', 'waitlisted', 'photo'])('fresh completion defeats a recently cached %s routing decision', async status => {
  seedAuthProfile(queryClient, 'member-a', { ...completed, onboarding_status: status });
  expect(await readOnboardingStatus('member-a')).toBe('complete');
  // This is the actual cache read and routing decision used when tabs mount.
  const profile = await getAuthProfile(queryClient, 'member-a');
  expect(authedDest({ ...profile!, needs_phone_migration: false })).toBe('/(tabs)/plans');
});

it('does not invalidate another member routing cache', async () => {
  seedAuthProfile(queryClient, 'member-b', { ...completed, onboarding_status: 'waitlisted' });
  await readOnboardingStatus('member-a');
  expect(queryClient.getQueryState(AUTH_PROFILE_KEY('member-b'))?.isInvalidated).toBe(false);
  expect((await getAuthProfile(queryClient, 'member-b'))?.onboarding_status).toBe('waitlisted');
  expect(chain().single).not.toHaveBeenCalled();
});

it('does not turn a failed completion read into permission to enter Plans', async () => {
  seedAuthProfile(queryClient, 'member-a', { ...completed, onboarding_status: 'waitlisted' });
  chain().maybeSingle.mockResolvedValue({ data: null, error: { message: 'offline' } });
  await expect(readOnboardingStatus('member-a')).rejects.toThrow();
  expect((await getAuthProfile(queryClient, 'member-a'))?.onboarding_status).toBe('waitlisted');
  expect(chain().single).not.toHaveBeenCalled();
});
