import ProfileButton from '../../components/ProfileButton';
import { GoldSurfaceFill } from '../../components/creator/GoldSurfaceFill';
import { GeneratedPoster } from '../../components/scene/GeneratedPoster';
import { AttendeeMessageLanding } from '../../components/notifications/AttendeeMessageLanding';
import { EventMessagePreference } from '../../components/notifications/EventMessagePreference';
import { EventMediaImage } from '../../components/events/EventMediaImage';
import React, { useState, useCallback, useEffect } from 'react';
import {
  AppState,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Linking,
  Platform,
  Share,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useLocalSearchParams, router } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { hapticLight, hapticMedium, hapticHeavy, hapticSelection, hapticSuccess, hapticWarning, hapticError } from '../../lib/haptics';
import { ArrowLeft, Share2, Heart, Calendar, MapPin, Ticket, Users, ChevronRight, MoreHorizontal, BadgeCheck } from 'lucide-react-native';
import { supabase } from '../../lib/supabase';
import { logError } from '../../lib/logger';
import { openUrl } from '../../lib/url';
import { peekPendingCheckout } from '../../lib/pendingLink';
import LinkifiedText from '../../components/LinkifiedText';
import { ReportModal } from '../../components/modals/ReportModal';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { useBlock } from '../../hooks/useBlock';
import Colors, { SceneDetailColors as Scene } from '../../constants/Colors';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { capDisplayCount, MAX_GROUP } from '../../constants/GroupLimits';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { COMMUNITIES_ENABLED, MEMBER_STATE_ENABLED, SCENE_DISCOVERY_ENABLED, CREATOR_PAGES_ENABLED } from '../../constants/FeatureFlags';
import { showAddToCalendar } from '../../lib/addToCalendar';
import { canParticipateInSceneEvent, getMyRsvp, getRsvpCount, isCommunityEventReleaseBlocked, markNudged, wasNudged, type RsvpStatus } from '../../lib/eventRsvp';
import { useEventRsvpRecovery } from '../../hooks/useEventRsvpRecovery';
import type { RsvpOwner } from '../../lib/eventRsvpRecovery';
import { recordScopedPlanAssent } from '../../lib/planParticipationScope';
import { getEventTopicId } from '../../lib/communityChat';
import { eventStartIso, formatEventDateLA, getTodayInLA } from '../../lib/laDate';
import { formatTicketPrice, normalizeTicketPrice } from '../../lib/ticketPrice';
import { getOrganizerProfiles } from '../../lib/organizerProfile';
import {
  getFollowState,
  getFollowerCount,
  recordFollow,
  removeFollow,
  type FollowTarget,
} from '../../lib/organizerFollows';
import { eventKickerLabel } from '../../lib/sceneDiscovery';
import { buildPlanPrefillFromEvent, canFindPeopleForEvent, getOpenLinkedPlans } from '../../lib/eventPlanHandoff';
import {readEventLinkedPlans, type LinkedEventPlan as LinkedPlan} from '../../lib/eventLinkedPlans';
import { getLeaderCards } from '../../lib/communityLeader';
import { ParticipationNotice } from '../../components/legal/ParticipationNotice';
import { getParticipationNoticeStatus } from '../../lib/participationTerms';
import { type DescriptionBlock } from '../../lib/eventContent';
import { EventBodyBlocks } from '../../components/events/EventBodyBlocks';
import { EventAction, EventSurface } from '../../constants/EventDesign';
import { formatCents, getOrder, getPublicTicketSummary, isLowInventory } from '../../lib/ticketing';
import { readEventTicketReturn } from '../../lib/eventTicketReturn';
import { EventFaqCards } from '../../components/events/EventFaqCards';
import { TicketCheckoutSheet } from '../../components/events/TicketCheckoutSheet';
import PlanChooserSheet, { type ChooserPlan } from '../../components/plans/PlanChooserSheet';
import { JoinCommunityPopup } from '../../components/communities/JoinCommunityPopup';
import { getJoinGate } from '../../lib/communityJoin';
import { getJoinPolicy } from '../../lib/creatorMode';

import { usePublicPageScope } from '../../hooks/usePublicPageScope';
import { useCreatorPageRead } from '../../hooks/useCreatorPageRead';
import { loadPublishedEventPageIdentities, publishedPageRoute } from '../../lib/publishedPageIdentity';
import { eventPageIdentity } from '../../lib/eventPageIdentity';
import { loadPublishedOrganizationPage } from '../../lib/publishedOrganizationPage';
import type { PageImageScope } from '../../lib/publishedPageCover';
import { OrganizationPageFollowControls } from '../../components/creator/pages/OrganizationPageFollowControls';
import { PublishedPageCover } from '../../components/creator/pages/PublishedPageCover';
import CreatorPageEventGate from '../../components/creator/pages/CreatorPageEventGate';
import type { CreatorPageEventContext } from '../../lib/creatorPageEventContext';

const HERO_HEIGHT = 280;
// social proof threshold (doc 37): under this, never show a raw count
const GOING_COUNT_THRESHOLD = 5;
// §4c more-from rail: poster cards, soonest first
const MORE_FROM_RAIL_LIMIT = 6;
const MORE_CARD_WIDTH = 150;
const MORE_CARD_POSTER_HEIGHT = 120;

interface ExploreEvent {
  id: string;
  title: string;
  description: string | null;
  description_blocks: DescriptionBlock[] | null;
  image_url: string | null;
  event_date: string | null;
  start_time: string | null;
  end_time: string | null;
  venue: string | null;
  venue_address: string | null;
  category: string | null;
  external_url: string | null;
  // Postgres numeric: arrives as a number or a numeric string depending on
  // the path; normalizeTicketPrice is the one reading (doc 34 2.3)
  ticket_price: number | string | null;
  offer_type?: string;
  public_name: string | null;
  community_id: string | null;
  host_user_id: string | null;
  // guest preview needs the status: a non-Live event renders as a WILL-look
  // preview (a real guest gets nothing for it under RLS), never a DOES-look one
  status: string | null;
}


