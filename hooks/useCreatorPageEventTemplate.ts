import {useEffect, useMemo, useRef, useState} from 'react';
import {CreatorPageScopeExpired, type CreatorPageScope} from '../lib/creatorPageReview';
import {requestWithDeadline} from '../lib/requestWithDeadline';
import {preparePageTemplateAttempt, readPageTemplateAttempt, resolvePageTemplateAttempt, retireStalePageTemplateAttempt,
  type SavedPageTemplateAttempt, type PageTemplateAttemptResult, type PageTemplateResolution} from '../lib/creatorPageEventTemplateAttempt';

/** The editor saves the complete source first. Returning only reads the journal;
 * checking never repeats that save or creates another template. */
export function useCreatorPageEventTemplate(pageId: string | undefined, eventId: string | undefined, scope: CreatorPageScope | undefined) {
  const state = useMemo(() => ({loaded: false, busy: false, recoveryRequired: false, retryReady: false, stale: false, retired: false,
    pending: null as SavedPageTemplateAttempt | null, saved: false, error: null as string | null}), [pageId, eventId, scope]);
  const latest = useRef(state); latest.current = state;
  const mounted = useRef(false); const [, render] = useState(0);
  const current = () => mounted.current && latest.current === state && !!scope?.isCurrent();
  const assertOperation = (owned: CreatorPageScope) => { if (!owned.isCurrent()) throw new CreatorPageScopeExpired(); };
  const update = () => { if (current()) render(n => n + 1); };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const withinOperation = async <T,>(milliseconds: number, work: (owned: CreatorPageScope, resolved: (result: PageTemplateResolution) => void) => Promise<T>) => {
    if (!scope || !current()) throw new CreatorPageScopeExpired();
    let active = true, cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    const owned = {userId: scope.userId, isCurrent: () => active && current()};
    let rejectCleanup!: (reason: Error) => void;
    const cleanupDeadline = new Promise<never>((_, reject) => { rejectCleanup = reject; });
    const resolved = (result: PageTemplateResolution) => {
      assertOperation(owned);
      state.saved = result === 'saved'; state.retired = result === 'retired';
      state.recoveryRequired = true; state.retryReady = false; state.stale = false;
      // Observe confirmed outcome before optional cleanup. The service retains
      // its serialized queue until the real storage call settles, even if the UI
      // deadline expires, so late cleanup cannot erase a newer saved attempt.
      cleanupTimer = setTimeout(() => rejectCleanup(Error('Check the confirmed template status to finish recovery.')), 3_000);
    };
    try { return await requestWithDeadline(Promise.race([work(owned, resolved), cleanupDeadline]), milliseconds); }
    finally { active = false; if (cleanupTimer !== undefined) clearTimeout(cleanupTimer); }
  };
  const recoveryError = () => state.saved ? 'Your template is saved. Check once more to finish recovery on this device.'
    : state.retired ? 'The old attempt is resolved. Check once more before returning to your page.'
    : 'This template is unconfirmed. Check the original attempt before continuing.';

  const refresh = async () => {
    if (!pageId || !eventId || !scope || !current() || state.busy) return;
    state.busy = true; state.retryReady = false; state.stale = false; update();
    try {
      await withinOperation(12_000, async owned => {
        const pending = await readPageTemplateAttempt(pageId, eventId, owned); assertOperation(owned);
        state.pending = pending; state.recoveryRequired = !!pending; state.loaded = true; state.error = null;
      });
    } catch { if (current()) { state.loaded = false; state.error = 'Couldn’t check your template attempt. Try again when connected.'; } }
    finally { state.busy = false; update(); }
  };
  useEffect(() => { void refresh(); }, [state]);

  const finish = (result: PageTemplateAttemptResult, owned: CreatorPageScope) => {
    assertOperation(owned); state.loaded = true; state.error = null; state.stale = result.state === 'stale';
    if (result.state === 'saved') {
      state.saved = true; state.retired = false; state.retryReady = false; state.recoveryRequired = result.cleanupPending;
      if (!result.cleanupPending) state.pending = null;
    } else {
      state.pending = result.attempt; state.recoveryRequired = true; state.retryReady = result.state === 'missing';
    }
    return result;
  };
  const canEdit = () => current() && state.loaded && !state.busy && !state.recoveryRequired && !state.error && !state.retired;
  const begin = async (saveSource: (owned: CreatorPageScope) => Promise<{name: string; updatedAt: string}>) => {
    if (!pageId || !eventId || !scope || !canEdit()) throw Error('Check the original template attempt before continuing.');
    state.busy = true; state.saved = false; state.retryReady = false; state.stale = false; update();
    let checkedOriginal = false;
    try {
      return await withinOperation(25_000, async (owned, resolved) => {
        const pending = await readPageTemplateAttempt(pageId, eventId, owned); assertOperation(owned);
        checkedOriginal = true;
        if (pending) {
          state.pending = pending; state.recoveryRequired = true;
          throw Error('Check the original template attempt before continuing.');
        }
        const source = await saveSource(owned); assertOperation(owned);
        state.recoveryRequired = true; update();
        const prepared = await preparePageTemplateAttempt(pageId, eventId, source.name, source.updatedAt, owned); assertOperation(owned);
        state.pending = prepared.attempt;
        if (!prepared.created) throw Error('Check the original template attempt before continuing.');
        return finish(await resolvePageTemplateAttempt(prepared.attempt, owned, 'retry', resolved), owned);
      });
    } catch (error) {
      if (current() && !checkedOriginal) {
        state.loaded = false; state.error = 'Couldn’t check your template attempt. Try again when connected.';
      }
      if (current() && state.recoveryRequired) state.error = recoveryError();
      if (current() && state.saved) throw Error(recoveryError());
      throw error;
    } finally { state.busy = false; update(); }
  };
  const check = async () => {
    if (!pageId || !eventId || !scope || !current() || state.busy) return;
    state.busy = true; state.retryReady = false; state.stale = false; state.error = null; update();
    try {
      return await withinOperation(12_000, async (owned, resolved) => {
        const pending = await readPageTemplateAttempt(pageId, eventId, owned); assertOperation(owned);
        state.pending = pending; state.recoveryRequired = !!pending;
        if (!pending) { state.loaded = true; return; }
        return finish(await resolvePageTemplateAttempt(pending, owned, 'check', resolved), owned);
      });
    } catch { if (current()) state.error = state.saved || state.retired ? recoveryError() : 'Couldn’t confirm this template. Your original attempt is kept for another check.'; }
    finally { state.busy = false; update(); }
  };
  const retry = async () => {
    if (!scope || !current() || state.busy || !state.pending || !state.retryReady) return;
    const pending = state.pending;
    state.busy = true; state.retryReady = false; state.stale = false; state.error = null; update();
    try { return await withinOperation(25_000, async (owned, resolved) => finish(await resolvePageTemplateAttempt(pending, owned, 'retry', resolved), owned)); }
    catch { if (current()) state.error = state.saved || state.retired ? recoveryError() : 'Couldn’t confirm this template. Check the original attempt again; its saved source may have changed.'; }
    finally { state.busy = false; update(); }
  };
  const review = async () => {
    if (!scope || !current() || state.busy) return;
    if (state.retired && !state.pending) return {state: 'retired' as const, cleanupPending: false};
    if (!(state.stale || state.retired) || !state.pending) return;
    const pending = state.pending;
    state.busy = true; state.retryReady = false; state.error = null; update();
    try {
      return await withinOperation(25_000, async (owned, resolved) => {
        const result = await retireStalePageTemplateAttempt(pending, owned, resolved); assertOperation(owned);
        if (result.state === 'saved') return finish(result, owned);
        if (!result.cleanupPending) state.pending = null;
        state.recoveryRequired = result.cleanupPending; state.stale = false; state.retired = true;
        return result;
      });
    } catch { if (current()) { state.stale = false; state.error = state.saved || state.retired ? recoveryError() : 'Couldn’t resolve the original template. Its attempt is kept; check it again before continuing.'; } }
    finally { state.busy = false; update(); }
  };
  return {...state, begin, check, retry, review, refresh, canEdit, ready: canEdit()};
}
