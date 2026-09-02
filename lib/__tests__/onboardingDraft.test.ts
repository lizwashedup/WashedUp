import AsyncStorage from '@react-native-async-storage/async-storage';

// The jest.fn() is created entirely inside the factory, with no reference to
// any outer-scope variable at all -- retrieved afterward via the (mocked)
// `supabase` import itself rather than a hand-captured closure variable. An
// outer `let`/`const` "captured by the factory" approach reliably breaks
// here: Babel's ESM interop hoists `import` statements (which is what
// actually triggers the factory, transitively, via onboardingDraft.ts's own
// import of this same module) above this file's own non-import statements,
// regardless of source order or a `mock`-prefixed name -- confirmed directly
// (the factory fires and receives the real callback, then the very next line
// already sees the capturing variable reset to its own initializer).
jest.mock('../supabase', () => ({
  supabase: { auth: { onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })) } },
}));

import { supabase } from '../supabase';
import { saveDraft, loadDraft, clearDraft, cancelPendingSave, clearAllDrafts } from '../onboardingDraft';

type Draft = { firstName: string; count: number };

function setUser(id: string | null) {
  // The module subscribes exactly once, at its own import time, so its
  // callback is always the first recorded call.
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
  setUser('user-a');
  // saveDraft() now refuses to write for a screen until that SAME screen's own
  // loadDraft() has genuinely confirmed auth once (the fix for a real bug: an
  // earlier version let a save succeed even for a screen whose own load had
  // given up, which is exactly how a write clobbered a real draft). These
  // tests exercise save/load/clear round-tripping directly rather than a full
  // screen mount, so establish that confirmation here, the same way a real
  // screen's own mount-time loadDraft call would.
  await loadDraft('basics');
  await loadDraft('referral');
  await loadDraft('laCheck');
});

describe('onboarding draft cache', () => {
  it('has nothing before any save — a fresh signup never sees a stale draft', async () => {
    await expect(loadDraft<Draft>('basics')).resolves.toBeNull();
  });

  it('round-trips a saved value, simulating a kill-and-relaunch', async () => {
    saveDraft<Draft>('basics', { firstName: 'jules', count: 1 });
    await wait(600); // past the internal debounce window
    await expect(loadDraft<Draft>('basics')).resolves.toEqual({ firstName: 'jules', count: 1 });
  });

  it('debounces rapid saves into the last value only, and does not write before the window elapses', async () => {
    saveDraft<Draft>('basics', { firstName: 'j', count: 1 });
    saveDraft<Draft>('basics', { firstName: 'ju', count: 2 });
    saveDraft<Draft>('basics', { firstName: 'jules', count: 3 });
    await expect(loadDraft<Draft>('basics')).resolves.toBeNull();
    await wait(600);
    await expect(loadDraft<Draft>('basics')).resolves.toEqual({ firstName: 'jules', count: 3 });
  });

  it('clears on real submit success and never resurrects on a later, separate signup', async () => {
    saveDraft<Draft>('basics', { firstName: 'jules', count: 1 });
    await wait(600);
    await clearDraft('basics');
    await expect(loadDraft<Draft>('basics')).resolves.toBeNull();
    await expect(loadDraft<Draft>('basics')).resolves.toBeNull();
  });

  it('clearDraft also cancels a still-pending debounced write', async () => {
    saveDraft<Draft>('basics', { firstName: 'jules', count: 1 });
    await clearDraft('basics'); // fires before the 500ms debounce window elapses
    await wait(600);
    await expect(loadDraft<Draft>('basics')).resolves.toBeNull();
  });

  it('cancelPendingSave drops a pending write without touching what is already on disk', async () => {
    saveDraft<Draft>('basics', { firstName: 'saved', count: 1 });
    await wait(600);
    saveDraft<Draft>('basics', { firstName: 'never-lands', count: 2 });
    cancelPendingSave('basics');
    await wait(600);
    await expect(loadDraft<Draft>('basics')).resolves.toEqual({ firstName: 'saved', count: 1 });
  });

  it('keeps separate screens on separate keys', async () => {
    saveDraft<Draft>('basics', { firstName: 'basics-screen', count: 1 });
    saveDraft<{ selected: string }>('referral', { selected: 'reddit' });
    await wait(600);
    await expect(loadDraft<Draft>('basics')).resolves.toEqual({ firstName: 'basics-screen', count: 1 });
    await expect(loadDraft<{ selected: string }>('referral')).resolves.toEqual({ selected: 'reddit' });
  });

  it("scopes drafts to the signed-in user: a different account never sees a prior account's draft", async () => {
    setUser('user-a');
    saveDraft<Draft>('basics', { firstName: 'person-a', count: 1 });
    await wait(600);
    await expect(loadDraft<Draft>('basics')).resolves.toEqual({ firstName: 'person-a', count: 1 });

    setUser('user-b');
    await expect(loadDraft<Draft>('basics')).resolves.toBeNull();
    saveDraft<Draft>('basics', { firstName: 'person-b', count: 1 });
    await wait(600);
    await expect(loadDraft<Draft>('basics')).resolves.toEqual({ firstName: 'person-b', count: 1 });

    setUser('user-a');
    await expect(loadDraft<Draft>('basics')).resolves.toEqual({ firstName: 'person-a', count: 1 });
  });

  it('refuses to read or write with no signed-in user — no shared bucket to leak through', async () => {
    setUser(null);
    saveDraft<Draft>('basics', { firstName: 'nobody-home', count: 1 });
    await wait(600);
    await expect(loadDraft<Draft>('basics')).resolves.toBeNull();
    // Confirm it's a true no-op, not a write to some fallback key a later
    // sign-in could then read: sign in as a real user and check they see nothing.
    setUser('user-a');
    await expect(loadDraft<Draft>('basics')).resolves.toBeNull();
  });

  it('a debounced write started before sign-out is aborted, not misfiled, if sign-out lands before it fires', async () => {
    setUser('user-a');
    saveDraft<Draft>('basics', { firstName: 'mid-flight', count: 1 });
    setUser(null); // sign-out's auth event fires before the 500ms debounce window elapses
    await wait(600);
    setUser('user-a');
    await expect(loadDraft<Draft>('basics')).resolves.toBeNull();
  });

  it('clearAllDrafts wipes every known screen for the current user only', async () => {
    setUser('user-a');
    saveDraft<Draft>('basics', { firstName: 'a', count: 1 });
    saveDraft<{ selected: string }>('referral', { selected: 'reddit' });
    saveDraft<{ city: string }>('laCheck', { city: 'LA' });
    await wait(600);

    setUser('user-b');
    saveDraft<Draft>('basics', { firstName: 'b', count: 1 });
    await wait(600);

    setUser('user-a');
    await clearAllDrafts();
    await expect(loadDraft<Draft>('basics')).resolves.toBeNull();
    await expect(loadDraft<{ selected: string }>('referral')).resolves.toBeNull();
    await expect(loadDraft<{ city: string }>('laCheck')).resolves.toBeNull();

    // user-b's own draft is untouched by user-a's clearAllDrafts.
    setUser('user-b');
    await expect(loadDraft<Draft>('basics')).resolves.toEqual({ firstName: 'b', count: 1 });
  });
});
