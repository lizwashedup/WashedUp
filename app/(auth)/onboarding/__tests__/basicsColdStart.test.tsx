import React from 'react';
import { act, create } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Separate from basics.test.tsx: that file's beforeEach fires an auth event
// before every test, which permanently resolves onboardingDraft's shared
// `ready` promise for the rest of that file's run. The exact race this file
// exists to reproduce -- the 8s render watchdog firing WHILE loadDraft's own
// (separately bounded) wait for auth is still genuinely pending -- can only
// happen with auth still unresolved.
//
// __resetForTests__() runs in beforeEach for the same reason: this file's own
// SECOND test looked like it passed when run alongside the first, and failed
// the moment it ran alone -- the two tests were sharing one onboardingDraft
// module instance (its cachedUserId/ready/hydrationConfirmed persist across
// tests in a file by default), so the first test's fireAuthEvent('user-a')
// left `ready` already resolved for the second, which then never exercised
// the race it exists to test at all. Confirmed directly: same failure shape
// as the lib-level cross-test leak in onboardingDraftColdStart.test.ts, just
// one level up. jest.resetModules() was tried first and rejected: it
// re-requires React itself along with everything else, producing "Invalid
// hook call" from a duplicate React copy against the statically-imported
// react-test-renderer.

const mockRouterReplace = jest.fn();
jest.mock('expo-router', () => ({ router: { replace: mockRouterReplace, push: jest.fn() } }));

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

jest.mock('../../../../lib/supabase', () => {
  const profileChain = {
    select: jest.fn(function (this: unknown) { return this; }),
    eq: jest.fn(function (this: unknown) { return this; }),
    maybeSingle: jest.fn(() => Promise.resolve({ data: null })),
    update: jest.fn(function (this: unknown) { return this; }),
  };
  return {
    supabase: {
      auth: {
        // Hangs forever: withTimeout's own 4s bound is what resolves this to
        // {user: null}, exercising the exact same branch as basics.test.tsx's
        // existing timeout test, so the profile fetch never runs and cannot
        // be the source of the slow path this file is isolating -- only
        // onboardingDraft's own separately-bounded auth wait is.
        getUser: jest.fn(() => new Promise(() => { /* never resolves */ })),
        onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
        signOut: jest.fn(),
      },
      from: jest.fn(() => profileChain),
      functions: { invoke: jest.fn() },
    },
  };
});

import { supabase } from '../../../../lib/supabase';
import { __resetForTests__ } from '../../../../lib/onboardingDraft';
import OnboardingBasicsScreen from '../basics';

function fireAuthEvent(id: string | null) {
  const mockOnAuthStateChange = supabase.auth.onAuthStateChange as jest.Mock;
  const cb = mockOnAuthStateChange.mock.calls[0]?.[0] as
    | ((event: string, session: { user: { id: string } } | null) => void)
    | undefined;
  cb?.(id ? 'SIGNED_IN' : 'SIGNED_OUT', id ? { user: { id } } : null);
}

describe('basics.tsx: the render watchdog can open the form before auth (and loadDraft) resolve', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    __resetForTests__(); // fresh cachedUserId/ready/hydrationConfirmed per test, see note above
    await AsyncStorage.clear();
    // Deliberately no fireAuthEvent() here -- that is the condition under test.
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it(
    'does not overwrite text the user already typed once the slow background restore finally resolves',
    async () => {
      // A real draft sits on disk from an earlier, already-hydrated mount.
      await AsyncStorage.setItem(
        'wu.onboardingDraft.user-a.basics.v1',
        JSON.stringify({
          firstName: 'STALE-DRAFT-NAME',
          lastName: '',
          email: '',
          marketingOptIn: false,
          birthdayISO: null,
          gender: null,
        }),
      );

      let tree: ReturnType<typeof create>;
      await act(async () => {
        tree = create(<OnboardingBasicsScreen />);
      });

      // getUser() hangs, hits its own 4s bound (user: null), the profile
      // block is skipped, and the async chain reaches loadDraft -- which
      // then blocks on onboardingDraft's own authReady() because no auth
      // event has fired at all yet. The chain is now genuinely stuck past
      // the point the 8s render watchdog fires, exactly the reported race.
      await act(async () => {
        jest.advanceTimersByTime(8000);
        await Promise.resolve();
        await Promise.resolve();
      });

      // The form is now visible (watchdog forced bootstrapping false) but
      // still blank -- loadDraft is still pending on authReady(). The user
      // starts typing into it.
      const firstNameInput = tree!.root.findAllByProps({ placeholder: 'first name' })[0];
      expect(firstNameInput.props.value).toBe(''); // confirms the race: still blank when they start
      await act(async () => {
        firstNameInput.props.onChangeText('USER-TYPED-THIS');
      });

      // NOW auth finally resolves, well after the watchdog already opened
      // the form and after the user already typed into it. loadDraft can
      // now proceed and would, without the fix, apply the stale draft.
      await act(async () => {
        fireAuthEvent('user-a');
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      const nameInputAfter = tree!.root.findAllByProps({ placeholder: 'first name' })[0];
      expect(nameInputAfter.props.value).toBe('USER-TYPED-THIS');

      await act(async () => {
        tree.unmount();
      });
    },
  );

  it(
    'editing one field during the same race does not discard the restore of the other, untouched fields',
    async () => {
      await AsyncStorage.setItem(
        'wu.onboardingDraft.user-a.basics.v1',
        JSON.stringify({
          firstName: 'Alice',
          lastName: 'Smith',
          email: 'alice@example.com',
          marketingOptIn: true,
          birthdayISO: '1995-06-15',
          gender: 'woman',
        }),
      );

      let tree: ReturnType<typeof create>;
      await act(async () => {
        tree = create(<OnboardingBasicsScreen />);
      });

      await act(async () => {
        jest.advanceTimersByTime(8000);
        await Promise.resolve();
        await Promise.resolve();
      });

      // The user edits ONLY firstName during the race.
      const firstNameInput = tree!.root.findAllByProps({ placeholder: 'first name' })[0];
      expect(firstNameInput.props.value).toBe(''); // confirms the race is real here too
      await act(async () => {
        firstNameInput.props.onChangeText('J');
      });

      await act(async () => {
        fireAuthEvent('user-a');
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      const firstNameAfter = tree!.root.findAllByProps({ placeholder: 'first name' })[0];
      const lastNameAfter = tree!.root.findAllByProps({ placeholder: 'last name' })[0];
      const emailAfter = tree!.root.findAllByProps({ placeholder: 'you@example.com' })[0];

      // The field the user actually touched: their typing wins.
      expect(firstNameAfter.props.value).toBe('J');
      // Every OTHER field: still restored from the real draft, not abandoned
      // just because a sibling field was being edited at the same moment.
      expect(lastNameAfter.props.value).toBe('Smith');
      expect(emailAfter.props.value).toBe('alice@example.com');

      await act(async () => {
        tree.unmount();
      });
    },
  );
});
