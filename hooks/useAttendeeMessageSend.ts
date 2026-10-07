import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import type { CreatorPageScope } from '../lib/creatorPageReview';
import type { CommunicationMessageDraft } from '../lib/communicationMessageDraft';
import type { AttendeeMessageContent, AttendeeMessageReview, AtomicMessageReceipt } from '../lib/attendeeMessageContract';
import { loadAttendeeMessageAttempt, saveAttendeeMessageAttempt, clearAttendeeMessageAttempt, type AttendeeMessageAttempt } from '../lib/attendeeMessageAttempt';
import { messageContent, reviewAttendeeMessage, readAttendeeMessageStatus, submitAttendeeMessage, AttendeeMessageRejected } from '../lib/attendeeMessageSend';

import { requestWithDeadline, RequestDeadlineError } from '../lib/requestWithDeadline';

type Review = { content: AttendeeMessageContent; receipt: AttendeeMessageReview; draftKey: string };
type State = { loading: boolean; busy: boolean; error: string; attempt: AttendeeMessageAttempt | null; review: Review | null;
  receipt: AtomicMessageReceipt | null; retryOriginal: boolean; rejected: boolean; loadFailed: boolean };
const initial = (): State => ({ loading: true, busy: false, error: '', attempt: null, review: null, receipt: null, retryOriginal: false, rejected: false, loadFailed: false });

