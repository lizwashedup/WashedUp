import React from 'react';
import { act, create } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Regression tests for two real bugs found in this feature:
//
// 1. A getUser() timeout used to flip bootstrapping=false WITHOUT ever
//    attempting loadDraft, so the save-effect (gated only on bootstrapping)
//    fired once with every field at its blank useState default and
//    overwrote a real on-disk draft ~500ms later. Fixed by gating saves on
//    draftLoadAttempted, only set from inside the bootstrap effect's own
//    `finally`, after loadDraft has actually run on every path.
//
// 2. Restoring a draft's birthday used to leave dateError at null regardless
//    of the restored date, so an under-18 birthday picked before a kill
//    passed canContinue silently on relaunch. Fixed by re-running is18Plus
//    on every restore path, plus a hard check inside handleContinue itself.

const mockRouterReplace = jest.fn();
jest.mock('expo-router', () => ({ router: { replace: (...args: unknown[]) => mockRouterReplace(...args), push: jest.fn() } }));

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

// Everything the factory needs is created INSIDE it, with no reference to any
// outer-scope variable -- retrieved afterward via the (mocked) `supabase`
// import itself. A hand-captured outer `let`/`const` "closed over by the
// factory" approach reliably breaks here: Babel's ESM interop hoists `import`
// statements (which is what actually invokes the factory, transitively, via
// basics.tsx's own import of this module) above this file's own non-import
// statements, regardless of source order or a `mock`-prefixed name --
// confirmed directly while building this (the factory fires and receives the
// real callback, then the very next line already sees the value reset back
// to its own initializer).
jest.mock('../../../../lib/supabase', () => {
  const profileChain = {
    select: jest.fn(function (this: unknown) { return this; }),
    eq: jest.fn(function (this: unknown) { return this; }),
    or: jest.fn(function (this: unknown) { return this; }),
    maybeSingle: jest.fn(() => new Promise(() => { /* hangs unless overridden per test */ })),
    update: jest.fn(function (this: unknown) { return this; }),
  };
  return {
    supabase: {
      auth: {
        getUser: jest.fn(() => new Promise(() => { /* hangs by default: forces withTimeout's 4s fallback */ })),
        onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
        signOut: jest.fn(),
      },
      from: jest.fn(() => profileChain),
      functions: { invoke: jest.fn() },
    },
  };
});

import { supabase } from '../../../../lib/supabase';
import { loadDraft } from '../../../../lib/onboardingDraft';
import OnboardingBasicsScreen from '../basics';

/**
 * Seeds a draft directly on disk, bypassing saveDraft(): saveDraft() now
 * refuses to write for a screen until that screen's own loadDraft() has
 * genuinely confirmed auth once (the round-4 fix for the exact asymmetry bug
 * this file's first test exists to catch), so it cannot be used for setup in
 * a test that is specifically about what happens before that confirmation
 * exists yet. A pre-existing draft on disk, written by an earlier already-
 * hydrated mount, is exactly what this simulates.
 */
async function seedDraft(userId: string, screen: string, value: unknown) {
  await AsyncStorage.setItem(`wu.onboardingDraft.${userId}.${screen}.v1`, JSON.stringify(value));
}

function setUser(id: string | null) {
  // The module subscribes exactly once, at its own import time, so its
  // callback is always the first recorded call.
  const mockOnAuthStateChange = supabase.auth.onAuthStateChange as jest.Mock;
  const cb = mockOnAuthStateChange.mock.calls[0]?.[0] as
    | ((event: string, session: { user: { id: string } } | null) => void)
    | undefined;
  cb?.(id ? 'SIGNED_IN' : 'SIGNED_OUT', id ? { user: { id } } : null);
}

function profileChain() {
  return supabase.from('profiles') as unknown as { maybeSingle: jest.Mock; update: jest.Mock; or: jest.Mock };
}

