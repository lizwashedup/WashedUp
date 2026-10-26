import React from 'react';
import { act, create } from 'react-test-renderer';
import { TouchableOpacity, Text } from 'react-native';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
  useFocusEffect: (effect: () => void) => require('react').useEffect(effect, [effect]),
}));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('../../../../lib/authGate', () => ({ getUserBounded: jest.fn() }));
jest.mock('../../../../lib/onboardingDraft', () => ({
  loadDraft: jest.fn(async (screen: string) => screen === 'referral' ? { selected: 'tiktok' } : { choseNo: false, city: 'San Diego' }),
  saveDraft: jest.fn(), clearDraft: jest.fn(), cancelPendingSave: jest.fn(), clearAllDrafts: jest.fn(),
}));
jest.mock('../../../../lib/supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn(async () => ({data:{user:{id:'member-a'}}})), onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })), signOut: jest.fn() },
    from: jest.fn(),
  },
}));

import { supabase } from '../../../../lib/supabase';
import { getUserBounded } from '../../../../lib/authGate';
import { clearDraft, clearAllDrafts } from '../../../../lib/onboardingDraft';
import ProgressHead from '../../../../components/onboarding/ProgressHead';
import { BrandedAlert } from '../../../../components/BrandedAlert';
import Location from '../la-check';
import Referral from '../referral';
import Waitlisted from '../waitlisted';

function deferred() {
  let resolve!: (result: any) => void;
  const promise = new Promise<any>(r => { resolve = r; });
  return { promise, resolve };
}

