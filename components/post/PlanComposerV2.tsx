import { requestWithDeadline } from '../../lib/requestWithDeadline';
/**
 * Main plan composer, with optional development-gated Afterglow presentation.
 * The original post requires title, date, time, category, a message of at least
 * ten characters, and a description. Drafts require title, date and time.
 * Place, photo, end time and ticket link stay optional. Posting, creator
 * membership, invitation recovery and all saved payloads retain their source
 * contracts; this presentation does not add a creation step.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AccessibilityInfo,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { router, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { ImagePlus, X, ChevronDown } from 'lucide-react-native';

import Colors, { AfterglowColors } from '../../constants/Colors';
import { extractFirstUrl } from '../../lib/url';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';
import { hapticLight, hapticMedium, hapticSelection, hapticSuccess } from '../../lib/haptics';
import { supabase } from '../../lib/supabase';
import { requestPlanNotificationPrompt } from '../../lib/planNotificationPrompt';
import { checkContent } from '../../lib/contentFilter';
import { uploadBase64ToStorage } from '../../lib/uploadPhoto';
import { PHOTO_FORMAT_ERROR_MESSAGE } from '../../constants/PhotoUpload';
import { MONTHS, getTodayInLA, laWallTimeToUTC, getLAWallParts, isValidLAWallTime, resolveOvernightLAEnd } from '../../lib/laDate';
import {
  NEIGHBORHOOD_OPTIONS,
  NEIGHBORHOOD_OTHER,
} from '../../constants/Neighborhoods';
import { PLAN_CATEGORIES, type PlanCategory } from '../../constants/Categories';
import { COMMUNITIES_ENABLED, COMMUNITY_CHAT_GROUPING_ENABLED } from '../../constants/FeatureFlags';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { COPY } from '../yours/state/constants';
import { useObservedUser } from '../../hooks/useObservedUser';
import type { MyFace } from '../../hooks/useMyFace';
import {
  buildOptimisticPlan,
  prependOptimisticPlan,
  type OptimisticHandle,
} from '../../lib/optimisticPlans';
import { useInviteInterestSignals } from '../../hooks/useInviteInterestSignals';
import { useDismissSuggestion } from '../../hooks/useDismissSuggestion';
import { usePostPlanInvitations } from './usePostPlanInvitations';
import { BrandedAlert } from '../../components/BrandedAlert';
import { SharePlanModal } from '../../components/modals/SharePlanModal';
import { type CalendarDay } from '../../components/calendar/WashedUpCalendar';
import EditorialTitleField from '../composer/EditorialTitleField';
import CategoryChips from '../composer/CategoryChips';
import CollapsibleCalendar from '../composer/CollapsibleCalendar';
import TimePicker, { displayTime } from '../composer/TimePicker';
import InlineNudge from '../composer/InlineNudge';
import { useNudgeArbiter, NUDGE_PLACE_BASE } from '../composer/nudgeArbiter';
import PlacePicker, { type PlaceValue } from '../composer/place/PlacePicker';
import PostConfirmation from '../composer/PostConfirmation';
import InvitePeopleSection, { type InviteChip, type InviteSuggestion } from '../../components/post/InvitePeopleSection';
import PeoplePickerSheet, { type PickedPerson } from '../../components/post/PeoplePickerSheet';

// ─── Constants ──────────────────────────────────────────────────────────────

type GenderPreference = 'mixed' | 'women_only' | 'men_only' | 'nonbinary_only';

const AGE_RANGES = ['All Ages', '21+', '20s', '30s', '40s', '50s', '60s', '70+'] as const;
type AgeRange = (typeof AGE_RANGES)[number];

const MIN_GROUP = 3;
const MAX_GROUP = 8;
const MSG_MIN = 10;
const MSG_LIMIT = 150;
const DESC_LIMIT = 2000;
// Counter turns to the warm warn color once you're within this many chars of the cap.
const DESC_WARN_MARGIN = 200;

type QuickKind = 'tonight' | 'tomorrow';
type RequiredField = 'title' | 'category' | 'message' | 'description' | 'when';
type ValidationMode = 'post' | 'draft';
type ComposerWrite = {
  userId: string;
  isCurrentViewer: () => boolean;
  optimistic: OptimisticHandle | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────

function buildDatetime(
  month: number, day: number, year: number,
  hour: number, minute: string, period: 'AM' | 'PM',
): Date {
  let h = hour;
  if (period === 'PM' && h !== 12) h += 12;
  if (period === 'AM' && h === 12) h = 0;
  // Pin to the LA wall clock, not the device's local zone (see laDate).
  return laWallTimeToUTC(year, month, day, h, parseInt(minute, 10));
}

function ageRangesToMinMax(ranges: AgeRange[]): { min: number | null; max: number | null } {
  if (ranges.length === 0 || ranges.includes('All Ages')) return { min: null, max: null };
  const bounds: Record<string, [number, number]> = {
    '21+': [21, 99], '20s': [20, 29], '30s': [30, 39], '40s': [40, 49],
    '50s': [50, 59], '60s': [60, 69], '70+': [70, 99],
  };
  let min = 99, max = 0;
  for (const r of ranges) {
    const b = bounds[r];
    if (b) { if (b[0] < min) min = b[0]; if (b[1] > max) max = b[1]; }
  }
  return { min, max };
}

/** Date (LA-local) for a quick chip. Tonight = today, tomorrow = +1. Both are
 *  unambiguous one-tap paths; everything else uses the calendar row. */
function quickDate(kind: QuickKind): { year: number; month: number; day: number } {
  const t = getTodayInLA();
  const base = new Date(t.y, t.m, t.d);
  if (kind === 'tomorrow') base.setDate(base.getDate() + 1);
  return { year: base.getFullYear(), month: base.getMonth(), day: base.getDate() };
}

