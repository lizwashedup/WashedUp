import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type { ChatOperationScope, ConversationKey } from './useChat';
import { emptyChatComposer, readChatComposer, saveChatComposer, prepareChatComposer, finishChatComposer, verifyChatComposerTarget, type ChatComposerDraft, type ChatDraftAttempt } from '../lib/chatComposerDraft';
import { requestWithDeadline } from '../lib/requestWithDeadline';

type State = { owner: ChatOperationScope | null; draft: ChatComposerDraft; ready: boolean; error: boolean };
export function useChatComposerDraft(room: ConversationKey, owner: ChatOperationScope | null) {
  const ref = useRef<State>({ owner: null, draft: emptyChatComposer(), ready: false, error: false });
  const [state, setState] = useState(ref.current);
  const epoch = useRef(0), revision = useRef(0), focused = useRef(true), firstFocus = useRef(true);
  const publish = useCallback((value: State) => { ref.current = value; setState(value); }, []);
  const current = useCallback(() => focused.current && !!owner?.isCurrent(), [owner]);
  const load = useCallback(async () => {
    if (!owner || !current()) return;
    const stamp = ++epoch.current;
    try {
      // Bound the UI wait, including a queued earlier write. The storage queue
      // keeps its original ordering; a timeout must never replace an unknown
      // saved draft with an empty, writable composer.
      const saved = await requestWithDeadline((async () => {
        if (ref.current.owner === owner && ref.current.ready && ref.current.error) await saveChatComposer(room, owner, ref.current.draft);
        return readChatComposer(room, owner);
      })(), 12_000);
      if (current() && stamp === epoch.current) publish({ owner, draft: saved.draft, ready: true, error: saved.unsaved });
    } catch { if (current() && stamp === epoch.current) publish({ ...ref.current, owner, error: true }); }
  }, [room, owner, current, publish]);
  useEffect(() => {
    ++epoch.current; revision.current++;
    publish({ owner, draft: emptyChatComposer(), ready: false, error: false });
    void Promise.resolve().then(load);
    return () => { ++epoch.current; };
  }, [owner, load, publish]);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    if (firstFocus.current) firstFocus.current = false;
    else void load();
    return () => { focused.current = false; ++epoch.current; };
  }, [load]));
  const persist = useCallback(async (draft: ChatComposerDraft) => {
    if (!owner || !current()) throw Error('This conversation visit changed.');
    const version = ++revision.current;
    publish({ owner, draft, ready: true, error: false });
    // Bound the UI waiter, never cancel or bypass the ordered storage write.
    try { await requestWithDeadline(saveChatComposer(room, owner, draft), 12_000); }
    catch (error) {
      if (current() && ref.current.owner === owner && version === revision.current) publish({ ...ref.current, error: true });
      throw error;
    }
  }, [room, owner, current, publish]);
  const change = useCallback((patch: Partial<Omit<ChatComposerDraft, 'attempt'>> | ((draft: ChatComposerDraft) => Partial<Omit<ChatComposerDraft, 'attempt'>>)) => {
    if (!current() || ref.current.owner !== owner || !ref.current.ready) return;
    const fields = typeof patch === 'function' ? patch(ref.current.draft) : patch;
    void persist({ ...ref.current.draft, ...fields }).catch(() => undefined);
  }, [owner, current, persist]);
  const prepare = useCallback(async (options?: { detachText?: boolean; onDetach?: () => void }) => {
    if (!owner || !current() || ref.current.owner !== owner || !ref.current.ready || ref.current.error) throw Error('Check your saved message first.');
    const existing = ref.current.draft.attempt;
    const preparingRevision = revision.current;
    const attempt = prepareChatComposer(ref.current.draft);
    if (!existing && (!options?.detachText || attempt.edit || attempt.replyId)) await verifyChatComposerTarget(room, attempt, owner);
    if (!current() || ref.current.owner !== owner) throw Error('This conversation visit changed.');
    try {
      // The send may start only after its original attempt is durably kept.
      // Bound this waiter, not the ordered storage operation: timing out must
      // retain the same UUID and require recovery before any transport.
      const independentDraft = !existing && !attempt.edit && options?.detachText;
      const detach = independentDraft && revision.current === preparingRevision;
      const saving = persist({ ...ref.current.draft,
        ...(detach ? { text: '', mentions: null, reply: null } : {}),
        ...(independentDraft ? { attemptDetached: true } : {}), attempt });
      // Request native clearing at the same handoff as the controlled value.
      // The original already lives in the ordered draft write.
      if (detach) { try { options?.onDetach?.(); } catch { /* controlled value still clears */ } }
      await saving;
    } catch (error) {
      if (current() && ref.current.owner === owner && ref.current.draft.attempt === attempt) {
        publish({ ...ref.current, error: true });
      }
      throw error;
    }
    if (!current()) throw Error('This conversation visit changed.');
    return attempt;
  }, [room, owner, current, persist, publish]);
  const finish = useCallback(async (attempt: ChatDraftAttempt) => {
    if (!current() || ref.current.owner !== owner) return;
    try { await persist(finishChatComposer(ref.current.draft, attempt)); }
    catch {
      // Delivery is already confirmed. Keep the cleared attempt and any newer
      // typing in memory, and recover storage without reporting a send failure
      // (which would restore the delivered text as a new, resendable message).
      if (current() && ref.current.owner === owner) publish({ ...ref.current, error: true });
    }
  }, [owner, current, persist, publish]);
  const refuseFresh = useCallback(async (attempt: ChatDraftAttempt) => {
    if (!current() || ref.current.owner !== owner || JSON.stringify(ref.current.draft.attempt) !== JSON.stringify(attempt)) return;
    await persist({ ...ref.current.draft, attempt: null });
  }, [owner, current, persist]);
  const restoreFailedText = useCallback((attempt: ChatDraftAttempt) => {
    if (!current() || ref.current.owner !== owner || ref.current.draft.attemptDetached || ref.current.draft.text || ref.current.draft.attempt?.id !== attempt.id) return;
    void persist({ ...ref.current.draft, text: attempt.text, mentions: attempt.mentions ?? null }).catch(() => undefined);
  }, [current, owner, persist]);
  const owned = state.owner === owner;
  return { draft: owned ? state.draft : emptyChatComposer(), ready: owned && state.ready, error: owned && state.error, change, prepare, finish, restoreFailedText, refuseFresh, retry: load, isCurrent: current };
}
