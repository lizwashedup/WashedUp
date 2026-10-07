import { ScaledText as Text } from '../../components/ScaledText';
import { requestPlanNotificationPrompt } from '../../lib/planNotificationPrompt';
import ProfileButton from '../../components/ProfileButton';
import { MEMBER_REDESIGN_APPEARANCE_ENABLED } from '../../constants/MemberAppearance';
import { useYoursGrid } from '../../hooks/useYoursGrid';
import {usePlanInterest} from '../../hooks/usePlanInterest';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hapticLight, hapticMedium, hapticSuccess, hapticWarning } from '../../lib/haptics';
import { buildPlanShareContent } from '../../lib/sharePlan';
import { planAgeLabel } from '../../lib/planAgeLabel';
import { buildDuplicatePostParams } from '../../lib/duplicatePlan';
import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
    ArrowLeft,
    Calendar,
    ImagePlus,
    MapPin,
    MessageCircle,
    MoreHorizontal,
    Ticket,
    Users,
    X
} from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Dimensions,
    Keyboard,
    KeyboardAvoidingView,
    Linking,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    Share,
    StyleSheet,
    Switch,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { GooglePlacesAutocomplete, GooglePlacesAutocompleteRef } from 'react-native-google-places-autocomplete';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandedAlert } from '../../components/BrandedAlert';
import WashedUpCalendar from '../../components/calendar/WashedUpCalendar';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../../components/keyboard/KeyboardDoneBar';
import { ParticipationNotice } from '../../components/legal/ParticipationNotice';
import MiniProfileCard from '../../components/MiniProfileCard';
import { ReportModal } from '../../components/modals/ReportModal';
import { SharePlanModal } from '../../components/modals/SharePlanModal';
import { COMMUNITIES_ENABLED, YOURS_PAGE_ENABLED, GROUPS_ENABLED, COMMUNITY_CHAT_GROUPING_ENABLED } from '../../constants/FeatureFlags';
import { usePlanInvitation } from '../../hooks/usePlanInvitation';
import { usePlanWaitlist } from '../../hooks/usePlanWaitlist';
import { usePlanEdit } from '../../hooks/usePlanEdit';
import { useCirclePlanContext } from '../../hooks/useCirclePlanContext';
import { useObservedUser, type ObservedUser } from '../../hooks/useObservedUser';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { useFeedWishlist } from '../../hooks/useFeedWishlist';
import { getPlanLifecycle } from '../../lib/planLifecycle';
import { usePlanDeparture, type PlanDepartureAction, type PlanDepartureResult } from '../../hooks/usePlanDeparture';
import { PlanDepartureSheet } from '../../components/plans/PlanDepartureSheet';
import { usePlanJoin } from '../../hooks/usePlanJoin';
import { usePlanExceptionActions } from '../../hooks/usePlanExceptionActions';
import { PlanJoinSheet } from '../../components/plans/PlanJoinSheet';
import { PlanDetailOverview } from '../../components/plans/PlanDetailOverview';
// Lazy so a circle component's module-scope code (its StyleSheet) is never
// evaluated for non-circle users on this universally-reachable shipped screen.
// It only renders behind GROUPS_ENABLED && isCirclePlan (see below).
const CirclePlanCoordination = React.lazy(
  () => import('../../components/circles/plan/CirclePlanCoordination'),
);
import { COPY } from '../../components/yours/state/constants';
import PingAfterPlanModal from '../../components/yours/ping/PingAfterPlanModal';
import Colors, { AfterglowColors } from '../../constants/Colors';
import { capDisplayCount, MAX_GROUP, MIN_GROUP, FEATURED_MIN_CAPACITY, FEATURED_MAX_CAPACITY, FEATURED_DEFAULT_CAPACITY } from '../../constants/GroupLimits';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';
import { useBlock } from '../../hooks/useBlock';
import { checkContent } from '../../lib/contentFilter';
import { getParticipationNoticeStatus } from '../../lib/participationTerms';
import { ObsoletePlanParticipation, recordScopedPlanAssent } from '../../lib/planParticipationScope';
import { supabase } from '../../lib/supabase';
import { openUrl } from '../../lib/url';
import LinkifiedText from '../../components/LinkifiedText';
import { friendlyError } from '../../lib/friendlyError';
import { logError } from '../../lib/logger';
import { joinErrorSurface } from '../../lib/planJoinSafety';
import { buildPlanEditRulePatch, savedAgeLabel } from '../../lib/planEditRules';
import { resolveManagePlanImageUrl } from '../../lib/planPhotoEdit';
import {
  fetchWaitlistManager,
  waitlistAlertMessage,
} from '../../lib/waitlistExceptions';
import { WAITLIST_MANAGER_KEY } from '../../constants/QueryKeys';
import { isPlanPast } from '../../lib/planTime';
import { getLAWallParts, isValidLAWallTime, laWallTimeToUTC } from '../../lib/laDate';
import { showAddToCalendar } from '../../lib/addToCalendar';
// Lazy-load react-native-map-link so older production binaries (built before
// this dep was added) don't crash when this screen's module is imported.
// Mirrors the pattern in lib/addToCalendar.ts and components/VideoSplash.tsx.
let showLocation: typeof import('react-native-map-link').showLocation | null = null;
try { showLocation = require('react-native-map-link').showLocation; } catch {}
import { MapView, Marker } from '../../components/MapView';

// Google Maps key: shared env-first module with fallback (single source).
import { GOOGLE_MAPS_API_KEY } from '../../lib/googleMapsKey';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const HERO_HEIGHT = SCREEN_WIDTH * (9 / 16);

const MANAGE_CATEGORIES = [
  'Art', 'Business', 'Comedy', 'Film', 'Fitness',
  'Food', 'Gaming', 'Music', 'Nightlife', 'Outdoors',
  'Sports', 'Tech', 'Wellness', 'Other',
] as const;

// Manage-Plan description limit. Matches the composer's DESC_LIMIT (2000) so
// editing never silently truncates a description created at the higher cap.
const EDIT_DESC_LIMIT = 2000;
const EDIT_DESC_WARN_MARGIN = 200; // counter turns warn-colored within this many chars of the cap

const AGE_RANGES = ['All Ages', '21+', '20s', '30s', '40s', '50s', '60s', '70+'] as const;
type AgeRange = typeof AGE_RANGES[number];

const AGE_BUCKETS: Record<Exclude<AgeRange, 'All Ages'>, [number, number]> = {
  '21+': [21, 99],
  '20s': [20, 29],
  '30s': [30, 39],
  '40s': [40, 49],
  '50s': [50, 59],
  '60s': [60, 69],
  '70+': [70, 99],
};

function ageRangesToMinMax(ranges: AgeRange[]): { min: number | null; max: number | null } {
  if (ranges.length === 0 || ranges.includes('All Ages')) return { min: null, max: null };
  let min = 99, max = 0;
  for (const r of ranges) {
    const b = AGE_BUCKETS[r as Exclude<AgeRange, 'All Ages'>];
    if (b) {
      if (b[0] < min) min = b[0];
      if (b[1] > max) max = b[1];
    }
  }
  return { min, max };
}

function minMaxToAgeRanges(min: number | null, max: number | null): AgeRange[] {
  if (min === null && max === null) return ['All Ages'];
  const entries = Object.entries(AGE_BUCKETS) as [Exclude<AgeRange, 'All Ages'>, [number, number]][];
  for (const [range, [bMin, bMax]] of entries) {
    if (bMin === min && bMax === max) return [range];
  }
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [a, [aMin, aMax]] = entries[i];
      const [b, [bMin, bMax]] = entries[j];
      if (Math.min(aMin, bMin) === min && Math.max(aMax, bMax) === max) {
        return [a, b];
      }
    }
  }
  return []; // Saved bounds do not fit a preset; keep them until explicitly changed.
}

// ─── Date/time picker constants ───────────────────────────────────────────────
// Keep display values aligned with the shared creation controls.

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MINUTE_OPTIONS = ['00', '15', '30', '45'];
const PERIODS: ('AM' | 'PM')[] = ['AM', 'PM'];

function buildDatetime(
  month: number, day: number, year: number,
  hour: number, minute: string, period: 'AM' | 'PM',
): Date {
  let h = hour;
  if (period === 'PM' && h !== 12) h += 12;
  if (period === 'AM' && h === 12) h = 0;
  return laWallTimeToUTC(year, month, day, h, parseInt(minute, 10));
}

function displayPickerDate(month: number, day: number, year: number): string {
  return `${MONTHS[month]} ${day}, ${year}`;
}

function displayPickerTime(hour: number, minute: string, period: 'AM' | 'PM'): string {
  return `${hour}:${minute} ${period}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlanDetail {
  id: string;
  title: string;
  description: string | null;
  host_message: string | null;
  start_time: string;
  location_text: string | null;
  location_lat: number | null;
  location_lng: number | null;
  image_url: string | null;
  primary_vibe: string | null;
  gender_rule: string | null;
  max_invites: number | null;
  min_invites: number | null;
  target_age_min: number | null;
  target_age_max: number | null;
  end_time: string | null;
  drop_in: boolean;
  allow_duplicate: boolean;
  neighborhood: string | null;
  slug: string | null;
  status: string;
  creator_user_id: string;
  tickets_url: string | null;
  is_featured: boolean;
  featured_type: 'washedup_event' | 'birthday_party' | 'special_event' | null;
  explore_event_id: string | null;
  circle_id?: string | null;
  creator: {
    id: string;
    first_name_display: string | null;
    profile_photo_url: string | null;
    bio: string | null;
  } | null;
  member_count: number;
}

interface Member {
  id: string;
  user_id: string;
  first_name_display: string | null;
  profile_photo_url: string | null;
  joined_at: string;
  handle?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatFullDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Los_Angeles',
  });
}

function formatTime(dateString: string): string {
  return new Date(dateString).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Los_Angeles',
  });
}

function formatWhenShort(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowStart = new Date(todayStart.getTime() + 86400000);
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (dateStart.getTime() === todayStart.getTime()) return date.getHours() >= 17 ? 'Tonight' : 'Today';
  if (dateStart.getTime() === tomorrowStart.getTime()) return 'Tomorrow';
  return date.toLocaleDateString('en-US', { weekday: 'short' });
}

function buildCalendarUrl(title: string, startTime: string, endTime?: string | null, location?: string): string {
  const start = new Date(startTime);
  const end = endTime ? new Date(endTime) : new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${fmt(start)}/${fmt(end)}`,
    location: location || '',
    details: 'washedup plan, washedup.app',
  });
  return `https://calendar.google.com/calendar/event?${params.toString()}`;
}

function formatGenderLabel(gender_rule: string | null): string | null {
  if (!gender_rule || gender_rule === 'mixed') return null;
  if (gender_rule === 'women_only') return 'Women Only';
  if (gender_rule === 'men_only') return 'Men Only';
  if (gender_rule === 'nonbinary_only') return 'Nonbinary Only';
  return null;
}

function openDirections(locationText: string, coords?: { latitude: number; longitude: number } | null) {
  if (coords && showLocation) {
    showLocation({
      latitude: coords.latitude,
      longitude: coords.longitude,
      title: locationText,
      dialogTitle: 'Get Directions',
      dialogMessage: 'Choose your maps app',
      cancelText: 'Cancel',
    });
  } else {
    const encoded = encodeURIComponent(locationText);
    const url = Platform.OS === 'ios'
      ? `maps://?q=${encoded}`
      : `geo:0,0?q=${encoded}`;
    Linking.openURL(url).catch(() => {
      Linking.openURL(`https://maps.google.com/?q=${encoded}`);
    });
  }
}

// ─── Data Fetching ────────────────────────────────────────────────────────────

async function fetchPlanDetail(id: string): Promise<PlanDetail> {
  const { data, error } = await supabase
    .from('events')
    .select(`
      id, title, description, host_message, start_time, end_time, drop_in, allow_duplicate,
      location_text, location_lat, location_lng,
      image_url, primary_vibe, gender_rule,
      max_invites, min_invites, target_age_min, target_age_max,
      status, member_count, creator_user_id, tickets_url, neighborhood, slug, is_featured, featured_type,
      explore_event_id, circle_id
    `)
    .eq('id', id)
    .single();

  if (error) throw error;

  const row = data as any;

  // Fetch creator via profiles_public view (bypasses profiles RLS for other users)
  let creator: PlanDetail['creator'] = null;
  if (row.creator_user_id) {
    const { data: profileRow } = await supabase
      .from('profiles_public')
      .select('id, first_name_display, profile_photo_url, bio')
      .eq('id', row.creator_user_id)
      .maybeSingle();

    if (profileRow) {
      creator = {
        id: profileRow.id,
        first_name_display: profileRow.first_name_display ?? null,
        profile_photo_url: profileRow.profile_photo_url ?? null,
        bio: profileRow.bio ?? null,
      };
    }
  }

  return {
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    host_message: row.host_message ?? null,
    start_time: row.start_time,
    end_time: row.end_time ?? null,
    drop_in: row.drop_in ?? true,
    allow_duplicate: row.allow_duplicate ?? true,
    location_text: row.location_text ?? null,
    location_lat: row.location_lat ?? null,
    location_lng: row.location_lng ?? null,
    image_url: row.image_url ?? null,
    primary_vibe: row.primary_vibe ?? null,
    gender_rule: row.gender_rule ?? null,
    max_invites: row.max_invites ?? null,
    min_invites: row.min_invites ?? null,
    target_age_min: row.target_age_min ?? null,
    target_age_max: row.target_age_max ?? null,
    neighborhood: row.neighborhood ?? null,
    slug: row.slug ?? null,
    status: row.status,
    creator_user_id: row.creator_user_id ?? null,
    tickets_url: row.tickets_url ?? null,
    is_featured: row.is_featured ?? false,
    featured_type: (row.featured_type as 'washedup_event' | 'birthday_party' | null) ?? null,
    explore_event_id: row.explore_event_id ?? null,
    circle_id: row.circle_id,
    member_count: row.member_count ?? 0,
    creator,
  };
}

async function fetchMembers(planId: string): Promise<Member[]> {
  const { data: rpcData, error: rpcError } = await supabase
    .rpc('get_event_members_reveal', { p_event_id: planId });

  if (!rpcError && rpcData && Array.isArray(rpcData)) {
    return rpcData.map((row: any) => ({
      id: row.id,
      user_id: row.user_id,
      first_name_display: row.first_name ?? row.first_name_display ?? null,
      profile_photo_url: row.avatar_url ?? row.profile_photo_url ?? null,
      joined_at: row.joined_at ?? '',
      handle: row.handle ?? null,
    }));
  }

  // Fallback: get_event_members_reveal requires membership and throws for a
  // non-member viewer (most viewers of a plan they haven't joined yet), which
  // is how we land here. get_event_members_public has no membership gate by
  // design — see 20260824200000_get_event_members_public_reveal_for_nonmembers.sql.
  const { data: publicRows, error: publicError } = await supabase
    .rpc('get_event_members_public', { p_event_id: planId });

  if (publicError) throw publicError;
  if (!publicRows || publicRows.length === 0) return [];

  return publicRows.map((row: any) => ({
    id: row.id,
    user_id: row.user_id,
    first_name_display: row.first_name_display ?? null,
    profile_photo_url: row.profile_photo_url ?? null,
    joined_at: row.joined_at ?? '',
    handle: row.handle ?? null,
  }));
}

// ─── Member Avatar ────────────────────────────────────────────────────────────

const MemberAvatar = React.memo(({ member, onPress }: { member: Member; onPress?: () => void }) => (
  <TouchableOpacity style={legacyStyles.memberAvatarWrapper} onPress={onPress} activeOpacity={0.7}>
    {member.profile_photo_url ? (
      <Image
        source={{ uri: member.profile_photo_url }}
        style={legacyStyles.memberAvatar}
        contentFit="cover"
        transition={200}
      />
    ) : (
      <View style={[legacyStyles.memberAvatar, legacyStyles.memberAvatarPlaceholder]}>
        <Text style={legacyStyles.memberAvatarInitial}>
          {member.first_name_display?.[0]?.toUpperCase() ?? '?'}
        </Text>
      </View>
    )}
    <Text style={legacyStyles.memberAvatarName} numberOfLines={1}>
      {member.first_name_display ?? 'Member'}
    </Text>
  </TouchableOpacity>
));
MemberAvatar.displayName = 'MemberAvatar';

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function PlanDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const identity = useObservedUser();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  if (identity.isLoading || identity.error) return <SafeAreaView style={legacyStyles.container}>
    <Stack.Screen options={{ headerShown: false }} />
    <View style={legacyStyles.centered}>{identity.isLoading ? <ActivityIndicator color={Colors.terracotta} /> : <>
      <Text style={legacyStyles.errorText}>Couldn’t check your account.</Text>
      <TouchableOpacity style={{ minHeight: 44, justifyContent: 'center' }} onPress={() => void identity.retry()}><Text style={legacyStyles.linkText}>Try again</Text></TouchableOpacity>
      <TouchableOpacity style={{ minHeight: 44, justifyContent: 'center' }} onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/plans')}><Text style={legacyStyles.linkText}>{router.canGoBack() ? 'Go back' : 'Back to Plans'}</Text></TouchableOpacity>
    </>}</View>
  </SafeAreaView>;
  return <PlanDetailSession key={`${id}:${identity.viewerId}:${identity.epoch}`} id={id} identity={identity} />;
}

