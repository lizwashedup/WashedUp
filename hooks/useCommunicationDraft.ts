import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { requestWithDeadline } from '../lib/requestWithDeadline';
import type { CreatorPageScope } from '../lib/creatorPageReview';
import { loadCommunicationDraft, saveCommunicationDraft, type CommunicationDraftKind } from '../lib/communicationDraft';

/** Save edits to the current account/event; failed reads never turn into an empty overwrite. */
export function useCommunicationDraft<T>(eventId: string, kind: CommunicationDraftKind, scope: CreatorPageScope | null, initial: T, valid: (value: unknown) => value is T) {
  const [, render] = useReducer(n => n + 1, 0);
  const state = useMemo(() => ({value: initial, loaded: false, loading: false, saving: false, saved: false,
    readError: false, error: '', revision: 0, read: 0}), [eventId, kind, scope?.userId, initial]);
  const currentState = useRef(state); currentState.current = state;
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = useCallback(() => mounted.current && currentState.current === state && !!scope?.isCurrent(), [state, scope]);
  const load = useCallback(async () => {
    if (!scope || !current() || state.loaded || state.loading) return;
    const read = ++state.read;
    state.loading = true; state.error = ''; render();
    try {
      const saved = await requestWithDeadline(loadCommunicationDraft(eventId, kind, scope, valid), 12_000);
      if (!current() || state.read !== read) return;
      state.value = saved ?? initial; state.loaded = true; state.saved = saved !== null; state.readError = false;
    } catch { if (current()) { state.error = 'Couldn’t load your draft. Try again before editing.'; state.readError = true; } }
    finally { state.loading = false; if (current()) render(); }
  }, [eventId, kind, scope, valid, initial, current, state]);
  useEffect(() => { void load(); }, [load]);
  const save = async (value = state.value) => {
    if (!scope || !current() || !state.loaded) return false;
    const revision = ++state.revision;
    state.saving = true; state.saved = false; state.error = ''; render();
    try {
      await requestWithDeadline(saveCommunicationDraft(eventId, kind, value, scope), 12_000);
      // Retain the receipt across blur, but never publish it into another account/event.
      if (state.revision === revision) { state.saved = true; state.error = ''; }
      return state.revision === revision;
    } catch { if (state.revision === revision) state.error = 'Couldn’t save your draft. Your changes are still here. Try again.'; return false; }
    finally { if (state.revision === revision) state.saving = false; if (current()) render(); }
  };
  return { ...state, ready: state.loaded && !!scope?.isCurrent(),
    change(value: T | ((previous: T) => T)) { if (!current() || !state.loaded) return; const next = typeof value === 'function' ? (value as (previous: T) => T)(state.value) : value; state.value = next; state.saved = false; render(); void save(next); },
    replace: async (value:T) => { if (!current() || !state.loaded) return false; state.value=value; state.saved=false; render(); return save(value); },
    save: () => save(), retry: () => state.readError ? load() : save(),
  };
}