function sameDay(a: { year: number; month: number; day: number } | null, b: { year: number; month: number; day: number }): boolean {
  return !!a && a.year === b.year && a.month === b.month && a.day === b.day;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function PlanComposerV2() {
  const { fonts } = useAfterglowFonts(COMMUNITY_CHAT_GROUPING_ENABLED);
  const appearance = useMemo(() => COMMUNITY_CHAT_GROUPING_ENABLED ? { fonts } : undefined, [fonts]);
  const styles = useMemo(() => appearance ? { ...legacyStyles, ...composerAppearance(appearance.fonts) } : legacyStyles, [appearance]);
  const muted = appearance ? AfterglowColors.muted : Colors.secondary;
  const placeholder = appearance ? AfterglowColors.muted : Colors.inkSoft;
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const titleInputRef = useRef<TextInput>(null);
  const messageInputRef = useRef<TextInput>(null);
  const descriptionInputRef = useRef<TextInput>(null);
  const sectionPositions = useRef<Partial<Record<RequiredField, number>>>({});
  const [validationMode, setValidationMode] = useState<ValidationMode | null>(null);
  const params = useLocalSearchParams<{
    prefillTitle?: string;
    prefillInvitePersonId?: string;
    prefillInvitePersonName?: string;
    prefillInvitePersonPhoto?: string;
    // "Post your own" (duplicate) prefill set (buildDuplicatePostParams).
    prefillDescription?: string;
    prefillLocation?: string;
    prefillLocationLat?: string;
    prefillLocationLng?: string;
    prefillNeighborhood?: string;
    prefillCategory?: string;
    prefillImageUrl?: string;
    prefillStartTime?: string;
    prefillEndTime?: string;
    prefillEventDate?: string;
    prefillDropIn?: string;
    prefillAllowDuplicate?: string;
    prefillAgeRange?: string;
    prefillGenderPref?: string;
    prefillGroupSize?: string;
    prefillTicketsUrl?: string;
    // the source explore event of a "find people to go with" spawn (or of a
    // duplicated/drafted plan that carries one). Written to the plan row so
    // the DB title-match trigger never has to guess (it guesses wrong with
    // duplicate titles).
    prefillExploreEventId?: string;
    duplicatedFromEventId?: string;
    // resuming a saved draft: post updates this row instead of inserting
    draftId?: string;
  }>();

  const composerViewer = useObservedUser();
  const composerUserId = !composerViewer.error && !composerViewer.isLoading ? composerViewer.viewerId : undefined;

  // ── Profile (gender options) ──
  const [userGender, setUserGender] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setUserGender(null);
    if (!composerUserId) return;
    (async () => {
      const { data: profile } = await supabase.from('profiles').select('gender').eq('id', composerUserId).single();
      if (active && composerViewer.isCurrent() && profile?.gender) setUserGender(profile.gender);
    })().catch(() => {});
    return () => { active = false; };
  }, [composerUserId, composerViewer.epoch, composerViewer.isCurrent]);

  // ── Core fields ──
  const [title, setTitle] = useState('');
  const [exploreEventId, setExploreEventId] = useState<string | null>(null);
  const [category, setCategory] = useState<PlanCategory | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [creatorMessage, setCreatorMessage] = useState('');

  // ── Place ──
  const [location, setLocation] = useState('');
  const [locationLat, setLocationLat] = useState<number | null>(null);
  const [locationLng, setLocationLng] = useState<number | null>(null);
  const [neighborhood, setNeighborhood] = useState('');

  // ── When ──
  const today = getTodayInLA();
  const [dateMonth, setDateMonth] = useState(today.m);
  const [dateDay, setDateDay] = useState(today.d);
  const [dateYear, setDateYear] = useState(today.y);
  const [dateSelected, setDateSelected] = useState(false);
  const [timeHour, setTimeHour] = useState(8);
  const [timeMinute, setTimeMinute] = useState('00');
  const [timePeriod, setTimePeriod] = useState<'AM' | 'PM'>('PM');
  const [timeSelected, setTimeSelected] = useState(false);
  // End time is optional (legacy parity). When set we compose end_time, rolling
  // to the next day for an overnight plan; min 30 min after start.
  const [endTimeHour, setEndTimeHour] = useState(9);
  const [endTimeMinute, setEndTimeMinute] = useState('00');
  const [endTimePeriod, setEndTimePeriod] = useState<'AM' | 'PM'>('PM');
  const [endTimeSelected, setEndTimeSelected] = useState(false);

  // ── How many + audience ──
  const [groupSize, setGroupSize] = useState(6); // max_invites; UI shows groupSize+1 total
  const [genderPref, setGenderPref] = useState<GenderPreference>('mixed');
  const [ageRanges, setAgeRanges] = useState<AgeRange[]>([]);

  // ── Link/tickets, joinability, + secondary optional fields (surfaced from the
  //    retired "more options" collapsible) ──
  const [ticketUrl, setTicketUrl] = useState('');
  const [dropIn, setDropIn] = useState(true);
  const [allowDuplicate, setAllowDuplicate] = useState(true);
  const [description, setDescription] = useState('');
  const [showNeighborhoodPicker, setShowNeighborhoodPicker] = useState(false);

  // ── Invite people (flag-on path) ──
  const { data: wantInSignals = [] } = useInviteInterestSignals(composerUserId);
  const { dismiss: dismissSuggestion, undo: undoDismissSuggestion } = useDismissSuggestion(composerUserId);
  const postInvitations = usePostPlanInvitations(composerViewer);
  const [invited, setInvited] = useState<InviteChip[]>([]);
  const [inviteShowAll, setInviteShowAll] = useState(false);
  const [peoplePickerOpen, setPeoplePickerOpen] = useState(false);
  const [hiddenWantIn, setHiddenWantIn] = useState<Set<string>>(new Set());

  // ── Submit / post-moment ──
  const [loading, setLoading] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message: string } | null>(null);
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [postedPlanId, setPostedPlanId] = useState<string | null>(null);
  const postedPlanIdRef = useRef<string | null>(null);
  const [postedPlanTitle, setPostedPlanTitle] = useState('');
  const [postedGenderLabel, setPostedGenderLabel] = useState<string | undefined>();
  // Optimistic post moment.
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [confirmIsFirst, setConfirmIsFirst] = useState(false);
  const [confirmMeta, setConfirmMeta] = useState('');
  const [shareWanted, setShareWanted] = useState(false);
  const [recoveryNudge, setRecoveryNudge] = useState(false);
  const neverPostedRef = useRef(false);
  // Synchronous lock against a real double-tap: `loading` state alone has a
  // render-commit lag a fast second tap can beat (closure on the button's
  // onPress still sees loading=false), which can double-insert the plan. A
  // ref updates instantly, before React re-renders.
  const submittingRef = useRef(false);
  const mountedRef = useRef(false);
  const photoVisit = useRef<object | null>(null);
  const photoAttempt = useRef<object | null>(null);
  const writeRef = useRef<ComposerWrite | null>(null);
  // Retirement removes only this attempt's temporary card. Restoring its old
  // cache snapshot here could erase newer data when the same account returns.
  const retireWrite = useCallback(() => {
    const write = writeRef.current;
    writeRef.current = null;
    submittingRef.current = false;
    if (write?.optimistic) {
      const tempId = write.optimistic.tempId;
      for (const key of [['events', 'feed', write.userId], ['my-plans', write.userId]]) {
        queryClient.setQueryData<Array<{ id: string }>>(key, old => old?.filter(plan => plan.id !== tempId));
        // A dispatched write may have committed. Reconcile on the next read;
        // never launch compensating writes under a replacement account.
        void queryClient.invalidateQueries({ queryKey: key, exact: true, refetchType: 'none' });
      }
    }
  }, [queryClient]);
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; photoVisit.current = null; photoAttempt.current = null; retireWrite(); };
  }, [retireWrite]);
  useFocusEffect(useCallback(() => {
    const visit = {}; photoVisit.current = visit;
    return () => {
      if (photoVisit.current !== visit) return;
      photoVisit.current = null;
      if (photoAttempt.current) {
        photoAttempt.current = null;
        setImageLoading(false);
        setImageUrl(current => current?.startsWith('http') ? current : null);
      }
    };
  }, [composerViewer.epoch]));
  const isComposerCurrent = () => mountedRef.current && composerViewer.isCurrent();
  const cancelComposer = () => {
    if (!isComposerCurrent()) return;
    hapticLight();
    photoVisit.current = null; photoAttempt.current = null;
    setImageLoading(false); setImageUrl(current => current?.startsWith('http') ? current : null);
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/plans');
  };
  const ownsWrite = (write: ComposerWrite) => mountedRef.current && writeRef.current === write && write.isCurrentViewer();
  const beginWrite = (): ComposerWrite | null => {
    // A retained callback cannot adopt the account returned by a later read.
    if (!isComposerCurrent() || submittingRef.current) return null;
    if (!composerUserId) {
      setAlertInfo({ title: 'Check your account', message: 'We could not confirm your account. Please try again before posting or saving.' });
      void composerViewer.retry();
      return null;
    }
    const write: ComposerWrite = { userId: composerUserId, isCurrentViewer: composerViewer.isCurrent, optimistic: null };
    writeRef.current = write;
    submittingRef.current = true;
    setLoading(true);
    return write;
  };
  const invitationOwner = useRef<{ viewerId: string | null | undefined; epoch: number }>({ viewerId: undefined, epoch: 0 });

  // Has the creator seen the first-plan moment? Drives the elevated copy.
  useEffect(() => {
    AsyncStorage.getItem('hasSeenFirstPlanCelebration').then((v) => {
      neverPostedRef.current = v === null;
    });
  }, []);

  // "share it" before the insert resolves: open the share sheet once the id lands.
  useEffect(() => {
    if (shareWanted && postedPlanId) {
      setShareWanted(false);
      setConfirmVisible(false);
      setShareModalVisible(true);
    }
  }, [shareWanted, postedPlanId]);

  // ── Prefill: pre-attached person from "Make a plan with {Name}", AND the
  // full "Post your own" (duplicate) set. V2 previously only read prefillTitle,
  // so duplicates silently dropped date/time/place/ticket/etc.; this mirrors
  // LegacyComposer's hydration so "Post your own" carries the source plan over. ──
  useEffect(() => {
    if (params.prefillTitle) setTitle(String(params.prefillTitle));
    if (params.prefillExploreEventId) setExploreEventId(String(params.prefillExploreEventId));
    if (params.prefillInvitePersonId) {
      setInvited((prev) =>
        prev.some((c) => c.user_id === params.prefillInvitePersonId)
          ? prev
          : [
              ...prev,
              {
                user_id: String(params.prefillInvitePersonId),
                name: params.prefillInvitePersonName ? String(params.prefillInvitePersonName) : 'Someone',
                photo: params.prefillInvitePersonPhoto ? String(params.prefillInvitePersonPhoto) : null,
              },
            ],
      );
    }

    // Duplicate ("Post your own") fields.
    if (params.prefillDescription) setDescription(String(params.prefillDescription));
    if (params.prefillTicketsUrl) setTicketUrl(String(params.prefillTicketsUrl));
    if (params.prefillImageUrl) setImageUrl(String(params.prefillImageUrl));
    if (params.prefillNeighborhood) setNeighborhood(String(params.prefillNeighborhood));
    if (params.prefillLocation) setLocation(String(params.prefillLocation));
    if (params.prefillLocationLat && params.prefillLocationLng) {
      const lat = parseFloat(String(params.prefillLocationLat));
      const lng = parseFloat(String(params.prefillLocationLng));
      if (!isNaN(lat) && !isNaN(lng)) { setLocationLat(lat); setLocationLng(lng); }
    }
    if (params.prefillCategory) {
      const c = String(params.prefillCategory).toLowerCase();
      const matched = PLAN_CATEGORIES.find((p) => p.toLowerCase() === c);
      if (matched) setCategory(matched);
    }
    if (params.prefillDropIn !== undefined) setDropIn(params.prefillDropIn !== 'false');
    if (params.prefillAllowDuplicate !== undefined) setAllowDuplicate(params.prefillAllowDuplicate !== 'false');
    if (params.prefillGenderPref) {
      const g = String(params.prefillGenderPref);
      if (g === 'mixed' || g === 'women_only' || g === 'men_only' || g === 'nonbinary_only') setGenderPref(g);
    }
    if (params.prefillGroupSize) {
      const n = parseInt(String(params.prefillGroupSize), 10);
      // Clamp to the composer's own range so duplicating a featured/large plan
      // can't seed max_invites above the 8-max capacity invariant.
      if (!isNaN(n)) setGroupSize(Math.max(MIN_GROUP - 1, Math.min(MAX_GROUP - 1, n)));
    }
    if (params.prefillAgeRange) {
      const parsed = String(params.prefillAgeRange).split(',').map((s) => s.trim())
        .filter((s): s is AgeRange => (AGE_RANGES as readonly string[]).includes(s));
      if (parsed.length > 0) setAgeRanges(parsed);
    }
    // Date: accepts YYYY-MM-DD (already an LA calendar day, split as a plain
    // string) or full ISO (converted to its LA day). Never parsed through the
    // device clock: reading the UTC or device-local side of a timestamp
    // shifts any 5pm-or-later LA time one day forward per reopen (the
    // draft/prefill date-shift bug, tour part 5).
    if (params.prefillEventDate) {
      const raw = String(params.prefillEventDate);
      if (raw.includes('T')) {
        const w = getLAWallParts(raw);
        if (w) { setDateMonth(w.m); setDateDay(w.d); setDateYear(w.y); setDateSelected(true); }
      } else {
        const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m) { setDateYear(Number(m[1])); setDateMonth(Number(m[2]) - 1); setDateDay(Number(m[3])); setDateSelected(true); }
      }
    }
    // Time: from start_time (ISO or HH:MM[:SS]); preserve the exact minute.
    // A full ISO carries both the LA day and the LA clock, so take BOTH from
    // the LA side: day and time must come from the same wall clock or they
    // drift apart (the +1 shift paired a UTC day with an LA time).
    if (params.prefillStartTime) {
      const st = String(params.prefillStartTime);
      let hours: number | null = null; let minutes: number | null = null;
      if (st.includes('T')) {
        const w = getLAWallParts(st);
        if (w) {
          hours = w.hour24; minutes = w.minute;
          setDateMonth(w.m); setDateDay(w.d); setDateYear(w.y); setDateSelected(true);
        }
      }
      else if (st.includes(':')) { const parts = st.split(':'); hours = parseInt(parts[0], 10); minutes = parseInt(parts[1] ?? '0', 10); }
      if (hours !== null && minutes !== null && !isNaN(hours) && !isNaN(minutes)) {
        const period: 'AM' | 'PM' = hours >= 12 ? 'PM' : 'AM';
        let displayHour = hours % 12; if (displayHour === 0) displayHour = 12;
        setTimeHour(displayHour); setTimeMinute(String(minutes).padStart(2, '0')); setTimePeriod(period); setTimeSelected(true);
      }
    }
    // End time (optional): from end_time (ISO, read on the LA clock, or
    // HH:MM[:SS]); preserve the exact minute.
    if (params.prefillEndTime) {
      const et = String(params.prefillEndTime);
      let hours: number | null = null; let minutes: number | null = null;
      if (et.includes('T')) { const w = getLAWallParts(et); if (w) { hours = w.hour24; minutes = w.minute; } }
      else if (et.includes(':')) { const parts = et.split(':'); hours = parseInt(parts[0], 10); minutes = parseInt(parts[1] ?? '0', 10); }
      if (hours !== null && minutes !== null && !isNaN(hours) && !isNaN(minutes)) {
        const period: 'AM' | 'PM' = hours >= 12 ? 'PM' : 'AM';
        let displayHour = hours % 12; if (displayHour === 0) displayHour = 12;
        setEndTimeHour(displayHour); setEndTimeMinute(String(minutes).padStart(2, '0')); setEndTimePeriod(period); setEndTimeSelected(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.prefillTitle, params.prefillInvitePersonId, params.prefillInvitePersonName, params.prefillInvitePersonPhoto, params.duplicatedFromEventId]);

  // ── Invite suggestions (want-in only; reactance fix) ──
  const inviteSuggestions = useMemo<InviteSuggestion[]>(() => {
    const invitedIds = new Set(invited.map((c) => c.user_id));
    const seen = new Set<string>();
    const out: InviteSuggestion[] = [];
    for (const s of wantInSignals) {
      const id = s.interested_user_id;
      if (invitedIds.has(id) || hiddenWantIn.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push({
        user_id: id,
        name: s.interested_name?.trim() || 'Someone',
        photo: s.interested_photo_url,
        provenance: COPY.inviteProvenance(s.origin_event_title?.trim() || 'a plan'),
        isWantIn: true,
      });
    }
    return out;
  }, [invited, wantInSignals, hiddenWantIn]);

  const onInviteSuggestion = useCallback((s: InviteSuggestion) => {
    if (!composerUserId || !composerViewer.isCurrent()) return;
    hapticLight();
    setInvited((prev) => prev.some((c) => c.user_id === s.user_id) ? prev : [...prev, { user_id: s.user_id, name: s.name, photo: s.photo }]);
  }, [composerUserId, composerViewer.isCurrent]);
  const onRemoveChip = useCallback((userId: string) => {
    hapticLight();
    setInvited((prev) => prev.filter((c) => c.user_id !== userId));
  }, []);
  const onPickedFromPeople = useCallback((picked: PickedPerson[]) => {
    if (!composerUserId || !composerViewer.isCurrent()) return;
    if (picked.length === 0) return;
    hapticLight();
    setInvited((prev) => {
      const have = new Set(prev.map((c) => c.user_id));
      return [...prev, ...picked.filter((p) => !have.has(p.user_id))];
    });
  }, [composerUserId, composerViewer.isCurrent]);
  const onDismissSuggestion = useCallback((s: InviteSuggestion) => {
    hapticLight();
    setHiddenWantIn((prev) => new Set(prev).add(s.user_id));
    dismissSuggestion.mutate(s.user_id);
  }, [dismissSuggestion]);

  // ── Gender options derived from the creator's own gender ──
  const genderOptions = useMemo(() => {
    const opts: { label: string; value: GenderPreference }[] = [{ label: 'Mixed', value: 'mixed' }];
    if (userGender === 'woman') opts.push({ label: 'Women only', value: 'women_only' });
    else if (userGender === 'man') opts.push({ label: 'Men only', value: 'men_only' });
    else if (userGender === 'non_binary') opts.push({ label: 'Nonbinary only', value: 'nonbinary_only' });
    return opts;
  }, [userGender]);

  // ── Photo ──
  const pickImage = async () => {
    if (!isComposerCurrent() || !composerUserId || !photoVisit.current || photoAttempt.current || submittingRef.current) return;
    const attempt = {}, visit = photoVisit.current, userId = composerUserId;
    const isCurrentViewer = composerViewer.isCurrent;
    photoAttempt.current = attempt;
    setImageLoading(true);
    const isCurrent = () => mountedRef.current && isCurrentViewer() && photoVisit.current === visit && photoAttempt.current === attempt;
    let stage: 'choose' | 'prepare' | 'upload' = 'choose';
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [16, 10], quality: 1 });
      if (!isCurrent() || result.canceled || !result.assets?.[0]) return;
      stage = 'prepare';
      const manipulated = await ImageManipulator.manipulateAsync(result.assets[0].uri, [{ resize: { width: 1200 } }], { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      if (!isCurrent()) return;
      if (!manipulated.base64) throw new Error('Missing prepared image');
      setImageUrl(manipulated.uri);
      stage = 'upload';
      const identity = await requestWithDeadline(supabase.auth.getUser(), 12_000);
      if (!isCurrent()) return;
      if (identity.error || identity.data.user?.id !== userId) throw new Error('Could not confirm photo owner');
      const { error: refreshErr } = await requestWithDeadline(supabase.auth.refreshSession(), 12_000);
      if (!isCurrent()) return;
      if (refreshErr) throw refreshErr;
      const refreshedIdentity = await requestWithDeadline(supabase.auth.getUser(), 12_000);
      if (!isCurrent()) return;
      if (refreshedIdentity.error || refreshedIdentity.data.user?.id !== userId) throw new Error('Could not confirm photo owner');
      const publicUrl = await requestWithDeadline(uploadBase64ToStorage('event-images', `${userId}/${Date.now()}.jpg`, manipulated.base64), 30_000);
      if (isCurrent()) setImageUrl(publicUrl);
    } catch {
      if (!isCurrent()) return;
      setImageUrl(null);
      setAlertInfo(stage === 'choose'
        ? { title: 'Couldn’t open photos', message: 'Try again.' }
        : stage === 'upload'
          ? { title: 'Upload failed', message: 'Could not upload photo. Try again.' }
          : { title: 'Invalid image', message: PHOTO_FORMAT_ERROR_MESSAGE });
    } finally {
      if (photoAttempt.current === attempt) { photoAttempt.current = null; if (mountedRef.current && isCurrentViewer() && photoVisit.current === visit) setImageLoading(false); }
    }
  };

  // ── When handlers ──
  const selectQuick = (kind: QuickKind) => {
    hapticSelection();
    const d = quickDate(kind);
    setDateMonth(d.month); setDateDay(d.day); setDateYear(d.year); setDateSelected(true);
    if (!timeSelected) { setTimeHour(7); setTimeMinute('00'); setTimePeriod('PM'); setTimeSelected(true); }
  };
  const selectDate = (d: CalendarDay) => {
    hapticLight();
    setDateMonth(d.month); setDateDay(d.day); setDateYear(d.year); setDateSelected(true);
  };

  const toggleAgeRange = (range: AgeRange) => {
    hapticSelection();
    if (range === 'All Ages') { setAgeRanges(['All Ages']); return; }
    setAgeRanges((prev) => {
      const filtered = prev.filter((r) => r !== 'All Ages');
      if (filtered.includes(range)) return filtered.filter((r) => r !== range);
      if (filtered.length >= 2) return filtered;
      return [...filtered, range];
    });
  };

  // ── Derived ──
  const selectedDate = dateSelected ? { year: dateYear, month: dateMonth, day: dateDay } : null;
  const activeQuick: QuickKind | null = useMemo(() => {
    if (!dateSelected) return null;
    const sel = { year: dateYear, month: dateMonth, day: dateDay };
    if (sameDay(sel, quickDate('tonight'))) return 'tonight';
    if (sameDay(sel, quickDate('tomorrow'))) return 'tomorrow';
    return null;
  }, [dateSelected, dateYear, dateMonth, dateDay]);

  const place: PlaceValue | null = location.trim()
    ? { name: location.trim(), lat: locationLat, lng: locationLng, neighborhood: neighborhood || null }
    : null;
  const onPlaceChange = (v: PlaceValue | null) => {
    setLocation(v?.name ?? '');
    setLocationLat(v?.lat ?? null);
    setLocationLng(v?.lng ?? null);
    if (v?.neighborhood) setNeighborhood(v.neighborhood);
  };

  // Single owner of the one visible gold line (recovery > most-recent Tier-3).
  const nudge = useNudgeArbiter({
    recoveryActive: recoveryNudge,
    tonightEligible: activeQuick === 'tonight',
    placeSkipEligible: place == null,
  });

  // the preview is a passive readout, so its empty states describe instead
  // of instruct: "add a day" read like a tappable link and it is not (C19,
  // Liz's call: genuinely tappable or visually passive, nothing in between).
  // LIZ COPY
  const timeSummary = displayTime(timeHour, timeMinute, timePeriod);
  const whenSummary = dateSelected
    ? `${MONTHS[dateMonth]} ${dateDay}${timeSelected ? ` · ${appearance ? timeSummary : timeSummary.toLowerCase()}` : ''}`
    : appearance ? 'No day yet' : 'no day yet';
  const placeSummary = location.trim()
    ? appearance ? location.trim() : location.trim().toLowerCase()
    : appearance ? 'No place yet' : 'no place yet';
  const peopleSummary = invited.length > 0
    ? invited.map((c) => appearance ? c.name : c.name.toLowerCase()).join(', ')
    : appearance ? `Open to ${groupSize}` : `open to ${groupSize}`;
  const summaryMeta = [whenSummary, placeSummary, peopleSummary].join(' · ');

  const canPost = title.trim().length > 0 && dateSelected && timeSelected && category !== null && creatorMessage.trim().length >= MSG_MIN && description.trim().length > 0 && !loading && !imageLoading;

  // Validate in screen order, so the first correction is also the next field
  // the member sees. Drafts keep their existing, smaller set of requirements.
  const requiredErrors = (mode: ValidationMode): Partial<Record<RequiredField, string>> => ({
    ...(!title.trim() ? { title: 'Add a title for your plan.' } : {}),
    ...(mode === 'post' && category === null ? { category: 'Choose a category.' } : {}),
    ...(mode === 'post' && creatorMessage.trim().length < MSG_MIN ? { message: `Add a message with at least ${MSG_MIN} characters.` } : {}),
    ...(mode === 'post' && !description.trim() ? { description: 'Add a description so people know what to expect.' } : {}),
    ...(!dateSelected || !timeSelected ? { when: !dateSelected && !timeSelected ? 'Choose a day and a start time.' : !dateSelected ? 'Choose a day for your plan.' : 'Choose a start time.' } : {}),
  });
  const fieldErrors: Partial<Record<RequiredField, string>> = validationMode ? requiredErrors(validationMode) : {};
  const validateRequired = (mode: ValidationMode) => {
    const errors = requiredErrors(mode);
    const first = (Object.keys(errors) as RequiredField[])[0];
    setValidationMode(mode);
    if (!first) return true;
    AccessibilityInfo.announceForAccessibility(errors[first]!);
    const input = first === 'title' ? titleInputRef : first === 'message' ? messageInputRef : first === 'description' ? descriptionInputRef : null;
    if (input) input.current?.focus();
    else Keyboard.dismiss();
    scrollRef.current?.scrollTo({ y: Math.max(0, (sectionPositions.current[first] ?? 0) - 12), animated: true });
    return false;
  };
  const fieldError = (field: RequiredField) => fieldErrors[field] ? (
    <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.fieldError}>{fieldErrors[field]}</Text>
  ) : null;

  const resetForm = () => {
    setValidationMode(null);
    setTitle(''); setExploreEventId(null); setCategory(null); setImageUrl(null); setCreatorMessage('');
    setLocation(''); setLocationLat(null); setLocationLng(null); setNeighborhood('');
    setTicketUrl(''); setDescription(''); setGenderPref('mixed'); setAgeRanges([]);
    setGroupSize(6); setDateSelected(false); setTimeSelected(false); setDropIn(true);
    setAllowDuplicate(true); setInvited([]);
    setEndTimeSelected(false);
    // Clear every prefill/duplicate param after a successful post. Otherwise a
    // "Post your own" leaves duplicatedFromEventId (and the rest) in route state,
    // and the NEXT plan posted from this same screen is mis-tagged a duplicate -
    // firing notify_waitlist_duplicate_plan at the previous plan's waitlist.
    router.setParams({
      prefillTitle: undefined, prefillInvitePersonId: undefined,
      prefillInvitePersonName: undefined, prefillInvitePersonPhoto: undefined,
      prefillDescription: undefined, prefillLocation: undefined,
      prefillLocationLat: undefined, prefillLocationLng: undefined,
      prefillNeighborhood: undefined, prefillCategory: undefined,
      prefillImageUrl: undefined, prefillStartTime: undefined,
      prefillEndTime: undefined, prefillEventDate: undefined,
      prefillDropIn: undefined, prefillAllowDuplicate: undefined,
      prefillAgeRange: undefined, prefillGenderPref: undefined,
      prefillGroupSize: undefined, prefillTicketsUrl: undefined,
      prefillExploreEventId: undefined,
      duplicatedFromEventId: undefined,
      draftId: undefined,
    } as never);
  };

  useLayoutEffect(() => {
    const previous = invitationOwner.current;
    // Keep the initial route prefill while identity loads. A later account
    // transition owns a fresh form and retires every prior write, even A→B→A.
    if (previous.viewerId !== undefined && previous.epoch !== composerViewer.epoch) {
      retireWrite();
      photoVisit.current = null; photoAttempt.current = null; setImageLoading(false);
      resetForm();
      postInvitations.reset();
      setLoading(false);
      setHiddenWantIn(new Set());
      setPeoplePickerOpen(false);
      setShowNeighborhoodPicker(false);
      setConfirmVisible(false);
      setShareModalVisible(false);
      setShareWanted(false);
      setPostedPlanId(null);
      postedPlanIdRef.current = null;
      setPostedPlanTitle('');
      setPostedGenderLabel(undefined);
      setConfirmMeta('');
      setRecoveryNudge(false);
      setAlertInfo(null);
    }
    invitationOwner.current = { viewerId: composerViewer.viewerId, epoch: composerViewer.epoch };
  }, [composerViewer.epoch, composerViewer.viewerId]);

  // ── Save as draft (COMMUNITIES_ENABLED): title + when are enough; the rest
  // waits. No host member row, no feed presence, no waitlist notify - the row
  // sits at status 'draft', visible only in Yours until it posts. ──
  const canSaveDraft = title.trim().length > 0 && dateSelected && timeSelected && !loading && !imageLoading;
  const handleSaveDraft = async () => {
    if (!isComposerCurrent() || submittingRef.current || photoAttempt.current || loading || imageLoading || confirmVisible) return;
    if (!validateRequired('draft')) return;
    const fieldsToCheck = [title, description, creatorMessage, location].filter(Boolean).join(' ');
    const filter = checkContent(fieldsToCheck);
    if (!filter.ok) {
      setAlertInfo({ title: 'Content not allowed', message: filter.reason ?? 'Please revise your plan and try again.' });
      return;
    }
    if (!isValidLAWallTime(dateYear, dateMonth, dateDay, timeHour % 12 + (timePeriod === 'PM' ? 12 : 0), Number(timeMinute))) {
      setAlertInfo({ title: 'Choose another time', message: 'That date or time does not exist in Los Angeles. Pick a different time.' });
      return;
    }
    const startTime = buildDatetime(dateMonth, dateDay, dateYear, timeHour, timeMinute, timePeriod);
    let endTimeIso: string | null = null;
    if (endTimeSelected) {
      const endDt = resolveOvernightLAEnd(dateYear, dateMonth, dateDay,
        timeHour % 12 + (timePeriod === 'PM' ? 12 : 0), Number(timeMinute),
        endTimeHour % 12 + (endTimePeriod === 'PM' ? 12 : 0), Number(endTimeMinute));
      if (!endDt) {
        setAlertInfo({ title: 'Choose another end time', message: 'That end time does not exist in Los Angeles. Pick a different time.' });
        return;
      }
      endTimeIso = endDt.toISOString();
    }
    const ageBounds = ageRangesToMinMax(ageRanges);
    const row = {
      title: title.trim(),
      start_time: startTime.toISOString(),
      end_time: endTimeIso,
      drop_in: dropIn,
      allow_duplicate: allowDuplicate,
      location_text: location.trim() || null,
      location_lat: locationLat,
      location_lng: locationLng,
      tickets_url: ticketUrl.trim() || null,
      primary_vibe: category?.toLowerCase() ?? null,
      gender_rule: genderPref,
      target_age_min: ageBounds.min,
      target_age_max: ageBounds.max,
      description: description.trim() || null,
      host_message: creatorMessage.trim().slice(0, MSG_LIMIT) || null,
      max_invites: groupSize,
      min_invites: MIN_GROUP,
      status: 'draft',
      city: 'Los Angeles',
      image_url: (imageUrl && imageUrl.startsWith('http')) ? imageUrl : null,
      neighborhood: neighborhood.trim() || null,
      explore_event_id: exploreEventId,
    };
    const write = beginWrite();
    if (!write) return;
    try {
      const { data: { user }, error: identityError } = await supabase.auth.getUser();
      if (!ownsWrite(write)) return;
      if (identityError || !user || user.id !== write.userId) throw new Error('auth');
      if (params.draftId) {
        const { error } = await supabase
          .from('events')
          .update(row)
          .eq('id', String(params.draftId))
          .eq('creator_user_id', user.id)
          .eq('status', 'draft');
        if (!ownsWrite(write)) return;
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('events')
          .insert({ ...row, creator_user_id: user.id });
        if (!ownsWrite(write)) return;
        if (error) throw error;
      }
      hapticSuccess();
      queryClient.invalidateQueries({ queryKey: ['my-plan-drafts'] });
      resetForm();
      // LIZ COPY
      setAlertInfo({ title: appearance ? 'Draft saved' : 'saved', message: appearance ? 'Find your draft in Yours under Plans. Finish it whenever you’re ready.' : 'your draft lives in yours, under plans. finish it whenever.' });
    } catch {
      if (!ownsWrite(write)) return;
      setAlertInfo({ title: 'That did not save', message: 'Try again in a moment.' });
    } finally {
      if (ownsWrite(write)) {
        writeRef.current = null;
        submittingRef.current = false;
        setLoading(false);
      }
    }
  };

  // ── Submit (optimistic: the post moment shows instantly; the insert runs in
  // the background and recovers quietly in gold on failure). ──
  const handleSubmit = async () => {
    if (!isComposerCurrent() || submittingRef.current) return;
    if (photoAttempt.current || loading || imageLoading || confirmVisible) return;
    if (!validateRequired('post')) return;
    const fieldsToCheck = [title, description, creatorMessage, location].filter(Boolean).join(' ');
    const filter = checkContent(fieldsToCheck);
    if (!filter.ok) {
      setAlertInfo({ title: 'Content not allowed', message: filter.reason ?? 'Please revise your plan and try again.' });
      return;
    }
    if (!isValidLAWallTime(dateYear, dateMonth, dateDay, timeHour % 12 + (timePeriod === 'PM' ? 12 : 0), Number(timeMinute))) {
      setAlertInfo({ title: 'Choose another time', message: 'That date or time does not exist in Los Angeles. Pick a different time.' });
      return;
    }
    const startTime = buildDatetime(dateMonth, dateDay, dateYear, timeHour, timeMinute, timePeriod);
    if (startTime <= new Date()) {
      setAlertInfo({ title: 'Pick a future time', message: 'That time has already passed.' });
      return;
    }

    // Optional end time (legacy parity): roll an earlier clock time to the next
    // day (overnight), require at least 30 min after start.
    let endTimeIso: string | null = null;
    if (endTimeSelected) {
      const endDt = resolveOvernightLAEnd(dateYear, dateMonth, dateDay,
        timeHour % 12 + (timePeriod === 'PM' ? 12 : 0), Number(timeMinute),
        endTimeHour % 12 + (endTimePeriod === 'PM' ? 12 : 0), Number(endTimeMinute));
      if (!endDt) {
        setAlertInfo({ title: 'Choose another end time', message: 'That end time does not exist in Los Angeles. Pick a different time.' });
        return;
      }
      if (endDt.getTime() - startTime.getTime() < 30 * 60 * 1000) {
        setAlertInfo({ title: 'Give it a little longer', message: 'An end time should be at least 30 minutes after the start.' });
        return;
      }
      endTimeIso = endDt.toISOString();
    }

    const write = beginWrite();
    if (!write) return;
    // Freeze this attempt's fields; the form resets only after confirmation.
    const ageBounds = ageRangesToMinMax(ageRanges);
    const row = {
      title: title.trim(),
      start_time: startTime.toISOString(),
      end_time: endTimeIso,
      drop_in: dropIn,
      allow_duplicate: allowDuplicate,
      location_text: location.trim() || null,
      location_lat: locationLat,
      location_lng: locationLng,
      tickets_url: ticketUrl.trim() || null,
      primary_vibe: category?.toLowerCase() ?? null,
      gender_rule: genderPref,
      target_age_min: ageBounds.min,
      target_age_max: ageBounds.max,
      description: description.trim() || null,
      host_message: creatorMessage.trim().slice(0, MSG_LIMIT) || null,
      max_invites: groupSize,
      min_invites: MIN_GROUP,
      status: 'forming',
      city: 'Los Angeles',
      image_url: (imageUrl && imageUrl.startsWith('http')) ? imageUrl : null,
      neighborhood: neighborhood.trim() || null,
      explore_event_id: exploreEventId,
      duplicated_from_event_id: params.duplicatedFromEventId ? String(params.duplicatedFromEventId) : null,
    };
    const inviteIds = invited.map((c) => c.user_id);
    postedPlanIdRef.current = null;
    const invitationRequest = postInvitations.prepare(inviteIds);
    const genderLabelSnap =
      genderPref === 'women_only' ? 'Women only'
        : genderPref === 'men_only' ? 'Men only'
        : genderPref === 'nonbinary_only' ? 'Nonbinary only' : undefined;
    const isFirst = neverPostedRef.current;

    // Optimistic: show the moment instantly + one success haptic.
    hapticSuccess();
    setConfirmIsFirst(isFirst);
    setConfirmMeta(summaryMeta);
    setPostedPlanTitle(row.title);
    setPostedGenderLabel(genderLabelSnap);
    setPostedPlanId(null);
    setRecoveryNudge(false);
    setConfirmVisible(true);
    // The form is NOT reset yet: if the background insert fails we restore the
    // composer with the data intact so the post can be retried.

    // Real optimistic posting: prepend a server-shaped Plan to the feed +
    // my-plans caches now, so the new plan is in those lists instantly (not after
    // the post-insert refetch). Committed to the real id once the event + host
    // member rows land; rolled back exactly on failure. composerUserId is the
    // synchronous auth id; the keys require it (partial keys no-op for setQueryData).
    let optimistic: OptimisticHandle | null = null;
    if (composerUserId) {
      const face = queryClient.getQueryData<MyFace>(['yours', 'my-face', composerUserId]);
      optimistic = prependOptimisticPlan(
        queryClient,
        composerUserId,
        buildOptimisticPlan(row, composerUserId, {
          id: composerUserId,
          first_name_display: face?.first_name_display ?? null,
          profile_photo_url: face?.profile_photo_url ?? null,
        }),
      );
      write.optimistic = optimistic;
    }

    // Background insert. `loading` tracks the real in-flight window so the post
    // button's spinner is reachable and `canPost`'s !loading is a true second
    // guard against a re-submit racing the insert (alongside confirmVisible).
    // submittingRef is the synchronous guard above (see its declaration).
    try {
      const { data: { user }, error: identityError } = await supabase.auth.getUser();
      if (!ownsWrite(write)) return;
      if (identityError || !user || user.id !== write.userId) throw new Error('auth');
      let insertedEvent: { id: string } | null = null;
      if (params.draftId) {
        // finishing a draft: the row exists, flip it to forming with the
        // final fields; the host member row lands below like any new plan
        const { data: updated, error: updateErr } = await supabase
          .from('events')
          .update(row)
          .eq('id', String(params.draftId))
          .eq('creator_user_id', user.id)
          .select('id')
          .single();
        if (!ownsWrite(write)) return;
        if (updateErr) throw updateErr;
        insertedEvent = updated;
      } else {
        const { data: inserted, error } = await supabase
          .from('events')
          .insert({ ...row, creator_user_id: user.id })
          .select('id')
          .single();
        if (!ownsWrite(write)) return;
        if (error) throw error;
        insertedEvent = inserted;
      }

      if (!insertedEvent?.id) throw new Error('The saved plan could not be confirmed.');
      if (insertedEvent.id) {
        const { error: memberErr } = await supabase.from('event_members').insert({
          event_id: insertedEvent.id, user_id: user.id, role: 'host', status: 'joined',
        });
        if (!ownsWrite(write)) return;
        if (memberErr) {
          await new Promise((r) => setTimeout(r, 500));
          if (!ownsWrite(write)) return;
          const { error: retryErr } = await supabase.from('event_members').insert({
            event_id: insertedEvent.id, user_id: user.id, role: 'host', status: 'joined',
          });
          if (!ownsWrite(write)) return;
          if (retryErr) {
            // Best-effort rollback of the orphaned event. Error-check it: a
            // failed delete leaves an event with no host member, so flag that
            // case distinctly - both paths fall through to the quiet gold
            // recovery below so the creator can simply retry. A resumed draft
            // rolls back to 'draft' instead of being deleted.
            const { error: rollbackErr } = params.draftId
              ? (await supabase.from('events').update({ status: 'draft' }).eq('id', insertedEvent.id)) 
              : (await supabase.from('events').delete().eq('id', insertedEvent.id));
            if (!ownsWrite(write)) return;
            throw new Error(rollbackErr ? 'member_orphan' : 'member');
          }
        }
        // Event + host member rows both committed: swap the optimistic card's
        // temp id for the real one so it's tappable and routes correctly. Done
        // only now (not right after the event insert) so an orphan rollback above
        // still removes the card via the catch's rollback().
        optimistic?.commit(insertedEvent.id);
        write.optimistic = null;
        // If this was a "Post your own" duplicate, notify the source plan's
        // waitlist (fire-and-forget; mirrors LegacyComposer).
        if (params.duplicatedFromEventId) {
          supabase.rpc('notify_waitlist_duplicate_plan', {
            p_original_event_id: String(params.duplicatedFromEventId),
            p_new_event_id: insertedEvent.id,
            p_creator_user_id: user.id,
          }).then(({ error: notifyErr }) => {
            if (notifyErr) console.warn('[post] notify_waitlist_duplicate_plan failed:', notifyErr.message);
          });
        }
        if (inviteIds.length > 0) {
          void postInvitations.send(invitationRequest, insertedEvent.id, user.id);
        }
      }

      queryClient.invalidateQueries({ queryKey: ['events', 'feed'] });
      queryClient.invalidateQueries({ queryKey: ['my-plans'] });
      queryClient.invalidateQueries({ queryKey: ['my-plan-drafts'] });
      queryClient.invalidateQueries({ queryKey: ['feed-member-ids'] });
      postedPlanIdRef.current = insertedEvent.id;
      setPostedPlanId(insertedEvent.id);
      if (isFirst) {
        // A local celebration preference cannot undo a committed plan or make
        // the recovery UI invite a duplicate post.
        await AsyncStorage.setItem('hasSeenFirstPlanCelebration', '1').catch(() => {});
        if (!ownsWrite(write)) return;
        neverPostedRef.current = false;
      }
      resetForm();
    } catch {
      if (!ownsWrite(write)) return;
      // Remove the optimistic card from feed + my-plans (restores the exact prior
      // snapshot) before the recovery UX runs.
      write.optimistic?.rollback();
      write.optimistic = null;
      // Quiet gold recovery: pull the moment, reopen the composer with the data
      // intact and a gold nudge. No red, never a hard error dialog.
      setConfirmVisible(false);
      setShareWanted(false);
      postInvitations.reset();
      setRecoveryNudge(true);
    } finally {
      if (ownsWrite(write)) {
        writeRef.current = null;
        setLoading(false);
        submittingRef.current = false;
      }
    }
  };

  const sheetBottomPad = Platform.OS === 'ios' ? 40 : Math.max(insets.bottom, 16) + 16;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <StatusBar style="dark" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={cancelComposer} accessibilityRole="button" accessibilityLabel="Cancel" style={appearance ? styles.headerAction : undefined} hitSlop={12}>
          <Text style={styles.cancel}>{appearance ? 'Cancel' : 'cancel'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{appearance ? 'New plan' : 'new plan'}</Text>
        {/* Stays tappable when the form is incomplete so handleSubmit can surface
            field errors and reveal the first missing section. Only a genuine
            in-flight post (loading/imageLoading) blocks the tap; the greyed
            look is still keyed to !canPost. */}
        <TouchableOpacity onPress={handleSubmit} disabled={loading || imageLoading} accessibilityRole="button" accessibilityLabel="Post" accessibilityState={{ disabled: loading || imageLoading, busy: loading }} style={appearance ? styles.headerAction : undefined} hitSlop={12}>
          <Text style={[styles.postInline, !canPost && styles.postInlineOff]}>{appearance ? 'Post' : 'post'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        // iOS: inset scroll content for the keyboard so the title/message inputs
        // are never covered on shorter screens, with no jump. No-op on Android
        // (handled by windowSoftInputMode) and when the input is already visible.
        automaticallyAdjustKeyboardInsets
        showsVerticalScrollIndicator={false}
      >
        {/* WHAT + photo */}
        <View style={styles.section} onLayout={event => { sectionPositions.current.title = event.nativeEvent.layout.y; }}>
          <EditorialTitleField inputRef={titleInputRef} error={fieldErrors.title} appearance={appearance} label={appearance ? "Plan title" : undefined} value={title} onChangeText={setTitle} placeholder={appearance ? "Sunset hike at Runyon" : "sunset hike at runyon"} />
          {fieldError('title')}
          <View style={styles.photoRow}>
            {imageUrl ? (
              <View style={styles.photoThumbWrap}>
                <Image source={{ uri: imageUrl }} style={styles.photoThumb} contentFit="cover" />
                {imageLoading ? (
                  <View style={styles.photoThumbOverlay}><ActivityIndicator color={Colors.white} /></View>
                ) : (
                  <TouchableOpacity style={styles.photoRemove} accessibilityRole="button" accessibilityLabel="Remove photo" onPress={() => { hapticLight(); setImageUrl(null); }} hitSlop={8}>
                    <X size={13} color={Colors.white} strokeWidth={2.5} />
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <TouchableOpacity style={styles.photoAdd} accessibilityRole="button" accessibilityLabel={imageLoading ? "Adding photo" : "Add photo"} accessibilityState={{ disabled: imageLoading, busy: imageLoading }} disabled={imageLoading} onPress={pickImage} activeOpacity={0.7}>
                <ImagePlus size={18} color={muted} strokeWidth={2} />
                <Text style={styles.photoAddText}>{imageLoading ? 'Adding photo…' : appearance ? 'Add photo' : 'add a photo'}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* CATEGORY */}
        <View style={styles.section} onLayout={event => { sectionPositions.current.category = event.nativeEvent.layout.y; }}>
          <CategoryChips expanded appearance={appearance} label={appearance ? "Category" : undefined} selected={category} onSelect={setCategory} />
          {fieldError('category')}
        </View>

        {/* YOUR MESSAGE (required) */}
        <View style={styles.section} onLayout={event => { sectionPositions.current.message = event.nativeEvent.layout.y; }}>
          <Text style={styles.label}>{appearance ? 'Your message' : 'your message'}{appearance ? <Text style={styles.labelOptional}> · required</Text> : null}</Text>
          <TextInput
            ref={messageInputRef}
            style={[styles.messageInput, fieldErrors.message ? styles.invalidInput : undefined]}
            value={creatorMessage}
            accessibilityLabel="Your message, required"
            accessibilityHint={fieldErrors.message}
            onChangeText={setCreatorMessage}
            placeholder={appearance ? "Going up the back trail, golden hour pace, no rush…" : "going up the back trail, golden hour pace, no rush..."}
            placeholderTextColor={placeholder}
            multiline
            maxLength={MSG_LIMIT}
          />
          {fieldError('message')}
          {!fieldErrors.message && title.trim().length > 0 && creatorMessage.trim().length < MSG_MIN
            ? <InlineNudge appearance={appearance} text={COPY.composerMessageRequired} /> : null}
        </View>

        {/* DESCRIPTION (required; surfaced out of "more options") */}
        <View style={styles.section} onLayout={event => { sectionPositions.current.description = event.nativeEvent.layout.y; }}>
          <View style={styles.descLabelRow}>
            <Text style={[styles.label, { marginBottom: 0 }]}>{appearance ? 'Description' : 'description'}{appearance ? <Text style={styles.labelOptional}> · required</Text> : null}</Text>
            <Text
              style={[
                styles.charCounter,
                description.length >= DESC_LIMIT - DESC_WARN_MARGIN && styles.charCounterWarn,
              ]}
            >
              {description.length}/{DESC_LIMIT}
            </Text>
          </View>
          <TextInput
            ref={descriptionInputRef}
            style={[styles.textField, styles.textArea, fieldErrors.description ? styles.invalidInput : undefined]}
            value={description}
            accessibilityLabel="Description, required"
            accessibilityHint={fieldErrors.description}
            onChangeText={setDescription}
            placeholder={appearance ? "Details people need before joining" : "anything else worth knowing"}
            placeholderTextColor={placeholder}
            multiline
            maxLength={DESC_LIMIT}
          />
          {fieldError('description')}
          {!fieldErrors.description && title.trim().length > 0 && description.trim().length === 0
            ? <InlineNudge appearance={appearance} text={COPY.composerDescriptionRequired} /> : null}
          {(() => {
            // One-tap (never silent): a pasted URL in the description is offered
            // a home in the ticket/link field, so links stop becoming a wall.
            const detectedUrl = extractFirstUrl(description);
            return detectedUrl && !ticketUrl.trim() ? (
              <InlineNudge
                appearance={appearance}
                text={COPY.composerLinkDetected}
                actionLabel={appearance ? "Add link" : "add it"}
                onPress={() => {
                  hapticLight();
                  setTicketUrl(detectedUrl);
                  setDescription((d) =>
                    d.replace(detectedUrl, '').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim(),
                  );
                }}
              />
            ) : null;
          })()}
        </View>

        {/* WHEN */}
        <View style={styles.section} onLayout={event => { sectionPositions.current.when = event.nativeEvent.layout.y; }}>
          <Text style={styles.label}>{appearance ? 'When' : 'when'}</Text>
          {fieldError('when')}
          <View style={styles.quickRow}>
            {(['tonight', 'tomorrow'] as QuickKind[]).map((k) => {
              const on = activeQuick === k;
              return (
                <TouchableOpacity
                  key={k}
                  accessibilityRole="button" accessibilityLabel={k === "tonight" ? "Tonight" : "Tomorrow"} accessibilityState={{ selected: on }}
                  activeOpacity={0.7}
                  onPress={() => selectQuick(k)}
                  style={[styles.quickChip, on && styles.quickChipOn]}
                >
                  <Text style={[styles.quickChipText, on && styles.quickChipTextOn]}>{appearance ? (k === 'tonight' ? 'Tonight' : 'Tomorrow') : k}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <CollapsibleCalendar appearance={appearance} selected={selectedDate} onSelect={selectDate} />
          <TimePicker
            appearance={appearance}
            hour={timeHour}
            minute={timeMinute}
            period={timePeriod}
            selected={timeSelected}
            onChange={(h, m, p) => { setTimeHour(h); setTimeMinute(m); setTimePeriod(p); setTimeSelected(true); }}
          />
          <View style={styles.endTimeRow}>
            <Text style={styles.subLabel}>{appearance ? 'Ends' : 'ends'}<Text style={styles.labelOptional}> · optional</Text></Text>
            {endTimeSelected ? (
              <TouchableOpacity onPress={() => { hapticLight(); setEndTimeSelected(false); }} accessibilityRole="button" accessibilityLabel="Clear end time" style={appearance ? styles.clearEndAction : undefined} hitSlop={8}>
                <Text style={styles.clearEndText}>{appearance ? 'Clear' : 'clear'}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <TimePicker
            appearance={appearance}
            hour={endTimeHour}
            minute={endTimeMinute}
            period={endTimePeriod}
            selected={endTimeSelected}
            onChange={(h, m, p) => { setEndTimeHour(h); setEndTimeMinute(m); setEndTimePeriod(p); setEndTimeSelected(true); }}
          />
          {nudge === 'tonight' ? <InlineNudge appearance={appearance} text={COPY.composerTonightNudge} /> : null}
        </View>

        {/* WHERE */}
        <View style={styles.section}>
          <Text style={styles.label}>{appearance ? 'Where' : 'where'}</Text>
          <PlacePicker appearance={appearance} value={place} onChange={onPlaceChange} />
          {nudge === 'placeSkip' ? <InlineNudge appearance={appearance} text={NUDGE_PLACE_BASE} /> : null}
        </View>

        {/* LINK OR TICKETS (surfaced from the retired "more options"; decision-shaping,
            and the visible home that keeps links out of the description) */}
        <View style={styles.section}>
          <Text style={styles.label}>{appearance ? 'Link or tickets' : 'link or tickets'}<Text style={styles.labelOptional}> · optional</Text></Text>
          <TextInput
            style={styles.textField}
            value={ticketUrl}
            accessibilityLabel="Link or tickets, optional"
            onChangeText={setTicketUrl}
            placeholder="https://"
            placeholderTextColor={placeholder}
            autoCapitalize="none"
            keyboardType="url"
          />
        </View>

        {/* HOW MANY (existing semantics, new skin) */}
        <View style={styles.section}>
          <Text style={styles.label}>{appearance ? 'How many' : 'how many'}</Text>
          <View style={styles.stepperRow}>
            <TouchableOpacity
              style={[styles.stepperBtn, groupSize <= MIN_GROUP - 1 && styles.stepperBtnOff]}
              onPress={() => { if (groupSize > MIN_GROUP - 1) { hapticLight(); setGroupSize((g) => g - 1); } }}
              disabled={groupSize <= MIN_GROUP - 1}
              accessibilityRole="button" accessibilityLabel="Fewer people" accessibilityState={{ disabled: groupSize <= MIN_GROUP - 1 }}
            >
              <Text style={styles.stepperBtnText}>−</Text>
            </TouchableOpacity>
            <View style={styles.stepperValue}>
              <Text style={styles.stepperValueNum}>{groupSize + 1}</Text>
              <Text style={styles.stepperValueSub}>people total</Text>
            </View>
            <TouchableOpacity
              style={[styles.stepperBtn, groupSize >= MAX_GROUP - 1 && styles.stepperBtnOff]}
              onPress={() => { if (groupSize < MAX_GROUP - 1) { hapticLight(); setGroupSize((g) => g + 1); } }}
              disabled={groupSize >= MAX_GROUP - 1}
              accessibilityRole="button" accessibilityLabel="More people" accessibilityState={{ disabled: groupSize >= MAX_GROUP - 1 }}
            >
              <Text style={styles.stepperBtnText}>+</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.stepperHint}>including you</Text>

          {/* WHO CAN JOIN + AGES (safety: never buried) */}
          <View style={styles.audienceRow}>
            <Text style={styles.subLabel}>{appearance ? 'Who can join' : 'who can join'}</Text>
            <View style={styles.pillWrap}>
              {genderOptions.map((opt) => {
                const on = genderPref === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    accessibilityRole="radio" accessibilityLabel={opt.label} accessibilityState={{ checked: on }}
                    activeOpacity={0.7}
                    onPress={() => { hapticSelection(); setGenderPref(opt.value); }}
                    style={[styles.smallPill, on && styles.smallPillOn]}
                  >
                    <Text style={[styles.smallPillText, on && styles.smallPillTextOn]}>{opt.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
          <View style={styles.audienceRow}>
            <Text style={styles.subLabel}>{appearance ? 'Ages' : 'ages'}</Text>
            <View style={styles.pillWrap}>
              {AGE_RANGES.map((r) => {
                const on = ageRanges.includes(r);
                return (
                  <TouchableOpacity
                    key={r}
                    accessibilityRole="checkbox" accessibilityLabel={r} accessibilityState={{ checked: on }}
                    activeOpacity={0.7}
                    onPress={() => toggleAgeRange(r)}
                    style={[styles.smallPill, on && styles.smallPillOn]}
                  >
                    <Text style={[styles.smallPillText, on && styles.smallPillTextOn]}>{appearance && r === 'All Ages' ? 'All ages' : r}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        {/* JOINABILITY (surfaced from the retired "more options"; decision-shaping) */}
        <View style={styles.section}>
          <TouchableOpacity style={styles.toggleRow} accessibilityRole="switch" accessibilityLabel="Drop-in welcome" accessibilityState={{ checked: dropIn }} onPress={() => { hapticLight(); setDropIn((v) => !v); }} activeOpacity={0.7}>
            <View style={styles.toggleTextWrap}>
              <Text style={styles.toggleTitle}>{appearance ? 'Drop-in welcome' : 'drop-in welcome'}</Text>
              <Text style={styles.toggleSub}>{appearance ? 'People can still join after it starts' : 'people can still join after it starts'}</Text>
            </View>
            <View style={[styles.switchTrack, dropIn && styles.switchTrackOn]}>
              <View style={[styles.switchThumb, dropIn && styles.switchThumbOn]} />
            </View>
          </TouchableOpacity>
        </View>

        {/* INVITE PEOPLE */}
        <View style={styles.section}>
          <InvitePeopleSection
            appearance={appearance}
            invited={invited}
            suggestions={inviteSuggestions}
            showAll={inviteShowAll}
            onToggleShowAll={() => setInviteShowAll(true)}
            onInvite={onInviteSuggestion}
            onRemoveChip={onRemoveChip}
            onDismiss={onDismissSuggestion}
            onAddFromPeople={() => setPeoplePickerOpen(true)}
          />
        </View>

        {/* OPTIONAL EXTRAS (genuinely secondary; quiet, at the bottom, no collapsible.
            Ticket link + drop-in were surfaced above into the main flow.) */}
        <View style={[styles.section, styles.secondarySection]}>
          <Text style={styles.secondaryHeader}>{appearance ? 'Optional extras' : 'optional extras'}</Text>
          <Text style={styles.mutedLabel}>{appearance ? 'Neighborhood' : 'neighborhood'}</Text>
          <TouchableOpacity style={styles.selectField} accessibilityRole="button" accessibilityLabel="Neighborhood, optional" onPress={() => setShowNeighborhoodPicker(true)} activeOpacity={0.7}>
            <Text style={[styles.selectFieldText, !neighborhood && styles.selectFieldPlaceholder]}>
              {neighborhood || (appearance ? 'Choose a neighborhood' : 'pick a neighborhood')}
            </Text>
            <ChevronDown size={18} color={muted} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.toggleRow} accessibilityRole="switch" accessibilityLabel="Let others copy this plan" accessibilityState={{ checked: allowDuplicate }} onPress={() => { hapticLight(); setAllowDuplicate((v) => !v); }} activeOpacity={0.7}>
            <View style={styles.toggleTextWrap}>
              <Text style={styles.toggleTitle}>{appearance ? 'Let others copy this plan' : 'let others copy this plan'}</Text>
              <Text style={styles.toggleSub}>{appearance ? 'When it fills, others can post their own' : 'when it fills, others can post their own'}</Text>
            </View>
            <View style={[styles.switchTrack, allowDuplicate && styles.switchTrackOn]}>
              <View style={[styles.switchThumb, allowDuplicate && styles.switchThumbOn]} />
            </View>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Sticky live post bar */}
      <View style={[styles.postBar, { paddingBottom: sheetBottomPad }]}>
        {nudge === 'recovery' ? (
          <TouchableOpacity style={styles.recoveryNudge} accessibilityRole="button" accessibilityLabel="Dismiss posting reminder" onPress={() => setRecoveryNudge(false)} activeOpacity={0.8}>
            <View style={styles.recoveryDot} />
            <Text style={styles.recoveryText}>{appearance ? 'That didn’t go through. Your plan is still here. Tap Post to try again.' : "that didn't go through. your plan is here. tap post to try again."}</Text>
          </TouchableOpacity>
        ) : null}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle} numberOfLines={1}>
            {title.trim() || (appearance ? 'Your plan' : 'your plan')}
          </Text>
          <Text style={styles.summaryMeta} numberOfLines={1}>{summaryMeta}</Text>
        </View>
        <View style={appearance ? styles.postActions : undefined}>
        <TouchableOpacity
          style={[styles.postBtn, !canPost && styles.postBtnOff]}
          accessibilityRole="button" accessibilityLabel={appearance ? "Post plan" : "post the plan"} accessibilityState={{ disabled: loading || imageLoading, busy: loading }}
          onPress={handleSubmit}
          disabled={loading || imageLoading}
          activeOpacity={0.85}
        >
          {loading ? <ActivityIndicator color={Colors.white} /> : <Text style={styles.postBtnText}>{appearance ? 'Post plan' : 'post the plan'}</Text>}
        </TouchableOpacity>
        {COMMUNITIES_ENABLED && (
          <TouchableOpacity
            onPress={handleSaveDraft}
            disabled={loading || imageLoading}
            hitSlop={8}
            style={styles.draftLinkWrap}
            accessibilityRole="button" accessibilityLabel={appearance ? "Save draft" : "save it as a draft"} accessibilityState={{ disabled: loading || imageLoading }}
          >
            {/* LIZ COPY */}
            <Text style={[styles.draftLink, !canSaveDraft && styles.draftLinkOff]}>{appearance ? 'Save draft' : 'save it as a draft'}</Text>
          </TouchableOpacity>
        )}
        </View>
      </View>

      {/* Neighborhood picker modal */}
      <Modal visible={showNeighborhoodPicker} transparent animationType="slide" onRequestClose={() => setShowNeighborhoodPicker(false)} statusBarTranslucent>
        <Pressable style={styles.modalOverlay} onPress={() => setShowNeighborhoodPicker(false)}>
          <Pressable style={[styles.modalSheet, { paddingBottom: sheetBottomPad }]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}><Text style={styles.modalTitle}>{appearance ? 'Choose neighborhood' : 'which neighborhood?'}</Text>{appearance && <TouchableOpacity style={styles.headerAction} accessibilityRole="button" accessibilityLabel="Close neighborhood picker" onPress={() => setShowNeighborhoodPicker(false)}><Text style={styles.cancel}>Close</Text></TouchableOpacity>}</View>
            <ScrollView style={styles.neighborhoodList} showsVerticalScrollIndicator={false}>
              {[...NEIGHBORHOOD_OPTIONS, NEIGHBORHOOD_OTHER].map((opt) => {
                const on = neighborhood === opt;
                return (
                  <TouchableOpacity key={opt} accessibilityRole="radio" accessibilityLabel={opt} accessibilityState={{ checked: on }} style={styles.neighborhoodOpt} onPress={() => { hapticLight(); setNeighborhood(opt); setShowNeighborhoodPicker(false); }} activeOpacity={0.7}>
                    <Text style={[styles.neighborhoodOptText, on && styles.neighborhoodOptTextOn]}>{opt}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* People picker */}
      <PeoplePickerSheet
        appearance={appearance}
        visible={peoplePickerOpen}
        onClose={() => setPeoplePickerOpen(false)}
        excludeIds={invited.map((c) => c.user_id)}
        onConfirm={onPickedFromPeople}
      />

      {/* The post moment (Tier-1, one per event). */}
      <PostConfirmation
        appearance={appearance}
        visible={confirmVisible}
        isFirstPlan={confirmIsFirst}
        planTitle={postedPlanTitle}
        metaLine={confirmMeta}
        planReady={!!postedPlanId}
        invitationStatus={postInvitations.status}
        canRetryInvites={postInvitations.canRetry}
        canContinue={() => isComposerCurrent() && !!postedPlanIdRef.current && postInvitations.canContinue()}
        onRetryInvites={() => { if (isComposerCurrent()) void postInvitations.retry(); }}
        onShare={() => {
          if (!isComposerCurrent() || !postedPlanIdRef.current || !postInvitations.canContinue()) return;
          if (postedPlanId) { setConfirmVisible(false); setShareModalVisible(true); }
          else setShareWanted(true); // open the share sheet once the id lands
        }}
        onSeePlans={() => {
          if (!isComposerCurrent() || !postedPlanIdRef.current || !postInvitations.canContinue()) return;
          const id = postedPlanIdRef.current;
          setConfirmVisible(false);
          setTimeout(() => {
            if (!isComposerCurrent()) return;
            if (id) {
              requestPlanNotificationPrompt({ userId: composerUserId!, planId: id, reason: 'posted' }, isComposerCurrent);
              router.push(`/plan/${id}` as any);
            }
            else router.replace('/(tabs)/plans');
          }, 200);
        }}
      />

      {/* "share it" opens the existing share content, on intent only. */}
      <SharePlanModal
        appearance={appearance}
        visible={shareModalVisible}
        onClose={() => {
          if (!isComposerCurrent()) return;
          const planId = postedPlanId;
          setShareModalVisible(false);
          setPostedPlanId(null);
          postedPlanIdRef.current = null;
          setPostedPlanTitle('');
          setTimeout(() => {
            if (!isComposerCurrent()) return;
            if (planId) {
              requestPlanNotificationPrompt({ userId: composerUserId!, planId, reason: 'posted' }, isComposerCurrent);
              router.push(`/plan/${planId}` as any);
            }
            else router.replace('/(tabs)/plans');
          }, 300);
        }}
        planTitle={postedPlanTitle}
        planId={postedPlanId || ''}
        slug={null}
        genderLabel={postedGenderLabel}
        variant="posted"
      />

      <BrandedAlert
        appearance={appearance}
        visible={alertInfo !== null}
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message ?? ''}
        onClose={() => setAlertInfo(null)}
      />
    </SafeAreaView>
  );
}

const legacyStyles = StyleSheet.create({
  headerAction: {}, clearEndAction: {}, postActions: {}, modalHeader: {},
  screen: { flex: 1, backgroundColor: Colors.cream },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  cancel: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.secondary },
  headerTitle: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  postInline: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  postInlineOff: { color: Colors.tertiary },

  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 24 },
  fieldError: { color: Colors.errorBrand, fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, lineHeight: 20, marginTop: 8 },
  invalidInput: { borderColor: Colors.errorBrand },
  section: {
    paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  label: {
    fontFamily: Fonts.sansSemibold, fontSize: 13, letterSpacing: 1.4,
    textTransform: 'uppercase', color: Colors.terracotta, marginBottom: 10,
  },
  subLabel: {
    fontFamily: Fonts.sansSemibold, fontSize: 13, letterSpacing: 1.2,
    textTransform: 'uppercase', color: Colors.terracotta, marginBottom: 8, marginTop: 4,
  },
  labelOptional: {
    fontFamily: Fonts.sansMedium, fontSize: 13, letterSpacing: 0,
    textTransform: 'none', color: Colors.secondary,
  },
  endTimeRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginTop: 16,
  },
  clearEndText: {
    fontFamily: Fonts.sansMedium, fontSize: 13, color: Colors.secondary,
    marginBottom: 8, marginTop: 4,
  },

  // Photo
  photoRow: { marginTop: 12 },
  photoAdd: {
    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white,
  },
  photoAddText: { fontFamily: Fonts.sansMedium, fontSize: 13, color: Colors.secondary },
  photoThumbWrap: { width: 96, height: 60, borderRadius: 12, overflow: 'hidden' },
  photoThumb: { width: '100%', height: '100%' },
  photoThumbOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.overlayDark40 },
  photoRemove: {
    position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.overlayDark60,
  },

  // Message (bounded field; the editorial underline is reserved for WHAT only)
  messageInput: {
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 11,
    fontFamily: Fonts.sans, fontSize: FontSizes.bodyLG, color: Colors.darkWarm,
    minHeight: 64, lineHeight: 22, textAlignVertical: 'top',
  },

  // When
  quickRow: { flexDirection: 'row', gap: 7, marginBottom: 12 },
  quickChip: {
    paddingHorizontal: 13, paddingVertical: 7, borderRadius: 16,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white,
  },
  quickChipOn: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  quickChipText: { fontFamily: Fonts.sansSemibold, fontSize: 13, color: Colors.secondary },
  quickChipTextOn: { color: Colors.white },
  timeRowCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10,
    paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white,
  },
  timeLabel: { fontFamily: Fonts.sansSemibold, fontSize: 13, color: Colors.secondary, letterSpacing: 0.4 },
  timePill: { backgroundColor: Colors.accentSubtle, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  timePillText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  timeChange: { fontFamily: Fonts.sansMedium, fontSize: 13, color: Colors.secondary, marginLeft: 'auto' },

  // How many
  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24 },
  stepperBtn: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: Colors.borderWarm, backgroundColor: Colors.white,
  },
  stepperBtnOff: { opacity: 0.4 },
  stepperBtnText: { fontFamily: Fonts.sans, fontSize: 22, color: Colors.darkWarm, lineHeight: 26 },
  stepperValue: { alignItems: 'center', minWidth: 80 },
  stepperValueNum: { fontFamily: Fonts.sansBold, fontSize: 22, color: Colors.darkWarm },
  stepperValueSub: { fontFamily: Fonts.sans, fontSize: 13, color: Colors.secondary, marginTop: 2 },
  stepperHint: { fontFamily: Fonts.sans, fontSize: 13, color: Colors.secondary, textAlign: 'center', marginTop: 8 },

  // Audience row
  audienceRow: { marginTop: 16 },
  pillWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  smallPill: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white,
  },
  smallPillOn: { backgroundColor: Colors.accentSubtle, borderColor: Colors.terracotta },
  smallPillText: { fontFamily: Fonts.sansMedium, fontSize: 13, color: Colors.secondary },
  smallPillTextOn: { color: Colors.terracotta },

  // Optional extras (quiet secondary footer section; no collapsible)
  secondarySection: { borderBottomWidth: 0, paddingTop: 16, paddingBottom: 28 },
  secondaryHeader: {
    fontFamily: Fonts.sansSemibold, fontSize: 12, letterSpacing: 1.2,
    textTransform: 'uppercase', color: Colors.tertiary, marginBottom: 14,
  },
  mutedLabel: { fontFamily: Fonts.sansMedium, fontSize: 13, color: Colors.secondary, marginBottom: 8 },
  textField: {
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 11, marginBottom: 14,
    fontFamily: Fonts.sans, fontSize: FontSizes.bodyLG, color: Colors.darkWarm,
  },
  textArea: { minHeight: 72, textAlignVertical: 'top' },
  descLabelRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10,
  },
  charCounter: {
    fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.tertiary,
  },
  charCounterWarn: { color: Colors.errorBrand, fontFamily: Fonts.sansSemibold },
  selectField: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 13, marginBottom: 14,
  },
  selectFieldText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyLG, color: Colors.darkWarm },
  selectFieldPlaceholder: { color: Colors.inkSoft },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
  toggleTextWrap: { flex: 1, paddingRight: 16 },
  toggleTitle: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  toggleSub: { fontFamily: Fonts.sans, fontSize: 13, color: Colors.secondary, marginTop: 2 },
  switchTrack: { width: 44, height: 26, borderRadius: 13, backgroundColor: Colors.borderWarm, padding: 3, justifyContent: 'center' },
  switchTrackOn: { backgroundColor: Colors.terracotta },
  switchThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: Colors.white },
  switchThumbOn: { alignSelf: 'flex-end' },

  // Post bar
  postBar: {
    backgroundColor: Colors.cream, borderTopWidth: 1, borderTopColor: Colors.border,
    paddingHorizontal: 20, paddingTop: 12,
  },
  recoveryNudge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.goldBadgeSoft, borderWidth: 1, borderColor: Colors.goldAccent,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 10,
  },
  recoveryDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.gold },
  recoveryText: { flex: 1, fontFamily: Fonts.sansMedium, fontSize: 13, lineHeight: 18, color: Colors.quoteText },
  summaryCard: {
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12,
  },
  summaryTitle: { fontFamily: Fonts.display, fontSize: 16, color: Colors.darkWarm },
  summaryMeta: { fontFamily: Fonts.sans, fontSize: 13, color: Colors.secondary, marginTop: 2 },
  postBtn: {
    backgroundColor: Colors.terracotta, borderRadius: 14, paddingVertical: 15, alignItems: 'center',
    shadowColor: Colors.terracotta, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
  },
  postBtnOff: { opacity: 0.45 },
  postBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.white, letterSpacing: 0.2 },
  draftLinkWrap: { alignItems: 'center', marginTop: 10 },
  draftLink: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  draftLinkOff: { opacity: 0.45 },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: Colors.overlayDark40, justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: Colors.cream, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 18 },
  modalTitle: { fontFamily: Fonts.display, fontSize: 22, color: Colors.darkWarm, marginBottom: 16 },
  modalConfirm: { backgroundColor: Colors.terracotta, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  modalConfirmText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  timeColumns: { flexDirection: 'row', gap: 12, height: 180 },
  timeCol: { flex: 1, backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border },
  timeOpt: { paddingVertical: 10, alignItems: 'center' },
  timeOptOn: { backgroundColor: Colors.accentSubtle },
  timeOptText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.secondary },
  timeOptTextOn: { color: Colors.terracotta, fontFamily: Fonts.sansBold },
  neighborhoodList: { maxHeight: 340 },
  neighborhoodOpt: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.border },
  neighborhoodOptText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  neighborhoodOptTextOn: { color: Colors.terracotta, fontFamily: Fonts.sansBold },
});

function composerAppearance(fonts: AfterglowFontFamilies) {
  const body = { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted };
  const label = { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.ink, letterSpacing: 0, textTransform: 'none' as const };
  const action = { ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.clay };
  const input = { ...AfterglowType.message, fontFamily: fonts.regular, color: AfterglowColors.ink, backgroundColor: AfterglowColors.white, borderColor: AfterglowColors.line, borderWidth: 1, borderRadius: 4 };
  const control = { minHeight: 44, borderRadius: 4, justifyContent: 'center' as const };
  return StyleSheet.create({
    fieldError: { ...legacyStyles.fieldError, fontFamily: fonts.medium },
    screen: { ...legacyStyles.screen, backgroundColor: AfterglowColors.paper },
    header: { ...legacyStyles.header, paddingVertical: 4, borderBottomColor: AfterglowColors.line },
    headerAction: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
    cancel: { ...body, color: AfterglowColors.ink },
    headerTitle: { ...AfterglowType.contextTitle, fontFamily: fonts.semibold, color: AfterglowColors.ink },
    postInline: action,
    postInlineOff: { color: AfterglowColors.muted },
    section: { ...legacyStyles.section, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: AfterglowColors.subtleLine },
    label: { ...label, marginBottom: 10 },
    subLabel: { ...label, marginBottom: 8, marginTop: 4 },
    labelOptional: body,
    clearEndAction: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    clearEndText: { ...body, color: AfterglowColors.clay },
    photoAdd: { ...legacyStyles.photoAdd, ...control, backgroundColor: AfterglowColors.white, borderColor: AfterglowColors.line },
    photoAddText: { ...body, fontFamily: fonts.medium, color: AfterglowColors.ink },
    photoThumbWrap: { ...legacyStyles.photoThumbWrap, width: 128, height: 80, borderRadius: 4 },
    photoRemove: { ...legacyStyles.photoRemove, width: 44, height: 44, top: 0, right: 0, borderRadius: 4 },
    messageInput: { ...legacyStyles.messageInput, ...input, minHeight: 84 },
    quickChip: { ...legacyStyles.quickChip, ...control, paddingHorizontal: 16, borderColor: AfterglowColors.line, backgroundColor: AfterglowColors.white },
    quickChipOn: { backgroundColor: AfterglowColors.clay, borderColor: AfterglowColors.clay },
    quickChipText: { ...body, fontFamily: fonts.medium, color: AfterglowColors.ink },
    quickChipTextOn: { color: AfterglowColors.white },
    stepperBtn: { ...legacyStyles.stepperBtn, width: 44, height: 44, borderRadius: 4, borderWidth: 1, borderColor: AfterglowColors.line, backgroundColor: AfterglowColors.white },
    stepperBtnText: { ...AfterglowType.identity, fontFamily: fonts.regular, color: AfterglowColors.ink },
    stepperValueNum: { ...AfterglowType.identity, fontFamily: fonts.display, color: AfterglowColors.ink },
    stepperValueSub: { ...body, marginTop: 2 },
    stepperHint: { ...body, textAlign: 'center', marginTop: 4 },
    smallPill: { ...legacyStyles.smallPill, ...control, backgroundColor: AfterglowColors.white, borderColor: AfterglowColors.line },
    smallPillOn: { backgroundColor: AfterglowColors.avatar, borderColor: AfterglowColors.clay },
    smallPillText: { ...body, fontFamily: fonts.medium, color: AfterglowColors.ink },
    smallPillTextOn: { color: AfterglowColors.clay },
    secondaryHeader: { ...label, color: AfterglowColors.muted, marginBottom: 14 },
    mutedLabel: { ...body, marginBottom: 8 },
    textField: { ...legacyStyles.textField, ...input, minHeight: 48 },
    textArea: { ...legacyStyles.textArea, minHeight: 88 },
    charCounter: { ...AfterglowType.caption, fontFamily: fonts.regular, color: AfterglowColors.muted },
    charCounterWarn: { color: Colors.errorBrand, fontFamily: fonts.semibold },
    selectField: { ...legacyStyles.selectField, ...input, minHeight: 48 },
    selectFieldText: { ...AfterglowType.title, fontFamily: fonts.regular, color: AfterglowColors.ink, flex: 1 },
    selectFieldPlaceholder: { color: AfterglowColors.muted },
    toggleRow: { ...legacyStyles.toggleRow, minHeight: 56 },
    toggleTitle: { ...label },
    toggleSub: { ...body, marginTop: 3 },
    switchTrack: { ...legacyStyles.switchTrack, backgroundColor: AfterglowColors.line },
    switchTrackOn: { backgroundColor: AfterglowColors.clay },
    postBar: { ...legacyStyles.postBar, backgroundColor: AfterglowColors.paper, borderTopColor: AfterglowColors.line },
    recoveryNudge: { ...legacyStyles.recoveryNudge, minHeight: 44, borderRadius: 4, backgroundColor: AfterglowColors.white, borderColor: AfterglowColors.line },
    recoveryDot: { ...legacyStyles.recoveryDot, backgroundColor: AfterglowColors.clay },
    recoveryText: { ...body, flex: 1 },
    summaryCard: { paddingVertical: 2, marginBottom: 10 },
    summaryTitle: { ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.ink },
    summaryMeta: { ...AfterglowType.caption, fontFamily: fonts.regular, color: AfterglowColors.muted, marginTop: 2 },
    postActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    postBtn: { ...legacyStyles.postBtn, flex: 1, minHeight: 48, paddingVertical: 12, borderRadius: 4, backgroundColor: AfterglowColors.clay, shadowOpacity: 0, elevation: 0 },
    postBtnText: { ...action, color: AfterglowColors.white },
    draftLinkWrap: { minHeight: 48, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 },
    draftLink: action,
    modalSheet: { ...legacyStyles.modalSheet, backgroundColor: AfterglowColors.paper, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
    modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 },
    modalTitle: { ...AfterglowType.contextTitle, fontFamily: fonts.semibold, color: AfterglowColors.ink, flex: 1 },
    neighborhoodOpt: { ...legacyStyles.neighborhoodOpt, minHeight: 48, borderBottomColor: AfterglowColors.subtleLine },
    neighborhoodOptText: { ...AfterglowType.title, fontFamily: fonts.regular, color: AfterglowColors.ink },
    neighborhoodOptTextOn: { color: AfterglowColors.clay, fontFamily: fonts.semibold },
  });
}