describe('basics.tsx onboarding-draft regressions', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    mockRouterReplace.mockClear();
    await AsyncStorage.clear();
    (supabase.auth.getUser as jest.Mock).mockImplementation(
      () => new Promise(() => { /* hangs unless overridden below */ }),
    );
    profileChain().maybeSingle.mockReset().mockResolvedValue({ data: { id: 'user-a', onboarding_status: 'pending' }, error: null });
    profileChain().or.mockClear();
    profileChain().update.mockClear();
    (supabase.functions.invoke as jest.Mock).mockClear().mockResolvedValue({ error: null });
    setUser('user-a');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function mountAdultDraft(email: string) {
    (supabase.auth.getUser as jest.Mock).mockResolvedValue({ data: { user: { id: 'user-a' } } });
    await seedDraft('user-a', 'basics', {
      firstName: 'Test', lastName: 'Member', email, marketingOptIn: false,
      birthdayISO: '1990-01-01', gender: 'man',
    });
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<OnboardingBasicsScreen />); });
    return tree;
  }

  function continueButton(tree: ReturnType<typeof create>) {
    const { TouchableOpacity, Text } = require('react-native');
    return tree.root.findAllByType(TouchableOpacity).find((button) =>
      button.findAllByType(Text).some((text) => text.props.children === 'continue'),
    )!;
  }

  it.each(['', 'invalid-email'])('requires a valid onboarding email even when the other fields are complete (%s)', async (email) => {
    const tree = await mountAdultDraft(email);
    expect(continueButton(tree).props.disabled).toBe(true);
    // Exercise the handler too, rather than relying only on button styling.
    await act(async () => { await continueButton(tree).props.onPress(); });
    expect(profileChain().update).not.toHaveBeenCalled();
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
    expect(mockRouterReplace).not.toHaveBeenCalled();
    const messages = tree.root.findAllByType(require('react-native').Text).map((n) => n.props.children);
    expect(messages).toContain(email ? 'enter a valid email address.' : 'email is required.');
    await act(async () => { tree.unmount(); });
  });

  it('saves the required email and requests Resend reconciliation while preserving an explicit marketing opt-out', async () => {
    const tree = await mountAdultDraft('  member@example.com  ');
    expect(continueButton(tree).props.disabled).toBe(false);
    await act(async () => { await continueButton(tree).props.onPress(); });
    expect(profileChain().update).toHaveBeenCalledWith(expect.objectContaining({
      email: 'member@example.com', marketing_opt_in: false, onboarding_status: 'la_check',
    }));
    expect(supabase.functions.invoke).toHaveBeenCalledWith('add-to-resend-audience');
    expect(mockRouterReplace).toHaveBeenCalledWith('/onboarding/la-check');
    await act(async () => { tree.unmount(); });
  });

  it('sends completed members back to Plans without a profile write', async () => {
    profileChain().maybeSingle.mockResolvedValue({ data: { onboarding_status: 'complete' }, error: null });
    const tree = await mountAdultDraft('member@example.com');
    expect(mockRouterReplace).toHaveBeenCalledWith('/(tabs)/plans');
    expect(profileChain().update).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  it('rechecks completion before saving a previously opened form', async () => {
    const tree = await mountAdultDraft('member@example.com');
    profileChain().maybeSingle.mockResolvedValue({ data: { onboarding_status: 'complete' }, error: null });
    await act(async () => { await continueButton(tree).props.onPress(); });
    expect(profileChain().update).not.toHaveBeenCalled();
    expect(mockRouterReplace).toHaveBeenCalledWith('/(tabs)/plans');
    await act(async () => tree.unmount());
  });

  it('handles completion on another device between the read and write', async () => {
    const tree = await mountAdultDraft('member@example.com');
    profileChain().maybeSingle
      .mockResolvedValueOnce({ data: { onboarding_status: 'pending' }, error: null })
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { onboarding_status: 'complete' }, error: null });
    await act(async () => { await continueButton(tree).props.onPress(); });
    expect(profileChain().or).toHaveBeenCalledWith('onboarding_status.is.null,onboarding_status.neq.complete');
    expect(mockRouterReplace).toHaveBeenCalledWith('/(tabs)/plans');
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  it.each([{ data: null, error: null }, { data: { onboarding_status: 'pending' }, error: { message: 'offline' } }])(
    'keeps the draft without writing when the account read fails (%j)', async (result) => {
      const tree = await mountAdultDraft('member@example.com');
      profileChain().maybeSingle.mockResolvedValueOnce(result);
      await act(async () => { await continueButton(tree).props.onPress(); });
      expect(profileChain().update).not.toHaveBeenCalled();
      expect(mockRouterReplace).not.toHaveBeenCalled();
      await expect(loadDraft('basics')).resolves.toMatchObject({ email: 'member@example.com' });
      await act(async () => tree.unmount());
    },
  );

  it('does not advance or sync marketing without a matching save receipt', async () => {
    const tree = await mountAdultDraft('member@example.com');
    profileChain().maybeSingle
      .mockResolvedValueOnce({ data: { onboarding_status: 'pending' }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    await act(async () => { await continueButton(tree).props.onPress(); });
    expect(mockRouterReplace).not.toHaveBeenCalled();
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
    await expect(loadDraft('basics')).resolves.toMatchObject({ email: 'member@example.com' });
    await act(async () => tree.unmount());
  });

  it.each(['unmount', 'account change'])('retires a pending completion check after %s', async (exit) => {
    const tree = await mountAdultDraft('member@example.com');
    let resolve!: (value: unknown) => void;
    profileChain().maybeSingle.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    let pending!: Promise<void>;
    await act(async () => { pending = continueButton(tree).props.onPress(); });
    if (exit === 'unmount') await act(async () => tree.unmount());
    else await act(async () => {
      for (const [callback] of (supabase.auth.onAuthStateChange as jest.Mock).mock.calls) {
        callback('SIGNED_IN', { user: { id: 'user-b' } });
        callback('SIGNED_IN', { user: { id: 'user-a' } });
      }
    });
    await act(async () => { resolve({ data: { onboarding_status: 'pending' }, error: null }); await pending; });
    expect(profileChain().update).not.toHaveBeenCalled();
    expect(mockRouterReplace).not.toHaveBeenCalled();
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
    if (exit !== 'unmount') await act(async () => tree.unmount());
  });

  it.each(['unmount', 'account change'])('ignores a late save receipt after %s', async (exit) => {
    const tree = await mountAdultDraft('member@example.com');
    let resolve!: (value: unknown) => void;
    profileChain().maybeSingle
      .mockResolvedValueOnce({ data: { onboarding_status: 'pending' }, error: null })
      .mockReturnValueOnce(new Promise(r => { resolve = r; }));
    let pending!: Promise<void>;
    await act(async () => { pending = continueButton(tree).props.onPress(); });
    expect(profileChain().update).toHaveBeenCalledTimes(1);
    if (exit === 'unmount') await act(async () => tree.unmount());
    else await act(async () => {
      for (const [callback] of (supabase.auth.onAuthStateChange as jest.Mock).mock.calls) {
        callback('SIGNED_IN', { user: { id: 'user-b' } });
      }
      await seedDraft('user-b', 'basics', { firstName: 'Other', email: 'other@example.com' });
    });
    await act(async () => { resolve({ data: { id: 'user-a' }, error: null }); await pending; });
    expect(mockRouterReplace).not.toHaveBeenCalled();
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
    if (exit === 'account change') {
      expect(await AsyncStorage.getItem('wu.onboardingDraft.user-b.basics.v1')).toContain('other@example.com');
      await act(async () => tree.unmount());
    }
  });

  it('never overwrites a real draft with blanks when getUser() times out', async () => {
    // A real draft already exists on disk before this screen ever mounts --
    // e.g. saved on a previous, still-unsubmitted attempt.
    await seedDraft('user-a', 'basics', {
      firstName: 'jules',
      lastName: 'winnfield',
      email: 'jules@example.com',
      marketingOptIn: false,
      birthdayISO: '1990-01-01',
      gender: 'man',
    });

    let tree: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<OnboardingBasicsScreen />);
    });

    // Drive getUser() to its 4s bound. This is the exact moment the old code
    // set bootstrapping=false and returned, WITHOUT calling loadDraft first.
    await act(async () => {
      jest.advanceTimersByTime(4000);
      await Promise.resolve();
      await Promise.resolve();
    });

    // If the old bug were present, the save-effect would have fired here with
    // every field still blank and clobbered the draft on disk by this point.
    await act(async () => {
      jest.advanceTimersByTime(600);
      await Promise.resolve();
    });

    await expect(loadDraft('basics')).resolves.toMatchObject({ firstName: 'jules' });

    await act(async () => {
      tree.unmount();
    });
  });

  it('re-flags an under-18 birthday restored from a draft instead of silently passing it', async () => {
    (supabase.auth.getUser as jest.Mock).mockResolvedValue({ data: { user: { id: 'user-a' } } });
    await seedDraft('user-a', 'basics', {
      firstName: 'kid',
      lastName: 'testerson',
      email: 'kid@example.com',
      marketingOptIn: false,
      birthdayISO: '2015-01-01', // well under 18 as of any date this app runs
      gender: 'man',
    });

    let tree: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<OnboardingBasicsScreen />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const errorTexts = tree!.root
      .findAllByType(require('react-native').Text)
      .map((n) => n.props.children)
      .flat()
      .filter((c) => typeof c === 'string');
    expect(errorTexts).toContain('you must be 18 or older to use washedup.');

    const continueButtons = tree!.root.findAll(
      (n) => n.props?.disabled === true,
    );
    // At minimum, the age-gate error must be visibly surfaced (checked above).
    // This also confirms canContinue itself went false, not just the message.
    expect(continueButtons.length).toBeGreaterThan(0);

    await act(async () => {
      tree.unmount();
    });
  });
});
