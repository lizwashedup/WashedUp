import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { usePeopleConnectionMutations, friendlyConnectionError, isObsoletePeopleConnection, type PeopleConnectionScope } from '../../../hooks/usePeopleConnectionMutations';
import type { ConnectionContext } from '../../../lib/yours/types';
import type { AfterglowFontFamilies } from '../../../constants/Typography';

export type PeoplePathAppearance = { fonts: AfterglowFontFamilies };
export type PathRequestState = { phase: 'sending' | 'requested' | 'connected' | 'error'; message?: string };
type Owner = { userId: string; query: string; revision: number; parent?: PeopleConnectionScope };
/** Local feedback belongs to an account/query/visible entry. The parent can
 * retire it synchronously as a sheet closes; unmount retires it independently. */
export function usePeoplePathVisit(userId: string, query: string, parent?: PeopleConnectionScope) {
  const { sendRequest } = usePeopleConnectionMutations(userId);
  const revisionRef = useRef(0), [revision, setRevision] = useState(0);
  const owner = useMemo<Owner>(() => ({ userId, query, revision, parent }), [userId, query, revision, parent]);
  const active = useRef<Owner | null>(null), latest = useRef(owner); latest.current = owner;
  const authUser = useRef<string | null | undefined>(undefined);
  const [feedback, setFeedback] = useState<{ owner: Owner; rows: Record<string, PathRequestState> }>({ owner, rows: {} });
  const locks = useRef(new Map<string, { owner: Owner }>());
  const readLock = useRef<{ owner: Owner } | null>(null), [reading, setReading] = useState<Owner | null>(null);
  useLayoutEffect(() => {
    active.current = owner; setFeedback({ owner, rows: {} }); setReading(null);
    return () => { if (active.current === owner) active.current = null; };
  }, [owner]);
  useEffect(() => {
    let live = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!live) return;
      const next = session?.user.id ?? null, previous = authUser.current === undefined ? latest.current.userId : authUser.current;
      authUser.current = next;
      if (next !== previous) { revisionRef.current++; setRevision(revisionRef.current); }
    });
    return () => { live = false; subscription.unsubscribe(); };
  }, []);
  const current = () => active.current === owner && latest.current === owner && !!userId &&
    revisionRef.current === owner.revision && (authUser.current === undefined || authUser.current === userId) &&
    (!owner.parent || (owner.parent.userId === userId && owner.parent.isCurrent()));
  const change = (id: string, row: PathRequestState) => {
    if (current()) setFeedback(value => value.owner === owner ? { owner, rows: { ...value.rows, [id]: row } } : value);
  };
  const rows = feedback.owner === owner ? feedback.rows : {};
  const currentRows = useRef(rows); currentRows.current = rows;
  const retireQuery = () => { revisionRef.current++; setRevision(revisionRef.current); };
  const add = async (targetId: string, context: ConnectionContext, eligible: () => boolean) => {
    if (!current() || !eligible() || !targetId || targetId === userId) return;
    const prior = currentRows.current[targetId];
    if (prior && prior.phase !== 'error') return;
    const lockKey = `${userId}:${targetId}`;
    const oldAttempt = locks.current.get(lockKey);
    if (oldAttempt) {
      if (oldAttempt.owner !== owner) change(targetId, { phase: 'error', message: 'Your earlier request is still being saved. Try again shortly.' });
      return;
    }
    const attempt = { owner }; locks.current.set(lockKey, attempt);
    change(targetId, { phase: 'sending' });
    try {
      const outcome = await sendRequest.mutateAsync({ recipientId: targetId, context }, {
        scope: { userId, isCurrent: current, canDispatch: eligible },
      });
      if (!current()) return;
      if (outcome === 'requested') change(targetId, { phase: 'requested' });
      else if (outcome === 'now_connected' || outcome === 'already_connected') change(targetId, { phase: 'connected' });
      else change(targetId, { phase: 'error', message: 'Couldn’t confirm the request. Try again.' });
    } catch (error) {
      if (current()) {
        if (!eligible()) setFeedback(value => {
          if (value.owner !== owner) return value;
          const next = { ...value.rows }; delete next[targetId]; return { owner, rows: next };
        });
        else change(targetId, { phase: 'error', message: isObsoletePeopleConnection(error)
          ? 'Your account or this request changed. Close and reopen this page.' : friendlyConnectionError(error) });
      }
    } finally {
      if (locks.current.get(lockKey) === attempt) locks.current.delete(lockKey);
    }
  };
  const refresh = async (refetch: () => Promise<unknown>) => {
    if (!current() || readLock.current?.owner === owner) return;
    const attempt = { owner }; readLock.current = attempt; setReading(owner);
    try { await refetch(); } catch { /* The query owns and exposes read failure. */ }
    finally { if (readLock.current === attempt) readLock.current = null; if (current()) setReading(null); }
  };
  return { rows, add, refresh, reading: reading === owner, current, retireQuery };
}