function formatFullDate(dateStr: string | null, timeStr: string | null): string {
  if (!dateStr) return '';
  const dayLabel = formatEventDateLA(dateStr, { weekday: 'long', month: 'long', day: 'numeric' });
  if (timeStr) {
    let t: string;
    // Full ISO timestamps (e.g. "2025-03-22T18:00:00+00:00") render the
    // stored instant on the LA clock, never the device clock (web twin's
    // pin; a bare "18:00:00" must not reach this branch, hence the T/space
    // guard, because some engines parse it as a device-local Date).
    const ts = new Date(timeStr);
    if (!isNaN(ts.getTime()) && (timeStr.includes('T') || timeStr.includes(' '))) {
      t = ts.toLocaleTimeString('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    } else {
      // A plain "HH:MM[:SS]" is already an LA wall time: print it literally.
      // setHours + toLocaleTimeString both run on the device clock, so the
      // zone cancels out and the given wall time is what renders.
      const parts = timeStr.split(':');
      const h = parts[0] ?? '0';
      const m = parts[1] ?? '0';
      const tmp = new Date();
      tmp.setHours(parseInt(h, 10), parseInt(m, 10), 0, 0);
      t = tmp.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    }
    return `${dayLabel} at ${t}`;
  }
  return dayLabel;
}

interface MoreFromEvent {
  id: string;
  title: string;
  event_date: string | null;
  venue: string | null;
  image_url: string | null;
  category: string | null;
}

function laTodayIsoDate(): string {
  const t = getTodayInLA();
  return `${t.y}-${String(t.m + 1).padStart(2, '0')}-${String(t.d).padStart(2, '0')}`;
}

function venueMapsUrl(venue: string, address: string | null): string {
  const query = encodeURIComponent(address ? `${venue} ${address}` : venue);
  return Platform.OS === 'ios'
    ? `https://maps.apple.com/?q=${query}`
    : `https://www.google.com/maps/search/?api=1&query=${query}`;
}

export default function EventDetailRoute() {
  const { id, preview, pageId, team, notificationId } = useLocalSearchParams<{ id: string; preview?: string; pageId?: string; team?: string; notificationId?: string }>();
  if (COMMUNITIES_ENABLED && notificationId && !preview) {
    return <AttendeeMessageLanding eventId={id} notificationId={notificationId} />;
  }
  // Page hints select the existing exact-event access reader; they never grant
  // authority. The gate retires this renderer when its account/visit changes.
  if (CREATOR_PAGES_ENABLED && preview === 'guest' && pageId) {
    return <CreatorPageEventGate pageId={pageId} eventId={id} team={team === '1'}>
      {page => <EventDetailScreen previewPage={page} />}
    </CreatorPageEventGate>;
  }
  return <EventDetailScreen />;
}

function EventDetailScreen({ previewPage }: { previewPage?: CreatorPageEventContext }) {
  // Reuse the public renderer. Page previews enter through the exact-event
  // gate above; legacy previews retain the original organizer check below.
  const { id, preview } = useLocalSearchParams<{ id: string; preview?: string }>();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const [artFrameWidth, setArtFrameWidth] = useState(0);
  const [artwork, setArtwork] = useState<{ reference: string; ratio: number } | null>(null);
  const queryClient = useQueryClient();
  const pageContext = usePublicPageScope(id);
  const userId = pageContext.account.viewerId ?? null;

  const [showReport, setShowReport] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ id: string; name: string } | null>(null);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);
  const [checkoutVisible, setCheckoutVisible] = useState(false);
  // PL-01: the plan chooser sheet, shown by goFindPeople when open Plans
  // already exist for this event, instead of guessing which one to open.
  const [chooserPlans, setChooserPlans] = useState<ChooserPlan[]>([]);
  const [chooserVisible, setChooserVisible] = useState(false);
  // SC-05: the event page's own join door, mirroring community/[id].tsx's
  const [joinPopupVisible, setJoinPopupVisible] = useState(false);
  const { blockUser } = useBlock();

  // Audit finding 2: paying happens in a browser, and Stripe's success page
  // is a web url this app does not claim, so nothing used to bring the buyer
  // back. This screen is the one they left, so when it comes back to the
  // foreground it takes them to the order they just paid for. (The tabs
  // layout consumes the same record if the app was killed mid-payment.)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      peekPendingCheckout().then(async (orderId) => {
        if (!orderId) return;
        const pendingOrder = await getOrder(orderId).catch(() => null);
        if (pendingOrder && pendingOrder.status !== 'pending') {
          router.replace(`/tickets/order/${orderId}` as never);
        }
      });
    });
    return () => sub.remove();
  }, []);

  const handleCreatorMenu = useCallback((creatorId: string, creatorName: string) => {
    if (creatorId === userId) return;
    hapticLight();
    setAlertInfo({
      title: creatorName,
      buttons: [
        {
          text: `Report ${creatorName}`,
          onPress: () => {
            setReportTarget({ id: creatorId, name: creatorName });
            setShowReport(true);
          },
        },
        {
          text: `Block ${creatorName}`,
          style: 'destructive',
          onPress: () => blockUser(creatorId, creatorName, () => {
            queryClient.invalidateQueries({ queryKey: ['event-plans', id] });
          }),
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    });
  }, [userId, blockUser, queryClient, id]);

  const { data: event, isLoading, error: eventError, isFetching: eventFetching, refetch: retryEvent } = useQuery({
    queryKey: ['explore-event', id, CREATOR_PAGES_ENABLED],
    queryFn: async (): Promise<ExploreEvent | null> => {
      const source = supabase.from('explore_events');
      const selection = CREATOR_PAGES_ENABLED
        ? source.select('id, title, description, description_blocks, image_url, event_date, start_time, end_time, venue, venue_address, category, external_url, ticket_price, public_name, community_id, host_user_id, status, offer_type')
        : source.select('id, title, description, description_blocks, image_url, event_date, start_time, end_time, venue, venue_address, category, external_url, ticket_price, public_name, community_id, host_user_id, status');
      const { data, error } = await selection.eq('id', id).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
    staleTime: 60_000,
  });

  // New page identity is checked before any legacy attribution. A failed or
  // unavailable publication never turns into a different page owned by that account.
  const readEventPage = useCallback(async (scope: PageImageScope) => {
    const links = await loadPublishedEventPageIdentities([id], scope);
    return { page: eventPageIdentity({ community_id: event?.community_id ?? null }, links.get(id)) };
  }, [id, event?.community_id]);
  const pageRead = useCreatorPageRead(CREATOR_PAGES_ENABLED && event ? pageContext.scope : null, readEventPage);
  const publishedPage = !pageRead.error ? pageRead.data?.page : null;
  const legacyIdentityAllowed = !CREATOR_PAGES_ENABLED || !!pageRead.data && !pageRead.error && pageRead.data.page === undefined;
  const readRelatedPage = useCallback((scope: PageImageScope) => loadPublishedOrganizationPage(publishedPage!.pageId, scope), [publishedPage?.pageId]);
  const relatedPageRead = useCreatorPageRead(publishedPage?.kind === 'organization' ? pageContext.scope : null, readRelatedPage);

  // §3.0 guest preview, gated to the organizer. host_user_id === viewer covers
  // the creator (a community event's host_user_id is the leader who posted it);
  // RLS already blocks anyone else from loading a Draft, so a non-organizer
  // with the param on a Live event just sees the normal page (param ignored).
  const isOrganizerViewer = !!userId && !!event?.host_user_id && event.host_user_id === userId;
  const previewMode = (isOrganizerViewer || !!previewPage) && preview === 'guest';
  // a non-Live event is not visible to a real guest at all, so the chrome must
  // promise how it WILL look once published, never claim this is how it looks
  const previewUnpublished = previewMode && event?.status !== 'Live';
  const showPreviewNotice = useCallback(() => {
    hapticLight();
    // LIZ COPY (taste gate): the buttons are inert while previewing
    setAlertInfo({ title: 'just a preview', message: 'this is how it looks to a guest. these actions aren’t available in preview.' });
  }, []);

  // THE CHAT LAW (docs 09 + 21, doc 00 2026-07-21): a community event's
  // conversation is its OWN chat (rsvp enrolls via the 7-07 trigger) and
  // the find-people/plans module NEVER renders on it; organizational and
  // standalone events keep rsvp + find-people + the doc-09 smart popup
  // exactly as built. Flag off, community events do not exist visibly.
  const isCommunityEvent = COMMUNITIES_ENABLED && !!event?.community_id;
  const sceneParticipationEnabled = canParticipateInSceneEvent(
    SCENE_DISCOVERY_ENABLED,
    COMMUNITIES_ENABLED,
    event?.community_id,
  );

  const readLinkedPlans = useCallback((scope: PageImageScope) => readEventLinkedPlans(id!, scope), [id]);
  const linkedRead = useCreatorPageRead(!!id && !!event && !isCommunityEvent ? pageContext.scope : null, readLinkedPlans);
  const linkedPlans = linkedRead.data?.plans ?? [];
  const memberCountsMap = linkedRead.data?.counts ?? {};
  const linkedReady = !!linkedRead.data && !linkedRead.loading && !linkedRead.error && !!pageContext.scope?.isCurrent();
  const linkedVersion = React.useMemo(() => ({}), [pageContext.scope, linkedRead.data, linkedRead.loading, linkedRead.error]);
  const latestLinkedVersion = React.useRef(linkedVersion); latestLinkedVersion.current = linkedVersion;
  const canUseLinkedPlans = useCallback(() => linkedReady && latestLinkedVersion.current === linkedVersion && !!pageContext.scope?.isCurrent(), [linkedReady, linkedVersion, pageContext.scope]);
  useEffect(() => { setChooserVisible(false); setChooserPlans([]); }, [linkedVersion]);
  const retryLinkedPlans = useCallback(() => { if (pageContext.scope?.isCurrent()) void linkedRead.refresh().catch(() => undefined); }, [pageContext.scope, linkedRead.refresh]);

  // Keep the existing event conversation, but never hide a failed lookup as absence.
  const eventTopicRead = useQuery({
    queryKey: ['event-topic', id, userId],
    queryFn: async () => {
      const scope = pageContext.scope;
      if (!scope?.isCurrent()) throw new Error('Your account changed. Check the chat again.');
      const topicId = await getEventTopicId(id!, true);
      if (!scope.isCurrent()) throw new Error('Your account changed. Check the chat again.');
      return topicId;
    },
    enabled: isCommunityEvent && !!id && !!pageContext.scope,
    staleTime: 60_000,
    retry: false,
  });
  const eventTopicId = eventTopicRead.error ? null : eventTopicRead.data ?? null;

  const { data: isWishlisted = false } = useQuery({
    queryKey: ['explore-wishlist-check', id, userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('explore_wishlists')
        .select('id')
        .eq('user_id', userId!)
        .eq('explore_event_id', id!)
        .maybeSingle();
      if (error) return false;
      return !!data;
    },
    enabled: !!userId && !!id,
  });

  const wishlistMutation = useMutation({
    mutationFn: async () => {
      if (!userId || !id) return;
      if (isWishlisted) {
        await supabase.from('explore_wishlists').delete().eq('user_id', userId).eq('explore_event_id', id);
      } else {
        await supabase.from('explore_wishlists').insert({ user_id: userId, explore_event_id: id });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['explore-wishlists'] });
      queryClient.invalidateQueries({ queryKey: ['explore-wishlist-check', id] });
    },
    onError: () => {
      hapticError();
    },
  });

  // -- just-join RSVPs + the doc 09 smart popup (flag-gated additions) ----------
  const [rsvpBusy, setRsvpBusy] = useState(false);
  // proposal 49 (legal v4.0): the Independent Activity Notice before the
  // caller's FIRST rsvp under the terms version in force. Dormant until 49
  // applies; once an assent row exists the sheet never returns.
  const [noticeVisible, setNoticeVisible] = useState(false);
  const rsvpRead = useQuery({
    queryKey: ['event-rsvp', id, userId],
    queryFn: () => getMyRsvp(id!, userId),
    enabled: sceneParticipationEnabled && !!id && !!userId,
    retry: false,
  });
  const myRsvp = rsvpRead.data ?? null;
  const rsvpReadProblem = !!pageContext.account.error || !!rsvpRead.error;
  const rsvpReadUnresolved = !previewMode && (pageContext.account.isLoading || !!pageContext.account.error
    || !!userId && (rsvpRead.isPending || !!rsvpRead.error));
  const { data: rsvpCount = null } = useQuery({
    queryKey: ['event-rsvp-count', id],
    queryFn: () => getRsvpCount(id!),
    enabled: sceneParticipationEnabled && !!id,
  });

  // proposal 36: a STANDALONE listing with no per-event public_name override
  // fronts with the host's organizer profile (name + logo). Community events
  // keep fronting with the community; public_name always wins when set.
  const { data: organizer = null } = useQuery({
    queryKey: ['organizer-profile-of', event?.host_user_id],
    queryFn: async () => {
      const map = await getOrganizerProfiles([event!.host_user_id!]);
      return map.get(event!.host_user_id!) ?? null;
    },
    enabled:
      COMMUNITIES_ENABLED && legacyIdentityAllowed && !!event && !event.community_id && !!event.host_user_id && !event.public_name,
    staleTime: 60_000,
  });

  // slice 2 (doc 37): a COMMUNITY event fronts with the community - its
  // name in the byline, the leader's face as the chip (the 41 read). A
  // public_name override still wins and wears neither image.
  const { data: eventCommunity = null } = useQuery({
    queryKey: ['event-community', event?.community_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('communities')
        .select('id, name')
        .eq('id', event!.community_id!)
        .maybeSingle();
      return (data as { id: string; name: string } | null) ?? null;
    },
    enabled: COMMUNITIES_ENABLED && legacyIdentityAllowed && !!event?.community_id && !event?.public_name,
    staleTime: 60_000,
  });
  const { data: eventLeaderCard = null } = useQuery({
    queryKey: ['leader-card', event?.community_id],
    queryFn: async () => (await getLeaderCards([event!.community_id!])).get(event!.community_id!) ?? null,
    enabled: COMMUNITIES_ENABLED && !!event?.community_id && (publishedPage?.kind === 'community' || legacyIdentityAllowed && !event?.public_name),
    staleTime: 60_000,
  });

  // §4c: the rail/track-record entity is the FRONTING entity - the
  // community, or the standalone organizer profile; a public_name override
  // fronts as itself and carries neither follow nor rail (proposal-36
  // grammar). This is a broader union than FollowTarget on purpose: it also
  // drives the more-from rail and track-record count for BOTH kinds, so it
  // can't itself be typed as follow-only.
  const frontingTarget: { kind: 'community' | 'organizer'; id: string } | null =
    !event || (!legacyIdentityAllowed && publishedPage?.kind !== 'community') || (legacyIdentityAllowed && event.public_name)
      ? null
      : event.community_id
        ? { kind: 'community', id: event.community_id }
        : event.host_user_id
          ? { kind: 'organizer', id: event.host_user_id }
          : null;

  // Scene handoff §16 (2026-09-01 "IMPORTANT DATA CORRECTION"): follow is an
  // ORGANIZATION-only action. frontingTarget above still carries both kinds
  // for the rail/track-record plumbing; follow narrows to organizer only, so
  // a community-fronted event's card resolves entirely through membership
  // state (viewerIsMemberHere / viewerJoinPending / viewerCanJoinHere below)
  // and never fetches or renders a follow pill or follower count.
  const followTarget: FollowTarget | null =
    frontingTarget?.kind === 'organizer' ? { kind: 'organizer', id: frontingTarget.id } : null;

  // §4c (doc 69 A6): more from the same fronting entity - upcoming Live
  // listings, soonest first, this one excluded
  // P3 (laws 9/10): the all-in price-from and real inventory scarcity,
  // shown beside the CTA before any checkout. Fees never surprise; a
  // sold-out tier never headlines; scarcity is real remaining only.
  const knownPageOffer = !(publishedPage || previewPage) || ['free_event', 'ticketed_event', 'course', 'drop_in'].includes(event?.offer_type ?? '');
  const ticketContextReady = !!event && knownPageOffer && (legacyIdentityAllowed || !!publishedPage || !!previewPage);
  const requiresTickets = !!(publishedPage || previewPage) && event?.offer_type === 'ticketed_event';
  const ticketRead = useQuery({
    queryKey: ['public-ticket-summary', id, pageContext.scope?.userId, requiresTickets],
    queryFn: () => getPublicTicketSummary(id!, requiresTickets),
    enabled: !!id && ticketContextReady,
    staleTime: 30_000,
  });
  const ticketSummary = ticketRead.data;
  const readOwnedTickets = useCallback((scope: NonNullable<typeof pageContext.scope>) =>
    readEventTicketReturn(id!, { userId: scope.userId!, isCurrent: scope.isCurrent }), [id]);
  const ownTickets = useCreatorPageRead(!previewMode && sceneParticipationEnabled && !!id && pageContext.scope?.userId
    ? pageContext.scope : null, readOwnedTickets);
  const ownedTicket = !previewMode && pageContext.scope?.isCurrent() && !ownTickets.error ? ownTickets.data : null;
  const ownTicketsUnresolved = !previewMode && sceneParticipationEnabled && !!userId && (ownTickets.loading || !!ownTickets.error);
  const openOwnedTickets = () => {
    if (ownedTicket && pageContext.scope?.isCurrent()) router.push(`/tickets/order/${ownedTicket.orderId}` as never);
  };
  const ticketReadUnresolved = !ticketContextReady || !ticketSummary || !!ticketRead.error;
  const ticketContextProblem = CREATOR_PAGES_ENABLED && (!!pageRead.error || !!pageContext.account.error || !knownPageOffer || pageRead.data?.page === null && !previewPage);
  const ticketProblem = !!ticketRead.error || ticketContextProblem;
  const retryTickets = () => {
    if (pageContext.account.error) { void pageContext.account.retry().catch(() => undefined); return; }
    if (!knownPageOffer) { void retryEvent(); return; }
    if (ticketContextProblem) { void pageRead.refresh().catch(() => undefined); return; }
    void ticketRead.refetch();
  };

  // P4 (doc 78 §2.8): the organizer's track record - how many events
  // they have put on (Live or Completed), the proof they are real
  const { data: legacyTrackRecordCount = null } = useQuery({
    queryKey: ['track-record', frontingTarget?.kind, frontingTarget?.id],
    queryFn: async () => {
      const col = frontingTarget!.kind === 'community' ? 'community_id' : 'host_user_id';
      const { count } = await supabase
        .from('explore_events')
        .select('id', { count: 'exact', head: true })
        .eq(col, frontingTarget!.id)
        .in('status', ['Live', 'Completed']);
      return count ?? 0;
    },
    enabled: COMMUNITIES_ENABLED && !!frontingTarget,
    staleTime: 60_000,
  });

  const { data: legacyMoreEvents = [] } = useQuery({
    queryKey: ['more-from', frontingTarget?.kind, frontingTarget?.id, id],
    queryFn: async () => {
      const col = frontingTarget!.kind === 'community' ? 'community_id' : 'host_user_id';
      const { data } = await supabase
        .from('explore_events')
        .select('id, title, event_date, venue, image_url, category')
        .eq(col, frontingTarget!.id)
        .eq('status', 'Live')
        .gte('event_date', laTodayIsoDate())
        .neq('id', id!)
        .order('event_date', { ascending: true })
        .limit(MORE_FROM_RAIL_LIMIT);
      return (data ?? []) as MoreFromEvent[];
    },
    enabled: COMMUNITIES_ENABLED && !!frontingTarget && !!id,
    staleTime: 60_000,
  });

  const trackRecordCount = publishedPage?.kind === 'organization'
    ? relatedPageRead.data ? relatedPageRead.data.upcomingEvents.length + relatedPageRead.data.pastEvents.length : null
    : legacyTrackRecordCount;
  const moreEvents = publishedPage?.kind === 'organization'
    ? relatedPageRead.data?.upcomingEvents.filter(row => row.id !== id).slice(0, MORE_FROM_RAIL_LIMIT) ?? []
    : legacyMoreEvents;

  // §4c (doc 69 B1/B2): dormant until proposal 68 applies - a missing
  // table reads as available:false and the affordance never renders.
  // Scoped to followTarget (organizer-only, Scene handoff §16) rather than
  // frontingTarget: a community event must never fetch follow state or a
  // follower count in the first place, not just hide it after the fact.
  const { data: followState } = useQuery({
    queryKey: ['organizer-follow', followTarget?.kind, followTarget?.id, userId],
    queryFn: () => getFollowState(followTarget!, userId!),
    enabled: COMMUNITIES_ENABLED && !!followTarget && !!userId,
    staleTime: 30_000,
  });
  const { data: followerCount = null } = useQuery({
    queryKey: ['follower-count', followTarget?.kind, followTarget?.id],
    queryFn: () => getFollowerCount(followTarget!),
    enabled: COMMUNITIES_ENABLED && !!followTarget,
    staleTime: 60_000,
  });
  // T9 (doc 121) at the time this was written: joining auto-follows
  // DB-side, so an active member always read as "following" on the shared
  // pill. Scene handoff §16 (2026-09-01) supersedes that model: a community
  // never shows follow state at all now (see followTarget above), so this
  // query's member/pending/join result is the ONLY thing that drives the
  // community entity-card pill below, independent of organizer_follows.
  // Follow-up for whoever owns that DB-side join trigger, if it is still
  // live: it may still be inserting a community-kind organizer_follows row
  // on every join, which is dead data no client reads anymore (the DRAFT
  // migration filed alongside this fix cleans up what already exists, but a
  // live trigger would keep recreating it going forward). Own-row read
  // (RLS user_id = auth.uid()).
  const { data: viewerMembershipStatus = null } = useQuery({
    queryKey: ['community-membership', event?.community_id, userId],
    queryFn: async () => {
      const { data } = await supabase
        .from('community_members')
        .select('status')
        .eq('community_id', event!.community_id!)
        .eq('user_id', userId!)
        .maybeSingle();
      return (data?.status as string | null) ?? null;
    },
    enabled: !previewMode && MEMBER_STATE_ENABLED && COMMUNITIES_ENABLED && !!event?.community_id && !!userId,
    staleTime: 30_000,
  });
  // Guest preview must not inherit the creator's cached membership state.
  const viewerIsMemberHere = !previewMode && MEMBER_STATE_ENABLED && viewerMembershipStatus === 'active';
  const viewerJoinPending = !previewMode && MEMBER_STATE_ENABLED && viewerMembershipStatus === 'pending';
  // SC-05: the event page had a follow pill but no real door into the
  // community itself - gated the same way member-state already is, since
  // without that flag we can't safely know they aren't already a member.
  const viewerCanJoinHere =
    MEMBER_STATE_ENABLED &&
    !!userId &&
    frontingTarget?.kind === 'community' &&
    !viewerIsMemberHere &&
    !viewerJoinPending;
  const { data: joinPolicy = null } = useQuery({
    queryKey: ['community-join-policy', event?.community_id],
    queryFn: () => getJoinPolicy(event!.community_id!),
    enabled: MEMBER_STATE_ENABLED && !!event?.community_id,
    staleTime: 60_000,
  });
  const joinsInstantly = joinPolicy === 'open';
  const { data: joinGate = null } = useQuery({
    queryKey: ['community-gate', event?.community_id],
    queryFn: () => getJoinGate(event!.community_id!),
    enabled: MEMBER_STATE_ENABLED && !!event?.community_id,
    staleTime: 60_000,
  });

  const followMutation = useMutation({
    mutationFn: async () => {
      if (!followTarget || !userId || !followState) throw new Error('not ready');
      const ok = followState.following
        ? await removeFollow(followTarget, userId)
        : await recordFollow(followTarget, userId);
      if (!ok) throw new Error('follow write failed');
    },
    onSuccess: () => {
      hapticSuccess();
      queryClient.invalidateQueries({ queryKey: ['organizer-follow'] });
      queryClient.invalidateQueries({ queryKey: ['follower-count'] });
    },
    onError: () => hapticError(),
  });

  const goToNewPlan = useCallback(() => {
    if (!event || !canUseLinkedPlans()) return;
    router.push({
      pathname: '/(tabs)/post',
      params: buildPlanPrefillFromEvent(event),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, canUseLinkedPlans]);

  // PL-01: the real chooser step (spec: existing open Plans shown first,
  // then an explicit "start a new Plan" action) instead of guessing a first
  // match or skipping straight into the creation form.
  const goFindPeople = useCallback(() => {
    if (previewMode) { showPreviewNotice(); return; }
    // item 07 is organization-event only; the chat law (item 04) keeps a
    // community event's RSVP opening its own event-room chat instead.
    if (!event || !canFindPeopleForEvent(event) || !canUseLinkedPlans()) return;
    hapticMedium();
    const openPlans = getOpenLinkedPlans(
      linkedPlans.map((p) => ({
        id: p.id,
        memberCount: memberCountsMap[p.id],
        maxInvites: p.max_invites,
      })),
    ).map((p) => linkedPlans.find((lp) => lp.id === p.id)!);
    if (openPlans.length === 0) {
      goToNewPlan();
      return;
    }
    setChooserPlans(
      openPlans.map((p) => {
        const { text, isFull } = getPlanSpotsInfo(p);
        return {
          id: p.id,
          title: p.title,
          creator_name: p.creator_name,
          creator_photo: p.creator_photo,
          spotsText: text,
          isFull,
        };
      }),
    );
    setChooserVisible(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, linkedPlans, memberCountsMap, goToNewPlan, previewMode, showPreviewNotice, canUseLinkedPlans]);

  const handleChooserSelectPlan = useCallback((planId: string) => {
    if (!canUseLinkedPlans() || !chooserPlans.some(plan => plan.id === planId)) return;
    setChooserVisible(false);
    router.push(`/plan/${planId}`);
  }, [canUseLinkedPlans, chooserPlans]);

  const handleChooserStartNew = useCallback(() => {
    setChooserVisible(false);
    goToNewPlan();
  }, [goToNewPlan]);

  const invalidateRsvp = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['event-rsvp', id] });
    queryClient.invalidateQueries({ queryKey: ['event-rsvp-count', id] });
    // going in or out of a community event adds or removes its chat
    queryClient.invalidateQueries({ queryKey: ['community-chat-cards'] });
    queryClient.invalidateQueries({ queryKey: ['community-chat-rows'] });
    queryClient.invalidateQueries({ queryKey: ['event-topic', id] });
  }, [queryClient, id]);

  const rsvpOwner = React.useMemo<RsvpOwner | null>(() => !previewMode && pageContext.scope?.userId
    ? { userId: pageContext.scope.userId, isCurrent: pageContext.scope.isCurrent } : null, [pageContext.scope, previewMode]);
  const noticeOwner = React.useRef<RsvpOwner | null>(null);
  const attendanceEntry = React.useRef<RsvpOwner | null>(null);
  useEffect(() => { noticeOwner.current = null; setNoticeVisible(false); setRsvpBusy(false); }, [rsvpOwner]);

  // Scene handoff §07/09/13: the post-confirmation branch. Organization
  // events promote Find people to go with (existing PL-01 behavior,
  // unchanged); community events promote Open event chat instead (the chat
  // law) and never offer Find people. eventTopicId is created at event
  // publish time for every community event (20260707120000_event_chat_model
  // .sql), so it should already be resolved by the time an RSVP succeeds;
  // if it genuinely isn't, this step is skipped rather than shown broken --
  // the calendar step above it already satisfied "exactly once."
  const showBranchNudge = useCallback(() => {
    if (!event || !rsvpOwner?.isCurrent()) return;
    if (isCommunityEvent) {
      if (!eventTopicId) return;
      // LIZ COPY
      setAlertInfo({
        title: "you're in",
        message: 'the event chat is where the coordination happens.',
        buttons: [
          { text: 'open the chat', onPress: () => { if (rsvpOwner.isCurrent()) router.push(`/community-topic/${eventTopicId}`); } },
          { text: 'not now', style: 'cancel' },
        ],
      });
      return;
    }
    if (!canUseLinkedPlans()) return;
    const openPlans = getOpenLinkedPlans(
      linkedPlans.map((p) => ({
        id: p.id,
        memberCount: memberCountsMap[p.id],
        maxInvites: p.max_invites,
      })),
    ).map((p) => linkedPlans.find((lp) => lp.id === p.id)!);
    if (openPlans.length > 0) {
      // PL-01: routes through goFindPeople so 2+ open Plans show the
      // real chooser instead of silently guessing openPlans[0].
      // LIZ COPY
      setAlertInfo({
        title: 'a group is forming for this',
        message: 'want in? your spot at the event stands either way.',
        buttons: [
          { text: 'see the group', onPress: () => { if (rsvpOwner.isCurrent()) goFindPeople(); } },
          { text: 'just going', style: 'cancel' },
        ],
      });
    } else {
      // LIZ COPY
      setAlertInfo({
        title: 'want people to go with?',
        message: "you're in either way. small groups form around events like this.",
        buttons: [
          { text: 'find people', onPress: () => { if (rsvpOwner.isCurrent()) goFindPeople(); } },
          { text: 'just going', style: 'cancel' },
        ],
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, rsvpOwner, isCommunityEvent, eventTopicId, linkedPlans, memberCountsMap, goFindPeople, canUseLinkedPlans]);

  // Scene handoff §06/§15: "every confirmed event offers Add to calendar
  // exactly once"; Add and Not now both complete the flow (never gated on
  // the native permission/picker outcome), then §07's branch nudge follows.
  // The 250ms defer is load-bearing, not stylistic: BrandedAlert's own
  // onPress wrapper calls btn.onPress() then onClose() synchronously in the
  // same tick (components/BrandedAlert.tsx), so a setAlertInfo call made
  // directly inside a button's onPress is immediately clobbered by that
  // trailing onClose()'s setAlertInfo(null) in the same batch. Deferring past
  // that tick (and past the fade-out) is what lets the second alert actually
  // render instead of flashing and disappearing.
  const showPostConfirmationSequence = useCallback(() => {
    if (!event || !rsvpOwner?.isCurrent()) return;
    const startIso = eventStartIso(event.event_date, event.start_time);
    if (!startIso) {
      showBranchNudge();
      return;
    }
    // LIZ COPY
    setAlertInfo({
      title: 'add this to your calendar?',
      message: 'get a reminder before it starts.',
      buttons: [
        {
          text: 'add to calendar',
          onPress: () => {
            if (!rsvpOwner.isCurrent()) return;
            showAddToCalendar(event.title, startIso, event.end_time, event.venue ?? undefined);
            setTimeout(showBranchNudge, 250);
          },
        },
        { text: 'not now', style: 'cancel', onPress: () => setTimeout(showBranchNudge, 250) },
      ],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, rsvpOwner, showBranchNudge]);

  const refreshSavedAttendance = useCallback((status: RsvpStatus) => {
    if (!rsvpOwner?.isCurrent()) return;
    queryClient.setQueryData(['event-rsvp', id, rsvpOwner.userId], status);
    invalidateRsvp();
  }, [id, rsvpOwner, queryClient, invalidateRsvp]);
  const onRsvpConfirmed = useCallback((status: 'going' | 'cancelled') => {
    refreshSavedAttendance(status);
    if (status !== 'going' || !rsvpOwner?.isCurrent()) return;
    void (async () => {
      if (!(await wasNudged(id)) && rsvpOwner.isCurrent()) {
        await markNudged(id);
        if (rsvpOwner.isCurrent()) showPostConfirmationSequence();
      }
    })();
  }, [id, rsvpOwner, refreshSavedAttendance, showPostConfirmationSequence]);
  const rsvpRecovery = useEventRsvpRecovery(id, rsvpOwner, onRsvpConfirmed, refreshSavedAttendance);
  const proceedWithRsvp = useCallback(async () => {
    if (!id || !rsvpOwner?.isCurrent()) return;
    setRsvpBusy(true);
    try {
      if (await rsvpRecovery.change(true) && rsvpOwner.isCurrent()) hapticSuccess();
    } finally {
      if (rsvpOwner.isCurrent()) setRsvpBusy(false);
    }
  }, [id, rsvpOwner, rsvpRecovery.change]);

  // the organizer name exactly as the byline renders it, for the notice and
  // its evidence snapshot (doc 13: show the organizer's display name)
  const noticeOrganizerName =
    (legacyIdentityAllowed ? event?.public_name || (event?.community_id ? eventCommunity?.name : organizer?.display_name) : publishedPage?.name) ||
    'the organizer';

  const handleCountMeIn = useCallback(async () => {
    if (!id || rsvpBusy || rsvpReadUnresolved || rsvpRecovery.blocked || !rsvpOwner?.isCurrent() || attendanceEntry.current === rsvpOwner) return;
    if (myRsvp === 'going') {
      // LIZ COPY
      setAlertInfo({
        title: 'not going anymore?',
        message: 'no pressure either way.',
        buttons: [
          { text: 'still going', style: 'cancel' },
          {
            text: 'take me off',
            onPress: async () => {
              if (rsvpOwner.isCurrent()) await rsvpRecovery.change(false);
            },
          },
        ],
      });
      return;
    }
    // proposal 49: first rsvp under the terms version in force shows the
    // Independent Activity Notice; the rsvp proceeds only once the assent
    // is recorded (fail CLOSED after 49 is live; dormant before it)
    attendanceEntry.current = rsvpOwner;
    setRsvpBusy(true);
    try {
      const { needsAssent } = await getParticipationNoticeStatus();
      if (!rsvpOwner.isCurrent()) return;
      if (needsAssent) {
        noticeOwner.current = rsvpOwner;
        setNoticeVisible(true);
        return;
      }
      await proceedWithRsvp();
    } catch {
      if (rsvpOwner.isCurrent()) setAlertInfo({ title: 'could not check attendance', message: 'Please try again.' });
    } finally {
      if (attendanceEntry.current === rsvpOwner) attendanceEntry.current = null;
      if (rsvpOwner.isCurrent()) setRsvpBusy(false);
    }
  }, [id, rsvpOwner, rsvpBusy, rsvpReadUnresolved, rsvpRecovery.blocked, rsvpRecovery.change, myRsvp, proceedWithRsvp]);

  const handleNoticeAgree = useCallback(async () => {
    const owner = noticeOwner.current;
    if (!id || !owner?.isCurrent() || owner !== rsvpOwner) return false;
    try {
      const ok = await recordScopedPlanAssent({
        listingType: 'explore_event', listingId: id,
        organizerUserId: event?.host_user_id ?? null, organizerName: noticeOrganizerName, action: 'rsvp',
      }, { viewerId: owner.userId, isCurrent: owner.isCurrent });
      if (!ok || !owner.isCurrent()) return false;
      setNoticeVisible(false);
      await proceedWithRsvp();
      return true;
    } catch { return false; }
  }, [id, rsvpOwner, event?.host_user_id, noticeOrganizerName, proceedWithRsvp]);

  if (!id || isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <StatusBar style="dark" />
        <View style={[styles.eventHeader, { justifyContent: 'space-between', paddingVertical: 8 }]}><TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" style={styles.headerButton} onPress={() => router.back()}><ArrowLeft size={20} color={Scene.text}/></TouchableOpacity><ProfileButton compact surface="scene"/></View>
        <View style={styles.centered}>
          {!id ? (
            <>
              <Text style={styles.emptyText}>this event is not around anymore.</Text>
              <TouchableOpacity onPress={() => router.back()} style={styles.goBackBtn}>
                <Text style={styles.goBackText}>go back</Text>
              </TouchableOpacity>
            </>
          ) : (
            <ActivityIndicator size="large" color={Scene.supporting} />
          )}
        </View>
      </SafeAreaView>
    );
  }

  if (!event) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <StatusBar style="dark" />
        <View style={[styles.eventHeader, { justifyContent: 'space-between', paddingVertical: 8 }]}><TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" style={styles.headerButton} onPress={() => router.back()}><ArrowLeft size={20} color={Scene.text}/></TouchableOpacity><ProfileButton compact surface="scene"/></View>
        <View style={styles.centered}>
          {eventError && (eventError as { code?: string }).code !== 'PGRST116' ? (
            <>
              <Text style={styles.emptyText} accessibilityLiveRegion="polite">We couldn’t load this event. Please try again.</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Try again"
                accessibilityState={{ disabled: eventFetching, busy: eventFetching }} disabled={eventFetching}
                onPress={() => { void retryEvent(); }} style={styles.goBackBtn}>
                {eventFetching ? <ActivityIndicator color={Scene.actionText} /> : <Text style={styles.goBackText}>Try again</Text>}
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Go back"
                onPress={() => router.back()} style={styles.recoveryBack}>
                <Text style={styles.recoveryBackText}>Go back</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.emptyText}>this event is not around anymore.</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} style={styles.goBackBtn}>
                <Text style={styles.goBackText}>go back</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  if (isCommunityEventReleaseBlocked(COMMUNITIES_ENABLED, event.community_id)) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <StatusBar style="dark" />
        <View style={[styles.eventHeader, { justifyContent: 'space-between', paddingVertical: 8 }]}><TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" style={styles.headerButton} onPress={() => router.back()}><ArrowLeft size={20} color={Scene.text}/></TouchableOpacity><ProfileButton compact surface="scene"/></View>
        <View style={styles.centered}>
          <Text style={styles.emptyText}>this event is not available in this build yet.</Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.goBackBtn}>
            <Text style={styles.goBackText}>go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const ticketPrice = normalizeTicketPrice(event.ticket_price);
  const isFree = ticketPrice === null;
  // Scene handoff §15 edge state "Event cancelled": explore_events.status
  // 'Cancelled' is a real, live value (lib/organizerHome.ts, app/creator/
  // event-summary.tsx, app/plan/[id].tsx, and app/community-topic/[id].tsx
  // all already branch on it) but this, the public guest-facing page, had
  // no handling at all -- a guest who could still load a cancelled event's
  // page saw normal, live attendance buttons.
  const isCancelled = event.status === 'Cancelled';
  // Screen 49 (Build 35 delta matrix) gap: "one dominant action reflecting
  // live sale state." 'Completed' is the same kind of real, live status
  // value as 'Cancelled' above -- event-summary.tsx and organizerHome.ts
  // already branch on it -- but this guest page had no handling for it at
  // all, so a guest opening a link to a past event still saw live
  // "get tickets" / "count me in" buttons.
  const eventEndMs = event.end_time ? Date.parse(event.end_time) : NaN;
  const eventStartMs = event.start_time ? Date.parse(event.start_time) : NaN;
  const isTimeEnded = Number.isFinite(eventEndMs)
    ? eventEndMs <= Date.now()
    : Number.isFinite(eventStartMs) && eventStartMs + 3 * 60 * 60 * 1000 <= Date.now();
  const isCompleted = event.status === 'Completed' || isTimeEnded;
  // allSoldOut is only ever true when real ticket_tiers rows exist and
  // every one is sold out (getPublicTicketSummary's own contract), so this
  // never fires for a genuine free/RSVP-only event. Before this, a
  // sold-out ticketed event fell through to the sceneParticipationEnabled
  // branch below and still showed an actionable "count me in" RSVP button
  // -- a guest could tap it and register as going via the free-RSVP path
  // even though there was zero real ticket inventory left.
  const isSoldOut = !ticketReadUnresolved && !!ticketSummary?.allSoldOut;

  // the byline grammar (slice 2): public_name override wins and wears
  // neither image; a community event fronts with the COMMUNITY name and
  // the leader's FACE; a standalone listing fronts with the organizer
  // profile name and LOGO. person = face, business = logo, never both.
  const bylineName =
    legacyIdentityAllowed ? event.public_name ||
    (event.community_id ? eventCommunity?.name ?? null : organizer?.display_name ?? null) : publishedPage?.name ?? previewPage?.name ?? null;
  const bylineFace =
    event.community_id && (publishedPage?.kind === 'community' || legacyIdentityAllowed && !event.public_name) ? eventLeaderCard?.avatar_url ?? null : null;
  const bylineLogo =
    legacyIdentityAllowed && !event.public_name && !event.community_id ? organizer?.logo_url ?? null : null;
  const artworkRatio = artwork && artwork.reference === event.image_url ? artwork.ratio : 4 / 5;
  const artworkWidth = Math.min(artFrameWidth || Math.max(1, windowWidth - 40), HERO_HEIGHT * artworkRatio);
  const artworkHeight = artworkWidth / artworkRatio;

  const getPlanSpotsInfo = (plan: LinkedPlan): { text: string; isFull: boolean } => {
    if (!linkedReady) return {text:'Availability not confirmed',isFull:false};
    const actualCount = memberCountsMap[plan.id];
    const capped = capDisplayCount(actualCount);
    const totalCapacity = Math.min((plan.max_invites ?? 7) + 1, MAX_GROUP);
    const left = Math.max(0, totalCapacity - capped);
    const isFull = left === 0;
    const text = isFull ? 'Full' : `${left} ${left === 1 ? 'spot' : 'spots'} left`;
    return { text, isFull };
  };

  return (
    <LinearGradient colors={[Scene.upper, Scene.middle, Scene.lower]} locations={Scene.gradientLocations} style={styles.container}>
      <StatusBar style="dark" />
      {previewMode && (
        /* §3.0 guest preview strip. Conditional truth: a Live event IS what a
           guest sees; a non-Live event is invisible to a real guest (RLS), so
           the copy promises how it WILL look once published. Exact wording is
           Liz's copy; the Live/unpublished split is built now, not retrofitted. */
        <View style={[styles.previewBar, { paddingTop: insets.top + 4 }]}>
          <Text style={styles.previewBarText}>
            {previewUnpublished ? 'how your page will look once it goes up' : 'how a guest sees it'}
          </Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Done previewing" onPress={() => router.back()} hitSlop={10} style={styles.previewDoneAction}>
            {/* LIZ COPY: back to editing */}
            <Text style={styles.previewBarDone}>done</Text>
          </TouchableOpacity>
        </View>
      )}
        <View style={[styles.eventHeader, { paddingTop: (previewMode ? 0 : insets.top) + 8, paddingBottom: 8 }]}>
          <TouchableOpacity
            accessibilityRole="button" accessibilityLabel="Back" style={styles.headerButton}
            onPress={() => router.back()}
          >
            <ArrowLeft size={20} color={Scene.text} strokeWidth={2} />
          </TouchableOpacity>
          <Text style={styles.headerContext} numberOfLines={1}>{bylineName || "The Scene"}</Text>

          <TouchableOpacity
            accessibilityRole="button" accessibilityLabel="Share event"
            style={styles.headerButton}
            onPress={async () => {
              if (previewMode) { showPreviewNotice(); return; }
              hapticLight();
              try {
                await Share.share({
                  message: `${event.title}\nhttps://washedup.app/e/${event.id}`,
                });
              } catch {}
            }}
          >
            <Share2 size={18} color={Scene.text} strokeWidth={2} />
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityRole="button" accessibilityLabel="Save event" accessibilityState={{ selected: isWishlisted }} style={styles.headerButton}
            onPress={() => {
              if (previewMode) { showPreviewNotice(); return; }
              hapticLight();
              wishlistMutation.mutate();
            }}
          >
            <Heart
              size={18}
              color={Scene.text}
              fill={isWishlisted ? Scene.text : 'transparent'}
              strokeWidth={2}
            />
          </TouchableOpacity>
          <ProfileButton compact surface="scene"/>
        </View>
      <ScrollView decelerationRate="normal" showsVerticalScrollIndicator={false}>
        <View style={styles.eventHeading}>
          {!!event.event_date && <Text style={styles.dateEyebrow}>{formatEventDateLA(event.event_date, { weekday: 'short', month: 'short', day: 'numeric' })}</Text>}
          <Text style={styles.title}>{event.title}</Text>
          {!!eventKickerLabel(event) && <View style={styles.detailCategoryPill}><Text style={styles.detailCategoryText}>{eventKickerLabel(event)}</Text></View>}
        </View>
        {!!event.image_url && <View style={styles.heroContainer} onLayout={e => setArtFrameWidth(e.nativeEvent.layout.width)}>
          <EventMediaImage eventId={event.id} reference={event.image_url} style={{ width: artworkWidth, height: artworkHeight, borderRadius: 8 }} contentFit="contain"
            onLoad={({ source }) => {
              if (source.width > 0 && source.height > 0) setArtwork({ reference: event.image_url!, ratio: source.width / source.height });
            }} />
        </View>}

        <View style={styles.content}>
          {(COMMUNITIES_ENABLED || publishedPage?.kind === 'organization') && !!bylineName && (
            <View style={styles.putOnByRow}>
              {!!bylineFace && (
                <Image source={{ uri: bylineFace }} style={styles.putOnByFace} contentFit="cover" />
              )}
              {!!bylineLogo && (
                <Image source={{ uri: bylineLogo }} style={styles.putOnByLogo} contentFit="cover" />
              )}
              {/* LIZ COPY (decision 16): bylines say put on by, never hosted by */}
              <Text style={styles.putOnBy}>put on by {bylineName}</Text>
            </View>
          )}

          {/* §4c (doc 69 A1): date/time and venue become tappable cards -
              calendar card adds the event, venue card opens the maps app.
              Flag off renders today's meta rows byte for byte (one reveal
              at the August moment, Cowork ruling). */}
          {COMMUNITIES_ENABLED ? (
            <View style={styles.infoCards}>
              {!!event.event_date && (
                <TouchableOpacity
                  style={styles.infoCard}
                  activeOpacity={0.85}
                  onPress={() => {
                    hapticLight();
                    const startIso = eventStartIso(event.event_date, event.start_time);
                    if (startIso) {
                      showAddToCalendar(event.title, startIso, event.end_time, event.venue ?? undefined);
                    }
                  }}
                >
                  <GoldSurfaceFill radius={12} /><View style={styles.infoCardInner}><Calendar size={18} color={Colors.asphalt} strokeWidth={2} />
                  <View style={styles.infoCardBody}>
                    <Text style={styles.infoCardText}>{formatFullDate(event.event_date, event.start_time)}</Text>
                    {/* copy to the taste gate (doc 69 Q5) */}
                    <Text style={styles.infoCardHint}>add to calendar</Text>
                  </View>
                  <ChevronRight size={16} color={Colors.asphalt} strokeWidth={2} /></View>
                </TouchableOpacity>
              )}
              {event.venue && (
                <TouchableOpacity
                  style={styles.infoCard}
                  activeOpacity={0.85}
                  onPress={() => {
                    hapticLight();
                    openUrl(venueMapsUrl(event.venue!, event.venue_address));
                  }}
                >
                  <GoldSurfaceFill radius={12} /><View style={styles.infoCardInner}><MapPin size={18} color={Colors.asphalt} strokeWidth={2} />
                  <View style={styles.infoCardBody}>
                    <Text style={styles.infoCardText}>{event.venue}</Text>
                    {event.venue_address ? (
                      <Text style={styles.infoCardHint}>{event.venue_address}</Text>
                    ) : (
                      /* copy to the taste gate (doc 69 Q5) */
                      <Text style={styles.infoCardHint}>open in maps</Text>
                    )}
                  </View>
                  <ChevronRight size={16} color={Colors.asphalt} strokeWidth={2} /></View>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <>
              <View style={styles.metaRow}>
                <Calendar size={16} color={Colors.asphalt} strokeWidth={2} />
                <Text style={styles.metaText}>{formatFullDate(event.event_date, event.start_time)}</Text>
              </View>

              {event.venue && (
                <View style={styles.metaRow}>
                  <MapPin size={16} color={Colors.asphalt} strokeWidth={2} />
                  <Text style={styles.metaText}>
                    {event.venue}{event.venue_address ? ` · ${event.venue_address}` : ''}
                  </Text>
                </View>
              )}
            </>
          )}

          {/* The price of a washedup-ticketed event comes from its TIERS
              (the sticky bar's "from" row), never from the legacy
              explore_events.ticket_price free-text field: that field can
              advertise a number for an event whose tickets are all still
              drafts. It survives here for LINK-OUT listings only, which
              have no tiers and no other price signal. */}
          {ticketPrice !== null && !!event.external_url
            && !ticketSummary?.onSale && !ticketSummary?.allSoldOut && (
            <View style={styles.metaRow}>
              <Ticket size={16} color={Scene.supporting} strokeWidth={2} />
              <Text style={styles.metaText}>{formatTicketPrice(ticketPrice)}</Text>
            </View>
          )}

          {/* the link-out is the one thing the link-first launch depends on
              (doc 37: prominence): a full-width button above the fold,
              shown whenever a link exists, labeled by context */}
          {event.external_url && (
            <TouchableOpacity
              accessibilityRole="button" accessibilityLabel={isFree ? 'Reserve a spot' : 'Get external tickets'}
              style={styles.ticketBtn}
              onPress={() => { if (previewMode) { showPreviewNotice(); return; } void openUrl(event.external_url!); }}
              activeOpacity={0.85}
            >
              <Ticket size={18} color={Scene.text} strokeWidth={2} />
              {/* LIZ COPY: priced vs free-with-link labels */}
              <Text style={styles.ticketBtnText}>{isFree ? 'reserve a spot' : 'get tickets'}</Text>
              <ChevronRight size={16} color={Scene.supporting} strokeWidth={2} />
            </TouchableOpacity>
          )}

          {/* the body (doc 76 §3): the mood board when an organizer has
              built one, the legacy plain description otherwise; the
              good-to-know cards close it either way */}
          {Array.isArray(event.description_blocks) && event.description_blocks.length > 0 ? (
            <View style={styles.descriptionSection}>
              <EventBodyBlocks eventId={event.id} blocks={event.description_blocks} surface="scene" />
            </View>
          ) : (
            <View style={styles.descriptionSection}>
              {!!event.description && (
                <LinkifiedText text={event.description} style={styles.descriptionText} linkStyle={{ color: Scene.text }} />
              )}
              <EventFaqCards eventId={event.id} surface="scene" />
            </View>
          )}

          {previewPage && !previewPage.isPublished && !publishedPage && (
            <View style={styles.entityCard}><GoldSurfaceFill radius={12} />
              <View style={styles.entityCardBody}>
                <Text style={styles.entityCardKicker}>{previewPage.kind}</Text>
                <Text style={styles.entityCardName}>{previewPage.name}</Text>
                <Text style={styles.entityCardMeta}>Your page is still private.</Text>
              </View>
            </View>
          )}
          {CREATOR_PAGES_ENABLED && !legacyIdentityAllowed && !publishedPage && !(previewPage && !previewPage.isPublished) && (
            <View style={[styles.entityCard, { flexDirection: 'column', alignItems: 'stretch' }]}><GoldSurfaceFill radius={12} />
              <Text accessibilityRole={pageRead.error || pageContext.account.error ? 'alert' : undefined} style={styles.entityCardMeta}>
                {pageRead.error || pageContext.account.error ? 'The event’s page could not be checked.' : pageRead.loading || pageContext.account.isLoading ? 'Checking this event’s page…' : 'This event’s page is unavailable.'}
              </Text>
              {(pageRead.error || pageContext.account.error) && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Check page" style={styles.followPill}
                onPress={() => { void (pageContext.account.error ? pageContext.account.retry() : pageRead.refresh()).catch(() => undefined); }}>
                <Text style={styles.followPillText}>Check page</Text>
              </TouchableOpacity>}
            </View>
          )}
          {publishedPage?.kind === 'organization' && (
            <View style={[styles.entityCard, { flexDirection: 'column', alignItems: 'stretch' }]}><GoldSurfaceFill radius={12} />
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Open ${publishedPage.name}`} style={[styles.entityCardIdentity, styles.stackedEntityIdentity]}
                onPress={() => router.push(publishedPageRoute(publishedPage) as never)}>
                <View style={styles.entityCardBody}>
                  <Text style={styles.entityCardKicker}>organization</Text>
                  <Text style={styles.entityCardName}>{publishedPage.name}</Text>
                  <Text style={styles.entityCardMeta}>{publishedPage.purpose}</Text>
                  {trackRecordCount !== null && trackRecordCount > 0 && <Text style={styles.entityCardMeta}>{trackRecordCount} public {trackRecordCount === 1 ? 'event' : 'events'}</Text>}
                </View>
                <ChevronRight size={18} color={Scene.supporting} />
              </TouchableOpacity>
              {!!publishedPage.coverMediaId && <PublishedPageCover pageId={publishedPage.pageId} mediaId={publishedPage.coverMediaId} height={120} />}
              <OrganizationPageFollowControls pageId={publishedPage.pageId} ownerId={publishedPage.ownerId} scope={pageContext.scope}
                surface="scene" preview={previewMode} onPreview={showPreviewNotice} />
              {!!relatedPageRead.error && <View><Text accessibilityRole="alert" style={styles.entityCardMeta}>This page’s other events could not be loaded.</Text>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Check events" style={styles.followPill} onPress={() => { void relatedPageRead.refresh().catch(() => undefined); }}>
                  <Text style={styles.followPillText}>Check events</Text>
                </TouchableOpacity></View>}
            </View>
          )}

          {/* §4c (doc 69 B2): the fronting-entity card with the inline
              follow (Dice pattern) sits after the about block. The pill
              renders only when 68 is live (followState.available) and the
              viewer is signed in; the count obeys the doc-37 threshold. */}
          {COMMUNITIES_ENABLED && !!frontingTarget && !!bylineName && (
            <View style={styles.entityCard}><GoldSurfaceFill radius={12} />
              {/* Scene handoff §12/13: tapping the organization identity
                  opens its public profile page (app/organization/[id].tsx).
                  followTarget is already organizer-only (see its definition
                  above), so a community's identity here stays a plain,
                  non-navigating row - §16 lists no public destination for
                  a community identity, only for an organization's. */}
              <TouchableOpacity
                style={styles.entityCardIdentity}
                activeOpacity={0.7}
                accessibilityRole="button" accessibilityLabel={`Open ${bylineName}`}
                onPress={() => {
                  if (frontingTarget?.kind === 'community') { router.push(`/community/${frontingTarget.id}` as never); return; }
                  if (!followTarget) return;
                  hapticLight();
                  // Not yet in the generated route types (brand-new route,
                  // same escape hatch this file already uses for
                  // /tickets/order/[id] below).
                  router.push(`/organization/${followTarget.id}` as never);
                }}
              >
                {!!bylineFace && (
                  <Image source={{ uri: bylineFace }} style={styles.entityCardImage} contentFit="cover" />
                )}
                {!!bylineLogo && (
                  <Image source={{ uri: bylineLogo }} style={styles.entityCardImage} contentFit="cover" />
                )}
                {!bylineFace && !bylineLogo && (
                  <View style={[styles.entityCardImage, styles.entityCardImageFallback]}>
                    <Text style={styles.entityCardInitial}>{bylineName[0]?.toUpperCase() ?? '?'}</Text>
                  </View>
                )}
                <View style={styles.entityCardBody}>
                  {/* LIZ COPY (decision 16): put on by, never hosted by */}
                  <Text style={styles.entityCardKicker}>put on by</Text>
                  <Text style={styles.entityCardName}>{bylineName}</Text>
                  {/* P4 (doc 78 §2.8): the trust bridge. A fronting entity
                      exists only through the approved-operator flow, so this
                      is application-reviewed by construction. Substance is
                      locked by vocabulary law; the exact string goes to the
                      taste gate. NOT terracotta - the CTA owns the accent. */}
                  <View style={styles.badgeRow}>
                    <BadgeCheck size={13} color={Colors.asphalt} strokeWidth={2.5} />
                    <Text style={styles.badgeText}>Reviewed creator</Text>
                  </View>
                  <View style={styles.entityCardMetaRow}>
                    {trackRecordCount !== null && trackRecordCount > 0 && (
                      /* copy to the taste gate: track record (doc 78 §2.8) */
                      <Text style={styles.entityCardMeta}>
                        {trackRecordCount} {trackRecordCount === 1 ? 'event' : 'events'}
                      </Text>
                    )}
                    {followerCount !== null && followerCount >= GOING_COUNT_THRESHOLD && (
                      /* copy to the taste gate (doc 69 Q5) */
                      <Text style={styles.entityCardMeta}>{followerCount} following</Text>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
              {/* Scene handoff §16 data correction (2026-09-01): a community
                  never shows Follow or a follower count, full stop -- this
                  is no longer a priority ordering between member and follow
                  state (T9/doc 121's original framing). followState only
                  ever resolves for an organizer target (followTarget above),
                  so the ": !!userId && !!followState?.available" branch
                  below is structurally unreachable for a community event;
                  member/pending/join here comes entirely from
                  viewerMembershipStatus. */}
              <View style={styles.entityCardActions}>
                {viewerIsMemberHere ? (
                  <View>
                    <Text style={styles.memberStatus}>You’re a member</Text>
                  </View>
                ) : !!userId && !!followState?.available ? (
                  <TouchableOpacity
                    style={[styles.followPill, followState.following && styles.followPillOn]}
                    onPress={() => {
                      if (previewMode) { showPreviewNotice(); return; }
                      hapticLight();
                      followMutation.mutate();
                    }}
                    disabled={followMutation.isPending}
                    activeOpacity={0.85}
                  >
                    {/* copy to the taste gate (doc 69 Q5) */}
                    <Text style={[styles.followPillText, followState.following && styles.followPillTextOn]}>
                      {followState.following ? 'following' : 'follow'}
                    </Text>
                  </TouchableOpacity>
                ) : null}
                {/* SC-05: a real join door, not just the follow pill - law 1
                    still applies here, so this stays the neutral pill style,
                    never a second terracotta fill on this screen. */}
                {viewerJoinPending ? (
                  <View style={[styles.followPill, styles.followPillOn]}>
                    {/* LIZ COPY */}
                    <Text style={[styles.followPillText, styles.followPillTextOn]}>pending</Text>
                  </View>
                ) : viewerCanJoinHere ? (
                  <TouchableOpacity
                    style={styles.followPill}
                    onPress={() => {
                      if (previewMode) { showPreviewNotice(); return; }
                      hapticLight();
                      setJoinPopupVisible(true);
                    }}
                    activeOpacity={0.85}
                  >
                    {/* LIZ COPY: proposal 91 - the door says what it does */}
                    <Text style={styles.followPillText}>{joinsInstantly ? 'join' : 'ask to join'}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          )}

          {/* social proof (doc 78 law 7: AFTER the organizer identity, not
              before the body). Threshold logic (doc 37): a real count only
              from five up, never "1 person going"; below that, the
              invitation, and only when flattering (never "0 going"). */}
          {sceneParticipationEnabled && rsvpCount !== null && (
            <View style={styles.metaRow}>
              <Users size={16} color={Scene.supporting} strokeWidth={2} />
              <Text style={styles.metaText}>
                {rsvpCount >= GOING_COUNT_THRESHOLD
                  ? `${rsvpCount} going`
                  : /* LIZ COPY */ 'new event · be one of the first'}
              </Text>
            </View>
          )}

          {/* the chat law: the plans module NEVER renders on a community
              event — its conversation is the event chat */}
          {!isCommunityEvent && (
          <View style={styles.plansSection}>
            <View style={styles.plansSectionHeader}>
              <Users size={18} color={Scene.text} strokeWidth={2} />
              {/* the lowercase law */}
            <Text style={styles.plansSectionTitle}>people going with washedup</Text>
            </View>

            {!linkedReady && <View style={styles.linkedPlanRecovery}>
              <Text accessibilityRole={linkedRead.error ? 'alert' : undefined} style={styles.noPlansText}>{linkedRead.error ? 'Plans couldn’t be checked.' : 'Checking plans…'}</Text>
              {linkedRead.error && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry linked plans" disabled={linkedRead.loading} style={styles.ticketReadRetry} onPress={retryLinkedPlans}><Text style={styles.ticketReadRetryText}>Try again</Text></TouchableOpacity>}
            </View>}
            {linkedReady && linkedPlans.length === 0 ? (
              <Text style={styles.noPlansText}>no one has posted a plan yet. go first.</Text>
            ) : (
              linkedPlans.map(plan => {
                const { text: spotsText, isFull } = getPlanSpotsInfo(plan);
                return (
                  <TouchableOpacity
                    key={plan.id}
                    style={styles.planCard}
                    accessibilityRole="button" accessibilityLabel={`View Plan: ${plan.title}`} disabled={!linkedReady}
                    onPress={() => { if (canUseLinkedPlans()) router.push(`/plan/${plan.id}`); }}
                    activeOpacity={0.85}
                  >
                    <View style={styles.planCardTop}>
                      {plan.creator_photo ? (
                        <Image source={{ uri: plan.creator_photo }} style={styles.planCreatorAvatar} contentFit="cover" />
                      ) : (
                        <View style={[styles.planCreatorAvatar, styles.planCreatorAvatarFallback]}>
                          <Text style={styles.planCreatorInitial}>
                            {plan.creator_name?.[0]?.toUpperCase() ?? '?'}
                          </Text>
                        </View>
                      )}
                      <Text style={styles.planCreatorName}>{plan.creator_name ?? 'someone'} posted</Text>
                      {plan.primary_vibe && (
                        <View style={styles.planVibePill}>
                          <Text style={styles.planVibeText}>{plan.primary_vibe}</Text>
                        </View>
                      )}
                      <View style={styles.planCardSpacer} />
                      {plan.creator_user_id !== userId && (
                        <TouchableOpacity
                          onPress={(e) => {
                            e.stopPropagation();
                            handleCreatorMenu(plan.creator_user_id, plan.creator_name ?? 'this person');
                          }}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          style={styles.planMenuBtn}
                        >
                          <MoreHorizontal size={16} color={Scene.supporting} />
                        </TouchableOpacity>
                      )}
                      <View style={[
                        styles.planJoinBtn,
                        isFull && styles.planJoinBtnFull,
                      ]}>
                        <Text style={[
                          styles.planJoinBtnText,
                          isFull && styles.planJoinBtnTextFull,
                        ]}>
                          {!linkedReady ? 'check' : isFull ? 'full' : 'view'}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.planTitle}>{plan.title}</Text>
                    <Text style={styles.planMeta}>{spotsText}</Text>
                  </TouchableOpacity>
                );
              })
            )}
          </View>
          )}

          {COMMUNITIES_ENABLED && !previewMode && <EventMessagePreference eventId={id} dark />}

          {/* §4c (doc 69 A6): the more-from rail closes the page */}
          {(COMMUNITIES_ENABLED || publishedPage?.kind === 'organization') && moreEvents.length > 0 && !!bylineName && (
            <View style={styles.moreSection}>
              {/* copy to the taste gate (doc 69 Q5) */}
              <Text style={styles.moreSectionTitle}>more put on by {bylineName}</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.moreRail}
              >
                {moreEvents.map((ev) => (
                  <TouchableOpacity
                    key={ev.id}
                    style={styles.moreCard}
                    activeOpacity={0.85}
                    onPress={() => {
                      hapticLight();
                      router.push(`/event/${ev.id}`);
                    }}
                  >
                    {ev.image_url ? (
                      <EventMediaImage eventId={ev.id} reference={ev.image_url} style={styles.moreCardImage} contentFit="cover" />
                    ) : (
                      <View style={styles.moreCardImage}>
                        <GeneratedPoster
                          title={ev.title}
                          category={ev.category}
                          venue={ev.venue}
                          height={MORE_CARD_POSTER_HEIGHT}
                          compact
                        />
                      </View>
                    )}
                    <Text style={styles.moreCardTitle} numberOfLines={2}>{ev.title}</Text>
                    {!!ev.event_date && (
                      <Text style={styles.moreCardMeta}>
                        {formatEventDateLA(ev.event_date, { weekday: 'short', month: 'short', day: 'numeric' })}
                      </Text>
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
          {!!ownedTicket && !ticketReadUnresolved && ticketSummary?.onSale && !isSoldOut && !isCancelled && !isCompleted && (
            <TouchableOpacity style={styles.ticketReadRetry} accessibilityRole="button" accessibilityLabel="Get more tickets"
              onPress={() => { if (pageContext.scope?.isCurrent()) { hapticMedium(); setCheckoutVisible(true); } }}>
              <Text style={styles.ticketReadRetryText}>Get more tickets</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

      <View style={[styles.stickyBarWrap, { paddingBottom: insets.bottom + 8 }]}>
        {/* P3: honest all-in price + real scarcity, before any checkout */}
        {!ownedTicket && !!ticketSummary && !ticketReadUnresolved && ticketSummary.onSale && !isSoldOut && !isCancelled && !isCompleted && (
          <View style={styles.priceRow}>
            {ticketSummary.allSoldOut ? (
              /* copy to the taste gate: never a sold-out tier's price */
              <Text style={styles.priceSoldOut}>sold out</Text>
            ) : (
              <>
                {/* law 9: "fees included" stated so nothing surprises */}
                <Text style={styles.priceFrom}>
                  {ticketSummary.fromCents === null ? 'Check ticket prices' : `from ${formatCents(ticketSummary.fromCents)}`}
                  {ticketSummary.fromCents !== null && <Text style={styles.priceFees}>  fees included</Text>}
                </Text>
                {!!ticketSummary.scarcity && ticketSummary.scarcity.left > 0 && (
                  /* law 10: REAL remaining only, from the availability RPC.
                     TK-07: low inventory is its own honest state, not just
                     the plain count -- mirrors PlanCard's spotsLeftBadge. */
                  isLowInventory(ticketSummary.scarcity.left, ticketSummary.scarcity.cap) ? (
                    <View style={styles.scarcityBadge}>
                      <Text style={styles.scarcityBadgeText}>{ticketSummary.scarcity.left} left</Text>
                    </View>
                  ) : (
                    <Text style={styles.priceScarcity}>
                      {ticketSummary.scarcity.left} of {ticketSummary.scarcity.cap} left
                    </Text>
                  )
                )}
              </>
            )}
          </View>
        )}
        <View style={[styles.stickyBar, fontScale > 1.3 && { flexDirection: 'column' }]}>
        {isCancelled ? (
          // Scene handoff §15: "Replace attendance CTAs with Cancelled and
          // show refund/contact information when relevant." Reuses the
          // exact support channel already established in
          // app/tickets/order/[id].tsx rather than inventing a new one.
          <View style={styles.cancelledRow}>
            <View style={[styles.rsvpButton, styles.cancelledPill]}>
              {/* copy to the taste gate */}
              <Text style={styles.cancelledPillText}>cancelled</Text>
            </View>
            <TouchableOpacity
              onPress={() => Linking.openURL('mailto:hello@washedup.app')}
              hitSlop={8}
              accessibilityRole="button"
            >
              {/* copy to the taste gate */}
              <Text style={styles.cancelledContactText}>paid for this? email us — hello@washedup.app</Text>
            </TouchableOpacity>
          </View>
        ) : isCompleted ? (
          // Screen 49 gap: a completed event gets the same single,
          // non-actionable dominant state as Cancelled -- reuses the exact
          // pill styling, no separate contact line (nothing to refund/
          // contact about just because an event already happened).
          <View style={[styles.rsvpButton, styles.cancelledPill]}>
            {/* copy to the taste gate */}
            <Text style={styles.cancelledPillText}>event ended</Text>
          </View>
        ) : ownedTicket ? (
          <>
            <TouchableOpacity style={styles.rsvpButton} accessibilityRole="button" accessibilityLabel="Your tickets" onPress={openOwnedTickets}>
              <Text style={styles.rsvpButtonText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>Your tickets</Text>
            </TouchableOpacity>
            {isCommunityEvent ? (eventTopicId ? (
              <TouchableOpacity style={styles.postPlanButton} accessibilityRole="button" accessibilityLabel="Open event chat"
                onPress={() => { if (pageContext.scope?.isCurrent()) router.push(`/community-topic/${eventTopicId}`); }}>
                <Text style={styles.postPlanButtonText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>Open chat</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.ticketReadRecovery}>
                <Text style={styles.ticketReadText}>{eventTopicRead.isPending || eventTopicRead.isFetching ? 'Checking your event chat…' : eventTopicRead.error ? 'Your event chat could not be checked.' : 'Your event chat is not available yet.'}</Text>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Check event chat" style={styles.ticketReadRetry}
                  disabled={eventTopicRead.isFetching} onPress={() => { if (pageContext.scope?.isCurrent()) void eventTopicRead.refetch(); }}>
                  <Text style={styles.ticketReadRetryText}>{eventTopicRead.isFetching ? 'Checking…' : 'Try again'}</Text>
                </TouchableOpacity>
              </View>
            )) : (
              <TouchableOpacity style={[styles.postPlanButton, !linkedReady && {opacity:0.55}]} accessibilityRole="button" accessibilityLabel="Find people" disabled={!linkedReady && !previewMode} onPress={goFindPeople}>
                <Text style={styles.postPlanButtonText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>find people</Text>
              </TouchableOpacity>
            )}
          </>
        ) : ownTicketsUnresolved ? (
          <View style={styles.ticketReadRecovery}>
            <Text accessibilityRole={ownTickets.error ? 'alert' : undefined} style={styles.ticketReadText}>
              {ownTickets.error ? 'Your tickets could not be checked.' : 'Checking your tickets…'}
            </Text>
            {ownTickets.error ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Check your tickets" style={styles.ticketReadRetry}
              disabled={ownTickets.loading} onPress={() => { if (pageContext.scope?.isCurrent()) void ownTickets.refresh().catch(() => undefined); }}>
              <Text style={styles.ticketReadRetryText}>Try again</Text>
            </TouchableOpacity> : <ActivityIndicator size="small" color={Scene.text} accessibilityLabel="Checking your tickets" />}
          </View>
        ) : isSoldOut ? (
          // Screen 49 gap: sold-out is its own honest dominant state, not
          // a silent fallthrough into the free-RSVP button (see isSoldOut).
          <View style={[styles.rsvpButton, styles.cancelledPill]}>
            {/* copy to the taste gate */}
            <Text style={styles.cancelledPillText}>sold out</Text>
          </View>
        ) : (
        <>
        {/* C1: a ticketed event's primary CTA is "get tickets" (the single
            terracotta fill), opening the tier selector -> checkout. rsvp is
            the going-signal for FREE/tierless events, so it steps aside when
            tickets are on sale (buying is the going action). */}
        {ticketReadUnresolved ? (
          <View style={styles.ticketReadRecovery}>
            <Text accessibilityRole={ticketProblem ? 'alert' : undefined} style={styles.ticketReadText}>
              {ticketProblem ? 'Ticket availability could not be checked.' : 'Checking ticket availability…'}
            </Text>
            {ticketProblem ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Check ticket availability"
              accessibilityState={{ disabled: ticketRead.isFetching, busy: ticketRead.isFetching }} disabled={ticketRead.isFetching}
              style={styles.ticketReadRetry} onPress={retryTickets}>
              <Text style={styles.ticketReadRetryText}>{ticketRead.isFetching ? 'Checking…' : 'Try again'}</Text>
            </TouchableOpacity> : <ActivityIndicator size="small" color={Scene.text} accessibilityLabel="Checking ticket availability" />}
          </View>
        ) : ticketSummary?.notOnSale || ticketSummary?.unavailable ? (
          <View style={styles.ticketReadRecovery}>
            <Text style={styles.ticketReadText}>{ticketSummary.notOnSale ? 'Tickets are not on sale right now.' : 'Tickets are unavailable right now.'}</Text>
          </View>
        ) : ticketSummary?.onSale ? (
          <TouchableOpacity
            style={styles.rsvpButton}
            onPress={() => {
              if (previewMode) { showPreviewNotice(); return; }
              hapticMedium(); setCheckoutVisible(true);
            }}
          >
            <Text style={styles.rsvpButtonText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>get tickets</Text>
          </TouchableOpacity>
        ) : sceneParticipationEnabled && rsvpRecovery.blocked ? (
          <View style={styles.ticketReadRecovery}>
            <Text accessibilityRole={rsvpRecovery.busy ? undefined : 'alert'} style={styles.ticketReadText}>
              {rsvpRecovery.busy ? 'Checking your attendance…' : rsvpRecovery.phase === 'unknown' ? 'Your attendance change has not been confirmed yet.' : rsvpRecovery.error}
            </Text>
            {rsvpRecovery.busy ? <ActivityIndicator size="small" color={Scene.text} accessibilityLabel="Checking your attendance change" /> : (
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Check attendance change" style={styles.ticketReadRetry} onPress={() => { void rsvpRecovery.check(); }}>
                <Text style={styles.ticketReadRetryText}>Check status</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : sceneParticipationEnabled && rsvpReadUnresolved ? (
          <View style={styles.ticketReadRecovery}>
            <Text accessibilityRole={rsvpReadProblem ? 'alert' : undefined} style={styles.ticketReadText}>
              {rsvpReadProblem ? 'Your attendance could not be checked.' : 'Checking your attendance…'}
            </Text>
            {rsvpReadProblem ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Check attendance"
              disabled={rsvpRead.isFetching} accessibilityState={{ disabled: rsvpRead.isFetching, busy: rsvpRead.isFetching }}
              style={styles.ticketReadRetry} onPress={() => { if (pageContext.account.error) void pageContext.account.retry(); else void rsvpRead.refetch(); }}>
              <Text style={styles.ticketReadRetryText}>{rsvpRead.isFetching ? 'Checking…' : 'Try again'}</Text>
            </TouchableOpacity> : <ActivityIndicator size="small" color={Scene.text} accessibilityLabel="Checking your attendance" />}
          </View>
        ) : sceneParticipationEnabled && (
          <TouchableOpacity
            style={[styles.rsvpButton, myRsvp === 'going' && styles.rsvpButtonGoing]}
            onPress={() => {
              if (previewMode) { showPreviewNotice(); return; }
              handleCountMeIn();
            }}
            disabled={rsvpBusy}
          >
            {rsvpBusy ? (
              <ActivityIndicator size="small" color={myRsvp === 'going' ? Scene.text : Scene.actionText} />
            ) : (
              <Text style={[styles.rsvpButtonText, myRsvp === 'going' && styles.rsvpButtonTextGoing]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
                {myRsvp === 'going' ? "you're going" : 'count me in'}
              </Text>
            )}
          </TouchableOpacity>
        )}
        {/* the chat law: find-people never renders on a community event -
            the chat affordance takes its place once the viewer is going */}
        {isCommunityEvent ? (
          !rsvpReadUnresolved && !rsvpRecovery.blocked && myRsvp === 'going' && (eventTopicId ? (
            <TouchableOpacity
              style={styles.postPlanButton}
              onPress={() => {
                if (previewMode) { showPreviewNotice(); return; }
                hapticMedium();
                // eventTopicId is a community_topics.id, so it belongs to the
                // TOPIC screen. Pushing it at /community-thread sent the send
                // through sendCommunityMessage, which inserts into
                // community_broadcasts with community_id = a topic id: RLS
                // refused it and the member saw the raw policy error.
                router.push(`/community-topic/${eventTopicId}`);
              }}
            >
              {/* copy to the taste gate (doc 69 Q5) */}
              <Text style={styles.postPlanButtonText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>open the chat</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.ticketReadRecovery}>
              <Text accessibilityRole={eventTopicRead.error ? 'alert' : undefined} style={styles.ticketReadText}>
                {eventTopicRead.isPending || eventTopicRead.isFetching ? 'Checking your event chat…' : eventTopicRead.error ? 'Your event chat could not be checked.' : 'Your event chat is not available yet.'}
              </Text>
              {eventTopicRead.isPending || eventTopicRead.isFetching ? <ActivityIndicator size="small" color={Scene.text} accessibilityLabel="Checking your event chat" /> : (
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Check event chat" style={styles.ticketReadRetry} onPress={() => { void eventTopicRead.refetch(); }}>
                  <Text style={styles.ticketReadRetryText}>Try again</Text>
                </TouchableOpacity>
              )}
            </View>
          ))
        ) : (
          <TouchableOpacity style={[styles.postPlanButton, !linkedReady && {opacity:0.55}]} accessibilityRole="button" accessibilityLabel="Find people" disabled={!linkedReady && !previewMode} onPress={goFindPeople}>
            <Text style={styles.postPlanButtonText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>find people</Text>
          </TouchableOpacity>
        )}
        </>
        )}
        </View>
      </View>

      {reportTarget && (
        <ReportModal
          visible={showReport}
          onClose={() => { setShowReport(false); setReportTarget(null); }}
          reportedUserId={reportTarget.id}
          reportedUserName={reportTarget.name}
        />
      )}

      <BrandedAlert
        visible={!!alertInfo}
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message}
        buttons={alertInfo?.buttons}
        onClose={() => setAlertInfo(null)}
      />

      {joinGate && (
        <JoinCommunityPopup
          visible={joinPopupVisible}
          gate={joinGate}
          joinsInstantly={joinsInstantly}
          onClose={() => setJoinPopupVisible(false)}
          onRequested={() => {
            setJoinPopupVisible(false);
            queryClient.invalidateQueries({ queryKey: ['community-membership', event?.community_id, userId] });
          }}
        />
      )}

      <PlanChooserSheet
        visible={chooserVisible}
        plans={chooserPlans}
        onSelectPlan={handleChooserSelectPlan}
        onStartNew={handleChooserStartNew}
        onClose={() => setChooserVisible(false)}
      />

      <ParticipationNotice
        visible={noticeVisible}
        organizerName={noticeOrganizerName}
        onAgree={handleNoticeAgree}
        onClose={() => setNoticeVisible(false)}
      />

      <TicketCheckoutSheet
        owner={pageContext.scope}
        visible={checkoutVisible}
        eventId={event.id}
        onClose={() => setCheckoutVisible(false)}
        onOrderReady={(orderId) => {
          setCheckoutVisible(false);
          // C2/C3: the order-complete + your-tickets surfaces
          router.push(`/tickets/order/${orderId}` as never);
        }}
        // Scene spec 05: carry the same event band + byline this page
        // already resolved for its own hero, straight into checkout.
        eventTitle={event.title}
        eventImage={event.image_url}
        eventDateLabel={event.event_date ? formatFullDate(event.event_date, event.start_time) : null}
        eventVenue={event.venue}
        creatorName={bylineName}
        creatorAvatar={bylineFace ?? bylineLogo}
      />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Scene.upper },
  ticketReadRecovery: { flex: 1, gap: 4, minWidth: 120 },
  ticketReadText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Scene.supporting },
  ticketReadRetry: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: 10 },
  ticketReadRetryText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Scene.text },
  // §3.0 guest-preview strip: quiet, neutral, a "done" that returns to editing
  previewBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: Scene.surface,
    borderBottomWidth: 1,
    borderBottomColor: Scene.border,
  },
  previewBarText: { flex: 1, minWidth: 0, fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Scene.supporting },
  previewDoneAction: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  previewBarDone: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Scene.text },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyLG, color: Scene.supporting, textAlign: 'center' },
  goBackBtn: { marginTop: 16, paddingHorizontal: 24, paddingVertical: 12, backgroundColor: Scene.action, borderRadius: 14 },
  recoveryBack: { minHeight: 44, marginTop: 4, paddingHorizontal: 20, justifyContent: 'center' },
  recoveryBackText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Scene.text },
  goBackText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Scene.actionText },
  // P2 (law 2/3): the cover sits on the warm-dark media ground so the
  // photo reads cinematic and never flashes cream while it loads
  heroContainer: { marginHorizontal: 20, alignItems: 'center' },
  eventHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 4 },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerContext: { flex: 1, minWidth: 0, fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Scene.text },
  eventHeading: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 18, gap: 10 },
  dateEyebrow: { fontFamily: Fonts.sansBold, fontSize: FontSizes.caption, color: Scene.supporting, textTransform: 'uppercase', letterSpacing: 0.8 },
  content: { padding: 20, gap: 14 },
  detailCategoryPill: { backgroundColor: Scene.action, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  // sentence-lowercase, no transforms (C16 + the lowercase law)
  detailCategoryText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.caption, color: Scene.actionText },
  // doc 76 §3: the title carries the page in the display face, with the
  // Luma/Posh air around it
  title: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displayLG,
    color: Scene.text,
    lineHeight: 34,
    marginBottom: 2,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoCards: { gap: 8 },
  infoCard: {
    backgroundColor: Scene.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Scene.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  infoCardInner: {flex:1,flexDirection:'row',alignItems:'center',gap:10},
  infoCardBody: { flex: 1, gap: 2 },
  infoCardText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  infoCardHint: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.asphalt },
  entityCard: {
    backgroundColor: Scene.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Scene.border,
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 12,
    marginTop: 8,
  },
  entityCardIdentity: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight:44 },
  stackedEntityIdentity: { flex: undefined, flexGrow: 0, flexShrink: 0, flexBasis: 'auto', minHeight: 44 },
  entityCardImage: { width: 44, height: 44, borderRadius: 22, overflow: 'hidden' },
  entityCardImageFallback: { backgroundColor: Colors.parchment, alignItems: 'center', justifyContent: 'center' },
  entityCardInitial: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  entityCardBody: { flex: 1, gap: 2 },
  entityCardKicker: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.asphalt },
  entityCardName: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  entityCardMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.asphalt },
  entityCardMetaRow: { flexDirection: 'row', gap: 12, marginTop: 2 },
  memberStatus: {fontFamily: Fonts.sansMedium,fontSize:FontSizes.caption,color:Colors.asphalt},
  entityCardActions: { gap: 6, alignItems: 'flex-start' },
  // the founding-partner badge: gold trust marker, never the terracotta accent
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  badgeText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.asphalt },
  // law 1: the sticky CTA is the screen's one terracotta fill, so follow
  // is a NEUTRAL secondary (border + darkWarm), not a second accent
  followPill: { borderWidth: 1.5, borderColor: Scene.border, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 7 },
  followPillOn: { borderColor: Scene.border, backgroundColor: Scene.surface },
  followPillText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Scene.text },
  followPillTextOn: { color: Scene.supporting },
  moreSection: { marginTop: 8, paddingTop: 16, borderTopWidth: 1, borderTopColor: Scene.border, gap: 12 },
  moreSectionTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.displaySM, color: Scene.text },
  moreRail: { gap: 10 },
  moreCard: { width: MORE_CARD_WIDTH, gap: 6 },
  moreCardImage: {
    width: MORE_CARD_WIDTH,
    height: MORE_CARD_POSTER_HEIGHT,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: Scene.surface,
  },
  moreCardTitle: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Scene.text },
  moreCardMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Scene.supporting },
  metaText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Scene.supporting, flex: 1, lineHeight: 20 },
  descriptionSection: { marginTop: 8, paddingTop: 16, borderTopWidth: 1, borderTopColor: Scene.border, gap: 14 },
  descriptionText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Scene.supporting, lineHeight: 22 },
  // the secondary-button pattern: outline terracotta, never competing with
  // the sticky bar's primary CTA
  // law 1: the sticky CTA owns the accent, so the legacy external link-out
  // (interim only - the go-live gate removes it, and C1's real tier CTA
  // replaces it) drops to the neutral secondary rather than a second
  // terracotta element competing with the primary action
  ticketBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: Scene.border,
    borderRadius: 999,
    paddingVertical: 13,
    marginTop: 4,
  },
  ticketBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Scene.text },
  plansSection: { marginTop: 16, paddingTop: 20, borderTopWidth: 1, borderTopColor: Scene.border, gap: 12 },
  plansSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  plansSectionTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.displaySM, color: Scene.text },
  noPlansText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Scene.supporting },
  planCard: {
    backgroundColor: Scene.surface,
    borderRadius: 12,
    padding: 14,
    gap: 6,
    borderWidth: 1,
    borderColor: Scene.border,
  },
  planCardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  planCreatorAvatar: { width: 28, height: 28, borderRadius: 14, overflow: 'hidden' },
  planCreatorAvatarFallback: { backgroundColor: Scene.surface, alignItems: 'center' as const, justifyContent: 'center' as const },
  planCreatorInitial: { fontFamily: Fonts.sansBold, fontSize: FontSizes.caption, color: Scene.text },
  planCreatorName: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Scene.text },
  planVibePill: { backgroundColor: Scene.surface, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  // sentence-lowercase, no transforms (C16 + the lowercase law)
  planVibeText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.micro, color: Scene.supporting },
  planCardSpacer: { flex: 1 },
  planMenuBtn: { padding: 4, marginRight: 4 },
  planJoinBtn: { backgroundColor: Scene.action, paddingHorizontal: 16, paddingVertical: 6, borderRadius: 14 },
  planJoinBtnFull: { backgroundColor: Scene.surface },
  planJoinBtnTextFull: { color: Scene.supporting },
  planJoinBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Scene.actionText },
  planTitle: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Scene.text },
  planMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Scene.supporting },
  stickyBarWrap: {
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: Scene.lower,
    borderTopWidth: 1,
    borderTopColor: Scene.border,
  },
  stickyBar: { flexDirection: 'row', gap: 10 },
  priceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 },
  priceFrom: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Scene.text },
  priceFees: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Scene.supporting },
  // real scarcity wears the terracotta scarcity token (doc 78 law 1)
  priceScarcity: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Scene.text },
  linkedPlanRecovery: {gap:4, alignItems:'flex-start'},
  // TK-07: same filled-pill urgency convention as PlanCard's spotsLeftBadge
  scarcityBadge: {
    backgroundColor: EventAction.scarcity, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
  },
  scarcityBadgeText: { fontFamily: Fonts.sansBold, fontSize: 10, color: Colors.white, lineHeight: 14 },
  priceSoldOut: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Scene.supporting },
  // doc 78 law 8: the SINGLE accent belongs to the primary action (rsvp),
  // so find-people/chat drops to the secondary outline treatment - it was
  // wearing the loud terracotta while the real CTA sat quiet, backwards.
  postPlanButton: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: Scene.action,
    borderRadius: 8,
    minHeight: 48,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postPlanButtonText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Scene.text, textAlign: 'center' },
  // Scene handoff §15 "Event cancelled": a quiet disabled pill (same shape
  // as rsvpButton, tierBlocked's opacity-only convention) replaces every
  // attendance CTA, plus one calm contact line reusing the order-complete
  // screen's established support channel.
  cancelledRow: { flex: 1, gap: 8, alignItems: 'center' },
  cancelledPill: { alignSelf: 'stretch', backgroundColor: Scene.surface, borderColor: Scene.border },
  cancelledPillText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Scene.supporting },
  cancelledContactText: {
    fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Scene.text, textDecorationLine: 'underline',
  },
  // RSVP is the primary CTA: the one terracotta fill. going = the
  // documented gold confirmed-state (fill + hairline gold border +
  // brandDeep label), the house success family, never green.
  rsvpButton: {
    flex: 1,
    backgroundColor: Scene.action,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: Scene.action,
    minHeight: 48,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rsvpButtonGoing: {
    backgroundColor: Colors.goingConfirmedFill,
    borderColor: Colors.gold,
  },
  rsvpButtonText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Scene.actionText },
  rsvpButtonTextGoing: { color: Scene.text },
  putOnByRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  putOnByFace: { width: 20, height: 20, borderRadius: 10 },
  putOnByLogo: { width: 18, height: 18, borderRadius: 5 },
  putOnBy: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Scene.supporting,
  },
});
