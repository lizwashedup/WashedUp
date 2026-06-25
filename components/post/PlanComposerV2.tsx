/**
 * PlanComposerV2 - the redesigned main composer (Golden Hour design study v3).
 *
 * Rendered only when YOURS_PAGE_ENABLED is true. Owns its own state and submit
 * so the frozen LegacyComposer carries zero risk. Built one section at a time
 * per composer-redesign-build-spec.md.
 *
 * Step 2: full section rhythm (what / category / photo / message / when /
 * where(stub) / how many / who can join + ages / invite / more options) plus
 * the sticky live post bar. The WHERE section is a stub here; the maps place
 * picker lands in steps 3-4. The post moment is the interim SharePlanModal;
 * the optimistic confirmation screen lands in step 6.
 *
 * V2 required set to post: title, date, time, category. Place, message, and
 * description are optional (place is skippable by spec; message is the study's
 * "one warm optional field"; description lives under More options). All other
 * fields persist exactly as the legacy composer.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { ImagePlus, X, ChevronDown } from 'lucide-react-native';

import Colors from '../../constants/Colors';
import { extractFirstUrl } from '../../lib/url';
import { Fonts, FontSizes } from '../../constants/Typography';
import { hapticLight, hapticMedium, hapticSelection, hapticSuccess } from '../../lib/haptics';
import { supabase } from '../../lib/supabase';
import { checkContent } from '../../lib/contentFilter';
import { uploadBase64ToStorage } from '../../lib/uploadPhoto';
import { PHOTO_FORMAT_ERROR_MESSAGE } from '../../constants/PhotoUpload';
import { MONTHS, getTodayInLA, laWallTimeToUTC } from '../../lib/laDate';
import {
  NEIGHBORHOOD_OPTIONS,
  NEIGHBORHOOD_OTHER,
} from '../../constants/Neighborhoods';
import { PLAN_CATEGORIES, type PlanCategory } from '../../constants/Categories';
import { COPY } from '../yours/state/constants';
import { useAuthUserId } from '../yours/state/useAuthUserId';
import type { MyFace } from '../../hooks/useMyFace';
import {
  buildOptimisticPlan,
  prependOptimisticPlan,
  type OptimisticHandle,
} from '../../lib/optimisticPlans';
import { useInviteInterestSignals } from '../../hooks/useInviteInterestSignals';
import { useDismissSuggestion } from '../../hooks/useDismissSuggestion';
import { useInvitePeopleToPlan } from '../../hooks/useInvitePeopleToPlan';
import { BrandedAlert } from '../../components/BrandedAlert';
import { SharePlanModal } from '../../components/modals/SharePlanModal';
import { type CalendarDay } from '../../components/calendar/WashedUpCalendar';
import EditorialTitleField from '../composer/EditorialTitleField';
import CategoryChips from '../composer/CategoryChips';
import CollapsibleCalendar from '../composer/CollapsibleCalendar';
import TimePicker, { displayTime, MINUTE_OPTIONS } from '../composer/TimePicker';
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
const DESC_LIMIT = 1000;

type QuickKind = 'tonight' | 'tomorrow';

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
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
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
    duplicatedFromEventId?: string;
  }>();

  // ── Profile (gender options) ──
  const [userGender, setUserGender] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase.from('profiles').select('gender').eq('id', user.id).single();
      if (profile?.gender) setUserGender(profile.gender);
    })();
  }, []);

  // ── Core fields ──
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<PlanCategory | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [creatorMessage, setCreatorMessage] = useState('');

  // ── Place (stub here; picker in steps 3-4) ──
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
  const { data: composerUserId } = useAuthUserId();
  const { data: wantInSignals = [] } = useInviteInterestSignals(composerUserId);
  const { dismiss: dismissSuggestion, undo: undoDismissSuggestion } = useDismissSuggestion(composerUserId);
  const invitePeopleToPlan = useInvitePeopleToPlan();
  const [invited, setInvited] = useState<InviteChip[]>([]);
  const [inviteShowAll, setInviteShowAll] = useState(false);
  const [peoplePickerOpen, setPeoplePickerOpen] = useState(false);
  const [hiddenWantIn, setHiddenWantIn] = useState<Set<string>>(new Set());

  // ── Submit / post-moment ──
  const [loading, setLoading] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message: string } | null>(null);
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [postedPlanId, setPostedPlanId] = useState<string | null>(null);
  const [postedPlanTitle, setPostedPlanTitle] = useState('');
  const [postedGenderLabel, setPostedGenderLabel] = useState<string | undefined>();
  const [inviteDeliveryFailed, setInviteDeliveryFailed] = useState(false);
  // Optimistic post moment.
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [confirmIsFirst, setConfirmIsFirst] = useState(false);
  const [confirmMeta, setConfirmMeta] = useState('');
  const [confirmInvited, setConfirmInvited] = useState(false);
  const [shareWanted, setShareWanted] = useState(false);
  const [recoveryNudge, setRecoveryNudge] = useState(false);
  const neverPostedRef = useRef(false);

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
    // Date: accepts YYYY-MM-DD or full ISO.
    if (params.prefillEventDate) {
      const raw = String(params.prefillEventDate);
      const d = raw.includes('T') ? new Date(raw) : new Date(`${raw}T12:00:00`);
      if (!isNaN(d.getTime())) {
        setDateMonth(d.getMonth()); setDateDay(d.getDate()); setDateYear(d.getFullYear()); setDateSelected(true);
      }
    }
    // Time: from start_time (ISO or HH:MM[:SS]); snap to the picker's minutes.
    if (params.prefillStartTime) {
      const st = String(params.prefillStartTime);
      let hours: number | null = null; let minutes: number | null = null;
      if (st.includes('T')) { const d = new Date(st); if (!isNaN(d.getTime())) { hours = d.getHours(); minutes = d.getMinutes(); } }
      else if (st.includes(':')) { const parts = st.split(':'); hours = parseInt(parts[0], 10); minutes = parseInt(parts[1] ?? '0', 10); }
      if (hours !== null && minutes !== null && !isNaN(hours) && !isNaN(minutes)) {
        const period: 'AM' | 'PM' = hours >= 12 ? 'PM' : 'AM';
        let displayHour = hours % 12; if (displayHour === 0) displayHour = 12;
        const nearestMinute = MINUTE_OPTIONS.reduce((prev, curr) =>
          Math.abs(parseInt(curr) - minutes!) < Math.abs(parseInt(prev) - minutes!) ? curr : prev);
        setTimeHour(displayHour); setTimeMinute(nearestMinute); setTimePeriod(period); setTimeSelected(true);
      }
    }
    // End time (optional): from end_time (ISO or HH:MM[:SS]); snap to picker.
    if (params.prefillEndTime) {
      const et = String(params.prefillEndTime);
      let hours: number | null = null; let minutes: number | null = null;
      if (et.includes('T')) { const d = new Date(et); if (!isNaN(d.getTime())) { hours = d.getHours(); minutes = d.getMinutes(); } }
      else if (et.includes(':')) { const parts = et.split(':'); hours = parseInt(parts[0], 10); minutes = parseInt(parts[1] ?? '0', 10); }
      if (hours !== null && minutes !== null && !isNaN(hours) && !isNaN(minutes)) {
        const period: 'AM' | 'PM' = hours >= 12 ? 'PM' : 'AM';
        let displayHour = hours % 12; if (displayHour === 0) displayHour = 12;
        const nearestMinute = MINUTE_OPTIONS.reduce((prev, curr) =>
          Math.abs(parseInt(curr) - minutes!) < Math.abs(parseInt(prev) - minutes!) ? curr : prev);
        setEndTimeHour(displayHour); setEndTimeMinute(nearestMinute); setEndTimePeriod(period); setEndTimeSelected(true);
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
    hapticLight();
    setInvited((prev) => prev.some((c) => c.user_id === s.user_id) ? prev : [...prev, { user_id: s.user_id, name: s.name, photo: s.photo }]);
  }, []);
  const onRemoveChip = useCallback((userId: string) => {
    hapticLight();
    setInvited((prev) => prev.filter((c) => c.user_id !== userId));
  }, []);
  const onPickedFromPeople = useCallback((picked: PickedPerson[]) => {
    if (picked.length === 0) return;
    hapticLight();
    setInvited((prev) => {
      const have = new Set(prev.map((c) => c.user_id));
      return [...prev, ...picked.filter((p) => !have.has(p.user_id))];
    });
  }, []);
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
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setAlertInfo({ title: 'Permission needed', message: 'Go to Settings and allow photo access.' });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsEditing: true, aspect: [16, 10], quality: 1,
    });
    if (!result.canceled && result.assets[0]) {
      try {
        const manipulated = await ImageManipulator.manipulateAsync(
          result.assets[0].uri,
          [{ resize: { width: 1200 } }],
          { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true },
        );
        setImageUrl(manipulated.uri);
        if (manipulated.base64) uploadPhoto(manipulated.base64);
        else { setImageUrl(null); setAlertInfo({ title: 'Invalid image', message: PHOTO_FORMAT_ERROR_MESSAGE }); }
      } catch {
        setImageUrl(null);
        setAlertInfo({ title: 'Invalid image', message: PHOTO_FORMAT_ERROR_MESSAGE });
      }
    }
  };

  const uploadPhoto = async (base64: string) => {
    setImageLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error: refreshErr } = await supabase.auth.refreshSession();
      if (refreshErr) throw refreshErr;
      const fileName = `${user.id}/${Date.now()}.jpg`;
      const publicUrl = await uploadBase64ToStorage('event-images', fileName, base64);
      setImageUrl(publicUrl);
    } catch {
      setImageUrl(null);
      setAlertInfo({ title: 'Upload failed', message: 'Could not upload photo. Try again.' });
    } finally {
      setImageLoading(false);
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

  const whenSummary = dateSelected
    ? `${MONTHS[dateMonth]} ${dateDay}${timeSelected ? ` · ${displayTime(timeHour, timeMinute, timePeriod).toLowerCase()}` : ''}`
    : 'add a day';
  const placeSummary = location.trim() ? location.trim().toLowerCase() : 'add a place';
  const peopleSummary = invited.length > 0 ? invited.map((c) => c.name.toLowerCase()).join(', ') : `open to ${groupSize}`;
  const summaryMeta = [whenSummary, placeSummary, peopleSummary].join(' · ');

  const canPost = title.trim().length > 0 && dateSelected && timeSelected && category !== null && creatorMessage.trim().length >= MSG_MIN && description.trim().length > 0 && !loading && !imageLoading;

  const resetForm = () => {
    setTitle(''); setCategory(null); setImageUrl(null); setCreatorMessage('');
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
      duplicatedFromEventId: undefined,
    } as never);
  };

  // ── Submit (optimistic: the post moment shows instantly; the insert runs in
  // the background and recovers quietly in gold on failure). ──
  const handleSubmit = async () => {
    if (loading || imageLoading || confirmVisible) return;
    const missing: string[] = [];
    if (title.trim().length === 0) missing.push('Title');
    if (!dateSelected) missing.push('Day');
    if (!timeSelected) missing.push('Time');
    if (category === null) missing.push('Category');
    if (creatorMessage.trim().length < MSG_MIN) {
      missing.push(`Your message (at least ${MSG_MIN} characters)`);
    }
    if (description.trim().length === 0) missing.push('Description');
    if (missing.length > 0) {
      setAlertInfo({ title: 'Almost there', message: `A couple things first:\n\n• ${missing.join('\n• ')}` });
      return;
    }
    const fieldsToCheck = [title, description, creatorMessage, location].filter(Boolean).join(' ');
    const filter = checkContent(fieldsToCheck);
    if (!filter.ok) {
      setAlertInfo({ title: 'Content not allowed', message: filter.reason ?? 'Please revise your plan and try again.' });
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
      let endDt = buildDatetime(dateMonth, dateDay, dateYear, endTimeHour, endTimeMinute, endTimePeriod);
      if (endDt.getTime() <= startTime.getTime()) {
        endDt = new Date(endDt.getTime() + 24 * 60 * 60 * 1000);
      }
      if (endDt.getTime() - startTime.getTime() < 30 * 60 * 1000) {
        setAlertInfo({ title: 'Give it a little longer', message: 'An end time should be at least 30 minutes after the start.' });
        return;
      }
      endTimeIso = endDt.toISOString();
    }

    // Snapshot everything the insert needs - the form resets immediately.
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
      duplicated_from_event_id: params.duplicatedFromEventId ? String(params.duplicatedFromEventId) : null,
    };
    const inviteIds = invited.map((c) => c.user_id);
    const genderLabelSnap =
      genderPref === 'women_only' ? 'Women only'
        : genderPref === 'men_only' ? 'Men only'
        : genderPref === 'nonbinary_only' ? 'Nonbinary only' : undefined;
    const isFirst = neverPostedRef.current;

    // Optimistic: show the moment instantly + one success haptic.
    hapticSuccess();
    setConfirmIsFirst(isFirst);
    setConfirmMeta(summaryMeta);
    setConfirmInvited(inviteIds.length > 0);
    setPostedPlanTitle(row.title);
    setPostedGenderLabel(genderLabelSnap);
    setPostedPlanId(null);
    setInviteDeliveryFailed(false);
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
    }

    // Background insert. `loading` tracks the real in-flight window so the post
    // button's spinner is reachable and `canPost`'s !loading is a true second
    // guard against a re-submit racing the insert (alongside confirmVisible).
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('auth');
      const { data: insertedEvent, error } = await supabase
        .from('events')
        .insert({ ...row, creator_user_id: user.id })
        .select('id')
        .single();
      if (error) throw error;

      if (insertedEvent?.id) {
        const { error: memberErr } = await supabase.from('event_members').insert({
          event_id: insertedEvent.id, user_id: user.id, role: 'host', status: 'joined',
        });
        if (memberErr) {
          await new Promise((r) => setTimeout(r, 500));
          const { error: retryErr } = await supabase.from('event_members').insert({
            event_id: insertedEvent.id, user_id: user.id, role: 'host', status: 'joined',
          });
          if (retryErr) {
            // Best-effort rollback of the orphaned event. Error-check it: a
            // failed delete leaves an event with no host member, so flag that
            // case distinctly - both paths fall through to the quiet gold
            // recovery below so the creator can simply retry.
            const { error: rollbackErr } = await supabase.from('events').delete().eq('id', insertedEvent.id);
            throw new Error(rollbackErr ? 'member_orphan' : 'member');
          }
        }
        // Event + host member rows both committed: swap the optimistic card's
        // temp id for the real one so it's tappable and routes correctly. Done
        // only now (not right after the event insert) so an orphan rollback above
        // still removes the card via the catch's rollback().
        optimistic?.commit(insertedEvent.id);
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
          invitePeopleToPlan.mutate(
            { eventId: insertedEvent.id, recipientIds: inviteIds },
            { onError: () => setInviteDeliveryFailed(true) },
          );
        }
      }

      queryClient.invalidateQueries({ queryKey: ['events', 'feed'] });
      queryClient.invalidateQueries({ queryKey: ['my-plans'] });
      queryClient.invalidateQueries({ queryKey: ['feed-member-ids'] });
      setPostedPlanId(insertedEvent?.id ?? null);
      if (isFirst) {
        await AsyncStorage.setItem('hasSeenFirstPlanCelebration', '1');
        neverPostedRef.current = false;
      }
      resetForm();
    } catch {
      // Remove the optimistic card from feed + my-plans (restores the exact prior
      // snapshot) before the recovery UX runs.
      optimistic?.rollback();
      // Quiet gold recovery: pull the moment, reopen the composer with the data
      // intact and a gold nudge. No red, never a hard error dialog.
      setConfirmVisible(false);
      setShareWanted(false);
      setRecoveryNudge(true);
    } finally {
      setLoading(false);
    }
  };

  const sheetBottomPad = Platform.OS === 'ios' ? 40 : Math.max(insets.bottom, 16) + 16;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <StatusBar style="dark" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => { hapticLight(); if (router.canGoBack()) router.back(); }} hitSlop={12}>
          <Text style={styles.cancel}>cancel</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>new plan</Text>
        <TouchableOpacity onPress={handleSubmit} disabled={!canPost} hitSlop={12}>
          <Text style={[styles.postInline, !canPost && styles.postInlineOff]}>post</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
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
        <View style={styles.section}>
          <EditorialTitleField value={title} onChangeText={setTitle} placeholder="sunset hike at runyon" />
          <View style={styles.photoRow}>
            {imageUrl ? (
              <View style={styles.photoThumbWrap}>
                <Image source={{ uri: imageUrl }} style={styles.photoThumb} contentFit="cover" />
                {imageLoading ? (
                  <View style={styles.photoThumbOverlay}><ActivityIndicator color={Colors.white} /></View>
                ) : (
                  <TouchableOpacity style={styles.photoRemove} onPress={() => { hapticLight(); setImageUrl(null); }} hitSlop={8}>
                    <X size={13} color={Colors.white} strokeWidth={2.5} />
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <TouchableOpacity style={styles.photoAdd} onPress={pickImage} activeOpacity={0.7}>
                <ImagePlus size={15} color={Colors.secondary} strokeWidth={2} />
                <Text style={styles.photoAddText}>add a photo</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* CATEGORY */}
        <View style={styles.section}>
          <CategoryChips selected={category} onSelect={setCategory} />
        </View>

        {/* YOUR MESSAGE (required) */}
        <View style={styles.section}>
          <Text style={styles.label}>your message</Text>
          <TextInput
            style={styles.messageInput}
            value={creatorMessage}
            onChangeText={setCreatorMessage}
            placeholder="going up the back trail, golden hour pace, no rush..."
            placeholderTextColor={Colors.inkSoft}
            multiline
            maxLength={MSG_LIMIT}
          />
          {title.trim().length > 0 && creatorMessage.trim().length < MSG_MIN
            ? <InlineNudge text={COPY.composerMessageRequired} /> : null}
        </View>

        {/* DESCRIPTION (required; surfaced out of "more options") */}
        <View style={styles.section}>
          <Text style={styles.label}>description</Text>
          <TextInput
            style={[styles.textField, styles.textArea]}
            value={description}
            onChangeText={setDescription}
            placeholder="anything else worth knowing"
            placeholderTextColor={Colors.inkSoft}
            multiline
            maxLength={DESC_LIMIT}
          />
          {title.trim().length > 0 && description.trim().length === 0
            ? <InlineNudge text={COPY.composerDescriptionRequired} /> : null}
          {(() => {
            // One-tap (never silent): a pasted URL in the description is offered
            // a home in the ticket/link field, so links stop becoming a wall.
            const detectedUrl = extractFirstUrl(description);
            return detectedUrl && !ticketUrl.trim() ? (
              <InlineNudge
                text={COPY.composerLinkDetected}
                actionLabel="add it"
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
        <View style={styles.section}>
          <Text style={styles.label}>when</Text>
          <View style={styles.quickRow}>
            {(['tonight', 'tomorrow'] as QuickKind[]).map((k) => {
              const on = activeQuick === k;
              return (
                <TouchableOpacity
                  key={k}
                  activeOpacity={0.7}
                  onPress={() => selectQuick(k)}
                  style={[styles.quickChip, on && styles.quickChipOn]}
                >
                  <Text style={[styles.quickChipText, on && styles.quickChipTextOn]}>{k}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <CollapsibleCalendar selected={selectedDate} onSelect={selectDate} />
          <TimePicker
            hour={timeHour}
            minute={timeMinute}
            period={timePeriod}
            selected={timeSelected}
            onChange={(h, m, p) => { setTimeHour(h); setTimeMinute(m); setTimePeriod(p); setTimeSelected(true); }}
          />
          <View style={styles.endTimeRow}>
            <Text style={styles.subLabel}>ends<Text style={styles.labelOptional}> · optional</Text></Text>
            {endTimeSelected ? (
              <TouchableOpacity onPress={() => { hapticLight(); setEndTimeSelected(false); }} hitSlop={8}>
                <Text style={styles.clearEndText}>clear</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <TimePicker
            hour={endTimeHour}
            minute={endTimeMinute}
            period={endTimePeriod}
            selected={endTimeSelected}
            onChange={(h, m, p) => { setEndTimeHour(h); setEndTimeMinute(m); setEndTimePeriod(p); setEndTimeSelected(true); }}
          />
          {nudge === 'tonight' ? <InlineNudge text={COPY.composerTonightNudge} /> : null}
        </View>

        {/* WHERE */}
        <View style={styles.section}>
          <Text style={styles.label}>where</Text>
          <PlacePicker value={place} onChange={onPlaceChange} />
          {nudge === 'placeSkip' ? <InlineNudge text={NUDGE_PLACE_BASE} /> : null}
        </View>

        {/* LINK OR TICKETS (surfaced from the retired "more options"; decision-shaping,
            and the visible home that keeps links out of the description) */}
        <View style={styles.section}>
          <Text style={styles.label}>link or tickets<Text style={styles.labelOptional}> · optional</Text></Text>
          <TextInput
            style={styles.textField}
            value={ticketUrl}
            onChangeText={setTicketUrl}
            placeholder="https://"
            placeholderTextColor={Colors.inkSoft}
            autoCapitalize="none"
            keyboardType="url"
          />
        </View>

        {/* HOW MANY (existing semantics, new skin) */}
        <View style={styles.section}>
          <Text style={styles.label}>how many</Text>
          <View style={styles.stepperRow}>
            <TouchableOpacity
              style={[styles.stepperBtn, groupSize <= MIN_GROUP - 1 && styles.stepperBtnOff]}
              onPress={() => { if (groupSize > MIN_GROUP - 1) { hapticLight(); setGroupSize((g) => g - 1); } }}
              disabled={groupSize <= MIN_GROUP - 1}
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
            >
              <Text style={styles.stepperBtnText}>+</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.stepperHint}>including you</Text>

          {/* WHO CAN JOIN + AGES (safety: never buried) */}
          <View style={styles.audienceRow}>
            <Text style={styles.subLabel}>who can join</Text>
            <View style={styles.pillWrap}>
              {genderOptions.map((opt) => {
                const on = genderPref === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
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
            <Text style={styles.subLabel}>ages</Text>
            <View style={styles.pillWrap}>
              {AGE_RANGES.map((r) => {
                const on = ageRanges.includes(r);
                return (
                  <TouchableOpacity
                    key={r}
                    activeOpacity={0.7}
                    onPress={() => toggleAgeRange(r)}
                    style={[styles.smallPill, on && styles.smallPillOn]}
                  >
                    <Text style={[styles.smallPillText, on && styles.smallPillTextOn]}>{r}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        {/* JOINABILITY (surfaced from the retired "more options"; decision-shaping) */}
        <View style={styles.section}>
          <TouchableOpacity style={styles.toggleRow} onPress={() => { hapticLight(); setDropIn((v) => !v); }} activeOpacity={0.7}>
            <View style={styles.toggleTextWrap}>
              <Text style={styles.toggleTitle}>drop-in welcome</Text>
              <Text style={styles.toggleSub}>people can still join after it starts</Text>
            </View>
            <View style={[styles.switchTrack, dropIn && styles.switchTrackOn]}>
              <View style={[styles.switchThumb, dropIn && styles.switchThumbOn]} />
            </View>
          </TouchableOpacity>
        </View>

        {/* INVITE PEOPLE */}
        <View style={styles.section}>
          <InvitePeopleSection
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
          <Text style={styles.secondaryHeader}>optional extras</Text>
          <Text style={styles.mutedLabel}>neighborhood</Text>
          <TouchableOpacity style={styles.selectField} onPress={() => setShowNeighborhoodPicker(true)} activeOpacity={0.7}>
            <Text style={[styles.selectFieldText, !neighborhood && styles.selectFieldPlaceholder]}>
              {neighborhood || 'pick a neighborhood'}
            </Text>
            <ChevronDown size={16} color={Colors.tertiary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.toggleRow} onPress={() => { hapticLight(); setAllowDuplicate((v) => !v); }} activeOpacity={0.7}>
            <View style={styles.toggleTextWrap}>
              <Text style={styles.toggleTitle}>let others copy this plan</Text>
              <Text style={styles.toggleSub}>when it fills, others can post their own</Text>
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
          <TouchableOpacity style={styles.recoveryNudge} onPress={() => setRecoveryNudge(false)} activeOpacity={0.8}>
            <View style={styles.recoveryDot} />
            <Text style={styles.recoveryText}>that didn't go through. your plan is here. tap post to try again.</Text>
          </TouchableOpacity>
        ) : null}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle} numberOfLines={1}>
            {title.trim() || 'your plan'}
          </Text>
          <Text style={styles.summaryMeta} numberOfLines={1}>{summaryMeta}</Text>
        </View>
        <TouchableOpacity
          style={[styles.postBtn, !canPost && styles.postBtnOff]}
          onPress={handleSubmit}
          disabled={!canPost}
          activeOpacity={0.85}
        >
          {loading ? <ActivityIndicator color={Colors.white} /> : <Text style={styles.postBtnText}>post the plan</Text>}
        </TouchableOpacity>
      </View>

      {/* Neighborhood picker modal */}
      <Modal visible={showNeighborhoodPicker} transparent animationType="slide" onRequestClose={() => setShowNeighborhoodPicker(false)} statusBarTranslucent>
        <Pressable style={styles.modalOverlay} onPress={() => setShowNeighborhoodPicker(false)}>
          <Pressable style={[styles.modalSheet, { paddingBottom: sheetBottomPad }]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>which neighborhood?</Text>
            <ScrollView style={styles.neighborhoodList} showsVerticalScrollIndicator={false}>
              {[...NEIGHBORHOOD_OPTIONS, NEIGHBORHOOD_OTHER].map((opt) => {
                const on = neighborhood === opt;
                return (
                  <TouchableOpacity key={opt} style={styles.neighborhoodOpt} onPress={() => { hapticLight(); setNeighborhood(opt); setShowNeighborhoodPicker(false); }} activeOpacity={0.7}>
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
        visible={peoplePickerOpen}
        onClose={() => setPeoplePickerOpen(false)}
        excludeIds={invited.map((c) => c.user_id)}
        onConfirm={onPickedFromPeople}
      />

      {/* The post moment (Tier-1, one per event). */}
      <PostConfirmation
        visible={confirmVisible}
        isFirstPlan={confirmIsFirst}
        planTitle={postedPlanTitle}
        metaLine={confirmMeta}
        invitedSomeone={confirmInvited}
        onShare={() => {
          if (postedPlanId) { setConfirmVisible(false); setShareModalVisible(true); }
          else setShareWanted(true); // open the share sheet once the id lands
        }}
        onSeePlans={() => {
          const id = postedPlanId;
          setConfirmVisible(false);
          setTimeout(() => {
            if (id) router.push(`/plan/${id}` as any);
            else router.replace('/(tabs)/plans');
          }, 200);
        }}
      />

      {/* "share it" opens the existing share content, on intent only. */}
      <SharePlanModal
        visible={shareModalVisible}
        onClose={() => {
          const planId = postedPlanId;
          setShareModalVisible(false);
          setPostedPlanId(null);
          setPostedPlanTitle('');
          setTimeout(() => {
            if (planId) router.push(`/plan/${planId}` as any);
            else router.replace('/(tabs)/plans');
          }, 300);
        }}
        planTitle={postedPlanTitle}
        planId={postedPlanId || ''}
        slug={null}
        genderLabel={postedGenderLabel}
        variant="posted"
        inviteWarning={inviteDeliveryFailed}
      />

      <BrandedAlert
        visible={alertInfo !== null}
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message ?? ''}
        onClose={() => setAlertInfo(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
  summaryTitle: { fontFamily: Fonts.displayItalic, fontSize: 16, color: Colors.darkWarm },
  summaryMeta: { fontFamily: Fonts.sans, fontSize: 13, color: Colors.secondary, marginTop: 2 },
  postBtn: {
    backgroundColor: Colors.terracotta, borderRadius: 14, paddingVertical: 15, alignItems: 'center',
    shadowColor: Colors.terracotta, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
  },
  postBtnOff: { opacity: 0.45 },
  postBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.white, letterSpacing: 0.2 },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: Colors.overlayDark40, justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: Colors.cream, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 18 },
  modalTitle: { fontFamily: Fonts.displayItalic, fontSize: 22, color: Colors.darkWarm, marginBottom: 16 },
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
