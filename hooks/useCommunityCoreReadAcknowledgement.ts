import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CommunityOperationScope } from '../lib/communityChat';
import {
  communityCoreReadCovers, getCommunityCoreReadState, markCommunityCoreRoomRead,
  type CommunityCoreReadState, type CommunityCoreRoomRole, type CommunityReadTargets,
} from '../lib/communityRoomHistory';

/** Visibility supplies the targets. Loading, opening or receiving a notification
 * never acknowledges a message. An uncertain write pauses until an explicit check. */
export function useCommunityCoreReadAcknowledgement(
  communityId: string | undefined, role: CommunityCoreRoomRole, scope: CommunityOperationScope, enabled: boolean,
) {
  const queryClient = useQueryClient();
  const visit = useMemo(() => ({ communityId, role, scope, enabled }), [communityId, role, scope, enabled]);
  const current = useRef<typeof visit | null>(null);
  const progress = useRef<{ confirmed: CommunityCoreReadState | null; pending: CommunityReadTargets | null; unknown: CommunityReadTargets | null; busy: boolean }>({ confirmed: null, pending: null, unknown: null, busy: false });
  const [status, setStatus] = useState<{ visit: typeof visit; checking: boolean; uncertain: boolean; retryReady?: boolean } | null>(null);
  useLayoutEffect(() => {
    current.current = visit;
    progress.current = { confirmed: null, pending: null, unknown: null, busy: false };
    setStatus(null);
    return () => { if (current.current === visit) current.current = null; };
  }, [visit]);
  const isCurrent = useCallback(() => current.current === visit && enabled && !!communityId && scope.isCurrent(), [visit, enabled, communityId, scope]);
  const operationScope = useMemo(() => ({ userId: scope.userId, isCurrent }), [scope.userId, isCurrent]);
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['community-chat-rows'] }).catch(() => {});
    void queryClient.invalidateQueries({ queryKey: ['community-chat-cards'] }).catch(() => {});
  };
  const drain = async () => {
    const state = progress.current;
    if (!isCurrent() || state.busy || state.unknown || !state.pending) return;
    state.busy = true;
    try {
      while (isCurrent() && state.pending && !state.unknown) {
        const targets = state.pending; state.pending = null;
        if (state.confirmed && communityCoreReadCovers(state.confirmed, targets)) continue;
        try {
          const result = await markCommunityCoreRoomRead(communityId!, role, targets, operationScope);
          if (!isCurrent()) {
            if (current.current === visit) { state.unknown = targets; setStatus({ visit, checking: false, uncertain: true }); }
            return;
          }
          state.confirmed = result; invalidate();
        } catch {
          if (current.current !== visit) return;
          state.unknown = targets;
          setStatus({ visit, checking: false, uncertain: true });
        }
      }
    } finally { if (current.current === visit) state.busy = false; }
  };
  const acknowledge = (targets: CommunityReadTargets) => {
    if (!isCurrent() || (!targets.broadcast && !targets.topic)) return;
    const state = progress.current;
    // Keep the latest requested position per source. The server also prevents
    // out-of-order callbacks from rolling a cursor backwards.
    const merged = { ...state.pending };
    for (const source of ['broadcast', 'topic'] as const) {
      const point = targets[source];
      if (!point) continue;
      const existing = merged[source];
      const position = existing ? { through_at: existing.created_at, through_id: existing.id, legacy_read_at: null } : null;
      const temporary: CommunityCoreReadState = { communityId: communityId!, role, unread: 0, broadcast: position ?? { through_at: null, through_id: null, legacy_read_at: null }, topic: position };
      if (!existing || !communityCoreReadCovers(temporary, { [source]: point })) merged[source] = point;
    }
    state.pending = merged;
    void drain();
  };
  const checkReadPosition = async () => {
    const state = progress.current;
    if (!isCurrent() || state.busy || !state.unknown) return;
    state.busy = true;
    setStatus({ visit, checking: true, uncertain: true });
    try {
      const result = await getCommunityCoreReadState(communityId!, role, operationScope);
      if (!isCurrent()) return;
      state.confirmed = result;
      // This action is read-only even if the original write did not commit.
      // A later visibility event may request a fresh acknowledgement.
      const covered = communityCoreReadCovers(result, state.unknown!);
      if (covered) state.unknown = null;
      invalidate(); setStatus({ visit, checking: false, uncertain: !covered, retryReady: !covered });
    } catch {
      if (isCurrent()) setStatus({ visit, checking: false, uncertain: true });
    } finally {
      if (current.current === visit) {
        state.busy = false;
        setStatus(previous => previous?.visit === visit ? { ...previous, checking: false } : previous);
      }
    }
  };
  const retryAcknowledgement = () => {
    const state = progress.current;
    if (!isCurrent() || state.busy || !state.unknown || status?.visit !== visit || !status.retryReady) return;
    const targets = state.unknown; state.unknown = null;
    setStatus({ visit, checking: false, uncertain: false });
    acknowledge(targets);
  };
  return { acknowledge, checkReadPosition, retryAcknowledgement, retryReady: status?.visit === visit && status.retryReady, uncertain: status?.visit === visit && status.uncertain, checking: status?.visit === visit && status.checking };
}