function PlanDetailSession({ id, identity }: { id: string; identity: ObservedUser }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const currentUserId = identity.viewerId ?? null;
  const peopleQuery = useYoursGrid(currentUserId, { userId: currentUserId ?? '', epoch: identity.epoch, isCurrent: identity.isCurrent });
  const visibleHandles = useMemo(() => {
    const handles: Record<string, string> = {};
    if (peopleQuery.isSuccess && !peopleQuery.isError && identity.isCurrent()) {
      for (const person of peopleQuery.data ?? []) if (person.handle) handles[person.user_id] = person.handle;
    }
    return handles;
  }, [peopleQuery.data, peopleQuery.isSuccess, peopleQuery.isError, identity]);

  const { fonts } = useAfterglowFonts(COMMUNITY_CHAT_GROUPING_ENABLED);
  const appearance = useMemo(() => MEMBER_REDESIGN_APPEARANCE_ENABLED ? { fonts } : undefined, [fonts]);
  const styles = useMemo(() => appearance ? detailAppearance(legacyStyles, fonts) : legacyStyles, [appearance, fonts]);
  const joinStyles = useMemo(() => appearance ? detailAppearance(legacyJoinStyles, fonts) : legacyJoinStyles, [appearance, fonts]);
  const manageStyles = useMemo(() => appearance ? manageAppearance(legacyManageStyles, fonts) : legacyManageStyles, [appearance, fonts]);
  const managePlacesStyles = useMemo(() => appearance ? detailAppearance(legacyManagePlacesStyles, fonts) : legacyManagePlacesStyles, [appearance, fonts]);
  const duplicateSheetStyles = useMemo(() => appearance ? detailAppearance(legacyDuplicateSheetStyles, fonts) : legacyDuplicateSheetStyles,[appearance,fonts]);
  const accent = appearance ? AfterglowColors.clay : Colors.terracotta;
  const ink = appearance ? AfterglowColors.ink : Colors.asphalt;
  const goBack = () => router.canGoBack() ? router.back() : router.replace('/(tabs)/plans');
  const wishlist = useFeedWishlist(currentUserId, () => {});
  const isWishlisted = wishlist.data?.includes(id) ?? false;
  const [mapCoords, setMapCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [joinModalVisible, setJoinModalVisible] = useState(false);
  const [joinMessage, setJoinMessage] = useState('');
  const [joinConfirmed, setJoinConfirmed] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [shareAfterJoinPending, setShareAfterJoinPending] = useState(false);
  const joinedNotification = useRef<{ userId: string; planId: string; isCurrent: () => boolean } | null>(null);
  const finishJoinNotifications = () => {
    const completed = joinedNotification.current;
    joinedNotification.current = null;
    if (completed) requestPlanNotificationPrompt({ userId: completed.userId, planId: completed.planId, reason: 'joined' }, completed.isCurrent);
  };
  const [pendingGreetingProblem, setPendingGreetingProblem] = useState<string | null>(null);
  const [noticePending, setNoticePending] = useState<
    { action: 'join'; message?: string; isCurrent: () => boolean } | { action: 'exception'; isCurrent: () => boolean } | null
  >(null);
  const noticePendingRef = useRef(noticePending); noticePendingRef.current = noticePending;
  const noticeAgreeLock = useRef<object | null>(null);
  if (noticeAgreeLock.current && noticeAgreeLock.current !== noticePending) noticeAgreeLock.current = null;
  type DismissalTransition = {
    source: 'join' | 'notice' | 'manage'; isCurrent: () => boolean; run: () => void;
    resolve: () => void; cancel: () => void;
  };
  const [modalTransition, setModalTransition] = useState<DismissalTransition | null>(null);
  const modalTransitionRef = useRef<DismissalTransition | null>(null);
  function afterPlanModalDismiss(source: DismissalTransition['source'], isCurrent: () => boolean, run: () => void = () => {}) {
    if (Platform.OS !== 'ios') { if (isCurrent()) run(); return Promise.resolve(); }
    return new Promise<void>((resolve, reject) => {
      if (!isCurrent()) { reject(new ObsoletePlanParticipation()); return; }
      modalTransitionRef.current?.cancel();
      const transition = { source, isCurrent, run, resolve, cancel: () => reject(new ObsoletePlanParticipation()) };
      modalTransitionRef.current = transition; setModalTransition(transition); setJoinPreparing(true);
    });
  }
  function finishPlanModalDismiss(source: DismissalTransition['source'], expected: DismissalTransition | null) {
    if (!expected || expected.source !== source || modalTransitionRef.current !== expected) return;
    modalTransitionRef.current = null; setModalTransition(null); setJoinPreparing(false);
    if (!expected.isCurrent()) { expected.cancel(); return; }
    try { expected.run(); expected.resolve(); } catch { expected.cancel(); }
  }
  useFocusEffect(useCallback(() => () => {
    modalTransitionRef.current?.cancel(); modalTransitionRef.current = null; setModalTransition(null); setJoinPreparing(false);
  }, []));
  const [showDuplicateSheet, setShowDuplicateSheet] = useState(false);
  const duplicateVisit = useRef<object | null>(null);
  const closeDuplicateSheet = () => {duplicateVisit.current=null;setShowDuplicateSheet(false);};
  useFocusEffect(useCallback(()=>()=>{duplicateVisit.current=null;setShowDuplicateSheet(false);},[]));
  const [ticketModalVisible, setTicketModalVisible] = useState(false);
  const [manageModalVisible, setManageModalVisible] = useState(false);
  const [departureVisit, setDepartureVisit] = useState<{ action: PlanDepartureAction; isCurrent: () => boolean } | null>(null);
  const departureVisitRef = useRef(departureVisit); departureVisitRef.current = departureVisit;
  const [departureError, setDepartureError] = useState<string | null>(null);
  const [departureResult, setDepartureResult] = useState<PlanDepartureResult | null>(null);

  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editCreatorMessage, setEditCreatorMessage] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editLocationLat, setEditLocationLat] = useState<number | null>(null);
  const [editLocationLng, setEditLocationLng] = useState<number | null>(null);
  const [editTicketUrl, setEditTicketUrl] = useState('');
  // Plan photo — mirrors PlanComposerV2's imageUrl/imageLoading pair
  const [editImageUrl, setEditImageUrl] = useState<string | null>(null);
  // Date / time editing keeps the shared calendar and direct-entry time sheet.
  const [editDateMonth, setEditDateMonth] = useState(0);
  const [editDateDay, setEditDateDay] = useState(1);
  const [editDateYear, setEditDateYear] = useState(new Date().getFullYear());
  const [editTimeHour, setEditTimeHour] = useState(7);
  const [editTimeMinute, setEditTimeMinute] = useState<string>('00');
  const [editTimePeriod, setEditTimePeriod] = useState<'AM' | 'PM'>('PM');
  const [showEditDatePicker, setShowEditDatePicker] = useState(false);
  const [showEditTimePicker, setShowEditTimePicker] = useState(false);
  const [tempEditMonth, setTempEditMonth] = useState(0);
  const [tempEditDay, setTempEditDay] = useState(1);
  const [tempEditYear, setTempEditYear] = useState(new Date().getFullYear());
  const [tempEditHour, setTempEditHour] = useState(7);
  const [tempEditMinute, setTempEditMinute] = useState<string>('00');
  const [tempEditPeriod, setTempEditPeriod] = useState<'AM' | 'PM'>('PM');
  const validTempEditTime = tempEditHour >= 1 && tempEditHour <= 12 &&
    /^\d{1,2}$/.test(tempEditMinute) && Number(tempEditMinute) <= 59;
  const managePlacesRef = React.useRef<GooglePlacesAutocompleteRef>(null);
  const [editCategory, setEditCategory] = useState<string | null>(null);
  const [editGenderRule, setEditGenderRule] = useState('mixed');
  const [editAgeRanges, setEditAgeRanges] = useState<AgeRange[]>([]);
  const [editGroupSize, setEditGroupSize] = useState(6);
  const edit = usePlanEdit({
    eventId: id, viewerId: currentUserId, isCurrent: identity.isCurrent,
    canEdit: () => !!plan && isCreator && contextReady && !isClosedPlan,
    onPhoto: setEditImageUrl,
    onCommitted: () => {
      void Promise.resolve(queryClient.invalidateQueries({ queryKey: ['events', 'detail', id, currentUserId, identity.epoch] })).catch(error => logError(error, 'plan.edit.refresh'));
    },
    onSaved: () => {
      hapticSuccess(); setManageModalVisible(false); edit.close();
      for (const queryKey of [['events', 'detail', id], ['events', 'feed'], ['my-plans'], ['feed-member-ids']]) {
        void Promise.resolve(queryClient.invalidateQueries({ queryKey })).catch(error => logError(error, 'plan.edit.refresh'));
      }
    },
  });
  const editSaving = edit.isSaving, editImageLoading = edit.isPhotoPending;
  const closeManageModal = () => {
    if (!edit.close()) return false;
    Keyboard.dismiss(); setManageModalVisible(false); setShowEditDatePicker(false); setShowEditTimePicker(false);
    return true;
  };
  useFocusEffect(useCallback(() => () => {
    setManageModalVisible(false); setShowEditDatePicker(false); setShowEditTimePicker(false);
  }, []));
  const [editOriginal, setEditOriginal] = useState<PlanDetail | null>(null);
  const [editAgeChanged, setEditAgeChanged] = useState(false);
  const [editTimeChanged, setEditTimeChanged] = useState(false);
  const [editGroupChanged, setEditGroupChanged] = useState(false);
  const [editFeaturedChanged, setEditFeaturedChanged] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ id: string; name: string } | null>(null);
  const [shareAfterJoinVisible, setShareAfterJoinVisible] = useState(false);
  const [pingPlanId, setPingPlanId] = useState<string | null>(null);
  const pendingNavRef = React.useRef<(() => void) | null>(null);
  const [brandedAlert, setBrandedAlert] = useState<{
    visible: boolean;
    title: string;
    message?: string;
    scrollMessage?: boolean;
    buttons?: { text: string; onPress?: () => void; style?: 'default' | 'cancel' | 'destructive' }[];
  }>({ visible: false, title: '' });
  const greetingRecoveryRef = useRef<object | null>(null);
  const closeBrandedAlert = () => {
    if (greetingRecoveryRef.current) finishJoinNotifications();
    greetingRecoveryRef.current = null;
    setBrandedAlert((alert) => ({ ...alert, visible: false }));
  };
  const [miniProfileUserId, setMiniProfileUserId] = useState<string | null>(null);
  const [featuredToggle, setFeaturedToggle] = useState(false);
  const [featuredType, setFeaturedType] = useState<'washedup_event' | 'birthday_party' | 'special_event'>('washedup_event');
  const [featuredCapacity, setFeaturedCapacity] = useState(FEATURED_DEFAULT_CAPACITY);
  const [featuredSaving, setFeaturedSaving] = useState(false);
  // A missing or invalid upload uses the existing branded Plan artwork.
  const [failedHeroUrl, setFailedHeroUrl] = useState<string | null>(null);

  const { blockUser } = useBlock();

  const viewerQuery = useQuery({
    queryKey: ['plan-viewer', currentUserId, identity.epoch], enabled: !!currentUserId,
    queryFn: async () => {
      const result = await supabase.from('profiles').select('gender, birthday, is_official_host').eq('id', currentUserId!).single();
      if (result.error) throw result.error;
      if (!result.data) throw new Error('Account details unavailable');
      return result.data;
    },
  });
  const userGender = viewerQuery.data?.gender ?? null;
  const isOfficialCreator = viewerQuery.data?.is_official_host === true;
  const userAge = useMemo(() => {
    const birthday = viewerQuery.data?.birthday;
    if (!birthday) return null;
    const [by, bm, bd] = birthday.split('-').map(Number), today = new Date();
    let age = today.getFullYear() - by;
    if (today.getMonth() + 1 < bm || (today.getMonth() + 1 === bm && today.getDate() < bd)) age--;
    return Number.isFinite(age) ? age : null;
  }, [viewerQuery.data?.birthday]);
  const planQuery = useQuery({
    queryKey: ['events', 'detail', id, currentUserId, identity.epoch],
    queryFn: () => fetchPlanDetail(id!), enabled: !!id, staleTime: 60_000,
  });
  const { data: plan, isLoading: planLoading, error: planError } = planQuery;
  const lifecycle = plan ? getPlanLifecycle({ status: plan.status, startTime: plan.start_time, endTime: plan.end_time }) : null;
  const isClosedPlan = lifecycle?.isClosed ?? true;
  const terminalStatus = lifecycle?.terminalStatus ?? null;
  const membersQuery = useQuery({
    queryKey: ['events', 'members', id, currentUserId, identity.epoch],
    queryFn: () => fetchMembers(id!), enabled: !!id, staleTime: 60_000,
  });
  const members = membersQuery.data ?? [];

  // Next Time! — creator-only: who's signaled they'd go next time on this plan?
  const creatorInterestQuery = useQuery({
    queryKey: ['events', 'creator-interest', id, currentUserId, identity.epoch],
    queryFn: async () => {
      if (!id) return [];
      const { data, error } = await supabase.rpc('get_event_interest_signals', { p_event_id: id });
      if (error) throw error;
      if (!Array.isArray(data) || data.some(row => !row || typeof row.signal_id !== 'string' || (row.interested_name !== null && typeof row.interested_name !== 'string') || (row.interested_photo_url !== null && typeof row.interested_photo_url !== 'string'))) throw new Error('Interest list unavailable');
      return data;
    },
    enabled: !!id && !!currentUserId && plan?.creator_user_id === currentUserId,
    staleTime: 60_000,
  });

  // Resolve map coordinates — use stored coords, or geocode from location_text
  useEffect(() => {
    if (!plan) return;
    let active = true;
    setMapCoords(null);

    if (plan.location_lat != null && plan.location_lng != null) {
      setMapCoords({ latitude: plan.location_lat, longitude: plan.location_lng });
      return;
    }

    if (!plan.location_text) return;

    // Plans live in LA (the city column is hardcoded), but a bare venue name
    // through the unbiased geocoder can land anywhere (the tour's Barnsdall
    // Art Park pin in San Jose). Anchor the query to LA and refuse results
    // outside the LA basin: no map beats a wrong-city map.
    Location.geocodeAsync(`${plan.location_text}, Los Angeles, CA`)
      .then((results) => {
        const hit = results.find(
          (r) => r.latitude > 33.2 && r.latitude < 34.9 && r.longitude > -119.1 && r.longitude < -117.2,
        );
        if (hit && active) {
          setMapCoords({ latitude: hit.latitude, longitude: hit.longitude });
        }
      })
      .catch(() => {
        // geocoding unavailable, map won't show
      });
    return () => { active = false; };
  }, [plan]);

  // Prefetch avatar images so they load faster when displayed
  useEffect(() => {
    const urls: string[] = [];
    if (plan?.creator?.profile_photo_url) urls.push(plan.creator.profile_photo_url);
    members.forEach((m) => { if (m.profile_photo_url) urls.push(m.profile_photo_url); });
    if (urls.length > 0) {
      Image.prefetch(urls).catch(() => {});
    }
  }, [plan?.creator?.profile_photo_url, members]);

  const waitlist = usePlanWaitlist({
    eventId:id,viewerId:currentUserId,epoch:identity.epoch,isCurrent:identity.isCurrent,
    canChange:()=>!isClosedPlan && !planError && contextReady && membersQuery.isSuccess && viewerQuery.isSuccess && !isMember && !isCreator && !isCirclePlan && effectiveIsEligible && effectiveIsFull,
  });
  const isOnWaitlist=!!waitlist.entry, waitlistLoading=waitlist.loading || waitlist.busy;
  const waitlistNotified=waitlist.ready && !waitlist.loading && waitlist.entry?.notified===true;
  const exceptionStatus=waitlist.ready && !waitlist.loading ? waitlist.entry?.exception_status ?? null : null;
  const exceptionExpiresAt=waitlist.entry?.exception_expires_at ?? null;
  const setExceptionStatus=waitlist.setExceptionStatus;

  const invitation=usePlanInvitation({eventId:id,viewerId:currentUserId,epoch:identity.epoch,isCurrent:identity.isCurrent,
    canRespond:()=>!isClosedPlan&&!planError&&contextReady&&membersQuery.isSuccess&&viewerQuery.isSuccess});
  const invitationCompletion=useRef<(()=>void)|null>(null);

  const isMember = members.some((m) => m.user_id === currentUserId);
  const isCreator = plan?.creator_user_id === currentUserId;

  // Does this plan have a live (non-archived) album? Gates the past-plan
  // "Add photos" entry so it appears only when there is actually an album to
  // add to. It never resurrects an archived one, and never drops the user into
  // an empty upload screen. An album row only exists for plans that have ended
  // (the server creates it post-end), so this is inherently end-time-aware.
  // RLS double-checks membership.
  const { data: hasLiveAlbum = false } = useQuery({
    queryKey: ['planAlbumExists', id, currentUserId, identity.epoch],
    queryFn: async () => {
      const { data } = await supabase
        .from('plan_albums')
        .select('id')
        .eq('event_id', id as string)
        .is('archived_at', null)
        .maybeSingle();
      return !!data;
    },
    enabled: !!id && !!plan && (isMember || isCreator),
    staleTime: 60_000,
  });

  const circleQuery = useCirclePlanContext(GROUPS_ENABLED ? id : null, {
    viewerId: identity.viewerId, epoch: identity.epoch, isCurrent: identity.isCurrent,
    event: plan ? { id: plan.id, circle_id: plan.circle_id } : undefined,
  });
  const circleCtx = GROUPS_ENABLED ? circleQuery.data : plan?.circle_id === null ? { is_circle_plan: false as const } : undefined;
  const contextReady = GROUPS_ENABLED ? circleQuery.isContextReady : plan?.circle_id === null;
  const isCirclePlan = !!plan?.circle_id || circleCtx?.is_circle_plan === true;
  const circleExplanation = plan?.circle_id && contextReady && !circleQuery.isError && !planError
    && circleCtx?.is_circle_plan === true && circleCtx.circle_id === plan.circle_id
    ? circleCtx.circle_visibility === 'open'
      ? 'A group of friends is opening their plan to new people. Joining this plan doesn’t add you to their circle.'
      : circleCtx.circle_visibility === 'circle_only' ? 'A plan for this circle’s members.' : undefined
    : undefined;
  const circleViewerIsMember = contextReady && circleCtx?.viewer_is_member === true;
  const circleName = circleCtx?.circle_name?.trim() || 'this circle';
  const confirmedCircleContext = useRef(circleCtx);
  if (contextReady && circleCtx) confirmedCircleContext.current = circleCtx;
  const conversation = confirmedCircleContext.current;
  const planChatPath = isCirclePlan && conversation?.has_own_chat === false && conversation.circle_id
    ? `/(tabs)/chats/circle/${conversation.circle_id}` : `/(tabs)/chats/${id}`;

  // Creator-only "Waitlist (N)" count. Shares WAITLIST_MANAGER_KEY with the
  // manager route so opening it is instant and the count refreshes when the
  // manager invalidates.
  const { data: waitlistManager } = useQuery({
    queryKey: WAITLIST_MANAGER_KEY(id ?? ''),
    queryFn: () => fetchWaitlistManager(id as string),
    enabled: !!id && !!plan && isCreator && contextReady && !isCirclePlan,
    staleTime: 30_000,
  });
  const waitingCount =
    waitlistManager?.rows.filter((r) => r.kind === 'waitlist').length ?? 0;

  // Waitlister exception-invite banner state.
  const inviteExpired = exceptionExpiresAt
    ? new Date(exceptionExpiresAt).getTime() <= Date.now()
    : false;
  // !isMember guard: exceptionStatus is local state set by an effect keyed on
  // [currentUserId, id] and does NOT re-run on query invalidation. If the user
  // accepts via the InboxModal (different screen) and returns here, members
  // refetches (isMember -> true) but exceptionStatus stays 'invited'. Without
  // this guard a stale "you're off the waitlist" banner would render over a
  // joined member and erroring on tap (not_on_waitlist).
  const hasActiveException =
    !isCreator && !isMember && exceptionStatus === 'invited' && !inviteExpired;
  const hasLapsedException =
    !isCreator && !isMember && exceptionStatus === 'invited' && inviteExpired;
  const exceptionHoursLeft = exceptionExpiresAt
    ? Math.max(
        0,
        Math.round((new Date(exceptionExpiresAt).getTime() - Date.now()) / 3600000),
      )
    : null;

  const exceptionActions = usePlanExceptionActions({
    eventId: id, viewerId: currentUserId, epoch: identity.epoch, isCurrent: identity.isCurrent,
    available: hasActiveException && !isClosedPlan && !planError, organizerUserId: plan?.creator_user_id ?? null,
    organizerName: plan?.creator?.first_name_display ?? 'Someone',
    onNotice: isCurrent => setNoticePending({ action: 'exception', isCurrent }),
    onNoticeComplete: isCurrent => {
      const dismissal = afterPlanModalDismiss('notice', isCurrent);
      setNoticePending(value => value?.action === 'exception' && value.isCurrent === isCurrent ? null : value);
      return dismissal;
    },
    onAccepted: () => {
      hapticSuccess();
      waitlist.clearAfterJoining();
      setExceptionStatus(null);
      queryClient.invalidateQueries({ queryKey: ['events', 'members', id] });
      queryClient.invalidateQueries({ queryKey: ['events', 'detail', id] });
      queryClient.invalidateQueries({ queryKey: ['events', 'feed'] });
      queryClient.invalidateQueries({ queryKey: ['my-plans'] });
      queryClient.invalidateQueries({ queryKey: ['feed-member-ids'] });
      queryClient.invalidateQueries({ queryKey: ['waitlisted-plans'] });
      queryClient.invalidateQueries({ queryKey: WAITLIST_MANAGER_KEY(id ?? '') });
      queryClient.invalidateQueries({ queryKey: ['inbox-count'] });
      router.replace(`/(tabs)/chats/${id}` as any);
    },
    onDeclined: () => {
      hapticLight();
      setExceptionStatus('declined');
      queryClient.invalidateQueries({ queryKey: WAITLIST_MANAGER_KEY(id ?? '') });
      queryClient.invalidateQueries({ queryKey: ['inbox-count'] });
    },
    onError: (error, kind) => {
      setBrandedAlert({
        visible: true,
        title: 'Hmm',
        message: waitlistAlertMessage(error, kind === 'accept' ? "We couldn't add you to the plan. Try again." : undefined),
      });
    },
  });
  const { acceptExceptionMutation, declineExceptionMutation } = exceptionActions;

  const isFeatured = plan?.is_featured ?? false;
  const isBirthdayParty = isFeatured && plan?.featured_type === 'birthday_party';
  const isSpecialEvent = isFeatured && plan?.featured_type === 'special_event';
  // Use actual member count when available — member_count can be out of sync
  const displayMemberCount = isCirclePlan ? (members.length > 0 ? members.length : plan?.member_count ?? 0) : members.length > 0 ? capDisplayCount(members.length, isFeatured) : capDisplayCount(plan?.member_count ?? 0, isFeatured);
  const totalCapacity = isFeatured
    ? (plan?.max_invites ?? 99) + 1
    : Math.min((plan?.max_invites ?? 7) + 1, MAX_GROUP);
  const isFull = plan ? displayMemberCount >= totalCapacity : false;
  const spotsLeft = plan ? Math.max(0, totalCapacity - displayMemberCount) : 0;
  const isPastPlan = plan ? isPlanPast(plan.start_time, plan.end_time) : false;

  // A confirmed cancelled source event can show a banner. A missing or
  // inaccessible row does not establish cancellation. The formed plan keeps
  // its own state and the group can still decide what to do.
  const { data: sourceEventCancelled = false } = useQuery({
    queryKey: ['plan-source-event-gone', id, currentUserId, identity.epoch],
    enabled: COMMUNITIES_ENABLED && !!id && !!plan && !isPastPlan,
    queryFn: async () => {
      const { data: row, error: sourceError } = await supabase
        .from('events')
        .select('explore_event_id')
        .eq('id', id!)
        .maybeSingle();
      if (sourceError) throw sourceError;
      if (!row?.explore_event_id) return false;
      const { data: ev, error: eventError } = await supabase
        .from('explore_events')
        .select('id, status')
        .eq('id', row.explore_event_id)
        .maybeSingle();
      if (eventError) throw eventError;
      return ev?.status === 'Cancelled';
    },
  });
  // Future interest does not use current attendance age/gender/capacity gates.
  const interestAvailable = !!plan && !!currentUserId && !isCreator && !isMember && !isClosedPlan &&
    !planError && planQuery.isSuccess && !planQuery.isFetching && membersQuery.isSuccess && !membersQuery.isFetching &&
    contextReady && (!isCirclePlan || circleCtx?.circle_visibility === 'open' || circleViewerIsMember);
  const interest = usePlanInterest({eventId:id,viewerId:currentUserId,epoch:identity.epoch,isCurrent:identity.isCurrent,
    canSend:()=>interestAvailable});
  const canShowInterestButton = interestAvailable && interest.ready && !interest.entry && !interest.error && !interest.phase;
  const interestAlreadySent = !!interest.entry;
  const creatorInterestList = creatorInterestQuery.data ?? [];
  const isHappeningNow =
    !!plan &&
    new Date(plan.start_time) <= new Date() &&
    new Date(plan.start_time) > new Date(Date.now() - 3 * 60 * 60 * 1000);

  const manageGenderOptions = useMemo(() => {
    const opts: { label: string; value: string }[] = [
      { label: 'Mixed', value: 'mixed' },
    ];
    if (userGender === 'woman') {
      opts.push({ label: 'Women Only', value: 'women_only' });
    } else if (userGender === 'man') {
      opts.push({ label: 'Men Only', value: 'men_only' });
    } else if (userGender === 'non_binary') {
      opts.push({ label: 'Nonbinary Only', value: 'nonbinary_only' });
    }
    return opts;
  }, [userGender]);

  const isEligible = useMemo(() => {
    if (!plan) return false;
    const gr = plan.gender_rule;
    if (gr === 'women_only' && userGender !== 'woman') return false;
    if (gr === 'men_only' && userGender !== 'man') return false;
    if (gr === 'nonbinary_only' && userGender !== 'non_binary') return false;
    if (userAge !== null) {
      if (plan.target_age_min !== null && userAge < plan.target_age_min) return false;
      if (plan.target_age_max !== null && userAge > plan.target_age_max) return false;
    }
    return true;
  }, [plan, userGender, userAge]);

  // Circle plans use stranger_cap (not max_invites) for capacity and let circle
  // MEMBERS bypass the gender/age eligibility gate (they already know the
  // group). Without these overrides the normal isFull (clamped to MAX_GROUP=8)
  // and isEligible gates would block a circle member from joining their own
  // circle's plan once 8 people are in, or on a single-gender plan.
  const circleMemberJoining = isCirclePlan && circleViewerIsMember;
  const effectiveIsEligible = circleMemberJoining ? true : isEligible;
  const effectiveIsFull = circleMemberJoining
    ? false
    : isCirclePlan
      ? (circleCtx?.viewer_stranger_spots_left ?? 0) <= 0
      : isFull;

  const joiningRef = useRef(false);
  const [joinPreparing, setJoinPreparing] = useState(false);
  const joinReady = !invitation.busy && invitation.attempt?.phase !== 'unknown' && !waitlist.busy && waitlist.intent?.phase !== 'unknown' && !isClosedPlan && !planError && contextReady && viewerQuery.isSuccess && membersQuery.isSuccess && !!currentUserId && !isMember && !isCreator && effectiveIsEligible && !(isCirclePlan && circleCtx?.circle_visibility === 'circle_only' && !circleViewerIsMember);
  const showGreetingProblem = (greeting: string) => {
    const recovery = {};
    const isCurrent = joinMutation.isCurrent;
    greetingRecoveryRef.current = recovery;
    setBrandedAlert({
      visible: true, title: 'You’re in', scrollMessage: true,
      message: `We couldn’t confirm your introduction in the chat. Check the conversation before sending it again.\n\nYour introduction:\n${greeting}`,
      buttons: [{ text: 'Open chat', onPress: () => {
        if (greetingRecoveryRef.current !== recovery || !isCurrent()) return;
        greetingRecoveryRef.current = null;
        setBrandedAlert((alert) => ({ ...alert, visible: false }));
        finishJoinNotifications();
        router.push(planChatPath as any);
      } }],
    });
  };
  const joinMutation = usePlanJoin({
    eventId: id, viewerId: currentUserId, epoch: identity.epoch, isCurrent: identity.isCurrent,
    ready: joinReady, startTime: plan?.start_time, endTime: plan?.end_time, status: plan?.status,
    circle: circleCtx, age: userAge, gender: userGender,
    onJoined: (result = {}) => {
      if (currentUserId && id && joinMutation.isCurrent()) {
        joinedNotification.current = { userId: currentUserId, planId: id, isCurrent: joinMutation.isCurrent };
      }
      hapticSuccess();
      const finishInvitation=invitationCompletion.current;invitationCompletion.current=null;
      finishInvitation?.();
      setJoinError(null);
      setJoinMessage(result.greetingUnconfirmed ?? '');
      setJoinConfirmed(false);
      queryClient.invalidateQueries({ queryKey: ['events', 'members', id] });
      queryClient.invalidateQueries({ queryKey: ['events', 'detail', id] });
      queryClient.invalidateQueries({ queryKey: ['events', 'feed'] });
      queryClient.invalidateQueries({ queryKey: ['my-plans'] });
      queryClient.invalidateQueries({ queryKey: ['feed-member-ids'] });
      queryClient.invalidateQueries({ queryKey: ['wishlists'] });
      queryClient.invalidateQueries({ queryKey: ['saved-plans'] });
      queryClient.invalidateQueries({ queryKey: ['waitlisted-plans'] });

      // Clear local waitlist state since the trigger deleted the row
      waitlist.clearAfterJoining();


      if (result.greetingUnconfirmed) {
        setShareAfterJoinPending(false);
        setShareAfterJoinVisible(false);
        if (Platform.OS === 'ios' && joinModalVisible) setPendingGreetingProblem(result.greetingUnconfirmed);
        else showGreetingProblem(result.greetingUnconfirmed);
        setJoinModalVisible(false);
        return;
      }
      if (Platform.OS === 'ios' && joinModalVisible) {
        // Native iOS cannot reliably replace one sibling Modal with another in
        // the same render. Open the share sheet only from the join sheet's
        // dismissal callback.
        setShareAfterJoinPending(true);
        setJoinModalVisible(false);
      } else {
        setJoinModalVisible(false);
        setShareAfterJoinVisible(true);
      }

    },
    onError: (message) => {
      if (joinErrorSurface(joinModalVisible) === 'inline') setJoinError(message);
      else setBrandedAlert({ visible: true, title: 'Joining this plan', message });
    },
  });

  useFocusEffect(useCallback(() => () => {
    invitationCompletion.current=null;
    joinedNotification.current = null;
    setJoinModalVisible(false); setNoticePending(null); setShareAfterJoinVisible(false);
    setShareAfterJoinPending(false); setTicketModalVisible(false); setPingPlanId(null);
    setPendingGreetingProblem(null);
    if (greetingRecoveryRef.current) {
      greetingRecoveryRef.current = null;
      setBrandedAlert((alert) => ({ ...alert, visible: false }));
    }
    pendingNavRef.current = null;
  }, []));

  // the creator name exactly as the byline renders it, for the notice and
  // its evidence snapshot (doc 13: show the organizer's display name)
  const noticeOrganizerName = plan?.creator?.first_name_display ?? 'Someone';

  // proposal 49: every path that ends in plan membership shows the
  // Independent Activity Notice first (Cowork ruling: entry route is
  // irrelevant to the evidence purpose) and proceeds only once the assent
  // is recorded (fail CLOSED after 49 is live; dormant before it). The
  // pending action is stashed while the sheet is up; the join modal
  // closes first because two sibling Modals cannot be visible at once on
  // iOS, and joinMessage survives in state.
  const requestJoin = useCallback(async (message?: string) => {
    if (joiningRef.current || modalTransitionRef.current || !joinReady || !joinMutation.isCurrent() || joinMutation.isPending || joinMutation.unconfirmed) return;
    if (!plan || isClosedPlan) {
      const showEnded = () => setBrandedAlert({ visible: true, title: 'This plan ended', message: 'You can still look back, but nobody new can join.' });
      if (Platform.OS === 'ios' && joinModalVisible) void afterPlanModalDismiss('join', joinMutation.isCurrent, showEnded).catch(() => {});
      else showEnded();
      setJoinModalVisible(false);
      return;
    }
    joiningRef.current = true; setJoinPreparing(true);
    try {
      const { needsAssent } = await getParticipationNoticeStatus();
      if (!joinMutation.isCurrent()) return;
      if (needsAssent) {
        const pending = { action: 'join' as const, message, isCurrent: joinMutation.isCurrent };
        if (Platform.OS === 'ios' && joinModalVisible) {
          void afterPlanModalDismiss('join', pending.isCurrent, () => setNoticePending(pending)).catch(() => {});
          setJoinModalVisible(false);
        } else { setJoinModalVisible(false); setNoticePending(pending); }
      }
      else joinMutation.join(message);
    } catch {
      if (joinMutation.isCurrent()) {
        const message = 'Couldn’t check the joining details. Try again.';
        if (joinErrorSurface(joinModalVisible) === 'inline') setJoinError(message);
        else setBrandedAlert({ visible: true, title: 'Joining this plan', message });
      }
    } finally {
      joiningRef.current = false;
      if (identity.isCurrent() && !modalTransitionRef.current) setJoinPreparing(false);
    }
  }, [joinMutation, plan, joinReady, identity, joinModalVisible, isClosedPlan]);

  const requestAcceptException = exceptionActions.requestAccept;

  const handleNoticeAgree = useCallback(async () => {
    const pending = noticePending;
    if (!id || !currentUserId || !pending || noticePendingRef.current !== pending || !pending.isCurrent() || !joinMutation.isCurrent() || noticeAgreeLock.current) return false;
    noticeAgreeLock.current = pending;
    try {
      if (pending.action === 'exception') return await exceptionActions.agree(pending.isCurrent);
      const scope = { viewerId: currentUserId, isCurrent: () => noticePendingRef.current === pending && pending.isCurrent() && joinMutation.isCurrent() };
      const ok = await recordScopedPlanAssent({
        listingType: 'plan', listingId: id,
        organizerUserId: plan?.creator_user_id ?? null,
        organizerName: noticeOrganizerName, action: 'join',
      }, scope);
      if (!ok || !scope.isCurrent()) return false;
      const dismissal = afterPlanModalDismiss('notice', () => pending.isCurrent() && joinMutation.isCurrent(), () => joinMutation.join(pending.message));
      setNoticePending(null);
      await dismissal;
      return true;
    } catch { return false; }
    finally { if (noticeAgreeLock.current === pending) noticeAgreeLock.current = null; }
  }, [id, currentUserId, plan?.creator_user_id, noticeOrganizerName, noticePending, joinMutation, exceptionActions]);

  const closeParticipationNotice = useCallback(() => {
    const pending = noticePending;
    if (!pending || noticePendingRef.current !== pending || noticeAgreeLock.current || !pending.isCurrent()) return;
    if (pending.action === 'exception' && !exceptionActions.cancelNotice(pending.isCurrent)) return;
    void afterPlanModalDismiss('notice', joinMutation.isCurrent).catch(() => {});
    noticePendingRef.current = null;
    setNoticePending(null);
  }, [noticePending, exceptionActions, joinMutation]);

  // ─── Leave ───────────────────────────────────────────────────────────────────

  const departure = usePlanDeparture({
    eventId: id, viewerId: currentUserId, epoch: identity.epoch, isCurrent: identity.isCurrent,
    ready: !!plan && !planError && contextReady && membersQuery.isSuccess && !isClosedPlan && !editSaving && !editImageLoading,
    canLeave: isMember && !isCreator, canCancel: isCreator,
    hasOwnChat: !isCirclePlan || circleCtx?.has_own_chat === true,
    onSuccess: result => { hapticWarning(); setDepartureError(null); setDepartureResult(result); },
    onError: message => setDepartureError(message),
    onUnconfirmed: () => setDepartureError(null),
  });
  const openDeparture = (action: PlanDepartureAction) => {
    if (!departure.isCurrent() || departure.isPending || departure.isChecking || departureVisitRef.current || editSaving || editImageLoading || edit.unknown || modalTransitionRef.current) return;
    if (isClosedPlan && !departure.unknownAction) return;
    if (action === 'cancel' ? !isCreator : !isMember || isCreator) return;
    const current = departure.isCurrent;
    const show = () => { if (!current()) return; setDepartureError(null); setDepartureResult(null); const visit = { action, isCurrent: current }; departureVisitRef.current = visit; setDepartureVisit(visit); };
    if (manageModalVisible && !edit.close()) return;
    if (manageModalVisible && Platform.OS === 'ios') {
      void afterPlanModalDismiss('manage', current, show).catch(() => {});
      setManageModalVisible(false);
    } else { setManageModalVisible(false); show(); }
  };
  useFocusEffect(useCallback(() => () => {
    departureVisitRef.current = null; setDepartureVisit(null); setDepartureError(null); setDepartureResult(null);
  }, []));

  const handleLeave = () => openDeparture('leave');

  // ─── Manage Plan ─────────────────────────────────────────────────────────────

  const openManageModal = () => {
    if (!plan || !contextReady || isClosedPlan || departure.isPending || departure.isChecking || departure.unknownAction || departureVisitRef.current) return;
    if (!edit.begin()) return;
    if (edit.unknown) { setManageModalVisible(true); return; }
    const isCurrentEdit = edit.capture();
    setEditOriginal({ ...plan });
    setEditAgeChanged(false); setEditTimeChanged(false); setEditGroupChanged(false); setEditFeaturedChanged(false);
    setFeaturedToggle(plan.is_featured);
    setFeaturedType(plan.featured_type ?? 'washedup_event');
    setFeaturedCapacity(plan.is_featured ? (plan.max_invites ?? 99) + 1 : FEATURED_DEFAULT_CAPACITY);
    setEditTitle(plan.title);
    setEditDescription(plan.description ?? '');
    setEditCreatorMessage(plan.host_message ?? '');
    setEditLocation(plan.location_text ?? '');
    setEditLocationLat(plan.location_lat ?? null);
    setEditLocationLng(plan.location_lng ?? null);
    setEditTicketUrl(plan.tickets_url ?? '');
    setEditImageUrl(plan.image_url ?? null);
    setTimeout(() => {
      if (isCurrentEdit()) managePlacesRef.current?.setAddressText(plan.location_text ?? '');
    }, 100);
    setEditCategory(plan.primary_vibe ? plan.primary_vibe.charAt(0).toUpperCase() + plan.primary_vibe.slice(1) : null);
    setEditGenderRule(plan.gender_rule ?? 'mixed');
    setEditAgeRanges(minMaxToAgeRanges(plan.target_age_min, plan.target_age_max));
    setEditGroupSize(plan.max_invites ?? 6);
    // Seed the date / time pickers from the existing plan.start_time
    const start = getLAWallParts(plan.start_time);
    if (!start) return;
    setEditDateMonth(start.m);
    setEditDateDay(start.d);
    setEditDateYear(start.y);
    const h24 = start.hour24;
    const period: 'AM' | 'PM' = h24 >= 12 ? 'PM' : 'AM';
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    setEditTimeHour(h12);
    // Preserve the exact published minute when opening Manage. A no-op edit
    // must never silently move a Plan to a quarter-hour boundary.
    setEditTimeMinute(String(start.minute).padStart(2, '0'));
    setEditTimePeriod(period);
    setManageModalVisible(true);
  };

  // Date picker open / confirm
  const openEditDatePicker = () => {
    if (!edit.canChange()) return;
    setTempEditMonth(editDateMonth);
    setTempEditDay(editDateDay);
    setTempEditYear(editDateYear);
    setShowEditDatePicker(true);
  };
  // Time picker open / confirm
  const openEditTimePicker = () => {
    if (!edit.canChange()) return;
    setTempEditHour(editTimeHour);
    setTempEditMinute(editTimeMinute);
    setTempEditPeriod(editTimePeriod);
    setShowEditTimePicker(true);
  };
  const confirmEditTime = () => {
    if (!edit.canChange() || !validTempEditTime) return;
    Keyboard.dismiss();
    setEditTimeChanged(true);
    setEditTimeHour(tempEditHour);
    setEditTimeMinute(tempEditMinute.padStart(2, '0'));
    setEditTimePeriod(tempEditPeriod);
    setShowEditTimePicker(false);
    hapticLight();
  };

  const toggleEditAgeRange = (range: AgeRange) => {
    if (!edit.canChange()) return;
    hapticLight(); setEditAgeChanged(true);
    if (range === 'All Ages') {
      setEditAgeRanges(['All Ages']);
      return;
    }
    setEditAgeRanges((prev) => {
      const filtered = prev.filter((r) => r !== 'All Ages');
      if (filtered.includes(range)) {
        return filtered.filter((r) => r !== range);
      }
      if (filtered.length >= 2) return filtered;
      return [...filtered, range];
    });
  };

  const pickEditImage = edit.pickPhoto;

  const handleSaveEdit = async () => {
    if (isClosedPlan || departure.isPending || departure.isChecking || departure.unknownAction || departureVisitRef.current) return;
    if (!plan || !editOriginal || !currentUserId || !edit.canChange() || !editTitle.trim()) return;

    const editHour24 = editTimeHour % 12 + (editTimePeriod === 'PM' ? 12 : 0);
    if (!isValidLAWallTime(editDateYear, editDateMonth, editDateDay, editHour24, Number(editTimeMinute))) {
      setBrandedAlert({ visible: true, title: 'Choose another time', message: 'That date or time does not exist in Los Angeles. Pick a different time.' });
      return;
    }

    const fieldsToCheck = [editTitle, editDescription, editCreatorMessage, editLocation].filter(Boolean).join(' ');
    const filter = checkContent(fieldsToCheck);
    if (!filter.ok) {
      setBrandedAlert({ visible: true, title: 'Content not allowed', message: filter.reason ?? 'Please revise your plan and try again.' });
      return;
    }

    try {
      const newStartTime = buildDatetime(
        editDateMonth, editDateDay, editDateYear,
        editTimeHour, editTimeMinute, editTimePeriod,
      );

      const editAgeBounds = ageRangesToMinMax(editAgeRanges);

      const updatePayload: Record<string, any> = {
        title: editTitle.trim(),
        description: editDescription.trim() || null,
        host_message: editCreatorMessage.trim() || null,
        location_text: editLocation.trim() || null,
        location_lat: editLocationLat,
        location_lng: editLocationLng,
        tickets_url: editTicketUrl.trim() || null,
        image_url: resolveManagePlanImageUrl(editImageUrl),
        primary_vibe: editCategory?.toLowerCase() ?? null,
        gender_rule: editGenderRule,
        ...buildPlanEditRulePatch(editOriginal, {
          timeChanged: editTimeChanged, proposedStart: newStartTime,
          ageChanged: editAgeChanged, ages: editAgeBounds,
          circlePlan: isCirclePlan, groupChanged: editGroupChanged, maxInvites: editGroupSize,
          officialCreator: isOfficialCreator, featuredChanged: editFeaturedChanged, featured: featuredToggle,
          featuredType, featuredCapacity,
        }),
      };

      await edit.save(updatePayload);
    } catch (e: any) {
      const rawMsg = e?.message ?? '';
      const msg = rawMsg.includes('events_host_message_length')
        ? 'Keep your message to 150 characters or fewer.'
        : friendlyError(e, 'Could not save changes.');
      setBrandedAlert({ visible: true, title: 'Error', message: msg });
    }
  };

  const handleCancelPlan = () => openDeparture('cancel');

  // ─── Wishlist ────────────────────────────────────────────────────────────────

  const toggleWishlist = () => wishlist.toggle(id, plan?.title ?? '', false);

  // ─── Waitlist ─────────────────────────────────────────────────────────────────

  const handleJoinWaitlist = () => {
    if (!waitlist.ready || waitlist.intent?.phase==='unknown') return waitlist.refresh();
    if (waitlist.intent?.phase==='failed') return waitlist.retry();
    return waitlist.change(!isOnWaitlist);
  };

  // ─── Share ───────────────────────────────────────────────────────────────────

  const handleShare = useCallback(async () => {
    if (!plan) return;
    hapticLight();
    try {
      const share = buildPlanShareContent({
        id: plan.id,
        title: plan.title,
        start_time: plan.start_time,
        location_text: plan.location_text,
        slug: plan.slug,
      });
      await Share.share({ message: `${share.message}\n${share.url}` });
    } catch {}
  }, [plan]);

  const handleReportMenu = useCallback(() => {
    if (isCreator || !plan?.creator) return;
    const creatorName = plan.creator?.first_name_display ?? 'Creator';
    setBrandedAlert({
      visible: true,
      title: 'Options',
      buttons: [
        {
          text: `Report ${creatorName}`,
          onPress: () => {
            setReportTarget({ id: plan.creator?.id ?? '', name: creatorName });
            setShowReport(true);
          },
        },
        {
          text: `Block ${creatorName}`,
          style: 'destructive',
          onPress: () => blockUser(plan.creator?.id ?? '', creatorName, () => router.back()),
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    });
  }, [isCreator, plan, blockUser]);

  // ─── Loading / Error ─────────────────────────────────────────────────────────

  if (planLoading) {
    return (
      <SafeAreaView style={styles.container} edges={appearance ? ['top'] : ['top', 'bottom']}>
        <Stack.Screen options={{ headerShown: false, gestureEnabled: true }} />
        <View style={[styles.header, { paddingTop: 8 }]}><TouchableOpacity onPress={goBack} accessibilityRole="button" accessibilityLabel={isCirclePlan || router.canGoBack() ? "Go back" : "Go back to plans"} style={styles.headerIconButton}><ArrowLeft size={20} color={ink}/></TouchableOpacity><ProfileButton compact/></View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (!plan) {
    return (
      <SafeAreaView style={styles.container} edges={appearance ? ['top'] : ['top', 'bottom']}>
        <Stack.Screen options={{ headerShown: false, gestureEnabled: true }} />
        <View style={[styles.header, { paddingTop: 8 }]}><TouchableOpacity onPress={goBack} accessibilityRole="button" accessibilityLabel={router.canGoBack() ? "Go back" : "Go back to plans"} style={styles.headerIconButton}><ArrowLeft size={20} color={ink}/></TouchableOpacity><ProfileButton compact/></View>
        <View style={styles.centered}>
          <Text style={styles.errorText}>Couldn’t load this plan.</Text>
          <TouchableOpacity style={{ minHeight: 44, justifyContent: 'center' }} onPress={() => void planQuery.refetch()}><Text style={styles.linkText}>Try again</Text></TouchableOpacity>
          <TouchableOpacity onPress={goBack} style={{ marginTop: 12 }}>
            <Text style={styles.linkText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const genderLabel = formatGenderLabel(plan.gender_rule);
  const ageLabel = isCirclePlan ? null : planAgeLabel(plan);

  // ─── Render ──────────────────────────────────────────────────────────────────

  const categoryTags = [
      plan.primary_vibe ? plan.primary_vibe.charAt(0).toUpperCase() + plan.primary_vibe.slice(1) : null,
    ].filter(Boolean);
  const isWomenOnly = plan.gender_rule === 'women_only';

  const groupSizeLabel = isFeatured ? (isBirthdayParty ? 'Birthday Party' : isSpecialEvent ? 'Special Event' : 'WashedUp Event') : totalCapacity <= 4 ? 'Small • intimate' : totalCapacity <= 6 ? 'Cozy' : 'Larger';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: true }} />

      {/* Custom Header */}
      <View style={[styles.header, { paddingTop: 8 }]}>
        <TouchableOpacity
          onPress={goBack}
          style={styles.backButton}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={isCirclePlan || router.canGoBack() ? "Go back" : "Go back to plans"}
        >
          <ArrowLeft size={20} color={ink} strokeWidth={2.5} />
          <Text style={styles.backButtonText}>{isCirclePlan || router.canGoBack() ? 'Back' : 'Plans'}</Text>
        </TouchableOpacity>
        <View style={styles.headerIcons}>
          <TouchableOpacity
            onPress={(e) => { e.stopPropagation(); handleShare(); }}
            style={styles.headerIconButton}
            accessibilityRole="button"
            accessibilityLabel="Share plan"
          >
            <Ionicons name="share-outline" size={22} color={ink} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={toggleWishlist}
            disabled={!wishlist.canWrite || wishlist.pending(id)}
            accessibilityState={{ disabled: !wishlist.canWrite || wishlist.pending(id), busy: wishlist.pending(id) }}
            style={styles.headerIconButton}
            accessibilityRole="button"
            accessibilityLabel={isWishlisted ? 'Remove from saved' : 'Save plan'}
          >
            <Ionicons
              name={isWishlisted ? 'bookmark' : 'bookmark-outline'}
              size={20}
              color={isWishlisted ? accent : (appearance ? AfterglowColors.muted : Colors.quoteText)}
            />
          </TouchableOpacity>
          {!isCreator && plan?.creator && (
            <TouchableOpacity
              onPress={handleReportMenu}
              style={styles.headerIconButton}
              accessibilityLabel="Report or block"
            >
              <MoreHorizontal size={20} color={ink} strokeWidth={2} />
            </TouchableOpacity>
          )}
          <ProfileButton compact/>
        </View>
      </View>

      {terminalStatus ? <View style={styles.cancelledEventBanner}><Text style={styles.exceptionBannerTitle}>{terminalStatus === 'cancelled' ? 'Plan cancelled' : 'Plan complete'}</Text></View> : null}
      {planError ? <View style={styles.cancelledEventBanner}>
        <Text style={styles.errorText}>Couldn’t refresh this plan. These are the last details we loaded.</Text>
        <TouchableOpacity accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }} onPress={() => void planQuery.refetch()}>
          <Text style={styles.linkText}>Try again</Text>
        </TouchableOpacity>
      </View> : null}
      {wishlist.isError || wishlist.feedback?.kind === 'error' ? <View style={styles.cancelledEventBanner}><Text style={styles.errorText}>{wishlist.isError ? 'Couldn’t load saved plans.' : 'Couldn’t update saved plans.'}</Text><TouchableOpacity style={{ minHeight: 44, justifyContent: 'center' }} onPress={() => wishlist.isError ? void wishlist.refetch() : wishlist.retry()}><Text style={styles.linkText}>Try again</Text></TouchableOpacity></View> : null}
      <ScrollView
        style={{ flex: 1 }}
        decelerationRate="normal"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {appearance ? <PlanDetailOverview fonts={fonts} plan={plan} visibleHandles={visibleHandles} mapCoords={mapCoords}
          date={formatFullDate(plan.start_time)} time={formatTime(plan.start_time)} audience={formatGenderLabel(plan.gender_rule)} ageLabel={ageLabel}
          featuredLabel={isFeatured ? (isBirthdayParty ? 'Birthday party' : isSpecialEvent ? 'Special event' : 'WashedUp event') : null}
          capacity={isClosedPlan ? terminalStatus === 'cancelled' ? 'Plan cancelled' : 'Plan ended' : !contextReady || !!planError || !membersQuery.isSuccess ? 'Checking availability…' : isMember ? 'You’re going' : isCirclePlan ? `${displayMemberCount} going` : isFeatured ? `${displayMemberCount} going` : spotsLeft === 0 ? 'Full' : `${spotsLeft} ${spotsLeft === 1 ? 'spot' : 'spots'} left`}
          capacityDetail={isClosedPlan ? undefined : !contextReady || !!planError || !membersQuery.isSuccess ? undefined : isMember ? `${displayMemberCount} going, including you` : isCirclePlan ? !contextReady ? 'Checking availability…' : circleViewerIsMember ? 'Circle members can join this plan.' : circleCtx?.circle_visibility === 'circle_only' ? 'For circle members' : `${circleCtx?.viewer_stranger_spots_left ?? 0} public ${circleCtx?.viewer_stranger_spots_left === 1 ? 'spot' : 'spots'} open` : isFeatured ? undefined : `Up to ${totalCapacity} people, including the creator`}
          circleLabel={isCirclePlan ? 'Made from a circle' : undefined}
          circleExplanation={circleExplanation}
          members={members} memberCount={plan.member_count} membersLoading={membersQuery.isLoading} membersError={membersQuery.isError}
          onRetryMembers={() => void membersQuery.refetch()} onProfile={setMiniProfileUserId}
          onCalendar={() => showAddToCalendar(plan.title, plan.start_time, plan.end_time, plan.location_text ?? undefined)}
          onMap={() => plan.location_text && openDirections(plan.location_text, mapCoords)} onTickets={() => plan.tickets_url && openUrl(plan.tickets_url)}
          sourceCancelled={sourceEventCancelled} happeningNow={isHappeningNow && !isClosedPlan} /> : <>
        <Image
          source={plan.image_url && failedHeroUrl !== plan.image_url
            ? { uri: plan.image_url }
            : require('../../assets/images/plan-placeholder.png')}
          accessibilityLabel={plan.image_url && failedHeroUrl !== plan.image_url ? 'Plan photo' : 'Plan placeholder'}
          style={styles.heroImage}
          contentFit="cover"
          transition={200}
          onError={() => setFailedHeroUrl(plan.image_url)}
        />

        {/* B. Plan Title */}
        <Text style={styles.planTitle}>{plan.title}</Text>
        {circleExplanation ? <Text style={styles.description}>{circleExplanation}</Text> : null}

        {COMMUNITIES_ENABLED && sourceEventCancelled && (
          /* LIZ COPY (taste call 7) */
          <View style={styles.cancelledEventBanner}>
            <Text style={styles.cancelledEventText}>
              the event this plan came from was cancelled. your plans are your own.
            </Text>
          </View>
        )}

        {/* C. Category Tags — featured pill ("washedup event" gold or "birthday party" pink) for featured plans, otherwise regular category */}
        {isFeatured ? (
          <View style={styles.categoryTagsRow}>
            <View
              style={[
                styles.featuredPill,
                isBirthdayParty && { backgroundColor: Colors.birthdayPinkTint15 },
                isSpecialEvent && { backgroundColor: Colors.specialEventMaroon },
              ]}
            >
              <Text
                style={[
                  styles.featuredPillText,
                  isBirthdayParty && { color: Colors.birthdayPink },
                  isSpecialEvent && { color: Colors.specialEventCream },
                ]}
              >
                {isBirthdayParty ? 'birthday party' : isSpecialEvent ? 'special event' : 'washedup event'}
              </Text>
            </View>
            {ageLabel ? <View style={styles.categoryTag}><Text accessibilityLabel={`Age range: ${ageLabel}`} style={styles.categoryTagText}>{ageLabel}</Text></View> : null}
          </View>
        ) : (categoryTags.length > 0 || isWomenOnly || ageLabel) ? (
          <View style={styles.categoryTagsRow}>
            {categoryTags.map((tag) => (
              <View key={tag} style={styles.categoryTag}>
                <Text style={styles.categoryTagText}>{tag}</Text>
              </View>
            ))}
            {ageLabel ? <View style={styles.categoryTag}><Text accessibilityLabel={`Age range: ${ageLabel}`} style={styles.categoryTagText}>{ageLabel}</Text></View> : null}
            {isWomenOnly && (
              <View style={styles.womenOnlyTag}>
                <Text style={styles.womenOnlyTagText}>Women Only</Text>
              </View>
            )}
          </View>
        ) : null}

        {/* C2. Birthday party subtitle — small italic context line below the pink tag. */}
        {isBirthdayParty && (
          <Text style={styles.birthdaySubtitle}>celebrating our OG washedup users</Text>
        )}

        {/* D. Description */}
        {plan.description && (
          <LinkifiedText text={plan.description} style={styles.description} />
        )}

        {/* F. Creator's Note */}
        {plan.host_message && (
          <View style={styles.noteBox}>
            <Text style={styles.noteLabel}>{`${plan.creator?.first_name_display ?? 'Creator'}’s note`}</Text>
            <LinkifiedText text={plan.host_message} style={styles.noteText} />
          </View>
        )}

        {/* E. Logistics Section */}
        <View style={styles.logisticsCard}>
          {isHappeningNow && (
            <View style={styles.happeningNowBanner}>
              <Text style={styles.happeningNowBannerText}>
                happening right now
              </Text>
              <Text style={styles.happeningNowBannerInvite}>
                still room for you
              </Text>
              <Text style={styles.happeningNowBannerSub}>
                started at {formatTime(plan.start_time).toLowerCase()}
              </Text>
            </View>
          )}
          <View style={styles.logisticsRow}>
            <Calendar size={18} color={accent} strokeWidth={2} />
            <View style={styles.logisticsContent}>
              <Text style={styles.logisticsMain}>
                {formatWhenShort(plan.start_time)} • {formatTime(plan.start_time)}
              </Text>
              <Text style={styles.logisticsSub}>{formatFullDate(plan.start_time)}</Text>
            </View>
            <TouchableOpacity
              onPress={() => showAddToCalendar(plan.title, plan.start_time, plan.end_time, plan.location_text ?? undefined)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.logisticsLink}>Add to Calendar</Text>
            </TouchableOpacity>
          </View>

          {plan.location_text && (
            <>
              <View style={[styles.logisticsRow, styles.logisticsRowBorder]}>
                <MapPin size={18} color={accent} strokeWidth={2} />
                <View style={styles.logisticsContent}>
                  <Text style={styles.logisticsMain}>{plan.neighborhood ? `${plan.location_text} · ${plan.neighborhood}` : plan.location_text}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => openDirections(plan.location_text!, mapCoords)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.logisticsLink}>Map →</Text>
                </TouchableOpacity>
              </View>
              {mapCoords && (
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => openDirections(plan.location_text!, mapCoords)}
                  style={styles.miniMapWrap}
                >
                  <MapView
                    style={styles.miniMap}
                    initialRegion={{
                      ...mapCoords,
                      latitudeDelta: 0.01,
                      longitudeDelta: 0.01,
                    }}
                    scrollEnabled={false}
                    zoomEnabled={false}
                    pitchEnabled={false}
                    rotateEnabled={false}
                    toolbarEnabled={false}
                    liteMode={Platform.OS === 'android'}
                    pointerEvents="none"
                  >
                    <Marker coordinate={mapCoords} />
                  </MapView>
                </TouchableOpacity>
              )}
            </>
          )}

          {plan.tickets_url && (
            <View style={[styles.logisticsRow, styles.logisticsRowBorder]}>
              <Ionicons name="ticket-outline" size={18} color={accent} />
              <View style={styles.logisticsContent}>
                <Text style={styles.logisticsMain}>Tickets required</Text>
              </View>
              <TouchableOpacity
                onPress={() => openUrl(plan.tickets_url!)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.logisticsLink}>Get Tickets →</Text>
              </TouchableOpacity>
            </View>
          )}

          {!isBirthdayParty && (
            <View style={[styles.logisticsRow, styles.logisticsRowBorder]}>
              <Users size={18} color={accent} strokeWidth={2} />
              <View style={styles.logisticsContent}>
                <Text style={styles.logisticsMain}>
                  {isCirclePlan
                    ? !contextReady || !!planError || !membersQuery.isSuccess ? 'Checking availability…' : `${displayMemberCount} going`
                    : isFeatured && !(isCreator && isOfficialCreator)
                    ? `${displayMemberCount} going`
                    : spotsLeft === 0
                      ? 'Full'
                      : `${spotsLeft} ${spotsLeft === 1 ? 'spot' : 'spots'} left`}
                </Text>
                {isCirclePlan ? contextReady && !planError && membersQuery.isSuccess && (
                  <Text style={styles.logisticsSub}>{circleViewerIsMember ? 'Circle members can join this plan.'
                    : circleCtx?.circle_visibility === 'circle_only' ? 'For circle members'
                    : circleCtx?.viewer_stranger_spots_left == null ? 'Checking public availability…'
                    : `${circleCtx.viewer_stranger_spots_left} public ${circleCtx.viewer_stranger_spots_left === 1 ? 'spot' : 'spots'} open`}</Text>
                ) : <Text style={styles.logisticsSub}>{groupSizeLabel}</Text>}
              </View>
            </View>
          )}
        </View>

        {/* F. Who's Going */}
        <Text style={styles.whoGoingTitle}>Who's going</Text>
        {members.length === 0 && (plan?.member_count ?? 0) > 0 ? (
          <Text style={styles.whoGoingFallback}>
            {plan?.member_count} {plan?.member_count === 1 ? 'person is' : 'people are'} going
          </Text>
        ) : (
          <View style={styles.memberAvatarRow}>
            {members.map((member) => (
              <MemberAvatar key={member.id} member={member} onPress={() => setMiniProfileUserId(member.user_id)} />
            ))}
          </View>
        )}

        </>}
        {/* F-2. Next Time! — interest signal button (non-creator, non-member, plan still upcoming) */}
        {canShowInterestButton && (
          <View>
          <Text style={[styles.ctaSub,{marginBottom:10}]}>Can’t make this one? Let {plan?.creator?.first_name_display ?? 'the creator'} know you’d join another time.</Text>
          <TouchableOpacity
            style={styles.interestButton}
            accessibilityRole="button"
            accessibilityLabel={`Tell ${plan?.creator?.first_name_display ?? 'them'} I would go next time`}
            onPress={() => {void interest.send();}}
            activeOpacity={0.8}
            disabled={interest.busy}
          >
            {interest.busy ? (
              <ActivityIndicator size="small" color={Colors.quoteText} />
            ) : (
              <>
                <Ionicons name="heart-outline" size={18} color={Colors.quoteText} />
                <Text numberOfLines={1} style={styles.interestButtonText}>Next time</Text>
              </>
            )}
          </TouchableOpacity>
          </View>
        )}
        {(interestAvailable || interest.phase === 'unknown' || interest.busy) && (interest.error || interest.phase) && (
          <View style={{marginBottom:16}}>
            <Text accessibilityLiveRegion="polite" style={[styles.ctaSub,{marginBottom:8}]}>{interest.busy ? 'Saving your interest…' : interest.error ?? 'Check your interest before trying again.'}</Text>
            {!interest.busy && <TouchableOpacity accessibilityRole="button" disabled={interest.loading} onPress={()=>{void interest.retry();}} style={styles.interestButton}>
              <Text numberOfLines={1} style={styles.interestButtonText}>{interest.loading ? 'Checking…' : interest.phase === 'unknown' ? 'Check interest' : 'Try again'}</Text>
            </TouchableOpacity>}
          </View>
        )}
        {interestAlreadySent && !isCreator && !isMember && (
          <View style={styles.interestSent}>
            <Ionicons name="checkmark-circle" size={18} color={Colors.quoteText} />
            <Text style={styles.interestSentText}>
              Interest saved
            </Text>
          </View>
        )}

        {isCreator && creatorInterestQuery.isError && <View style={styles.creatorInterestBlock}>
          <Text style={styles.ctaSub}>Couldn’t load who would go next time.</Text>
          <TouchableOpacity accessibilityRole="button" disabled={creatorInterestQuery.isFetching} onPress={()=>{void creatorInterestQuery.refetch();}}>
            <Text style={styles.interestButtonText}>Try again</Text>
          </TouchableOpacity>
        </View>}
        {/* F-3. Next Time! — creator-only "Would go next time" section */}
        {isCreator && creatorInterestList.length > 0 && (
          <View style={styles.creatorInterestBlock}>
            <Text style={styles.creatorInterestTitle}>Would go next time</Text>
            <View style={styles.memberAvatarRow}>
              {creatorInterestList.map((row: any) => (
                <View key={row.signal_id} style={styles.memberAvatarWrapper}>
                  {row.interested_photo_url ? (
                    <Image source={{ uri: row.interested_photo_url }} style={styles.memberAvatar} />
                  ) : (
                    <View style={[styles.memberAvatar, styles.memberAvatarPlaceholder]}>
                      <Text style={styles.memberAvatarInitial}>
                        {row.interested_name?.[0]?.toUpperCase() ?? '?'}
                      </Text>
                    </View>
                  )}
                  <Text style={styles.memberAvatarName} numberOfLines={1}>
                    {row.interested_name ?? 'Someone'}
                  </Text>
                </View>
              ))}
            </View>
            <Text style={styles.creatorInterestSub}>
              {creatorInterestList.length === 1
                ? '1 person wants to go next time'
                : `${creatorInterestList.length} people want to go next time`}
            </Text>
          </View>
        )}

        {/* H. CTA hints (button is in sticky bar) */}
        {!isCreator && !isMember && contextReady && isEligible && !isFull && !isCirclePlan && (
          <View style={styles.ctaBlock}>
            {!isFeatured && spotsLeft > 0 && spotsLeft <= 2 && (
              <Text style={styles.ctaInfo}>
                {spotsLeft} spot{spotsLeft === 1 ? '' : 's'} left
              </Text>
            )}
            <Text style={styles.ctaSub}>A chat opens the moment you join</Text>
          </View>
        )}

        {/* Circle-plan coordination: Start a chat / Open it up. The component
            renders only for a circle member viewing a circle_only plan. */}
        {GROUPS_ENABLED && contextReady && isCirclePlan && id && (
          <React.Suspense fallback={null}>
            <CirclePlanCoordination
              eventId={id}
              circleName={circleName}
              visibility={circleCtx?.circle_visibility}
              hasOwnChat={circleCtx?.has_own_chat}
              viewerIsMember={circleViewerIsMember}
              viewerIsCreator={isCreator}
            />
          </React.Suspense>
        )}
      </ScrollView>

      {/* ─── Sticky Bottom Bar ─────────────────────────────────────────────────── */}

      <View style={[styles.stickyBar, { paddingBottom: insets.bottom + 12 }]}>
        {(invitation.error||invitation.attempt||invitation.loading&&!invitation.ready) && <View style={{gap:8,marginBottom:12}}>
          <Text style={styles.exceptionBannerBody} accessibilityLiveRegion="polite">
            {isMember&&invitation.attempt?.reply==='accepted'?'You’re in this plan. ':''}{invitation.busy?'Saving your invitation reply…':invitation.loading?'Checking your invitation…':invitation.error}
          </Text>
          {!invitation.busy&&!invitation.loading&&<TouchableOpacity accessibilityRole="button" style={styles.waitlistButton}
            onPress={()=>{if(!invitation.ready||!invitation.attempt||invitation.attempt.phase==='unknown')void invitation.refresh();else void invitation.retry();}}>
            <Text numberOfLines={1} style={styles.waitlistButtonText}>{invitation.attempt?.phase==='unknown'?'Check reply':'Try again'}</Text>
          </TouchableOpacity>}
          {!invitation.busy&&!invitation.loading&&invitation.attempt?.phase==='failed'&&invitation.attempt.reply==='declined'&&
            <TouchableOpacity accessibilityRole="button" onPress={invitation.keepInvitation} style={{minHeight:44,justifyContent:'center',alignItems:'center'}}>
              <Text numberOfLines={1} style={styles.waitlistButtonText}>Keep invitation</Text>
            </TouchableOpacity>}
        </View>}

        {!currentUserId ? <TouchableOpacity style={styles.joinButton} onPress={() => router.push('/(auth)/login')}><Text style={styles.joinButtonText}>Sign in</Text></TouchableOpacity> : departure.unknownAction ? <View><Text style={styles.exceptionBannerTitle}>Check the result</Text><Text style={styles.exceptionBannerBody}>We haven’t confirmed the change yet.</Text><TouchableOpacity accessibilityRole="button" style={styles.joinButton} onPress={() => setDepartureVisit({ action: departure.unknownAction!, isCurrent: departure.isCurrent })}><Text style={styles.joinButtonText}>Check status</Text></TouchableOpacity></View> : joinMutation.unconfirmed && !isMember ? <View>
          <Text style={styles.exceptionBannerTitle}>Check your place</Text>
          <Text style={styles.exceptionBannerBody}>We haven’t received confirmation yet. Check who’s going before trying again.</Text>
          <TouchableOpacity style={styles.joinButton} onPress={() => { setJoinModalVisible(false); void membersQuery.refetch(); void planQuery.refetch(); }}><Text style={styles.joinButtonText}>Check plan</Text></TouchableOpacity>
        </View> : (!contextReady || (currentUserId && !viewerQuery.isSuccess) || !membersQuery.isSuccess) ? <View>
          <Text style={styles.exceptionBannerBody}>{circleQuery.isError || viewerQuery.isError || membersQuery.isError ? 'Couldn’t check the joining details.' : 'Checking the joining details…'}</Text>
          {circleQuery.isError || viewerQuery.isError || membersQuery.isError ? <TouchableOpacity style={styles.joinButton} onPress={() => { void circleQuery.refetch().catch(() => {}); void viewerQuery.refetch(); void membersQuery.refetch(); }}><Text style={styles.joinButtonText}>Try again</Text></TouchableOpacity> : <ActivityIndicator color={accent}/>}
        </View> : isCirclePlan && circleCtx?.circle_visibility === 'circle_only' && !circleViewerIsMember ? <Text style={styles.ineligibleText}>This plan is for circle members.</Text> : isClosedPlan && (isMember || isCreator) && currentUserId ? (
          <View style={styles.memberActions}>
            {hasLiveAlbum && terminalStatus !== 'cancelled' && (
              <TouchableOpacity
                style={styles.openChatButton}
                onPress={() => router.push(`/album/upload/${plan!.id}` as any)}
              >
                <Ionicons name="camera-outline" size={18} color={Colors.white} />
                <Text style={styles.openChatText}>Add photos</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.openChatButton}
              onPress={() => router.push(planChatPath as any)}
            >
              <MessageCircle size={18} color={Colors.white} strokeWidth={2} />
              <Text numberOfLines={1} style={styles.openChatText}>Open Chat</Text>
            </TouchableOpacity>
          </View>
        ) : isClosedPlan ? (
          <View style={styles.endedBar}>
            <Text style={styles.endedBarText}>{terminalStatus === 'cancelled' ? 'Plan cancelled' : 'Plan ended'}</Text>
          </View>
        ) : isCreator ? (
          <View>
            <View style={styles.memberActions}>
              <TouchableOpacity
                style={styles.manageButton}
                onPress={openManageModal}
              >
                <Text style={styles.manageButtonText}>Manage Plan</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.openChatButton}
                onPress={() => router.push(planChatPath as any)}
              >
                <MessageCircle size={18} color={Colors.white} strokeWidth={2} />
                <Text numberOfLines={1} style={styles.openChatText}>Open Chat</Text>
              </TouchableOpacity>
            </View>
            {!isCirclePlan && <TouchableOpacity
              style={styles.waitlistManageButton}
              onPress={() => router.push(`/waitlist/${plan.id}` as any)}
              activeOpacity={0.85}
            >
              <Text style={styles.waitlistManageButtonText}>
                {waitingCount > 0 ? `Waitlist (${waitingCount})` : 'Waitlist'}
              </Text>
            </TouchableOpacity>}
            <TouchableOpacity
              style={styles.creatorCancelLink}
              onPress={handleCancelPlan}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.creatorCancelLinkText}>Cancel this plan</Text>
            </TouchableOpacity>
          </View>
        ) : isMember ? (
          <View>
            <View style={styles.memberActions}>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Leave plan" style={styles.youreGoingBadge} onPress={handleLeave}>
                <Text numberOfLines={1} style={styles.youreGoingText}>Can't make it?</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.openChatButton}
                onPress={() => router.push(planChatPath as any)}
              >
                <MessageCircle size={18} color={Colors.white} strokeWidth={2} />
                <Text numberOfLines={1} style={styles.openChatText}>Open Chat</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : invitation.attempt?.reply === 'declined' ? null : waitlist.busy || waitlist.intent?.phase === 'unknown' ? (
          <View style={{gap:10}}>
            <Text style={styles.exceptionBannerBody} accessibilityLiveRegion="polite">
              {waitlist.busy ? 'Updating your waitlist…' : waitlist.error ?? 'Your waitlist change may have saved. Check before trying again.'}
            </Text>
            <TouchableOpacity accessibilityRole="button"
              accessibilityState={{disabled:waitlistLoading,busy:waitlistLoading}}
              style={styles.waitlistButton} disabled={waitlistLoading}
              onPress={()=>{void waitlist.refresh();}}>
              <Text numberOfLines={1} style={styles.waitlistButtonText}>{waitlistLoading ? 'Checking…' : 'Check waitlist'}</Text>
            </TouchableOpacity>
          </View>
        ) : hasActiveException ? (
          <View>
            <Text style={styles.exceptionBannerTitle}>You're off the waitlist!</Text>
            <Text style={styles.exceptionBannerBody}>
              The creator saved you a spot. Want in?
            </Text>
            {exceptionHoursLeft !== null && exceptionHoursLeft > 0 && (
              <Text style={styles.exceptionBannerExpiry}>
                {exceptionHoursLeft}h left to respond
              </Text>
            )}
            <View style={styles.exceptionBannerActions}>
              <TouchableOpacity
                style={styles.exceptionAcceptBtn}
                activeOpacity={0.85}
                disabled={acceptExceptionMutation.isPending || declineExceptionMutation.isPending}
                onPress={() => requestAcceptException()}
              >
                <Text style={styles.exceptionAcceptText}>Join the plan</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.exceptionDeclineBtn}
                activeOpacity={0.7}
                disabled={acceptExceptionMutation.isPending || declineExceptionMutation.isPending}
                onPress={() => declineExceptionMutation.mutate()}
              >
                <Text style={styles.exceptionDeclineText}>Not this time</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : hasLapsedException ? (
          <View>
            <Text style={styles.exceptionBannerTitle}>This invite expired</Text>
            <Text style={styles.exceptionBannerBody}>
              Your spot wasn't claimed in time. You're still on the waitlist if
              another spot opens up.
            </Text>
            <View style={styles.exceptionBannerActions}>
              <TouchableOpacity
                style={styles.exceptionDeclineBtn}
                activeOpacity={0.7}
                onPress={() => setExceptionStatus('expired')}
              >
                <Text style={styles.exceptionDeclineText}>Got it</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : !effectiveIsEligible ? (
          <View style={styles.ineligibleBar}>
            <Text style={styles.ineligibleText}>This plan isn't available for you</Text>
            <Text style={styles.ineligibleSub}>It's restricted by age or gender</Text>
          </View>
        ) : waitlistNotified ? (
          <TouchableOpacity
            style={styles.claimSpotButton}
            onPress={() => { hapticLight(); setJoinModalVisible(true); }}
            activeOpacity={0.85}
          >
            <Text style={styles.claimSpotText}>Claim Your Spot</Text>
          </TouchableOpacity>
        ) : isCirclePlan && effectiveIsFull ? (
          <View><Text style={styles.exceptionBannerTitle}>The public spots are full</Text><Text style={styles.exceptionBannerBody}>You can check back here for an opening.</Text></View>
        ) : effectiveIsFull ? (
          <View style={{gap:10}}>
            <Text style={styles.exceptionBannerBody} accessibilityLiveRegion="polite">
              {waitlist.error ?? (!waitlist.ready ? 'Checking your waitlist…' : isOnWaitlist ? 'You’re on the waitlist. A place isn’t reserved yet.' : 'Join the waitlist for an opening.')}
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityState={{disabled:waitlistLoading,busy:waitlistLoading}}
              style={[styles.waitlistButton,isOnWaitlist && styles.waitlistButtonActive]}
              disabled={waitlistLoading}
              onPress={()=>{
                if(waitlistLoading)return;
                if(waitlist.intent || isOnWaitlist) {void handleJoinWaitlist();return;}
                if(!waitlist.ready){void waitlist.refresh();return;}
                if(plan?.allow_duplicate===false){void waitlist.change(true);return;}
                hapticLight();duplicateVisit.current={};setShowDuplicateSheet(true);
              }}>
              <Text numberOfLines={1} style={[styles.waitlistButtonText,isOnWaitlist&&styles.waitlistButtonTextActive]}>
                {waitlistLoading ? 'Checking…' : waitlist.intent?.phase==='failed' ? 'Try again' : !waitlist.ready ? 'Try again' : isOnWaitlist ? 'Leave waitlist' : 'Join waitlist'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : invitation.invitation && !invitation.attempt ? (
          <View style={styles.inviteActions}>
            <TouchableOpacity accessibilityRole="button" style={styles.declineInviteButton}
              disabled={invitation.loading||invitation.busy||!invitation.ready}
              onPress={()=>{hapticLight();void invitation.decline();}} activeOpacity={0.85}>
              <Text numberOfLines={1} style={styles.declineInviteText}>Not this time</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" style={styles.acceptInviteButton}
              disabled={invitation.loading||invitation.busy||!invitation.ready||!joinReady}
              onPress={()=>{
                if(!joinReady||invitationCompletion.current)return;
                const complete=invitation.prepareAcceptance();if(!complete)return;
                invitationCompletion.current=complete;hapticMedium();
                if(isCirclePlan&&circleViewerIsMember)requestJoin(undefined);
                else setJoinModalVisible(true);
              }} activeOpacity={0.9}>
              <Text numberOfLines={1} style={styles.acceptInviteText}>Join the plan</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.joinButton}
            accessibilityRole="button"
            disabled={joinPreparing || joinMutation.isPending || !joinReady}
            accessibilityState={{ disabled: joinPreparing || joinMutation.isPending || !joinReady, busy: joinPreparing || joinMutation.isPending }}
            onPress={() => {
              hapticMedium();
              // Circle members bypass the "say hi" intro gate (they already know
              // the group): join directly, no greeting modal. Strangers on an
              // open circle plan keep the modal, exactly like a normal plan.
              if (isCirclePlan && circleViewerIsMember) {
                requestJoin(undefined);
              } else {
                setJoinError(null);
                setJoinModalVisible(true);
              }
            }}
            activeOpacity={0.9}
          >
            {joinPreparing || joinMutation.isPending ? <ActivityIndicator color={Colors.white} /> : <Text style={styles.joinButtonText}>Let's Go →</Text>}
          </TouchableOpacity>
        )}
      </View>

      {departureVisit ? <PlanDepartureSheet action={departureVisit.action} planTitle={plan.title} appearance={appearance}
        busy={departure.isPending || departure.isChecking} unknown={!!departure.unknownAction} error={departureError} result={departureResult}
        onConfirm={() => { if (departureVisitRef.current !== departureVisit || !departureVisit.isCurrent()) return; setDepartureError(null); if (departureVisit.action === 'leave') departure.leave(); else departure.cancel(); }}
        onCheck={() => { if (departureVisitRef.current === departureVisit && departureVisit.isCurrent()) { setDepartureError(null); void departure.checkResult(); } }}
        onClose={() => { if (departureVisitRef.current !== departureVisit || departure.isPending || departure.isChecking) return; departureVisitRef.current = null; setDepartureVisit(null); }}
        onDone={() => { if (departureVisitRef.current !== departureVisit || !departureVisit.isCurrent()) return; departureVisitRef.current = null; setDepartureVisit(null); router.replace('/(tabs)/plans'); }} /> : null}

      <PlanJoinSheet visible={joinModalVisible} planId={id} appearance={appearance}
        planTitle={plan.title} dateLabel={`${formatFullDate(plan.start_time)} at ${formatTime(plan.start_time)}`}
        message={joinMessage} confirmed={joinConfirmed} error={joinError} unconfirmed={joinMutation.unconfirmed}
        busy={joinPreparing || joinMutation.isPending} canJoin={joinReady}
        onMessage={(value) => { setJoinMessage(value); setJoinError(null); }} onConfirmed={setJoinConfirmed}
        onJoin={() => requestJoin(joinMessage)} onClose={() => {invitationCompletion.current=null;setJoinModalVisible(false);}}
        onCheck={async () => { setJoinModalVisible(false); await Promise.all([membersQuery.refetch(), planQuery.refetch()]); }}
        onDismiss={() => {
          if (modalTransition) { finishPlanModalDismiss('join', modalTransition); return; }
          if (pendingGreetingProblem && joinMutation.isCurrent()) {
            setPendingGreetingProblem(null); showGreetingProblem(pendingGreetingProblem);
          } else if (shareAfterJoinPending && joinMutation.isCurrent()) {
            setShareAfterJoinPending(false); setShareAfterJoinVisible(true);
          }
        }} />

      {/* "Don't want to wait?" bottom sheet — shown when user taps Join Waitlist
          on a full plan (only when they're not already on waitlist / not waitlistNotified). */}
      <Modal
        visible={showDuplicateSheet}
        transparent
        animationType="slide"
        onRequestClose={closeDuplicateSheet}
        statusBarTranslucent
      >
        <Pressable
          style={duplicateSheetStyles.overlay}
          onPress={closeDuplicateSheet}
          accessibilityRole="button"
          accessibilityLabel="close"
        >
          <Pressable style={[duplicateSheetStyles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 20 }]} onPress={() => {}}>
            <View style={duplicateSheetStyles.handle} />
            <Text style={duplicateSheetStyles.title}>Post your own</Text>
            <Text style={duplicateSheetStyles.body}>
              Make another plan, or join the waitlist for this one.
            </Text>
            <TouchableOpacity
              style={duplicateSheetStyles.primaryBtn}
              onPress={() => {
                if(!duplicateVisit.current)return;
                hapticLight();closeDuplicateSheet();
                // Let the modal start its slide-out before pushing the next
                // screen — otherwise on Android with statusBarTranslucent
                // there's a brief flash where the modal is mid-animation
                // while the new screen pushes in.
                const isCurrent = waitlist.capture();
                setTimeout(() => {
                  if (!isCurrent()) return;
                  router.push({
                    pathname: '/(tabs)/post',
                    params: buildDuplicatePostParams(plan, id),
                  });
                }, 150);
              }}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Post your own"
            >
              <Text style={duplicateSheetStyles.primaryBtnText}>Post your own</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={duplicateSheetStyles.secondaryBtn}
              onPress={() => {
                if(!duplicateVisit.current)return;
                hapticLight();closeDuplicateSheet();
                void waitlist.change(true);
              }}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Join waitlist"
            >
              <Text style={duplicateSheetStyles.secondaryBtnText} numberOfLines={1}>Join waitlist</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <SharePlanModal
        appearance={appearance}
        visible={shareAfterJoinVisible}
        onClose={() => {
          if (!joinMutation.isCurrent()) return;
          setShareAfterJoinVisible(false);
          const runRest = () => {
            if (plan?.tickets_url) {
              // Show the ticket prompt first; navigate to chat only after
              // the user dismisses it. Previously we navigated immediately
              // and fired the ticket modal 600ms later, which caused a
              // visible flash of "get your tickets" over the chat screen
              // transition on Android.
              setTicketModalVisible(true);
            } else {
              finishJoinNotifications(); router.push(planChatPath as any);
            }
          };
          if (YOURS_PAGE_ENABLED) {
            // Ping moment before chat / ticket prompt (spec: after join).
            pendingNavRef.current = runRest;
            setPingPlanId(id as string);
          } else {
            runRest();
          }
        }}
        planTitle={plan?.title || ''}
        planId={id as string}
        slug={plan?.slug}
        variant="joined"
      />

      {YOURS_PAGE_ENABLED && (
        <PingAfterPlanModal
          planId={pingPlanId}
          onDone={() => {
            if (!joinMutation.isCurrent()) return;
            const nav = pendingNavRef.current;
            pendingNavRef.current = null;
            setPingPlanId(null);
            nav?.();
          }}
        />
      )}

      {/* Ticket Prompt Modal — shown after joining a ticketed event */}
      <Modal visible={ticketModalVisible} transparent animationType="fade" onRequestClose={() => { setTicketModalVisible(false); finishJoinNotifications(); router.push(planChatPath as any); }} statusBarTranslucent>
        <Pressable style={joinStyles.overlay} onPress={() => { setTicketModalVisible(false); finishJoinNotifications(); router.push(planChatPath as any); }}>
          <Pressable style={ticketStyles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={ticketStyles.iconCircle}>
              <Ticket size={28} color={accent} strokeWidth={2} />
            </View>
            <Text style={ticketStyles.title}>This plan is ticketed!</Text>
            <Text style={ticketStyles.subtitle}>
              Make sure to grab your tickets so you're all set for the day.
            </Text>

            <TouchableOpacity
              style={ticketStyles.primaryBtn}
              onPress={() => {
                setTicketModalVisible(false);
                if (plan?.tickets_url) openUrl(plan.tickets_url);
                finishJoinNotifications(); router.push(planChatPath as any);
              }}
              activeOpacity={0.85}
            >
              <Text style={ticketStyles.primaryBtnText}>Get Tickets Now</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={ticketStyles.secondaryBtn}
              onPress={() => {
                setTicketModalVisible(false);
                finishJoinNotifications(); router.push(planChatPath as any);
              }}
              activeOpacity={0.7}
            >
              <Text style={ticketStyles.secondaryBtnText}>I'll remember</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Manage Plan Modal */}
      <Modal visible={manageModalVisible} onDismiss={() => finishPlanModalDismiss('manage', modalTransition)} transparent animationType="slide" onRequestClose={closeManageModal} statusBarTranslucent>
        <KeyboardAvoidingView style={manageStyles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={manageStyles.sheet}>
            <View style={manageStyles.headerRow}>
              <Text style={manageStyles.title}>Manage Plan</Text>
              <TouchableOpacity style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }} accessibilityRole="button" accessibilityLabel="Close editor" disabled={edit.isBusy} onPress={closeManageModal} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Text style={manageStyles.closeX}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              decelerationRate="normal"
              showsVerticalScrollIndicator={true}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentContainerStyle={{
                // Android edge-to-edge: Modal renders full-screen behind
                // the nav/gesture bar, so the ScrollView needs explicit
                // insets.bottom padding or the last item (Cancel This Plan)
                // ends up clipped by the system bar. iOS unchanged.
                paddingBottom: 24 + (Platform.OS === 'android' ? insets.bottom : 0),
              }}
              scrollIndicatorInsets={{ right: 2 }}
            >
<View pointerEvents={edit.isBusy || edit.unknown ? "none" : "auto"}>
              {/* Title */}
              <Text style={manageStyles.label}>Title</Text>
              <TextInput
                editable={!edit.isBusy && !edit.unknown}
                style={manageStyles.input}
                accessibilityLabel="Plan title"
                value={editTitle}
                onChangeText={setEditTitle}
                maxLength={80}
                placeholder="Plan title"
                placeholderTextColor={Colors.textLight}
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
                inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
              />

              {/* Plan photo */}
              <Text style={manageStyles.label}>Plan photo</Text>
              <View style={manageStyles.photoRow}>
                {editImageUrl ? (
                  <View style={manageStyles.photoThumbWrap}>
                    <Image source={{ uri: editImageUrl }} style={manageStyles.photoThumb} contentFit="cover" />
                    {editImageLoading ? (
                      <View style={manageStyles.photoThumbOverlay}><ActivityIndicator color={Colors.white} /></View>
                    ) : (
                      <TouchableOpacity accessibilityRole="button" style={manageStyles.photoRemove} accessibilityLabel="Remove photo" disabled={edit.isBusy || edit.unknown} onPress={() => { if (edit.canChange()) { hapticLight(); setEditImageUrl(null); } }} hitSlop={8}>
                        <X size={13} color={Colors.white} strokeWidth={2.5} />
                      </TouchableOpacity>
                    )}
                  </View>
                ) : (
                  <TouchableOpacity accessibilityRole="button" style={manageStyles.photoAdd} disabled={edit.isBusy || edit.unknown} onPress={pickEditImage} activeOpacity={0.7}>
                    <ImagePlus size={15} color={Colors.secondary} strokeWidth={2} />
                    <Text style={manageStyles.photoAddText} numberOfLines={1}>Add photo</Text>
                  </TouchableOpacity>
                )}
                {editImageUrl && <TouchableOpacity accessibilityRole="button" disabled={edit.isBusy || edit.unknown} onPress={pickEditImage} style={manageStyles.photoAdd}>
                  <Text style={manageStyles.photoAddText} numberOfLines={1}>Change photo</Text>
                </TouchableOpacity>}
                {editImageLoading && <Text accessibilityLiveRegion="polite" style={manageStyles.hint}>Adding photo…</Text>}
              </View>

              {/* Date & time */}
              <Text style={manageStyles.label}>Date & time</Text>
              <View style={manageStyles.dateTimeRow}>
                <TouchableOpacity accessibilityRole="button"
                  disabled={edit.isBusy || edit.unknown}
                style={[manageStyles.input, manageStyles.dateTimeBtn]}
                  onPress={() => { hapticLight(); openEditDatePicker(); }}
                  activeOpacity={0.85}
                >
                  <Text numberOfLines={1} adjustsFontSizeToFit style={manageStyles.dateTimeBtnText}>
                    {new Date(editDateYear, editDateMonth, editDateDay).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity accessibilityRole="button"
                  disabled={edit.isBusy || edit.unknown}
                style={[manageStyles.input, manageStyles.dateTimeBtn, { marginLeft: 8 }]}
                  onPress={() => { hapticLight(); openEditTimePicker(); }}
                  activeOpacity={0.85}
                >
                  <Text numberOfLines={1} adjustsFontSizeToFit style={manageStyles.dateTimeBtnText}>
                    {displayPickerTime(editTimeHour, editTimeMinute, editTimePeriod)}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Description */}
              <View style={manageStyles.descLabelRow}>
                <Text style={[manageStyles.label, { marginTop: 0, marginBottom: 0 }]}>Plan description</Text>
                <Text
                  style={[
                    manageStyles.charCounter,
                    editDescription.length >= EDIT_DESC_LIMIT - EDIT_DESC_WARN_MARGIN && manageStyles.charCounterWarn,
                  ]}
                >
                  {editDescription.length}/{EDIT_DESC_LIMIT}
                </Text>
              </View>
              <TextInput
                editable={!edit.isBusy && !edit.unknown}
                style={[manageStyles.input, manageStyles.textArea]}
                accessibilityLabel="Plan description"
                value={editDescription}
                onChangeText={setEditDescription}
                multiline
                maxLength={EDIT_DESC_LIMIT}
                placeholder="What's the plan? Dress code, what to expect..."
                placeholderTextColor={Colors.textLight}
                inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
              />

              {/* Creator note */}
              <Text style={manageStyles.label}>Your message</Text>
              <TextInput
                editable={!edit.isBusy && !edit.unknown}
                style={[manageStyles.input, manageStyles.creatorMessageInput]}
                accessibilityLabel="Your message"
                value={editCreatorMessage}
                onChangeText={setEditCreatorMessage}
                multiline
                maxLength={150}
                placeholder="A personal note to people joining"
                placeholderTextColor={Colors.textLight}
                inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
              />
              <Text style={manageStyles.hint}>Up to 150 characters</Text>

              {/* Location */}
              <Text style={manageStyles.label}>Location</Text>
              <View style={{ zIndex: 10, elevation: 10 }}>
                <GooglePlacesAutocomplete
                  ref={managePlacesRef}
                  placeholder="Venue or neighborhood"
                  fetchDetails
                  disableScroll={true}
                  onPress={(data, details) => {
                    if (!edit.canChange()) return;
                    const lat = details?.geometry?.location?.lat ?? null;
                    const lng = details?.geometry?.location?.lng ?? null;
                    const name = data.structured_formatting?.main_text ?? data.description;
                    setEditLocation(name || data.description);
                    setEditLocationLat(lat);
                    setEditLocationLng(lng);
                    hapticLight();
                  }}
                  query={{
                    key: GOOGLE_MAPS_API_KEY,
                    language: 'en',
                    components: 'country:us',
                    location: '34.0522,-118.2437',
                    radius: '50000',
                  }}
                  styles={managePlacesStyles}
                  textInputProps={{
                    accessibilityLabel: "Location",
                    editable: !edit.isBusy && !edit.unknown,
                    onChangeText: (text: string) => {
                      if (!edit.canChange()) return;
                      setEditLocation(text); setEditLocationLat(null); setEditLocationLng(null);
                    },
                    placeholderTextColor: Colors.textLight,
                  }}
                  enablePoweredByContainer={false}
                  debounce={300}
                  keepResultsAfterBlur={false}
                  nearbyPlacesAPI="GooglePlacesSearch"
                />
              </View>

              {/* Ticket link */}
              <Text style={manageStyles.label}>Ticket link</Text>
              <TextInput
                editable={!edit.isBusy && !edit.unknown}
                style={manageStyles.input}
                accessibilityLabel="Ticket link"
                value={editTicketUrl}
                onChangeText={setEditTicketUrl}
                placeholder="https://..."
                placeholderTextColor={Colors.textLight}
                autoCapitalize="none"
                keyboardType="url"
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
                inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
              />

              {/* Category */}
              <Text style={manageStyles.label}>Category</Text>
              <View style={manageStyles.pillWrap}>
                {MANAGE_CATEGORIES.map((cat) => {
                  const isSelected = editCategory === cat;
                  return (
                    <TouchableOpacity accessibilityRole="button"
                      key={cat}
                      accessibilityState={{ selected: isSelected, disabled: edit.isBusy || edit.unknown }}
                      disabled={edit.isBusy || edit.unknown}
                      style={[manageStyles.pill, isSelected && manageStyles.pillSelected]}
                      onPress={() => {
                        hapticLight();
                        setEditCategory(cat);
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={[manageStyles.pillText, isSelected && manageStyles.pillTextSelected]}>{cat}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Who can join */}
              <Text style={manageStyles.label}>Who can join</Text>
              <View style={manageStyles.genderRow}>
                {manageGenderOptions.map((opt) => {
                  const isSelected = editGenderRule === opt.value;
                  return (
                    <TouchableOpacity accessibilityRole="button"
                      key={opt.value}
                      accessibilityState={{ selected: isSelected, disabled: edit.isBusy || edit.unknown }}
                      disabled={edit.isBusy || edit.unknown}
                      style={[manageStyles.genderPill, isSelected && manageStyles.pillSelected]}
                      onPress={() => {
                        hapticLight();
                        setEditGenderRule(opt.value);
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={[manageStyles.pillText, isSelected && manageStyles.pillTextSelected]}>{opt.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Age range */}
              <Text style={manageStyles.label}>Age range</Text>
              <View style={manageStyles.pillWrap}>
                {AGE_RANGES.map((range) => {
                  const isSelected = editAgeRanges.includes(range);
                  return (
                    <TouchableOpacity accessibilityRole="button"
                      key={range}
                      accessibilityState={{ selected: isSelected, disabled: edit.isBusy || edit.unknown }}
                      disabled={edit.isBusy || edit.unknown}
                      style={[manageStyles.pill, isSelected && manageStyles.pillSelected]}
                      onPress={() => toggleEditAgeRange(range)}
                      activeOpacity={0.8}
                    >
                      <Text style={[manageStyles.pillText, isSelected && manageStyles.pillTextSelected]}>{range}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={manageStyles.hint}>{!editAgeChanged && editAgeRanges.length === 0 && editOriginal ? `${savedAgeLabel(editOriginal.target_age_min, editOriginal.target_age_max)}. Kept unless you choose a range.` : 'Select up to 2 ranges, or All Ages'}</Text>

              {/* Ordinary capacity does not describe a Circle’s outsider allowance. */}
              {isCirclePlan ? <><Text style={manageStyles.label}>Circle plan</Text><Text style={manageStyles.hint}>Circle members aren’t included in the public spot limit. Your Circle’s existing joining settings stay the same.</Text></> : !featuredToggle ? <>
              <Text style={manageStyles.label}>How many to invite</Text>
              <View style={manageStyles.stepperRow}>
                <TouchableOpacity accessibilityRole="button"
                  style={[manageStyles.stepperBtn, editGroupSize <= (MIN_GROUP - 1) && manageStyles.stepperBtnDisabled]}
                  onPress={() => {
                    if (editGroupSize > (MIN_GROUP - 1)) {
                      hapticLight();
                      setEditGroupChanged(true); setEditGroupSize((g) => g - 1);
                    }
                  }}
                  accessibilityLabel="Fewer people"
                  disabled={edit.isBusy || edit.unknown || editGroupSize <= (MIN_GROUP - 1)}
                >
                  <Text style={manageStyles.stepperBtnText}>−</Text>
                </TouchableOpacity>
                <View style={manageStyles.stepperValue}>
                  <Text style={manageStyles.stepperValueText}>{editGroupSize + 1}</Text>
                  <Text style={manageStyles.stepperValueSub}>people total</Text>
                </View>
                <TouchableOpacity accessibilityRole="button"
                  style={[manageStyles.stepperBtn, editGroupSize >= (MAX_GROUP - 1) && manageStyles.stepperBtnDisabled]}
                  onPress={() => {
                    if (editGroupSize < (MAX_GROUP - 1)) {
                      hapticLight();
                      setEditGroupChanged(true); setEditGroupSize((g) => g + 1);
                    }
                  }}
                  accessibilityLabel="More people"
                  disabled={edit.isBusy || edit.unknown || editGroupSize >= (MAX_GROUP - 1)}
                >
                  <Text style={manageStyles.stepperBtnText}>+</Text>
                </TouchableOpacity>
              </View>
              <Text style={manageStyles.stepperValueSub}>including you</Text></> : null}

              {/* Featured Event toggle — official creators only */}
              {isCreator && isOfficialCreator && !isCirclePlan && (
                <View style={manageStyles.featuredSection}>
                  <View style={manageStyles.featuredRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={manageStyles.label}>Feature this Plan</Text>
                      <Text style={manageStyles.hint}>Allows custom capacity (50 to 500)</Text>
                    </View>
                    <Switch
                      accessibilityLabel="Feature this plan"
                      disabled={edit.isBusy || edit.unknown}                      value={featuredToggle}
                      onValueChange={(val) => {
                        if (!edit.canChange()) return;
                        hapticLight();
                        setEditFeaturedChanged(true); setFeaturedToggle(val);
                        if (val) {
                          setFeaturedCapacity(editOriginal?.is_featured ? (editOriginal.max_invites ?? 99) + 1 : FEATURED_DEFAULT_CAPACITY);
                        }
                      }}
                      trackColor={{ false: appearance ? AfterglowColors.line : Colors.border, true: appearance ? AfterglowColors.clay : featuredType === 'birthday_party' ? Colors.birthdayPink : featuredType === 'special_event' ? Colors.specialEventMaroon : Colors.goldenAmber }}
                      thumbColor={Colors.white}
                    />
                  </View>
                  {featuredToggle && (
                    <View style={manageStyles.featuredTypeRow}>
                      <TouchableOpacity accessibilityRole="button"
                        style={[
                          manageStyles.featuredTypePill,
                          { backgroundColor: appearance ? (featuredType === 'washedup_event' ? AfterglowColors.clay : AfterglowColors.white) : (featuredType === 'washedup_event' ? Colors.goldenAmberTint15 : Colors.inputBg) },
                        ]}
                        disabled={edit.isBusy || edit.unknown}
                        accessibilityState={{selected: featuredType === "washedup_event"}}
                        onPress={() => { if (!edit.canChange()) return; hapticLight(); setEditFeaturedChanged(true); setFeaturedType('washedup_event'); }}
                        activeOpacity={0.85}
                      >
                        <Text
                          style={[
                            manageStyles.featuredTypePillText,
                            { color: appearance ? (featuredType === 'washedup_event' ? AfterglowColors.white : AfterglowColors.ink) : (featuredType === 'washedup_event' ? Colors.goldenAmber : Colors.tertiary) },
                          ]}
                        >
                          washedup event
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity accessibilityRole="button"
                        style={[
                          manageStyles.featuredTypePill,
                          { backgroundColor: appearance ? (featuredType === 'birthday_party' ? AfterglowColors.clay : AfterglowColors.white) : (featuredType === 'birthday_party' ? Colors.birthdayPinkTint15 : Colors.inputBg) },
                        ]}
                        disabled={edit.isBusy || edit.unknown}
                        accessibilityState={{selected: featuredType === "birthday_party"}}
                        onPress={() => { if (!edit.canChange()) return; hapticLight(); setEditFeaturedChanged(true); setFeaturedType('birthday_party'); }}
                        activeOpacity={0.85}
                      >
                        <Text
                          style={[
                            manageStyles.featuredTypePillText,
                            { color: appearance ? (featuredType === 'birthday_party' ? AfterglowColors.white : AfterglowColors.ink) : (featuredType === 'birthday_party' ? Colors.birthdayPink : Colors.tertiary) },
                          ]}
                        >
                          birthday party
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity accessibilityRole="button"
                        style={[
                          manageStyles.featuredTypePill,
                          { backgroundColor: appearance ? (featuredType === 'special_event' ? AfterglowColors.clay : AfterglowColors.white) : (featuredType === 'special_event' ? Colors.specialEventMaroon : Colors.inputBg) },
                        ]}
                        disabled={edit.isBusy || edit.unknown}
                        accessibilityState={{selected: featuredType === "special_event"}}
                        onPress={() => { if (!edit.canChange()) return; hapticLight(); setEditFeaturedChanged(true); setFeaturedType('special_event'); }}
                        activeOpacity={0.85}
                      >
                        <Text
                          style={[
                            manageStyles.featuredTypePillText,
                            { color: appearance ? (featuredType === 'special_event' ? AfterglowColors.white : AfterglowColors.ink) : (featuredType === 'special_event' ? Colors.specialEventCream : Colors.tertiary) },
                          ]}
                        >
                          special event
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {featuredToggle && (
                    <View style={manageStyles.capacitySection}>
                      <Text style={manageStyles.capacityValue}>{featuredCapacity} people</Text>
                      <View style={manageStyles.stepperRow}>
                        <TouchableOpacity accessibilityRole="button"
                          style={[manageStyles.stepperBtn, featuredCapacity <= FEATURED_MIN_CAPACITY && manageStyles.stepperBtnDisabled]}
                          onPress={() => {
                            if (featuredCapacity > FEATURED_MIN_CAPACITY) {
                              hapticLight();
                              setEditFeaturedChanged(true); setFeaturedCapacity((c) => Math.max(FEATURED_MIN_CAPACITY, c - 50));
                            }
                          }}
                          accessibilityLabel="Lower capacity" disabled={edit.isBusy || edit.unknown || featuredCapacity <= FEATURED_MIN_CAPACITY}
                        >
                          <Text style={manageStyles.stepperBtnText}>−</Text>
                        </TouchableOpacity>
                        <View style={manageStyles.stepperValue}>
                          <Text style={manageStyles.stepperValueText}>{featuredCapacity}</Text>
                          <Text style={manageStyles.stepperValueSub}>capacity</Text>
                        </View>
                        <TouchableOpacity accessibilityRole="button"
                          style={[manageStyles.stepperBtn, featuredCapacity >= FEATURED_MAX_CAPACITY && manageStyles.stepperBtnDisabled]}
                          onPress={() => {
                            if (featuredCapacity < FEATURED_MAX_CAPACITY) {
                              hapticLight();
                              setEditFeaturedChanged(true); setFeaturedCapacity((c) => Math.min(FEATURED_MAX_CAPACITY, c + 50));
                            }
                          }}
                          accessibilityLabel="Higher capacity" disabled={edit.isBusy || edit.unknown || featuredCapacity >= FEATURED_MAX_CAPACITY}
                        >
                          <Text style={manageStyles.stepperBtnText}>+</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>
              )}

</View>
              {/* Duplicate: reuse the exact prefill pipeline the waitlist
                  "Post your own" path uses, from the creator's own plan */}
              {COMMUNITIES_ENABLED && (
                <TouchableOpacity accessibilityRole="button"
                  disabled={edit.isBusy || edit.unknown}
                  style={manageStyles.duplicateBtn}
                  onPress={() => {
                    if (edit.unknown || !closeManageModal()) return;
                    router.push({
                      pathname: '/(tabs)/post',
                      params: buildDuplicatePostParams(plan, id),
                    });
                  }}
                  activeOpacity={0.7}
                >
                  <Text numberOfLines={1} style={manageStyles.duplicateBtnText}>Post again</Text>
                </TouchableOpacity>
              )}

              {/* Cancel plan */}
              <TouchableOpacity accessibilityRole="button"
                style={manageStyles.cancelBtn}
                disabled={edit.isBusy || edit.unknown}
                onPress={handleCancelPlan}
                activeOpacity={0.7}
              >
                <Text numberOfLines={1} style={manageStyles.cancelBtnText}>Cancel plan</Text>
              </TouchableOpacity>
            </ScrollView>
            <View style={[manageStyles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>              {edit.unknown && <View style={manageStyles.recovery}>
                <Text style={manageStyles.label}>Check your changes</Text>
                <Text style={manageStyles.hint}>Your changes may have saved, but we didn’t receive confirmation. Check before saving again.</Text>
              </View>}
              {edit.error && <Text accessibilityRole="alert" style={manageStyles.editError}>{edit.error}</Text>}
              {/* Save button */}
              <TouchableOpacity accessibilityRole="button"
                style={[manageStyles.saveBtn, (editSaving || editImageLoading || editTitle.trim().length === 0) && manageStyles.saveBtnDisabled]}
                onPress={edit.unknown ? edit.check : handleSaveEdit}
                disabled={editSaving || editImageLoading || editTitle.trim().length === 0}
                activeOpacity={0.85}
              >
                {editSaving ? (
                  <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><ActivityIndicator size="small" color={Colors.white} /><Text numberOfLines={1} style={manageStyles.saveBtnText}>{edit.unknown ? "Checking…" : "Saving…"}</Text></View>
                ) : (
                  <Text numberOfLines={1} style={manageStyles.saveBtnText}>{edit.unknown ? "Check changes" : "Save changes"}</Text>
                )}
              </TouchableOpacity>


            </View>
          </View>
          {/* Date picker overlay — child of the manage modal overlay so we
              avoid the Modal-inside-Modal stacking issue on iOS. */}
          {showEditDatePicker && (
            <Pressable
              style={manageStyles.pickerOverlay}
              onPress={() => setShowEditDatePicker(false)}
            >
              <Pressable style={manageStyles.pickerSheet} onPress={(e) => e.stopPropagation()}>
                <Text style={manageStyles.pickerTitle}>Select date</Text>
                <WashedUpCalendar
                  mode="pick"
                  selected={{ year: tempEditYear, month: tempEditMonth, day: tempEditDay }}
                  onSelect={(day) => {
                    if (!edit.canChange()) return;
                    setEditTimeChanged(true);
                    setEditDateYear(day.year);
                    setEditDateMonth(day.month);
                    setEditDateDay(day.day);
                    setShowEditDatePicker(false);
                  }}
                />
              </Pressable>
            </Pressable>
          )}

          {/* Time picker overlay */}
          {showEditTimePicker && (
            <Pressable
              style={manageStyles.pickerOverlay}
              onPress={() => setShowEditTimePicker(false)}
            >
              <Pressable style={manageStyles.pickerSheet} onPress={(e) => e.stopPropagation()}>
                <Text style={manageStyles.pickerTitle}>Select time</Text>
                <View style={manageStyles.pickerRow}>
                  <TextInput style={manageStyles.directTimeInput} value={tempEditHour ? String(tempEditHour) : ''} onChangeText={(value) => setTempEditHour(Number(value.replace(/\D/g, '').slice(0, 2)))} keyboardType="number-pad" maxLength={2} selectTextOnFocus accessibilityLabel="Hour, 1 through 12" />
                  <Text style={manageStyles.pickerItemText}>:</Text>
                  <TextInput style={manageStyles.directTimeInput} value={tempEditMinute} onChangeText={(value) => setTempEditMinute(value.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" maxLength={2} selectTextOnFocus accessibilityLabel="Minute, 0 through 59" />
                  {PERIODS.map((p) => (
                    <Pressable key={p} style={[manageStyles.directPeriod, tempEditPeriod === p && manageStyles.pickerItemSelected]} onPress={() => setTempEditPeriod(p)} accessibilityRole="button" accessibilityState={{ selected: tempEditPeriod === p }}>
                      <Text style={[manageStyles.pickerItemText, tempEditPeriod === p && manageStyles.pickerItemTextSel]}>{p}</Text>
                    </Pressable>
                  ))}
                </View>
                <View style={manageStyles.directMinutes}>
                  {MINUTE_OPTIONS.map((m) => (
                    <Pressable key={m} style={[manageStyles.directPeriod, tempEditMinute === m && manageStyles.pickerItemSelected]} onPress={() => setTempEditMinute(m)} accessibilityRole="button" accessibilityLabel={`${m} minutes`}>
                      <Text style={[manageStyles.pickerItemText, tempEditMinute === m && manageStyles.pickerItemTextSel]}>:{m}</Text>
                    </Pressable>
                  ))}
                </View>
                {!validTempEditTime && <Text style={manageStyles.directTimeError}>Enter an hour from 1–12 and minutes from 00–59.</Text>}
                <TouchableOpacity style={[manageStyles.pickerDoneBtn, !validTempEditTime && { opacity: 0.45 }]} onPress={confirmEditTime} disabled={!validTempEditTime} accessibilityRole="button" accessibilityState={{ disabled: !validTempEditTime }}>
                  <Text style={manageStyles.pickerDoneBtnText}>Done</Text>
                </TouchableOpacity>
              </Pressable>
            </Pressable>
          )}

          {/* BrandedAlert inside the modal so it renders on top, not behind it */}
          <BrandedAlert
        appearance={appearance}
            visible={brandedAlert.visible}
            title={brandedAlert.title}
            message={brandedAlert.message}
            scrollMessage={brandedAlert.scrollMessage}
            buttons={brandedAlert.buttons}
            onClose={closeBrandedAlert}
          />
        </KeyboardAvoidingView>
      </Modal>

      {reportTarget && (
        <ReportModal
          visible={showReport}
          onClose={() => { setShowReport(false); setReportTarget(null); }}
          reportedUserId={reportTarget.id}
          reportedUserName={reportTarget.name}
          eventId={plan.id}
        />
      )}

      <BrandedAlert
        appearance={appearance}
        visible={brandedAlert.visible}
        title={brandedAlert.title}
        message={brandedAlert.message}
            scrollMessage={brandedAlert.scrollMessage}
        buttons={brandedAlert.buttons}
        onClose={closeBrandedAlert}
      />

      <MiniProfileCard
        userId={miniProfileUserId}
        visible={!!miniProfileUserId}
        onClose={() => setMiniProfileUserId(null)}
        onReport={(uid, uname) => {
          setReportTarget({ id: uid, name: uname });
          setShowReport(true);
        }}
        onBlock={(uid, uname) => blockUser(uid, uname, () => router.back())}
      />

      <ParticipationNotice
        visible={noticePending !== null}
        organizerName={noticeOrganizerName}
        onAgree={handleNoticeAgree}
        onClose={closeParticipationNotice}
        onDismiss={() => finishPlanModalDismiss('notice', modalTransition)}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const legacyStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyLG, color: Colors.textMedium },
  linkText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.terracotta },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: Colors.parchment,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  backButtonText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  headerIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroImage: {
    width: SCREEN_WIDTH,
    height: 200,
    marginBottom: 16,
    marginLeft: -20,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 28,
  },
  planTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displayLG,
    color: Colors.asphalt,
    lineHeight: 34,
    marginBottom: 12,
  },
  cancelledEventBanner: {
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.gold,
    padding: 12,
    marginBottom: 12,
  },
  cancelledEventText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.asphalt,
  },
  categoryTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  categoryTag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#F5E8E2',
  },
  womenOnlyTag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: Colors.birthdayPinkTint15,
  },
  womenOnlyTagText: {
    fontWeight: '600',
    fontSize: 10,
    color: Colors.birthdayPink,
    letterSpacing: 0.2,
  },
  featuredPill: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.goldenAmberTint15,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  featuredPillText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.goldenAmber,
    letterSpacing: 0.2,
  },
  birthdaySubtitle: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.bodyMD,
    color: Colors.warmGray,
    marginTop: 6,
    marginBottom: 4,
  },
  categoryTagText: {
    fontWeight: '600',
    fontSize: 10,
    color: '#B5522E',
    textTransform: 'capitalize',
    letterSpacing: 0.2,
  },
  description: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.textMedium,
    lineHeight: 22,
    marginBottom: 12,
  },
  noteBox: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: Colors.goldenAmber,
  },
  noteLabel: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.textLight,
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  noteText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
    lineHeight: 22,
  },
  logisticsCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  logisticsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logisticsRowBorder: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    marginTop: 12,
    paddingTop: 12,
  },
  logisticsContent: {
    flex: 1,
  },
  happeningNowBanner: {
    backgroundColor: '#C5A55A',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 10,
  },
  happeningNowBannerText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: '#2C1810',
  },
  happeningNowBannerInvite: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: '#2C1810',
    marginTop: 2,
  },
  happeningNowBannerSub: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: '#78695C',
    marginTop: 2,
  },
  logisticsMain: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  logisticsSub: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.textMedium,
    marginTop: 2,
  },
  logisticsLink: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.terracotta,
  },
  miniMapWrap: {
    marginTop: 12,
    borderRadius: 10,
    overflow: 'hidden',
  },
  miniMap: {
    width: '100%',
    height: 150,
  },
  whoGoingTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displayMD,
    color: Colors.asphalt,
    marginBottom: 12,
  },
  whoGoingFallback: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.textMedium,
    marginBottom: 24,
  },
  memberAvatarRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    marginBottom: 24,
    gap: 12,
  },
  memberAvatarWrapper: {
    alignItems: 'center',
    width: 52,
  },
  memberAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: Colors.parchment,
  },
  memberAvatarPlaceholder: {
    backgroundColor: Colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarInitial: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  memberAvatarName: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.micro,
    color: Colors.textMedium,
    marginTop: 4,
    textAlign: 'center',
    maxWidth: 52,
  },
  memberAvatarOverflow: {
    backgroundColor: Colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarOverflowText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  // Next Time! — gold-filled button. See CLAUDE.md "Documented exceptions":
  // gold says "warm, optional," in deliberate contrast to terracotta's "do this now."
  interestButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.goldAccent,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  interestButtonText: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.bodyMD,
    color: Colors.quoteText,
  },
  interestSent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    marginBottom: 16,
  },
  interestSentText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.quoteText,
  },
  creatorInterestBlock: {
    marginTop: 4,
    marginBottom: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  creatorInterestTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displayMD,
    color: Colors.asphalt,
    marginBottom: 12,
  },
  creatorInterestSub: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.textMedium,
    marginTop: 4,
  },
  ctaBlock: {
    marginTop: 8,
  },
  ctaButton: {
    backgroundColor: Colors.terracotta,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  ctaButtonText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.white,
  },
  ctaInfo: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.textMedium,
    marginBottom: 4,
  },
  ctaSub: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.textLight,
  },
  stickyBar: {
    flexShrink: 0,
    paddingHorizontal: 20,
    paddingBottom: 32,
    paddingTop: 12,
    backgroundColor: Colors.parchment,
    borderTopWidth: 0.5,
    borderTopColor: Colors.border,
  },
  ticketButton: {
    backgroundColor: Colors.cardBg,
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  ticketButtonText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  joinButton: {
    backgroundColor: Colors.terracotta,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinButtonText: { color: Colors.white, fontFamily: Fonts.sansBold, fontSize: FontSizes.displaySM },
  endedBar: {
    minHeight: 52,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  endedBarText: {
    color: Colors.secondary,
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
  },
  inviteActions: {
    flexDirection: 'row',
    gap: 10,
  },
  declineInviteButton: {
    flex: 1,
    backgroundColor: Colors.parchment,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineInviteText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.textMedium,
  },
  acceptInviteButton: {
    flex: 1.5,
    backgroundColor: Colors.terracotta,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptInviteText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.displaySM,
    color: Colors.white,
  },
  memberActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  youreGoingBadge: {
    flex: 1,
    backgroundColor: Colors.inputBg,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  youreGoingText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.textMedium },
  openChatButton: {
    flex: 1,
    backgroundColor: Colors.terracotta,
    borderRadius: 14,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  openChatText: { color: Colors.white, fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD },
  claimSpotButton: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: Colors.terracotta,
    shadowColor: Colors.terracotta,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  claimSpotText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.displaySM,
    color: Colors.white,
  },
  waitlistButton: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
  },
  waitlistButtonActive: {
    backgroundColor: Colors.terracotta,
    borderColor: Colors.terracotta,
  },
  waitlistButtonText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.displaySM, color: Colors.terracotta },
  waitlistButtonTextActive: { color: Colors.white },
  ineligibleBar: { paddingVertical: 16, alignItems: 'center' },
  ineligibleText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.textLight },
  ineligibleSub: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium, marginTop: 4 },
  manageButton: {
    flex: 1,
    backgroundColor: Colors.cardBg,
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  manageButtonText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  creatorCancelLink: {
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginTop: 6,
  },
  creatorCancelLinkText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    // muted, never red (C13); the confirm carries the weight
    color: Colors.textMedium,
    textDecorationLine: 'underline',
  },
  waitlistManageButton: {
    marginTop: 10,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    backgroundColor: Colors.cardBg,
  },
  waitlistManageButtonText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.terracotta,
  },
  exceptionBannerTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displaySM,
    color: Colors.darkWarm,
  },
  exceptionBannerBody: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.secondary,
    marginTop: 4,
    lineHeight: 20,
  },
  exceptionBannerExpiry: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
    marginTop: 6,
  },
  exceptionBannerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    gap: 10,
  },
  exceptionAcceptBtn: {
    backgroundColor: Colors.terracotta,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 999,
  },
  exceptionAcceptText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.white,
  },
  exceptionDeclineBtn: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  exceptionDeclineText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.tertiary,
  },
});

const legacyJoinStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: Colors.overlayDark,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  sheet: {
    backgroundColor: Colors.white,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    position: 'relative',
  },
  closeButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 1,
    elevation: 1,
  },
  closeX: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.displaySM,
    color: Colors.textLight,
  },
  title: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.displayMD,
    color: Colors.asphalt,
    marginBottom: 4,
    paddingRight: 32,
  },
  subtitle: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.textLight,
    marginBottom: 20,
  },
  infoBox: {
    backgroundColor: Colors.parchment,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    alignItems: 'center',
  },
  infoTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
    textAlign: 'center',
    marginBottom: 4,
  },
  infoText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.textMedium,
    textAlign: 'center',
    lineHeight: 18,
  },
  label: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
    marginBottom: 8,
  },
  required: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
  },
  input: {
    backgroundColor: Colors.white,
    borderWidth: 1.5,
    borderColor: Colors.inputBg,
    borderRadius: 12,
    padding: 14,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  inputRequired: {
    borderColor: Colors.terracotta,
  },
  hint: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.textLight,
    marginTop: 6,
    marginBottom: 20,
  },
  error: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.errorRed,
    marginTop: -10,
    marginBottom: 16,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 20,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: Colors.terracotta,
    borderColor: Colors.terracotta,
  },
  checkmark: {
    color: Colors.white,
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
  },
  checkLabel: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  joinBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  joinBtnDisabled: {
    opacity: 0.35,
  },
  joinBtnText: {
    color: Colors.white,
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.displaySM,
  },
});

