import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCommunityChatRows } from '../lib/communityChat';
import { getCommunityInboxNotificationState } from '../lib/communityChatNotificationState';
import { getCommunityRoomInboxRows } from '../lib/communityRoomInbox';
import { supabase } from '../lib/supabase';
import { requestWithDeadline, RequestDeadlineError } from '../lib/requestWithDeadline';

type Viewer = { viewerId: string | null | undefined; epoch: number };

class StaleCommunityViewerError extends Error {
  constructor() {
    super('The community chat account changed while loading.');
    this.name = 'StaleCommunityViewerError';
  }
}

const keyFor = ({ viewerId, epoch }: Viewer, mappedRooms = false) => mappedRooms ? ['community-chat-rows', viewerId, epoch, 'mapped'] as const : ['community-chat-rows', viewerId, epoch] as const;
const sameViewer = (a: Viewer, b: Viewer) => a.viewerId === b.viewerId && a.epoch === b.epoch;
const asError = (error: unknown) => error instanceof Error ? error : new Error(String(error));

/** Account-scoped community reads, independent of the legacy profile auth query. */
export function useCommunityChatRows(enabled: boolean, mappedRooms = false) {
  const queryClient = useQueryClient();
  const current = useRef<Viewer>({ viewerId: undefined, epoch: 0 });
  const lifecycle = useRef(0);
  const mounted = useRef(false);
  const retrySession = useRef<(() => Promise<void>) | null>(null);
  const [viewer, setViewer] = useState(current.current);
  const [sessionError, setSessionError] = useState<Error | null>(null);
  const [resolvingSession, setResolvingSession] = useState(true);

  useEffect(() => {
    mounted.current = true;
    const generation = ++lifecycle.current;
    let active = true;
    let revision = 0;
    const cancel = (identity: Viewer) => {
      void queryClient.cancelQueries({ queryKey: keyFor(identity, mappedRooms), exact: true }).catch(() => {});
    };
    const publish = (viewerId: string | null) => {
      const previous = current.current;
      if (previous.viewerId !== viewerId) {
        current.current = { viewerId, epoch: previous.epoch + 1 };
        cancel(previous);
        setViewer(current.current);
      }
      setSessionError(null);
      setResolvingSession(false);
    };
    // Subscribe before reading so a late initial read cannot overwrite an event.
    // Keep this callback synchronous: Supabase may call it while holding its auth lock.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      revision += 1;
      publish(session?.user.id ?? null);
    });
    const readSession = async () => {
      const readRevision = ++revision;
      setSessionError(null);
      setResolvingSession(true);
      try {
        const { data, error } = await requestWithDeadline(supabase.auth.getSession(), 12_000);
        if (!active || lifecycle.current !== generation || readRevision !== revision) return;
        if (error) throw error;
        publish(data.session?.user.id ?? null);
      } catch (error) {
        if (!active || lifecycle.current !== generation || readRevision !== revision) return;
        setSessionError(asError(error));
        setResolvingSession(false);
      }
    };
    retrySession.current = readSession;
    void readSession();
    return () => {
      active = false;
      mounted.current = false;
      lifecycle.current += 1;
      if (retrySession.current === readSession) retrySession.current = null;
      subscription.unsubscribe();
      cancel(current.current);
    };
  }, [queryClient, mappedRooms]);

  const canRead = enabled && !!viewer.viewerId && !sessionError;
  const query = useQuery({
    queryKey: keyFor(viewer, mappedRooms),
    enabled: canRead,
    queryFn: async ({ signal }) => {
      const generation = lifecycle.current;
      const assertCurrent = () => {
        if (!mounted.current || !viewer.viewerId || !sameViewer(current.current, viewer)
          || generation !== lifecycle.current || signal.aborted) {
          throw new StaleCommunityViewerError();
        }
      };
      assertCurrent();
      const rows = await requestWithDeadline(getCommunityChatRows(), 12_000);
      assertCurrent();
      if (!mappedRooms) return rows;
      const scopedRows = await requestWithDeadline(getCommunityRoomInboxRows(rows, { userId: viewer.viewerId!, isCurrent: () => {
        try { assertCurrent(); return true; } catch { return false; }
      } }), 12_000);
      assertCurrent();
      return requestWithDeadline(getCommunityInboxNotificationState(scopedRows, { userId: viewer.viewerId!, isCurrent: () => {
        try { assertCurrent(); return true; } catch { return false; }
      } }), 12_000);
    },
    // An abandoned account request must never retry against the new session.
    retry: (failureCount, error) => !(error instanceof StaleCommunityViewerError) && !(error instanceof RequestDeadlineError) && failureCount < 3,
  });

  const refetch = useCallback(async () => {
    if (!enabled || !mounted.current || !sameViewer(current.current, viewer)) return;
    if (viewer.viewerId === undefined || sessionError) {
      await retrySession.current?.();
      return;
    }
    if (!viewer.viewerId) return;
    return query.refetch();
  }, [enabled, viewer, sessionError, query.refetch]);

  const visible = canRead && sameViewer(current.current, viewer);
  return {
    data: visible ? query.data : undefined,
    error: sessionError ?? (visible ? query.error : null),
    isLoading: enabled && (resolvingSession || (visible && query.isLoading)),
    isFetching: visible && query.isFetching,
    refetch,
    viewerId: viewer.viewerId,
  };
}