describe.each(['resident', 'visitor', 'waitlist', 'referral', 'waitlisted'] as const)('%s signup recovery', (step) => {
  let tree: ReturnType<typeof create>;
  let unmounted: boolean;
  let read: jest.Mock, write: jest.Mock, update: jest.Mock, filter: jest.Mock;
  const result = { data: { id: 'member-a' }, error: null };
  const screen = step === 'referral' ? 'referral' : 'laCheck';
  const next = step === 'referral' ? '/onboarding/photo' : step === 'waitlist' ? '/onboarding/waitlisted' : '/onboarding/referral';
  const previous = step === 'referral' ? '/onboarding/la-check' : '/onboarding/basics';

  function auth(event: string, id: string | null) {
    for (const [callback] of (supabase.auth.onAuthStateChange as jest.Mock).mock.calls) {
      callback(event, id ? { user: { id } } : null);
    }
  }
  function button(pattern: RegExp) {
    return tree.root.findAllByType(TouchableOpacity).find(b => b.findAllByType(Text).some(t => pattern.test(String(t.props.children))))!;
  }
  function continueButton() {
    return button(step === 'referral' ? /^continue$/ : step === 'waitlist' ? /waitlist/ : step === 'visitor' ? /visiting LA/ : /live here/);
  }
  async function start() {
    let pending!: Promise<void>;
    await act(async () => { pending = continueButton().props.onPress(); });
    return { pending };
  }

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    unmounted = false;
    (getUserBounded as jest.Mock).mockResolvedValue({ user: { id: 'member-a' }, resolved: true });
    read = jest.fn().mockResolvedValue({ data: { onboarding_status: step === 'referral' ? 'referral' : 'la_check' }, error: null });
    write = jest.fn().mockResolvedValue(result);
    update = jest.fn(); filter = jest.fn();
    (supabase.from as jest.Mock).mockImplementation(() => {
      let writing = false;
      const chain: any = {
        select: jest.fn(() => chain), eq: jest.fn(() => chain),
        or: (...args: any[]) => { filter(...args); return chain; },
        update: (value: unknown) => { writing = true; update(value); return chain; },
        single: () => writing ? write() : read(),
        maybeSingle: () => writing ? write() : read(),
        then: (yes: any, no: any) => (writing ? write() : read()).then(yes, no),
      };
      return chain;
    });
    await act(async () => { tree = create(step === 'referral' ? <Referral /> : step === 'waitlisted' ? <Waitlisted /> : <Location />); });
    await act(async () => { auth('INITIAL_SESSION', 'member-a'); });
    if (step === 'waitlist') await act(async () => { button(/bring washedup|another city/).props.onPress(); });
  });

  afterEach(async () => {
    if (!unmounted) await act(async () => tree.unmount());
    jest.useRealTimers();
  });

  it('advances once with the expected profile fields and a matching receipt', async () => {
    await act(async () => { await continueButton().props.onPress(); });
    const fields = step === 'referral' ? { referral_source: 'tiktok', onboarding_status: 'photo' }
      : step === 'waitlist' ? { city: 'San Diego', onboarding_status: 'waitlisted' }
        : { city: 'Los Angeles', is_visitor: step === 'visitor', onboarding_status: 'referral' };
    expect(update).toHaveBeenCalledWith(fields);
    expect(filter).toHaveBeenCalledWith('onboarding_status.is.null,onboarding_status.neq.complete');
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith(next);
    expect(clearDraft).toHaveBeenCalledWith(screen);
  });

  if (step !== 'waitlisted') it('retires the request immediately on Back before the screen unmounts', async () => {
    const slow = deferred(); (getUserBounded as jest.Mock).mockReturnValueOnce(slow.promise);
    const { pending } = await start();
    await act(async () => { tree.root.findByType(ProgressHead).props.onBack(); });
    await act(async () => { slow.resolve({ user: { id: 'member-a' }, resolved: true }); await pending; });
    expect(mockReplace.mock.calls).toEqual([[previous]]);
    expect(update).not.toHaveBeenCalled();
    expect(clearDraft).not.toHaveBeenCalled();
  });

  it.each(step === 'waitlisted' ? ['unmount', 'account switch'] : ['Back', 'unmount', 'account switch'])('ignores a late save receipt after %s', async (exit) => {
    const slow = deferred(); write.mockReturnValueOnce(slow.promise);
    const { pending } = await start();
    expect(update).toHaveBeenCalledTimes(1);
    await act(async () => {
      if (exit === 'Back') tree.root.findByType(ProgressHead).props.onBack();
      if (exit === 'unmount') { tree.unmount(); unmounted = true; }
      if (exit === 'account switch') auth('SIGNED_IN', 'member-b');
    });
    mockReplace.mockClear();
    await act(async () => { slow.resolve(result); await pending; });
    expect(mockReplace).not.toHaveBeenCalled();
    expect(clearDraft).not.toHaveBeenCalled();
  });

  it('does not regress an already completed account', async () => {
    read.mockResolvedValue({ data: { onboarding_status: 'complete' }, error: null });
    await act(async () => { await continueButton().props.onPress(); });
    expect(update).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/plans');
  });

  it('handles completion between preflight and the conditional write', async () => {
    write.mockResolvedValueOnce({ data: null, error: null });
    read.mockResolvedValueOnce({ data: { onboarding_status: 'referral' }, error: null })
      .mockResolvedValueOnce({ data: { onboarding_status: 'complete' }, error: null });
    await act(async () => { await continueButton().props.onPress(); });
    expect(filter).toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/plans');
  });

  it.each([null, { id: 'different-member' }])('retains the answers when the receipt is not the current member: %j', async (data) => {
    write.mockResolvedValueOnce({ data, error: null });
    await act(async () => { await continueButton().props.onPress(); });
    expect(mockReplace).not.toHaveBeenCalled();
    expect(clearDraft).not.toHaveBeenCalled();
    expect(tree.root.findByType(BrandedAlert).props.visible).toBe(true);
    expect(continueButton().props.disabled).toBeFalsy();
    await act(async () => { await continueButton().props.onPress(); });
    expect(mockReplace).toHaveBeenCalledWith(next);
  });

  it('keeps the form when reading account status fails', async () => {
    read.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
    await act(async () => { await continueButton().props.onPress(); });
    expect(update).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(clearDraft).not.toHaveBeenCalled();
  });

  it('releases a hung save after four seconds without accepting its later receipt', async () => {
    const slow = deferred(); write.mockReturnValueOnce(slow.promise);
    const { pending } = await start();
    await act(async () => { jest.advanceTimersByTime(4001); });
    expect(continueButton().props.disabled).toBeFalsy();
    expect(mockReplace).not.toHaveBeenCalled();
    await act(async () => { slow.resolve(result); await pending; });
    expect(mockReplace).not.toHaveBeenCalled();
    expect(clearDraft).not.toHaveBeenCalled();
  });

  it('does not sign out a renewed session because of an older missing-user result', async () => {
    const slow = deferred(); (getUserBounded as jest.Mock).mockReturnValueOnce(slow.promise);
    const { pending } = await start();
    await act(async () => { auth('TOKEN_REFRESHED', 'member-a'); });
    await act(async () => { slow.resolve({ user: null, resolved: true }); await pending; });
    expect(clearAllDrafts).not.toHaveBeenCalled();
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
  });

  it('blocks duplicate taps while the same request is pending', async () => {
    const slow = deferred(); (getUserBounded as jest.Mock).mockReturnValueOnce(slow.promise);
    const press = continueButton().props.onPress;
    let first!: Promise<void>;
    await act(async () => { first = press(); await press(); });
    expect(getUserBounded).toHaveBeenCalledTimes(1);
    await act(async () => { slow.resolve({ user: { id: 'member-a' }, resolved: true }); await first; });
    expect(update).toHaveBeenCalledTimes(1);
  });
});