const ticketStyles = StyleSheet.create({
  sheet: {
    backgroundColor: Colors.white,
    borderRadius: 20,
    padding: 28,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: `${Colors.terracotta}14`,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.displayMD,
    color: Colors.asphalt,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.textMedium,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  primaryBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    width: '100%',
    marginBottom: 10,
  },
  primaryBtnText: {
    color: Colors.white,
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.displaySM,
  },
  secondaryBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    width: '100%',
  },
  secondaryBtnText: {
    color: Colors.textLight,
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
  },
});

const legacyManagePlacesStyles = {
  container: { flex: 0 },
  textInputContainer: { backgroundColor: 'transparent' },
  textInput: {
    backgroundColor: Colors.parchment,
    borderWidth: 1,
    borderColor: Colors.inputBg,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
    height: 46,
    marginBottom: 0,
  },
  listView: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.inputBg,
    borderRadius: 12,
    marginTop: 4,
    overflow: 'hidden' as const,
  },
  row: { paddingHorizontal: 14, paddingVertical: 12, backgroundColor: Colors.white },
  separator: { height: 1, backgroundColor: Colors.inputBg, marginHorizontal: 14 },
  description: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  poweredContainer: { display: 'none' as const },
};

const legacyManageStyles = StyleSheet.create({
  footer: { borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 12, gap: 12 },
  recovery: { marginTop: 0 },
  editError: { color: Colors.errorRed, fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, marginTop: 12 },
  overlay: {
    flex: 1,
    backgroundColor: Colors.overlayDark,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 24,
    maxHeight: SCREEN_HEIGHT * 0.85,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.displayMD,
    color: Colors.asphalt,
  },
  closeX: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.displaySM,
    color: Colors.textLight,
  },
  label: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.warmGray,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
    marginTop: 16,
  },
  input: {
    backgroundColor: Colors.parchment,
    borderWidth: 1,
    borderColor: Colors.inputBg,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  creatorMessageInput: {
    minHeight: 50,
    textAlignVertical: 'top',
  },
  // Plan photo — same values as PlanComposerV2's photoRow/photoAdd/etc.
  photoRow: { marginTop: 0 },
  photoAdd: {
    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white,
  },
  photoAddText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.secondary },
  photoThumbWrap: { width: 96, height: 60, borderRadius: 12, overflow: 'hidden' },
  photoThumb: { width: '100%', height: '100%' },
  photoThumbOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.overlayDark40 },
  photoRemove: {
    position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.overlayDark60,
  },
  hint: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.textLight,
    marginTop: 4,
  },
  descLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 16,
    marginBottom: 6,
  },
  charCounter: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
  },
  charCounterWarn: {
    color: Colors.errorBrand,
    fontFamily: Fonts.sansSemibold,
  },
  pillWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: Colors.parchment,
    borderWidth: 1,
    borderColor: Colors.inputBg,
    borderRadius: 20,
  },
  pillSelected: {
    backgroundColor: Colors.terracotta,
    borderColor: Colors.terracotta,
  },
  pillText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  pillTextSelected: {
    color: Colors.white,
    fontFamily: Fonts.sansBold,
  },
  genderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  genderPill: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: Colors.parchment,
    borderWidth: 1,
    borderColor: Colors.inputBg,
    borderRadius: 14,
    alignItems: 'center',
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepperBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.parchment,
    borderWidth: 1,
    borderColor: Colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnDisabled: { opacity: 0.35 },
  stepperBtnText: { fontFamily: Fonts.sans, fontSize: FontSizes.displayMD, color: Colors.asphalt },
  stepperValue: { flex: 1, alignItems: 'center' },
  stepperValueText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.displayLG, color: Colors.terracotta },
  stepperValueSub: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.textLight, marginTop: -2 },
  saveBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 24,
  },
  saveBtnDisabled: {
    opacity: 0.4,
  },
  saveBtnText: { color: Colors.white, fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG },
  cancelBtn: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 8,
  },
  // muted, never red (C13)
  cancelBtnText: { color: Colors.textMedium, fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD },
  duplicateBtn: { alignItems: 'center', paddingVertical: 12 },
  duplicateBtnText: { color: Colors.terracotta, fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD },
  featuredSection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  featuredRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  featuredTypeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
    justifyContent: 'center',
  },
  featuredTypePill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  featuredTypePillText: {
    fontFamily: Fonts.sansBold,
    fontSize: 11,
    letterSpacing: 0.3,
  },
  // Date / time editor in the manage modal
  dateTimeRow: {
    flexDirection: 'row',
    marginTop: 4,
  },
  dateTimeBtn: {
    flex: 1,
    justifyContent: 'center',
  },
  dateTimeBtnText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  // Date / time picker overlays (inside the manage modal so they stack
  // above the form sheet without spawning a nested RN Modal).
  pickerOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: Colors.overlayDark40,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    elevation: 24,
  },
  pickerSheet: {
    width: '88%',
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 20,
    maxHeight: '70%',
  },
  pickerTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
    textAlign: 'center',
    marginBottom: 12,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  directTimeInput: {
    width: 55,
    minHeight: 50,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 6,
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
  },
  directPeriod: {
    flex: 1,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 6,
  },
  directMinutes: { flexDirection: 'row', gap: 8, marginTop: 14 },
  directTimeError: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.errorRed, marginTop: 10 },
  pickerCol: {
    flex: 1,
  },
  pickerColSm: {
    flex: 0.7,
  },
  pickerItem: {
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  pickerItemSelected: {
    backgroundColor: Colors.terracotta,
  },
  pickerItemText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  pickerItemTextSel: {
    color: Colors.white,
    fontFamily: Fonts.sansBold,
  },
  pickerDoneBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  pickerDoneBtnText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.white,
  },
  capacitySection: {
    marginTop: 12,
    alignItems: 'center',
  },
  capacityValue: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
    marginBottom: 8,
  },
});

const legacyDuplicateSheetStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: Colors.overlayDark,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.parchment,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingBottom: 32,
    paddingHorizontal: 24,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.displayMD,
    color: Colors.asphalt,
    marginBottom: 8,
  },
  body: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.textMedium,
    lineHeight: 22,
    marginBottom: 24,
  },
  primaryBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  primaryBtnText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.displaySM,
    color: Colors.white,
  },
  secondaryBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.displaySM,
    color: Colors.terracotta,
  },
});

function detailAppearance<T extends Record<string, any>>(base: T, fonts: AfterglowFontFamilies): T {
  const colorMap: Record<string, string> = {
    [Colors.parchment]: AfterglowColors.paper, [Colors.asphalt]: AfterglowColors.ink,
    [Colors.textLight]: AfterglowColors.muted,
    [Colors.terracotta]: AfterglowColors.clay, [Colors.cardBg]: AfterglowColors.white,
    [Colors.border]: AfterglowColors.subtleLine, [Colors.inputBg]: AfterglowColors.white,
  };
  const familyMap: Record<string, string> = { [Fonts.displayBold]: fonts.display, [Fonts.display]: fonts.regular,
    [Fonts.sans]: fonts.regular, [Fonts.sansMedium]: fonts.medium, [Fonts.sansSemibold]: fonts.semibold, [Fonts.sansBold]: fonts.semibold };
  return Object.fromEntries(Object.entries(base).map(([key, value]) => {
    const style = { ...StyleSheet.flatten(value) } as any;
    for (const prop of ['color', 'backgroundColor', 'borderColor', 'borderTopColor', 'borderBottomColor']) if (colorMap[style[prop]]) style[prop] = colorMap[style[prop]];
    if (familyMap[style.fontFamily]) style.fontFamily = familyMap[style.fontFamily];
    if (/Button$|Btn$/.test(key)) { style.minHeight = 48; style.borderRadius = 6; }
    if (['joinButton', 'openChatButton', 'managePlanButton', 'waitlistButton'].includes(key)) style.borderRadius = 14;
    if (key === 'headerIconButton') { style.width = 44; style.height = 44; style.backgroundColor = AfterglowColors.paper; style.borderWidth = 0; }
    if (key === 'youreGoingBadge') { style.backgroundColor = AfterglowColors.paper; style.minHeight = 48; style.borderRadius = 0; style.justifyContent = 'center'; }
    if (key === 'youreGoingText') style.color = AfterglowColors.muted;
    if (key === 'scrollContent') style.paddingBottom = 28;
    if (key === 'stickyBar') { style.position = 'relative'; style.bottom = undefined; style.left = undefined; style.right = undefined; style.borderTopColor = AfterglowColors.subtleLine; }
    if (key === 'title') { Object.assign(style, AfterglowType.identity); }
    if (key === 'sheet') { style.borderTopLeftRadius = 12; style.borderTopRightRadius = 12; }
    return [key, style];
  })) as T;
}

