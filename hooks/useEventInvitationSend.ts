import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import type { CreatorPageScope } from '../lib/creatorPageReview';
import type { InvitationDraft } from '../lib/eventInvitation';
import type { InvitationReview, InvitationReceipt } from '../lib/eventInvitationSend';
import { loadInvitationAttempt, saveInvitationAttempt, clearInvitationAttempt, type InvitationAttempt } from '../lib/eventInvitationAttempt';
import { invitationContent, reviewEventInvitation, readEventInvitationStatus, submitEventInvitation, InvitationRejected } from '../lib/eventInvitationSend';

import { requestWithDeadline, RequestDeadlineError } from '../lib/requestWithDeadline';

type Review = { content: InvitationDraft; receipt: InvitationReview; draftKey: string };
type State = { loading: boolean; busy: boolean; error: string; attempt: InvitationAttempt | null; review: Review | null;
  receipt: InvitationReceipt | null; retryOriginal: boolean; rejected: boolean; loadFailed: boolean };
const initial = (): State => ({ loading: true, busy: false, error: '', attempt: null, review: null, receipt: null, retryOriginal: false, rejected: false, loadFailed: false });

/** Invitation review plus durable, account-owned request recovery. Never retries a write automatically. */
export function useEventInvitationSend(eventId: string, scope: CreatorPageScope, draft: InvitationDraft, pageId: string | undefined, enabled: boolean, isAuthorized?: () => boolean) {
  const life = useMemo(() => ({ lock: false, operation: 0 }), [eventId, scope]);
  const latest = useRef(life); latest.current = life;
  const mounted = useRef(false);
  const currentDraft = useRef(draft); currentDraft.current = draft;
  const authority = useRef({ enabled, pageId, isAuthorized }); authority.current = { enabled, pageId, isAuthorized };
  const [stored, setStored] = useState<{ life: object; value: State }>();
  const state = stored?.life === life ? stored.value : initial();
  const stateRef = useRef(state); stateRef.current = state;
  const current = useCallback(() => mounted.current && latest.current === life && scope.isCurrent(), [life, scope]);
  const authorized = useCallback(() => current() && !!authority.current.pageId && (authority.current.isAuthorized?.() ?? true), [current]);
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
    const id = ++life.operation, page = authority.current.pageId;
    let retired = false;
    const owns = () => !retired && current() && life.operation === id;
    return { owns, scope: { userId: scope.userId, isCurrent: owns },
      writeScope: { userId: scope.userId, isCurrent: () => owns() && canSend() && authority.current.pageId === page },
      cleanupScope: { userId: scope.userId, isCurrent: () => owns() && authorized() && authority.current.pageId === page },
      end() { retired = true; if (life.operation === id) life.lock = false; },
    };
  }, [life, current, scope.userId, canSend, authorized]);
  const load = useCallback(async () => {
    if (!current() || life.lock) return;
    const op = begin(); publish({ loading: true, error: '' });
    try { const attempt = await requestWithDeadline(loadInvitationAttempt(eventId, op.scope), 12_000); publish({ attempt, loadFailed: false }); }
    catch (e) { publish({ loadFailed: true, error: e instanceof Error ? e.message : 'The saved request could not be loaded.' }); }
    finally { op.end(); publish({ loading: false }); }
  }, [current, eventId, life, publish, begin]);
  useEffect(() => { void load(); }, [load]);

  const prepare = async () => {
    if (!authorized() || life.lock || stateRef.current.loading || stateRef.current.loadFailed || stateRef.current.attempt) return false;
    const content = invitationContent(currentDraft.current), draftKey = JSON.stringify(currentDraft.current);
    if (!content) { publish({ error: 'Check the invitation and audience before reviewing.' }); return false; }
    const op = begin(); publish({ busy: true, error: '', review: null });
    try {
      const receipt = await requestWithDeadline(reviewEventInvitation(eventId, content, op.cleanupScope), 12_000);
      if (!op.cleanupScope.isCurrent() || JSON.stringify(currentDraft.current) !== draftKey) return false;
      if (receipt.context.pageId !== authority.current.pageId) throw Error('This event’s page changed. Reopen the invitation before reviewing.');
      publish({ review: { content, receipt, draftKey } }); return true;
    } catch (e) { publish({ error: e instanceof Error ? e.message : 'The audience could not be checked.' }); return false; }
    finally { op.end(); publish({ busy: false }); }
  };
  const dispatch = async (attempt: InvitationAttempt) => {
    const op = begin(); publish({ busy: true, attempt, error: '', retryOriginal: false, rejected: false });
    try {
      const receipt = await requestWithDeadline((async () => {
        await saveInvitationAttempt(attempt, op.scope);
        if (!op.writeScope.isCurrent() || authority.current.pageId !== attempt.review.context.pageId) throw Error('Event access changed before sending. Your original request is kept; check its status before trying again.');
        return submitEventInvitation(eventId, attempt.review.context.pageId, attempt.requestId, attempt.review, op.writeScope);
      })(), 25_000);
      publish({ receipt });
    } catch (e) { publish({ rejected: e instanceof InvitationRejected, error: e instanceof RequestDeadlineError
      ? 'Recording could not be confirmed yet. Your original request is kept. Check its status before trying again.'
      : e instanceof Error ? e.message : 'Recording could not be confirmed. Check this saved request.' }); }
    finally { op.end(); publish({ busy: false }); }
  };
  const send = async () => {
    const s = stateRef.current;
    if (!canSend() || life.lock || s.loading || s.loadFailed || s.attempt || !s.review || !s.review.receipt.sendingEnabled || s.review.receipt.recipientCount < 1 || s.review.receipt.context.eventStatus !== 'Live' || s.review.receipt.context.pageId !== authority.current.pageId || s.review.draftKey !== JSON.stringify(currentDraft.current)) return;
    await dispatch({ accountId: scope.userId, eventId, requestId: Crypto.randomUUID(), review: s.review.receipt });
  };
  const check = async () => {
    const attempt = stateRef.current.attempt;
    if (!current() || life.lock || !attempt) return;
    const op = begin(); publish({ busy: true, error: '', retryOriginal: false });
    try {
      const receipt = await requestWithDeadline(readEventInvitationStatus(eventId, attempt.review.context.pageId, attempt.requestId, op.scope), 12_000);
      publish({ receipt, retryOriginal: receipt === null, error: receipt === null ? 'No receipt is available yet. You can retry the original request safely.' : '', rejected: false });
    } catch { publish({ error: 'Invitation status could not be checked. Your original request is kept.' }); }
    finally { op.end(); publish({ busy: false }); }
  };
  const retry = async () => {
    const s = stateRef.current;
    if (!canSend() || life.lock || !s.attempt || !s.retryOriginal || s.attempt.review.context.pageId !== authority.current.pageId) return;
    await dispatch(s.attempt);
  };
  const finish = async (clearDraft?: () => Promise<boolean>) => {
    const s = stateRef.current;
    if (!authorized() || life.lock || !s.attempt || s.attempt.review.context.pageId !== authority.current.pageId || !(s.rejected || s.receipt?.deliveryStatus === 'queued')) return false;
    const op = begin(); publish({ busy: true, error: '' });
    try {
      const cleared = await requestWithDeadline((async () => {
        // Persist a cleared draft before dropping a confirmed request; a crash can recover it.
        if (s.receipt?.deliveryStatus === 'queued' && (!clearDraft || !await clearDraft())) throw Error('Could not prepare a new draft. Your confirmed request is kept.');
        if (!op.cleanupScope.isCurrent()) return false;
        await clearInvitationAttempt(s.attempt!, op.cleanupScope);
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
