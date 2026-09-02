import AsyncStorage from '@react-native-async-storage/async-storage';

// Deliberately separate from onboardingDraft.test.ts: that file's beforeEach
// fires an auth event before every test, which permanently resolves the
// module's `ready` promise for the rest of that file's run and can never
// exercise the "auth genuinely has not reported anything yet" state. This
// file's very first test IS that state -- a fresh module registry per test
// file means no auth event has fired here until a test fires one itself.
jest.mock('../supabase', () => ({
  supabase: { auth: { onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })) } },
}));

import { supabase } from '../supabase';
import { saveDraft, loadDraft, clearAllDrafts } from '../onboardingDraft';

type Draft = { firstName: string; count: number };

function fireAuthEvent(id: string | null) {
  const mockOnAuthStateChange = supabase.auth.onAuthStateChange as jest.Mock;
  const cb = mockOnAuthStateChange.mock.calls[0]?.[0] as
    | ((event: string, session: { user: { id: string } } | null) => void)
    | undefined;
  cb?.(id ? 'SIGNED_IN' : 'SIGNED_OUT', id ? { user: { id } } : null);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('onboarding draft cache: before auth has resolved even once', () => {
  // Each test below uses ITS OWN screen name, never reused across tests in
  // this file. hydrationConfirmed (the mechanism under test) is deliberately
  // a permanent per-screen ratchet inside the module with no reset between
  // tests, so two tests sharing a screen name would let an earlier test's
  // success silently satisfy a later test's premise -- exactly the kind of
  // false pass that let the original bug ship unnoticed the first time.

  it('loadDraft waits for the first auth event instead of reading a real draft as "none"', async () => {
    // Seeded directly, bypassing the module's own API: no auth event has
    // fired yet in this test, so seeding through saveDraft() would not be
    // possible (nor would it be realistic -- this represents a draft written
    // by an earlier, already-hydrated mount, not something this mount produces).
    await AsyncStorage.setItem(
      'wu.onboardingDraft.user-a.screen-wait.v1',
      JSON.stringify({ firstName: 'jules', count: 1 }),
    );

    const loadPromise = loadDraft<Draft>('screen-wait');
    await wait(50); // a screen's mount effect calling loadDraft before auth is known
    fireAuthEvent('user-a'); // auth resolves shortly after, well inside the bound

    await expect(loadPromise).resolves.toEqual({ firstName: 'jules', count: 1 });
  });

  it('a screen whose own loadDraft succeeds may then save normally', async () => {
    const loadPromise = loadDraft<Draft>('screen-normal');
    fireAuthEvent('user-a');
    await expect(loadPromise).resolves.toBeNull(); // nothing saved yet, but auth resolved in time

    saveDraft<Draft>('screen-normal', { firstName: 'typed-after-hydration', count: 1 });
    await wait(600);
    await expect(loadDraft<Draft>('screen-normal')).resolves.toEqual({
      firstName: 'typed-after-hydration',
      count: 1,
    });
  });

  it(
    'THE CORE FIX: a save can never succeed for a screen whose own load never confirmed auth, ' +
      'even if auth resolves later -- this is the exact asymmetry that let a write clobber a real ' +
      'draft after the matching read had already given up',
    async () => {
      jest.useFakeTimers();
      try {
        const screen = 'screen-core-fix';

        // loadDraft times out (auth never resolves within its bound) --
        // exactly the getUser()-timeout / cold-boot scenario.
        const loadPromise = loadDraft<Draft>(screen);
        jest.advanceTimersByTime(8000); // authReady()'s bound
        await Promise.resolve();
        await Promise.resolve();
        await expect(loadPromise).resolves.toBeNull();

        // The screen, having gotten null back, renders blank fields and its
        // save effect arms with those blanks.
        saveDraft<Draft>(screen, { firstName: '', count: 0 });
        jest.advanceTimersByTime(600); // saveDraft's own debounce, if it armed at all

        // NOW auth actually resolves, well after loadDraft gave up -- this is
        // the moment the old (round-3) code let a write through anyway.
        fireAuthEvent('user-a');
        await Promise.resolve();
        await Promise.resolve();

        // A real draft appears on disk (as if an earlier, successfully-hydrated
        // mount had written it). This screen's OWN load never confirmed auth,
        // so its save path must still be permanently refused, auth being known
        // now notwithstanding -- prove it directly against that real value.
        await AsyncStorage.setItem(
          `wu.onboardingDraft.user-a.${screen}.v1`,
          JSON.stringify({ firstName: 'REAL-DRAFT-MUST-SURVIVE', count: 99 }),
        );
        saveDraft<Draft>(screen, { firstName: 'blank-attempt-2', count: 0 });
        jest.advanceTimersByTime(600);
        await Promise.resolve();

        const loadAfter = loadDraft<Draft>(screen); // auth is already known now, resolves fast
        jest.advanceTimersByTime(10);
        await Promise.resolve();
        await expect(loadAfter).resolves.toEqual({ firstName: 'REAL-DRAFT-MUST-SURVIVE', count: 99 });
      } finally {
        jest.useRealTimers();
      }
    },
  );

  it('the signing-out guard clears on its own bounded fallback if no confirming event ever arrives', async () => {
    jest.useFakeTimers();
    try {
      // Must be a real KNOWN_SCREENS name -- clearAllDrafts() only wipes those,
      // and this test's clearAllDrafts assertion below depends on that write
      // actually landing. No collision with this file's other tests, which
      // deliberately use synthetic names instead.
      const screen = 'basics';

      // Establish hydration first (matches real usage: a screen always loads before it saves).
      const firstLoad = loadDraft<Draft>(screen);
      fireAuthEvent('user-a');
      await firstLoad;

      saveDraft<Draft>(screen, { firstName: 'before-signout', count: 1 });
      jest.advanceTimersByTime(600);
      await Promise.resolve();
      await expect(loadDraft<Draft>(screen)).resolves.toEqual({ firstName: 'before-signout', count: 1 });

      const clearing = clearAllDrafts(); // sets the signing-out guard; the confirming event never comes (offline signOut)
      await clearing;
      await expect(loadDraft<Draft>(screen)).resolves.toBeNull();

      // Guard should still be blocking saves right after clearAllDrafts.
      saveDraft<Draft>(screen, { firstName: 'blocked-mid-signout', count: 1 });
      jest.advanceTimersByTime(600);
      await Promise.resolve();
      await expect(loadDraft<Draft>(screen)).resolves.toBeNull();

      // No SIGNED_OUT event ever arrives (the realistic offline-signOut failure
      // case) -- the fallback must still release the guard on its own.
      jest.advanceTimersByTime(8000);
      await Promise.resolve();

      saveDraft<Draft>(screen, { firstName: 'after-fallback-release', count: 1 });
      jest.advanceTimersByTime(600);
      await Promise.resolve();
      await expect(loadDraft<Draft>(screen)).resolves.toEqual({
        firstName: 'after-fallback-release',
        count: 1,
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