function manageAppearance<T extends Record<string, any>>(base: T, fonts: AfterglowFontFamilies): T {
  const result = detailAppearance(base, fonts) as any;
  Object.assign(result.sheet, { backgroundColor: AfterglowColors.paper, paddingHorizontal: 20, paddingTop: 12, maxHeight: '92%' });
  Object.assign(result.title, { ...AfterglowType.identity, fontFamily: fonts.semibold });
  Object.assign(result.label, { textTransform: 'none', letterSpacing: 0, fontFamily: fonts.semibold, fontSize: FontSizes.bodyMD, color: AfterglowColors.ink });
  for (const key of ['input', 'photoAdd']) Object.assign(result[key], { backgroundColor: AfterglowColors.white, borderColor: AfterglowColors.line, borderRadius: 6, minHeight: 48 });
  Object.assign(result.saveBtn, { marginTop: 0, minHeight: 52 });
  Object.assign(result.photoRow, { gap: 10 });
  for (const key of ['pill', 'genderPill', 'featuredTypePill']) Object.assign(result[key], { borderRadius: 6, minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: AfterglowColors.line });
  Object.assign(result.featuredTypePillText, { fontSize: FontSizes.bodySM });
  Object.assign(result.hint, { color: AfterglowColors.muted });
  Object.assign(result.photoRemove, { width: 44, height: 44, top: 0, right: 0, borderRadius: 6 });
  return result;
}
