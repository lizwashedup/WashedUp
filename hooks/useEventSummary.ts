import { useCallback, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useObservedUser } from './useObservedUser';
import { getOperatorEvent } from '../lib/creatorEvents';
import { getCreatorAccess } from '../lib/creatorMode';
import { getEventSummaryTickets } from '../lib/eventSummaryGross';
import { getEventSummaryGross } from '../lib/eventSummaryGross';
import { getPageEventSummaryAccess } from '../lib/pageEventSummary';
import type { CreatorPageScope } from '../lib/creatorPageReview';
import { eventSummaryAccess } from '../lib/eventSummary';
import { requestWithDeadline } from '../lib/requestWithDeadline';
import { getEventRegistrationKind, getEventRsvpSummary } from '../lib/eventRsvpGuests';

export function useEventSummary(id: string | null, pageId: string | null = null) {
  const identity = useObservedUser();
  const focused = useRef(false);
  const focusVisit = useRef({});
  useFocusEffect(useCallback(() => { focused.current = true; focusVisit.current = {}; return () => { focused.current = false; focusVisit.current = {}; }; }, []));
  const visit = useMemo(() => ({}), [id, pageId, identity.viewerId, identity.epoch]);
  const currentVisit = useRef(visit); currentVisit.current = visit;
  const scope = useMemo<CreatorPageScope>(() => ({userId: identity.viewerId ?? '', isCurrent: () => focused.current && currentVisit.current === visit && identity.isCurrent()}), [identity.viewerId, identity.epoch, identity.isCurrent, visit]);
  const enabled = !!id && !!identity.viewerId && !identity.isLoading && !identity.error;
  const key = ['creator-event-overview', identity.viewerId, identity.epoch, id, ...(pageId ? [pageId] : [])];
  const ownedRead = async <T,>(read: (owned: CreatorPageScope) => Promise<T>): Promise<T> => {
    let active = true;
    const focus = focusVisit.current;
    const owned = { userId: scope.userId, isCurrent: () => active && focusVisit.current === focus && scope.isCurrent() };
    try {
      if (!owned.isCurrent()) throw new Error('This event visit has ended.');
      const value = await requestWithDeadline(read(owned), 12_000);
      if (!owned.isCurrent()) throw new Error('This event visit has ended.');
      return value;
    } finally { active = false; }
  };
  const event = useQuery({ queryKey: [...key, 'event'], queryFn: () => ownedRead(async () => {
    const saved = await getOperatorEvent(id!);
    if (saved && saved.id !== id) throw new Error('This event is unavailable.');
    return saved;
  }), enabled, retry: false, staleTime: 0 });
  const access = useQuery({ queryKey: [...key, 'access'], queryFn: () => ownedRead(getCreatorAccess), enabled: enabled && !pageId, retry: false, staleTime: 0 });
  const pageAccess = useQuery({queryKey: [...key, 'page-access'], queryFn: () => ownedRead(owned => getPageEventSummaryAccess(pageId!, id!, owned)), enabled: enabled && !!pageId, retry: false, staleTime: 0});
  const legacyPermissions = eventSummaryAccess(event.data, access.data, identity.viewerId);
  const permissions = pageId ? pageAccess.data ?? {events: false, audience: false, finance: false} : {...legacyPermissions, audience: legacyPermissions.events};
  const activeAccess = pageId ? pageAccess : access;
  const ready = enabled && event.isSuccess && activeAccess.isSuccess && !activeAccess.isFetching && !event.isFetching;
  const registration = useQuery({ queryKey: [...key, 'registration'], queryFn: () => ownedRead(owned => getEventRegistrationKind(id!, owned)), enabled: ready && (permissions.audience || permissions.finance), retry: false, staleTime: 0 });
  const rsvps = useQuery({ queryKey: [...key, 'rsvps'], queryFn: () => ownedRead(owned => getEventRsvpSummary(id!, owned)), enabled: ready && permissions.audience && registration.data?.freeRsvp === true, retry: false, staleTime: 10_000 });
  const attendees = useQuery({ queryKey: [...key, 'attendees'], queryFn: () => ownedRead(owned => getEventSummaryTickets(id!, owned.isCurrent, pageId ? owned : undefined)), enabled: ready && permissions.audience, retry: false, staleTime: 10_000 });
  const gross = useQuery({ queryKey: [...key, 'gross'], queryFn: () => ownedRead(owned => getEventSummaryGross(id!, owned.isCurrent, pageId ? owned : undefined)), enabled: ready && permissions.finance, retry: false, staleTime: 10_000 });
  const retryOverview = useCallback(() => { if (identity.isCurrent() && enabled) { void event.refetch(); void activeAccess.refetch(); } }, [identity.isCurrent, enabled, event.refetch, activeAccess.refetch]);
  const latest = useRef({ ready, permissions });
  latest.current = { ready, permissions };
  useFocusEffect(useCallback(() => { retryOverview(); }, [retryOverview]));
  const canOpen = (kind: 'events' | 'finance' | 'audience') => scope.isCurrent() && latest.current.ready && latest.current.permissions[kind];
  return { identity, event, access: activeAccess, page: pageId ? pageAccess.data : undefined, attendees, gross, registration, rsvps, permissions, ready, canOpen, retryOverview };
}