/** Existing composer state plus durable, account-owned request recovery. Never retries a write automatically. */
export function useAttendeeMessageSend(eventId: string, scope: CreatorPageScope, draft: CommunicationMessageDraft, enabled: boolean, isAuthorized?: () => boolean) {
  const life = useMemo(() => ({ lock: false, operation: 0 }), [eventId, scope]);
  const latest = useRef(life); latest.current = life;
  const mounted = useRef(false);
  const currentDraft = useRef(draft); currentDraft.current = draft;
  const authority = useRef({ enabled, isAuthorized }); authority.current = { enabled, isAuthorized };
  const [stored, setStored] = useState<{ life: object; value: State }>();
  const state = stored?.life === life ? stored.value : initial();
  const stateRef = useRef(state); stateRef.current = state;
  const current = useCallback(() => mounted.current && latest.current === life && scope.isCurrent(), [life, scope]);
  const authorized = useCallback(() => current() && (authority.current.isAuthorized?.() ?? true), [current]);
  const canSend = useCallback(() => authorized() && authority.current.enabled, [authorized]);
  const publish = useCallback((patch: Partial<State>) => {
    if (!current()) return;
    const value = { ...stateRef.current, ...patch }; stateRef.current = value; setStored({ life, value });
  }, [life, current]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // An operation scope expires when its bounded wait ends. In particular, a late
  // session/storage result must not resume a mutation after recovery is shown.
  const begin = useCallback(() => {
    life.lock = true;
    const id = ++life.operation;
    let retired = false;
    const owns = () => !retired && current() && life.operation === id;
    return { owns, scope: { userId: scope.userId, isCurrent: owns },
      writeScope: { userId: scope.userId, isCurrent: () => owns() && canSend() },
      cleanupScope: { userId: scope.userId, isCurrent: () => owns() && authorized() },
      end() { retired = true; if (life.operation === id) life.lock = false; },
    };
  }, [life, current, scope.userId, canSend, authorized]);
  const load = useCallback(async () => {
    if (!current() || life.lock) return;
    const op = begin(); publish({ loading: true, error: '' });
    try { const attempt = await requestWithDeadline(loadAttendeeMessageAttempt(eventId, op.scope), 12_000); publish({ attempt, loadFailed: false }); }
    catch (e) { publish({ loadFailed: true, error: e instanceof Error ? e.message : 'The saved request could not be loaded.' }); }
    finally { op.end(); publish({ loading: false }); }
  }, [current, eventId, life, publish, begin]);
  useEffect(() => { void load(); }, [load]);

  const prepare = async () => {
    if (!canSend() || life.lock || stateRef.current.loading || stateRef.current.loadFailed || stateRef.current.attempt) return false;
    const content = messageContent(currentDraft.current), draftKey = JSON.stringify(currentDraft.current);
    if (!content) { publish({ error: 'Check the message and audience before reviewing.' }); return false; }
    const op = begin(); publish({ busy: true, error: '', review: null });
    try {
      const receipt = await requestWithDeadline(reviewAttendeeMessage(eventId, content, op.writeScope), 12_000);
      if (!op.writeScope.isCurrent() || JSON.stringify(currentDraft.current) !== draftKey) return false;
      publish({ review: { content, receipt, draftKey } }); return true;
    } catch (e) { publish({ error: e instanceof Error ? e.message : 'The audience could not be checked.' }); return false; }
    finally { op.end(); publish({ busy: false }); }
  };
  const dispatch = async (attempt: AttendeeMessageAttempt) => {
    const op = begin(); publish({ busy: true, attempt, error: '', retryOriginal: false, rejected: false });
    try {
      const receipt = await requestWithDeadline((async () => {
        await saveAttendeeMessageAttempt(attempt, op.scope);
        if (!op.writeScope.isCurrent()) throw Error('Event access changed before sending. Your original request is kept; check its status before trying again.');
        return submitAttendeeMessage(eventId, attempt.requestId, attempt.message, attempt.review.reviewHash, op.writeScope);
      })(), 25_000);
      publish({ receipt });
    } catch (e) { publish({ rejected: e instanceof AttendeeMessageRejected, error: e instanceof RequestDeadlineError
      ? 'Recording could not be confirmed yet. Your original request is kept. Check its status before trying again.'
      : e instanceof Error ? e.message : 'Recording could not be confirmed. Check this saved request.' }); }
    finally { op.end(); publish({ busy: false }); }
  };
  const send = async () => {
    const s = stateRef.current;
    if (!canSend() || life.lock || s.loading || s.loadFailed || s.attempt || !s.review || s.review.draftKey !== JSON.stringify(currentDraft.current)) return;
    await dispatch({ accountId: scope.userId, eventId, requestId: Crypto.randomUUID(), message: s.review.content, review: s.review.receipt });
  };
  const check = async () => {
    const attempt = stateRef.current.attempt;
    if (!current() || life.lock || !attempt) return;
    const op = begin(); publish({ busy: true, error: '', retryOriginal: false });
    try {
      const receipt = await requestWithDeadline(readAttendeeMessageStatus(eventId, attempt.requestId, op.scope), 12_000);
      publish({ receipt, retryOriginal: receipt === null, error: receipt === null ? 'No receipt is available yet. You can retry the original request safely.' : '', rejected: false });
    } catch { publish({ error: 'Message status could not be checked. Your original request is kept.' }); }
    finally { op.end(); publish({ busy: false }); }
  };
  const retry = async () => {
    const s = stateRef.current;
    if (!canSend() || life.lock || !s.attempt || !s.retryOriginal) return;
    await dispatch(s.attempt);
  };
  const finish = async (clearDraft?: () => Promise<boolean>) => {
    const s = stateRef.current;
    if (!authorized() || life.lock || !s.attempt || !(s.rejected || s.receipt?.deliveryStatus === 'queued')) return false;
    const op = begin(); publish({ busy: true, error: '' });
    try {
      const cleared = await requestWithDeadline((async () => {
        // Persist a cleared draft before dropping a confirmed request; a crash can recover it.
        if (s.receipt?.deliveryStatus === 'queued' && (!clearDraft || !await clearDraft())) throw Error('Could not prepare a new draft. Your confirmed request is kept.');
        if (!op.cleanupScope.isCurrent()) return false;
        await clearAttendeeMessageAttempt(s.attempt!, op.cleanupScope);
        return op.cleanupScope.isCurrent();
      })(), 25_000);
      if (!cleared) return false;
      publish({ ...initial(), loading: false }); return current();
    } catch (e) { publish({ error: e instanceof Error ? e.message : 'Could not clear this request. Try again.' }); return false; }
    finally { op.end(); publish({ busy: false }); }
  };
  return { ...state, review: state.review?.draftKey === JSON.stringify(draft) ? state.review : null,
    load, prepare, send, check, retry, finish,
    dismissReview: () => { if (authorized() && !life.lock && !stateRef.current.attempt) publish({ review: null, error: '' }); },
  };
}
