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
import { usePlanComposerDraft } from './usePlanComposerDraft';
import { legacyStyles, composerAppearance } from './planComposerStyles';
import { AGE_RANGES, MIN_GROUP, MAX_GROUP, MSG_MIN, MSG_LIMIT, DESC_LIMIT, DESC_WARN_MARGIN, buildDatetime, ageRangesToMinMax, quickDate, sameDay, type GenderPreference, type AgeRange, type QuickKind } from './planComposerRules';
import { hapticLight, hapticMedium, hapticSelection, hapticSuccess } from '../../lib/haptics';
import { supabase } from '../../lib/supabase';
import { requestPlanNotificationPrompt } from '../../lib/planNotificationPrompt';
import { checkContent } from '../../lib/contentFilter';
import { uploadBase64ToStorage } from '../../lib/uploadPhoto';
import { PHOTO_FORMAT_ERROR_MESSAGE } from '../../constants/PhotoUpload';
import { MONTHS, getLAWallParts, isValidLAWallTime, resolveOvernightLAEnd } from '../../lib/laDate';
import {
  NEIGHBORHOOD_OPTIONS,
  NEIGHBORHOOD_OTHER,
} from '../../constants/Neighborhoods';
import { PLAN_CATEGORIES } from '../../constants/Categories';
import { COMMUNITIES_ENABLED, COMMUNITY_CHAT_GROUPING_ENABLED } from '../../constants/FeatureFlags';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { COPY } from '../yours/state/constants';
import { useObservedUser } from '../../hooks/useObservedUser';
import type { MyFace } from '../../hooks/useMyFace';
import {
  buildOptimisticPlan,
  prependOptimisticPlan,
  optimisticPlanCacheKeys,
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
import InvitePeopleSection, { type InviteSuggestion } from '../../components/post/InvitePeopleSection';
import PeoplePickerSheet, { type PickedPerson } from '../../components/post/PeoplePickerSheet';

// ─── Constants ──────────────────────────────────────────────────────────────

type RequiredField = 'title' | 'category' | 'message' | 'description' | 'when';
class DraftUnavailable extends Error {}
const unavailableDraftAlert = {
  title: 'Draft unavailable',
  message: 'This draft may have been posted or deleted. Your edits are still here. Check Yours for the latest plan.',
};

async function updateOwnedDraft(id: string, viewerId: string, changes: Record<string, unknown>) {
  const { data, error } = await supabase.from('events').update(changes)
    .eq('id', id).eq('creator_user_id', viewerId).eq('status', 'draft')
    .select('id').maybeSingle();
  if (error) throw error;
  if (data === null) throw new DraftUnavailable();
  if (data?.id !== id) throw new Error('Could not confirm the draft update.');
  return { id };
}

type ValidationMode = 'post' | 'draft';
type ComposerWrite = {
  userId: string;
  isCurrentViewer: () => boolean;
  optimistic: OptimisticHandle | null;
};

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
    similarPlanRequest?: string;
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

  const {
    title, setTitle, exploreEventId, setExploreEventId, category, setCategory,
    imageUrl, setImageUrl, creatorMessage, setCreatorMessage, location, setLocation,
    locationLat, setLocationLat, locationLng, setLocationLng, neighborhood, setNeighborhood,
    dateMonth, setDateMonth, dateDay, setDateDay, dateYear, setDateYear,
    dateSelected, setDateSelected, timeHour, setTimeHour, timeMinute, setTimeMinute,
    timePeriod, setTimePeriod, timeSelected, setTimeSelected, endTimeHour, setEndTimeHour,
    endTimeMinute, setEndTimeMinute, endTimePeriod, setEndTimePeriod, endTimeSelected, setEndTimeSelected,
    groupSize, setGroupSize, genderPref, setGenderPref, ageRanges, setAgeRanges,
    ticketUrl, setTicketUrl, dropIn, setDropIn, allowDuplicate, setAllowDuplicate,
    description, setDescription, invited, setInvited,
    resetFields: resetDraftFields,
  } = usePlanComposerDraft();
  const [imageLoading, setImageLoading] = useState(false);
  const [showNeighborhoodPicker, setShowNeighborhoodPicker] = useState(false);

  // ── Invite people (flag-on path) ──
  const { data: wantInSignals = [] } = useInviteInterestSignals(composerUserId);
  const { dismiss: dismissSuggestion, undo: undoDismissSuggestion } = useDismissSuggestion(composerUserId);
  const postInvitations = usePostPlanInvitations(composerViewer);
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
      for (const key of optimisticPlanCacheKeys(write.userId)) {
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
    if (params.similarPlanRequest) resetForm();
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
    if (params.similarPlanRequest) {
      // A tab may still contain another draft. Start this review with no
      // previous dates, event links, people, or asynchronous photo/write work.
      retireWrite();
      photoAttempt.current = null;
      setImageLoading(false);
      setLoading(false);
      resetFields();
      postInvitations.reset();
      setPeoplePickerOpen(false);
      setShowNeighborhoodPicker(false);
      setConfirmVisible(false);
      setShareModalVisible(false);
      setShareWanted(false);
      setPostedPlanId(null);
      postedPlanIdRef.current = null;
      setRecoveryNudge(false);
      setAlertInfo(null);
    }
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
  }, [params.prefillTitle, params.prefillInvitePersonId, params.prefillInvitePersonName, params.prefillInvitePersonPhoto, params.duplicatedFromEventId, params.similarPlanRequest]);

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

  const resetFields = () => { setValidationMode(null); resetDraftFields(); };
  const resetForm = () => {
    resetFields();
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
      similarPlanRequest: undefined,
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
      ...(params.similarPlanRequest ? { skip_explore_auto_link: true } : {}),
    };
    const write = beginWrite();
    if (!write) return;
    let dispatched = false;
    try {
      const { data: { user }, error: identityError } = await requestWithDeadline(supabase.auth.getUser(), 12_000);
      if (!ownsWrite(write)) return;
      if (identityError || !user || user.id !== write.userId) throw new Error('auth');
      dispatched = true;
      if (params.draftId) {
        await updateOwnedDraft(String(params.draftId), user.id, row);
        if (!ownsWrite(write)) return;
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
    } catch (error) {
      if (!ownsWrite(write)) return;
      if (error instanceof DraftUnavailable) setAlertInfo(unavailableDraftAlert);
      else if (dispatched) setAlertInfo({ title: 'Couldn’t confirm the save', message: 'Your edits are still here. Check Yours for the draft before trying again.' });
      else setAlertInfo({ title: 'That did not save', message: 'Try again in a moment.' });
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
      ...(params.similarPlanRequest ? { skip_explore_auto_link: true } : {}),
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
      const { data: { user }, error: identityError } = await requestWithDeadline(supabase.auth.getUser(), 12_000);
      if (!ownsWrite(write)) return;
      if (identityError || !user || user.id !== write.userId) throw new Error('auth');
      let insertedEvent: { id: string } | null = null;
      if (params.draftId) {
        insertedEvent = await updateOwnedDraft(String(params.draftId), user.id, row);
        if (!ownsWrite(write)) return;
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
    } catch (error) {
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
      if (error instanceof DraftUnavailable) setAlertInfo(unavailableDraftAlert);
      else setRecoveryNudge(true);
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
