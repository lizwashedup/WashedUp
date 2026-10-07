import { useEffect, useRef, useState } from 'react';
import { useInvitePeopleToPlan } from '../../hooks/useInvitePeopleToPlan';
import type { ObservedUser } from '../../hooks/useObservedUser';

export type PostPlanInvitationStatus = 'none' | 'waiting' | 'sending' | 'confirmed' | 'unconfirmed';
type Request = {
  recipientIds: readonly string[];
  userId: string | null | undefined;
  isCurrentViewer: () => boolean;
  eventId: string | null;
  status: PostPlanInvitationStatus;
  busy: boolean;
};

/** Keeps an acknowledged plan separate from its retryable invitation request. No delivery claims. */
export function usePostPlanInvitations(viewer: ObservedUser) {
  const transport = useInvitePeopleToPlan();
  const mounted = useRef(false);
  const current = useRef<Request | null>(null);
  const [state, setState] = useState<{ request: Request; status: PostPlanInvitationStatus } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const publish = (request: Request, status: PostPlanInvitationStatus) => {
    request.status = status;
    if (mounted.current && current.current === request) setState({ request, status });
  };
  const prepare = (recipientIds: readonly string[]) => {
    const request: Request = {
      recipientIds: Object.freeze([...new Set(recipientIds)]), userId: viewer.viewerId,
      isCurrentViewer: viewer.isCurrent, eventId: null, status: recipientIds.length ? 'waiting' : 'none', busy: false,
    };
    current.current = request;
    publish(request, request.status);
    return request;
  };
  const send = async (request: Request, eventId: string, creatorId: string) => {
    if (!mounted.current || current.current !== request || request.busy || request.status === 'confirmed' || request.recipientIds.length === 0) return;
    if (request.userId && creatorId === request.userId) request.eventId = eventId;
    if (!request.userId || creatorId !== request.userId || !request.isCurrentViewer() || viewer.error || viewer.isLoading) {
      publish(request, 'unconfirmed');
      return;
    }
    request.eventId = eventId;
    request.busy = true;
    publish(request, 'sending');
    try {
      // Preserve the existing batch RPC and its recipient policy. Its numeric
      // result counts deduped no-ops too, so it is never a delivered-person count.
      await transport.mutateAsync({ eventId, recipientIds: [...request.recipientIds] });
      if (request.isCurrentViewer()) publish(request, 'confirmed');
    } catch {
      if (request.isCurrentViewer()) publish(request, 'unconfirmed');
    } finally {
      request.busy = false;
    }
  };
  const reset = () => { current.current = null; if (mounted.current) setState(null); };
  const active = state?.request === current.current && state?.request.isCurrentViewer() ? state : null;
  const status = active?.status ?? (state?.request.recipientIds.length ? 'unconfirmed' : 'none');
  const canRetry = status === 'unconfirmed' && !!active?.request.eventId && !!active.request.userId && !viewer.error && !viewer.isLoading;
  const retry = async () => {
    const request = current.current;
    if (!canRetry || !request?.eventId || !request.userId) return;
    await send(request, request.eventId, request.userId);
  };
  const canContinue = () => {
    const request = current.current;
    return !request || !request.isCurrentViewer() || (!request.busy && request.status !== 'waiting');
  };
  return { status, busy: status === 'waiting' || status === 'sending', canRetry, canContinue, prepare, send, retry, reset };
}
