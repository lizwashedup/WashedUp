import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { KEYBOARD_DONE_ACCESSORY_ID } from '@/components/keyboard/KeyboardDoneBar';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Pressable,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { hapticLight, hapticMedium, hapticHeavy, hapticSelection, hapticSuccess, hapticWarning, hapticError } from '@/lib/haptics';
import * as Location from 'expo-location';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { ImagePlus, X, FileText, Trash2 } from 'lucide-react-native';
import FirstPlanCelebration from '@/components/FirstPlanCelebration';
import { SharePlanModal } from '@/components/modals/SharePlanModal';
import { YOURS_PAGE_ENABLED } from '@/constants/FeatureFlags';
import PingAfterPlanModal from '@/components/yours/ping/PingAfterPlanModal';
import ProfileButton from '@/components/ProfileButton';
import { GooglePlacesAutocomplete, GooglePlacesAutocompleteRef } from 'react-native-google-places-autocomplete';
import { uploadBase64ToStorage } from '@/lib/uploadPhoto';
import {
  NEIGHBORHOOD_OPTIONS,
  NEIGHBORHOOD_OTHER,
  NEIGHBORHOOD_SET,
} from '@/constants/Neighborhoods';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import Colors from '@/constants/Colors';
import { PHOTO_FORMAT_ERROR_MESSAGE } from '@/constants/PhotoUpload';
import { Fonts, FontSizes } from '@/constants/Typography';
import { checkContent } from '@/lib/contentFilter';
import { BrandedAlert, BrandedAlertButton } from '@/components/BrandedAlert';
import { COPY } from '@/components/yours/state/constants';
import { useAuthUserId } from '@/components/yours/state/useAuthUserId';
import type { MyFace } from '@/hooks/useMyFace';
import {
  buildOptimisticPlan,
  prependOptimisticPlan,
  type OptimisticHandle,
} from '@/lib/optimisticPlans';
import PeoplePickerSheet, { type PickedPerson } from '@/components/post/PeoplePickerSheet';
import { useInviteInterestSignals } from '@/hooks/useInviteInterestSignals';
import { useDismissSuggestion } from '@/hooks/useDismissSuggestion';
import { useInvitePeopleToPlan } from '@/hooks/useInvitePeopleToPlan';
import InvitePeopleSection, { type InviteChip, type InviteSuggestion } from '@/components/post/InvitePeopleSection';
import { Toast } from '@/components/Toast';
import WashedUpCalendar, { type CalendarDay } from '@/components/calendar/WashedUpCalendar';
import { MONTHS } from '@/lib/laDate';

// Google Maps key comes from the EAS secret exposed as EXPO_PUBLIC_GOOGLE_MAPS_API_KEY.
// No hardcoded fallback: the var must be present at build time (source of truth).
const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES = [
  'Art', 'Business', 'Comedy', 'Film', 'Fitness',
  'Food', 'Gaming', 'Music', 'Nightlife', 'Outdoors',
  'Sports', 'Tech', 'Wellness', 'Other',
] as const;
type Category = typeof CATEGORIES[number];

type GenderPreference = 'mixed' | 'women_only' | 'men_only' | 'nonbinary_only';

const AGE_RANGES = ['All Ages', '21+', '20s', '30s', '40s', '50s', '60s', '70+'] as const;
type AgeRange = typeof AGE_RANGES[number];

const HOURS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const MINUTE_OPTIONS = ['00', '15', '30', '45'];
const PERIODS: ('AM' | 'PM')[] = ['AM', 'PM'];

const MIN_GROUP = 3;
const MAX_GROUP = 8;
const MSG_MIN = 10;
const MSG_LIMIT = 150;
const DESC_LIMIT = 500;

// ─── Helpers ──────────────────────────────────────────────────────────────────
// LA-date helpers + the month grid now live in lib/laDate.ts (shared with
// WashedUpCalendar). displayDate below still formats with the shared MONTHS.

function buildDatetime(
  month: number, day: number, year: number,
  hour: number, minute: string, period: 'AM' | 'PM',
): Date {
  let h = hour;
  if (period === 'PM' && h !== 12) h += 12;
  if (period === 'AM' && h === 12) h = 0;
  return new Date(year, month, day, h, parseInt(minute));
}

function displayDate(month: number, day: number, year: number): string {
  return `${MONTHS[month]} ${day}, ${year}`;
}

function displayTime(hour: number, minute: string, period: 'AM' | 'PM'): string {
  return `${hour}:${minute} ${period}`;
}

function ageRangesToMinMax(ranges: AgeRange[]): { min: number | null; max: number | null } {
  if (ranges.length === 0 || ranges.includes('All Ages')) return { min: null, max: null };

  const bounds: Record<string, [number, number]> = {
    '21+': [21, 99],
    '20s': [20, 29],
    '30s': [30, 39],
    '40s': [40, 49],
    '50s': [50, 59],
    '60s': [60, 69],
    '70+': [70, 99],
  };

  let min = 99, max = 0;
  for (const r of ranges) {
    const b = bounds[r];
    if (b) {
      if (b[0] < min) min = b[0];
      if (b[1] > max) max = b[1];
    }
  }
  return { min, max };
}

// ─── Drafts ────────────────────────────────────────────────────────────────────

const DRAFTS_KEY = 'washedup_plan_drafts';

interface PlanDraft {
  id: string;
  title: string;
  location: string;
  locationLat: number | null;
  locationLng: number | null;
  ticketUrl: string;
  category: Category | null;
  genderPref: GenderPreference;
  ageRanges: AgeRange[];
  description: string;
  creatorMessage: string;
  groupSize: number;
  imageUrl: string | null;
  savedAt: number;
}

async function loadDrafts(): Promise<PlanDraft[]> {
  try {
    const raw = await AsyncStorage.getItem(DRAFTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function saveDrafts(drafts: PlanDraft[]): Promise<void> {
  await AsyncStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function LegacyComposer() {
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const sheetBottomPad =
    Platform.OS === 'ios' ? 40 : Math.max(insets.bottom, 16) + 16;

  const now = new Date();
  const currentYear = now.getFullYear();
  const years = [currentYear, currentYear + 1];

  const [userGender, setUserGender] = useState<string | null>(null);
  const [screenReady, setScreenReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data: profile } = await supabase
          .from('profiles')
          .select('gender')
          .eq('id', user.id)
          .single();
        if (profile?.gender) setUserGender(profile.gender);
      } finally {
        setScreenReady(true);
      }
    })();
  }, []);

  // Next Time! - list of people who said they'd go next time on any of the
  // creator's past plans. The choices map holds the creator's per-row decision
  // (invite or skip); we replay it after the new event is created.
  type InterestRow = {
    signal_id: string;
    interested_user_id: string;
    interested_name: string | null;
    interested_photo_url: string | null;
    origin_event_id: string;
    origin_event_title: string | null;
    created_at: string;
  };
  const [interestSignals, setInterestSignals] = useState<InterestRow[]>([]);
  const [interestChoices, setInterestChoices] = useState<Map<string, 'invite' | 'skip'>>(new Map());
  const [interestExpanded, setInterestExpanded] = useState(true);
  const [interestShowAll, setInterestShowAll] = useState(false);

  useEffect(() => {
    // Legacy "People who want in" path, flag-off only. With YOURS_PAGE_ENABLED on,
    // the INVITE PEOPLE section replaces this and uses get_invite_interest_signals.
    if (YOURS_PAGE_ENABLED) return;
    (async () => {
      const { data, error } = await supabase.rpc('get_creator_interest_signals');
      if (error || !data) return;
      setInterestSignals(data as InterestRow[]);
      // Auto-collapse if there are 6+ signals.
      setInterestExpanded((data as InterestRow[]).length <= 5);
    })();
  }, []);

  const setInterestChoice = useCallback((userId: string, choice: 'invite' | 'skip') => {
    hapticLight();
    setInterestChoices(prev => {
      const next = new Map(prev);
      next.set(userId, choice);
      return next;
    });
  }, []);

  // ── INVITE PEOPLE section (YOURS_PAGE_ENABLED). Invited chips + want-in
  // suggestion rows; your-people come in via the "+ Add from your people" picker
  // (reactance fix). dismiss/undo + invite-on-post via invite_people_to_plan. ──
  const { data: composerUserId } = useAuthUserId();
  const { data: wantInSignals = [] } = useInviteInterestSignals(YOURS_PAGE_ENABLED ? composerUserId : null);
  const { dismiss: dismissSuggestion, undo: undoDismissSuggestion } = useDismissSuggestion(composerUserId);
  const invitePeopleToPlan = useInvitePeopleToPlan();
  const [invited, setInvited] = useState<InviteChip[]>([]);
  const [inviteShowAll, setInviteShowAll] = useState(false);
  const [peoplePickerOpen, setPeoplePickerOpen] = useState(false);
  // Locally-hidden want-in ids so a dismissed row vanishes instantly (undo restores).
  const [hiddenWantIn, setHiddenWantIn] = useState<Set<string>>(new Set());
  // A QUEUE, not a single slot: rapid double-dismiss must keep every undo
  // reachable. Each entry shows in turn (the Toast is keyed by userId so its
  // auto-dismiss timer re-arms per entry); undo always acts on the head.
  const [toastQueue, setToastQueue] = useState<{ userId: string; name: string }[]>([]);

  // WANT-IN ONLY (reactance fix): the app shows rows only for people who raised a
  // hand. Your-people are NOT volunteered as named rows; they come in via the
  // "+ Add from your people" picker (pull, not push).
  const inviteSuggestions = useMemo<InviteSuggestion[]>(() => {
    if (!YOURS_PAGE_ENABLED) return [];
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
    setInvited((prev) => prev.some((c) => c.user_id === s.user_id)
      ? prev
      : [...prev, { user_id: s.user_id, name: s.name, photo: s.photo }]);
  }, []);

  const onRemoveChip = useCallback((userId: string) => {
    hapticLight();
    setInvited((prev) => prev.filter((c) => c.user_id !== userId));
  }, []);

  // "+ Add from your people" picker -> add each picked person as a chip.
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
    setToastQueue((prev) =>
      prev.some((t) => t.userId === s.user_id)
        ? prev
        : [...prev, { userId: s.user_id, name: s.name }]);
  }, [dismissSuggestion]);

  // Undo acts on the head (the entry currently shown), then advances the queue.
  const onUndoDismiss = useCallback(() => {
    const head = toastQueue[0];
    if (!head) return;
    undoDismissSuggestion.mutate(head.userId);
    setHiddenWantIn((p) => { const next = new Set(p); next.delete(head.userId); return next; });
    setToastQueue((prev) => prev.slice(1));
  }, [toastQueue, undoDismissSuggestion]);

  // Auto-dismiss (or the user letting it time out): drop the head, reveal next.
  const onToastDismiss = useCallback(() => {
    setToastQueue((prev) => prev.slice(1));
  }, []);

  const genderOptions = useMemo(() => {
    const opts: { label: string; value: GenderPreference }[] = [
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

  // Form fields
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [locationRaw, setLocationRaw] = useState(''); // always tracks visible input text
  const [locationLat, setLocationLat] = useState<number | null>(null);
  const [locationLng, setLocationLng] = useState<number | null>(null);
  const [neighborhood, setNeighborhood] = useState('');
  const [neighborhoodOther, setNeighborhoodOther] = useState('');
  const [showNeighborhoodPicker, setShowNeighborhoodPicker] = useState(false);
  const [ticketUrl, setTicketUrl] = useState('');
  const [category, setCategory] = useState<Category | null>(null);
  const [genderPref, setGenderPref] = useState<GenderPreference>('mixed');
  const [ageRanges, setAgeRanges] = useState<AgeRange[]>([]);
  const [description, setDescription] = useState('');
  const [creatorMessage, setCreatorMessage] = useState('');
  const [groupSize, setGroupSize] = useState(6);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);

  const params = useLocalSearchParams<{
    prefillTitle?: string;
    prefillExploreEventId?: string;
    prefillStartTime?: string;
    prefillEventDate?: string;
    prefillEndTime?: string;
    prefillDropIn?: string;
    prefillAllowDuplicate?: string;
    prefillDescription?: string;
    prefillImageUrl?: string;
    prefillLocation?: string;
    prefillLocationLat?: string;
    prefillLocationLng?: string;
    prefillNeighborhood?: string;
    prefillCategory?: string;
    prefillAgeRange?: string;
    prefillGenderPref?: string;
    prefillGroupSize?: string;
    prefillTicketsUrl?: string;
    duplicatedFromEventId?: string;
    // Arriving from a person (long-press menu / keep page / profile): pre-attach
    // them as a removable invite chip (the locked auto-attach rule).
    prefillInvitePersonId?: string;
    prefillInvitePersonName?: string;
    prefillInvitePersonPhoto?: string;
  }>();
  const [exploreEventId, setExploreEventId] = useState<string | null>(null);

  // Seed the pre-attached invite chip once when arriving from a person. Consumed
  // via a ref so removing the chip doesn't re-add it on the next render.
  const inviteSeedRef = useRef(false);
  useEffect(() => {
    if (!YOURS_PAGE_ENABLED || inviteSeedRef.current) return;
    const id = params.prefillInvitePersonId;
    if (!id) return;
    inviteSeedRef.current = true;
    setInvited((prev) => prev.some((c) => c.user_id === id) ? prev : [...prev, {
      user_id: id,
      name: params.prefillInvitePersonName?.trim() || 'Someone',
      photo: params.prefillInvitePersonPhoto || null,
    }]);
  }, [params.prefillInvitePersonId]);

  useEffect(() => {
    if (params.prefillTitle && !title) {
      setTitle(params.prefillTitle);
    }
    if (params.prefillExploreEventId) {
      setExploreEventId(params.prefillExploreEventId);
    }

    // Date - accepts either a date string ("2025-03-22") or a full ISO
    // timestamp (the duplicate flow used to pass start_time directly, which
    // appended "T12:00:00" produced an invalid date and silently no-op'd).
    if (params.prefillEventDate) {
      const raw = params.prefillEventDate;
      const d = raw.includes('T') ? new Date(raw) : new Date(`${raw}T12:00:00`);
      if (!isNaN(d.getTime())) {
        setDateMonth(d.getMonth());
        setDateDay(d.getDate());
        setDateYear(d.getFullYear());
        setDateSelected(true);
      }
    }

    // Time - from start_time (ISO timestamp or "HH:MM:SS" time-only)
    if (params.prefillStartTime) {
      let hours: number | null = null;
      let minutes: number | null = null;
      if (params.prefillStartTime.includes('T')) {
        const d = new Date(params.prefillStartTime);
        if (!isNaN(d.getTime())) {
          hours = d.getHours();
          minutes = d.getMinutes();
        }
      } else if (params.prefillStartTime.includes(':')) {
        const parts = params.prefillStartTime.split(':');
        hours = parseInt(parts[0], 10);
        minutes = parseInt(parts[1] ?? '0', 10);
      }
      if (hours !== null && minutes !== null && !isNaN(hours) && !isNaN(minutes)) {
        const period: 'AM' | 'PM' = hours >= 12 ? 'PM' : 'AM';
        let displayHour = hours % 12;
        if (displayHour === 0) displayHour = 12;
        const nearestMinute = MINUTE_OPTIONS.reduce((prev, curr) =>
          Math.abs(parseInt(curr) - minutes!) < Math.abs(parseInt(prev) - minutes!) ? curr : prev
        );
        setTimeHour(displayHour);
        setTimeMinute(nearestMinute);
        setTimePeriod(period);
        setTimeSelected(true);
      }
    }

    // End time prefill - same parser as start_time
    if (params.prefillEndTime) {
      let hours: number | null = null;
      let minutes: number | null = null;
      if (params.prefillEndTime.includes('T')) {
        const d = new Date(params.prefillEndTime);
        if (!isNaN(d.getTime())) {
          hours = d.getHours();
          minutes = d.getMinutes();
        }
      } else if (params.prefillEndTime.includes(':')) {
        const parts = params.prefillEndTime.split(':');
        hours = parseInt(parts[0], 10);
        minutes = parseInt(parts[1] ?? '0', 10);
      }
      if (hours !== null && minutes !== null && !isNaN(hours) && !isNaN(minutes)) {
        const period: 'AM' | 'PM' = hours >= 12 ? 'PM' : 'AM';
        let displayHour = hours % 12;
        if (displayHour === 0) displayHour = 12;
        const nearestMinute = MINUTE_OPTIONS.reduce((prev, curr) =>
          Math.abs(parseInt(curr) - minutes!) < Math.abs(parseInt(prev) - minutes!) ? curr : prev
        );
        setEndHour(displayHour);
        setEndMinute(nearestMinute);
        setEndPeriod(period);
        setEndTimeSelected(true);
      }
    }

    // Drop-in prefill - duplicates pass "true"/"false" as a string
    if (params.prefillDropIn !== undefined) {
      setDropIn(params.prefillDropIn !== 'false');
    }

    // Allow-duplicate prefill - same string-encoded shape as prefillDropIn.
    if (params.prefillAllowDuplicate !== undefined) {
      setAllowDuplicate(params.prefillAllowDuplicate !== 'false');
    }

    if (params.prefillDescription) {
      setDescription(params.prefillDescription);
    }
    if (params.prefillImageUrl) {
      setImageUrl(params.prefillImageUrl);
    }
    if (params.prefillLocation) {
      setLocation(params.prefillLocation);
      setLocationRaw(params.prefillLocation);
      placesRef.current?.setAddressText(params.prefillLocation);
    }
    if (params.prefillCategory) {
      const matched = CATEGORIES.find(
        (c) => c.toLowerCase() === params.prefillCategory!.toLowerCase(),
      );
      if (matched) setCategory(matched);
    }

    // Location coords - paired with prefillLocation text. Both are needed
    // for the post-submit insert; without them the geocoding fallback fires.
    if (params.prefillLocationLat && params.prefillLocationLng) {
      const lat = parseFloat(params.prefillLocationLat);
      const lng = parseFloat(params.prefillLocationLng);
      if (!isNaN(lat) && !isNaN(lng)) {
        setLocationLat(lat);
        setLocationLng(lng);
      }
    }
    if (params.prefillNeighborhood) {
      // Pass through raw - UI's existing "Other" branch handles non-canonical values.
      setNeighborhood(params.prefillNeighborhood);
    }
    if (params.prefillTicketsUrl) {
      setTicketUrl(params.prefillTicketsUrl);
    }
    if (params.prefillAgeRange) {
      const parsed = params.prefillAgeRange
        .split(',')
        .map((s) => s.trim())
        .filter((s): s is AgeRange => (AGE_RANGES as readonly string[]).includes(s));
      if (parsed.length > 0) setAgeRanges(parsed);
    }
    if (params.prefillGenderPref) {
      const valid: GenderPreference[] = ['mixed', 'women_only', 'men_only', 'nonbinary_only'];
      if ((valid as string[]).includes(params.prefillGenderPref)) {
        setGenderPref(params.prefillGenderPref as GenderPreference);
      }
    }
    if (params.prefillGroupSize) {
      const n = parseInt(params.prefillGroupSize, 10);
      if (!isNaN(n)) {
        // groupSize state stores max_invites directly; UI displays groupSize+1
        // as "people total". Clamp to the [MIN_GROUP-1, MAX_GROUP-1] window
        // the stepper allows.
        const clamped = Math.min(Math.max(n, MIN_GROUP - 1), MAX_GROUP - 1);
        setGroupSize(clamped);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.prefillTitle, params.prefillExploreEventId, params.prefillStartTime,
      params.prefillEventDate, params.prefillEndTime, params.prefillDropIn,
      params.prefillDescription, params.prefillImageUrl,
      params.prefillLocation, params.prefillLocationLat, params.prefillLocationLng,
      params.prefillNeighborhood, params.prefillCategory,
      params.prefillAgeRange, params.prefillGenderPref,
      params.prefillGroupSize, params.prefillTicketsUrl]);


  const placesRef = useRef<GooglePlacesAutocompleteRef>(null);
  // Used to prevent onChangeText from clearing coordinates after a Place selection
  const placeJustSelectedRef = useRef(false);

  // Sync the GooglePlacesAutocomplete input text once the ref is attached.
  // The main prefill effect runs before the form mounts (form is gated on
  // screenReady, set after an async profile fetch), so placesRef.current is
  // null at that moment and the setAddressText call silently no-ops. This
  // re-fires once the form is on screen.
  useEffect(() => {
    if (!params.prefillLocation || !screenReady) return;
    placesRef.current?.setAddressText(params.prefillLocation);
  }, [params.prefillLocation, screenReady]);

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setAlertInfo({ title: 'Permission needed', message: 'Go to Settings and allow photo access.' });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [16, 10],
      quality: 1,
    });
    if (!result.canceled && result.assets[0]) {
      const picked = result.assets[0];
      try {
        const manipulated = await ImageManipulator.manipulateAsync(
          picked.uri,
          [{ resize: { width: 1200 } }],
          { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true },
        );
        setImageUrl(manipulated.uri);
        if (manipulated.base64) {
          uploadPhoto(manipulated.base64);
        } else {
          setImageUrl(null);
          setAlertInfo({ title: 'Invalid image', message: PHOTO_FORMAT_ERROR_MESSAGE });
        }
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

  const toggleAgeRange = (range: AgeRange) => {
    hapticLight();
    if (range === 'All Ages') {
      setAgeRanges(['All Ages']);
      return;
    }
    setAgeRanges((prev) => {
      const filtered = prev.filter((r) => r !== 'All Ages');
      if (filtered.includes(range)) {
        return filtered.filter((r) => r !== range);
      }
      if (filtered.length >= 2) return filtered;
      return [...filtered, range];
    });
  };

  // Date
  const [dateMonth, setDateMonth] = useState(now.getMonth());
  const [dateDay, setDateDay] = useState(now.getDate());
  const [dateYear, setDateYear] = useState(currentYear);
  const [dateSelected, setDateSelected] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  // WashedUpCalendar owns its own browsing/view state; the composer only holds
  // the committed selection (dateMonth/dateDay/dateYear/dateSelected).

  // Time
  const [timeHour, setTimeHour] = useState(8);
  const [timeMinute, setTimeMinute] = useState<string>('00');
  const [timePeriod, setTimePeriod] = useState<'AM' | 'PM'>('PM');
  const [timeSelected, setTimeSelected] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [tempHour, setTempHour] = useState(8);
  const [tempMinute, setTempMinute] = useState<string>('00');
  const [tempPeriod, setTempPeriod] = useState<'AM' | 'PM'>('PM');

  // End time (optional - disappears from feed at this point if drop_in is off, or
  // caps the "happening now" window if drop_in is on)
  const [endHour, setEndHour] = useState(11);
  const [endMinute, setEndMinute] = useState<string>('00');
  const [endPeriod, setEndPeriod] = useState<'AM' | 'PM'>('PM');
  const [endTimeSelected, setEndTimeSelected] = useState(false);
  const [showEndTimePicker, setShowEndTimePicker] = useState(false);
  const [tempEndHour, setTempEndHour] = useState(11);
  const [tempEndMinute, setTempEndMinute] = useState<string>('00');
  const [tempEndPeriod, setTempEndPeriod] = useState<'AM' | 'PM'>('PM');

  // Allow-duplicate flag - when false, the "post a duplicate plan" sheet on
  // the plan detail page (shown when plan is full) is suppressed and only
  // the waitlist option appears. Defaults true.
  const [allowDuplicate, setAllowDuplicate] = useState(true);

  // Drop-in flag - when false, plan vanishes from the feed for non-members
  // the moment start_time passes (used for one-shot moments like a movie)
  const [dropIn, setDropIn] = useState(true);

  // Submit
  const [loading, setLoading] = useState(false);
  const [shareModalVisible, setShareModalVisible] = useState(false);
  // Set when an on-post invite delivery rejects; shows a non-blocking note in
  // the share modal. Reset at the start of each post's invite step.
  const [inviteDeliveryFailed, setInviteDeliveryFailed] = useState(false);
  const [pingPlanId, setPingPlanId] = useState<string | null>(null);
  const pendingNavRef = useRef<(() => void) | null>(null);
  const [firstPlanCelebrationVisible, setFirstPlanCelebrationVisible] = useState(false);
  const [postedPlanId, setPostedPlanId] = useState<string | null>(null);
  const [postedPlanTitle, setPostedPlanTitle] = useState('');
  const [postedSpotsLeft, setPostedSpotsLeft] = useState<number | undefined>();
  const [postedGenderLabel, setPostedGenderLabel] = useState<string | undefined>();
  const [alertInfo, setAlertInfo] = useState<{ title: string; message: string; buttons?: BrandedAlertButton[] } | null>(null);
  const firstPlanPendingRef = useRef(false);

  // ─── Drafts ────────────────────────────────────────────────────────────────
  const [drafts, setDrafts] = useState<PlanDraft[]>([]);

  useEffect(() => {
    // Skip the drafts list while a duplicate-plan prefill is active so the
    // user can't accidentally clobber their prefilled state by tapping
    // "load draft", and so saving from a duplicate doesn't silently overwrite
    // a prior draft via stale state.
    if (params.duplicatedFromEventId) return;
    loadDrafts().then(setDrafts);
  }, [params.duplicatedFromEventId]);

  const handleSaveDraft = useCallback(async () => {
    if (!title.trim()) {
      setAlertInfo({ title: 'Add a title', message: 'Give your plan a title before saving as a draft.' });
      return;
    }
    hapticMedium();
    const draft: PlanDraft = {
      id: Date.now().toString(),
      title: title.trim(),
      location, locationLat, locationLng, ticketUrl,
      category, genderPref, ageRanges,
      description, creatorMessage, groupSize,
      imageUrl: (imageUrl && imageUrl.startsWith('http')) ? imageUrl : null,
      savedAt: Date.now(),
    };
    const updated = [draft, ...drafts];
    setDrafts(updated);
    await saveDrafts(updated);
    setAlertInfo({ title: 'Draft saved', message: 'You can continue editing it later.' });
  }, [title, location, locationLat, locationLng, ticketUrl, category, genderPref, ageRanges, description, creatorMessage, groupSize, imageUrl, drafts]);

  const loadDraft = useCallback((draft: PlanDraft) => {
    hapticLight();
    setTitle(draft.title);
    setLocation(draft.location);
    setLocationRaw(draft.location);
    setLocationLat(draft.locationLat);
    setLocationLng(draft.locationLng);
    // Sync the GooglePlacesAutocomplete text input (it manages its own internal state)
    if (draft.location) placesRef.current?.setAddressText(draft.location);
    setTicketUrl(draft.ticketUrl);
    setCategory(draft.category);
    setGenderPref(draft.genderPref);
    setAgeRanges(draft.ageRanges);
    setDescription(draft.description);
    setCreatorMessage(draft.creatorMessage);
    setGroupSize(draft.groupSize);
    if (draft.imageUrl) setImageUrl(draft.imageUrl);
  }, []);

  const deleteDraft = useCallback(async (draftId: string) => {
    const updated = drafts.filter(d => d.id !== draftId);
    setDrafts(updated);
    await saveDrafts(updated);
  }, [drafts]);

  // locationText is used for hint display only - location is validated at submit time via ref
  const locationText = locationRaw.trim() || location.trim() || '';
  const canSubmit = title.trim().length > 0 && dateSelected && timeSelected && category !== null && description.trim().length > 0 && creatorMessage.trim().length >= MSG_MIN && creatorMessage.trim().length <= MSG_LIMIT && !loading && !imageLoading;

  // ─── Date picker (WashedUpCalendar) ──────────────────────────────────────────

  const openDatePicker = () => setShowDatePicker(true);

  // WashedUpCalendar hands back the full {year, month, day}; commit it and close.
  const selectDate = (d: CalendarDay) => {
    setDateMonth(d.month);
    setDateDay(d.day);
    setDateYear(d.year);
    setDateSelected(true);
    setShowDatePicker(false);
    hapticLight();
  };

  // ─── Time picker ─────────────────────────────────────────────────────────────

  const openTimePicker = () => {
    setTempHour(timeHour);
    setTempMinute(timeMinute);
    setTempPeriod(timePeriod);
    setShowTimePicker(true);
  };

  const confirmTime = () => {
    setTimeHour(tempHour);
    setTimeMinute(tempMinute);
    setTimePeriod(tempPeriod);
    setTimeSelected(true);
    setShowTimePicker(false);
    hapticLight();
  };

  // ─── End-time picker ────────────────────────────────────────────────────────

  const openEndTimePicker = () => {
    setTempEndHour(endHour);
    setTempEndMinute(endMinute);
    setTempEndPeriod(endPeriod);
    setShowEndTimePicker(true);
  };

  const confirmEndTime = () => {
    setEndHour(tempEndHour);
    setEndMinute(tempEndMinute);
    setEndPeriod(tempEndPeriod);
    setEndTimeSelected(true);
    setShowEndTimePicker(false);
    hapticLight();
  };

  const clearEndTime = () => {
    setEndTimeSelected(false);
    setShowEndTimePicker(false);
    hapticLight();
  };

  // ─── Submit ───────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (loading || imageLoading) return;

    // Read location from ref at tap time - this is always current regardless of state sync issues
    const effectiveLocation = locationRaw.trim() || location.trim() || placesRef.current?.getAddressText()?.trim() || '';

    // Surface every missing required field at once so the user can see
    // exactly what's left before the plan can be posted.
    const missing: string[] = [];
    if (title.trim().length === 0) missing.push('Title');
    if (!dateSelected) missing.push('Date');
    if (!timeSelected) missing.push('Time');
    if (category === null) missing.push('Category');
    if (effectiveLocation.length === 0) missing.push('Location');
    if (description.trim().length === 0) missing.push('Plan description');
    if (creatorMessage.trim().length < MSG_MIN) {
      missing.push(`Your message (at least ${MSG_MIN} characters)`);
    } else if (creatorMessage.trim().length > MSG_LIMIT) {
      missing.push(`Your message (max ${MSG_LIMIT} characters)`);
    }
    if (missing.length > 0) {
      setAlertInfo({
        title: 'Almost there',
        message: `Please complete these before posting:\n\n• ${missing.join('\n• ')}`,
      });
      return;
    }
    const fieldsToCheck = [title, description, creatorMessage, effectiveLocation].filter(Boolean).join(' ');
    const filter = checkContent(fieldsToCheck);
    if (!filter.ok) {
      setAlertInfo({ title: 'Content not allowed', message: filter.reason ?? 'Please revise your plan and try again.' });
      return;
    }

    hapticMedium();
    setLoading(true);

    // Real optimistic posting handle (see lib/optimisticPlans.ts). Declared here
    // so both the member-orphan early-return and the catch can roll it back.
    let optimistic: OptimisticHandle | null = null;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setAlertInfo({ title: 'Error', message: 'Please sign in again.' });
        setLoading(false);
        return;
      }

      const startTime = buildDatetime(dateMonth, dateDay, dateYear, timeHour, timeMinute, timePeriod);
      if (startTime <= new Date()) {
        setAlertInfo({ title: 'Invalid time', message: 'Please choose a future date and time.' });
        setLoading(false);
        return;
      }

      let endTime: Date | null = null;
      if (endTimeSelected) {
        endTime = buildDatetime(dateMonth, dateDay, dateYear, endHour, endMinute, endPeriod);
        // Allow same-day overnight (e.g. 8pm → 1am next day): if end <= start, push to next day.
        if (endTime <= startTime) {
          endTime = new Date(endTime.getTime() + 24 * 60 * 60 * 1000);
        }
        if (endTime.getTime() - startTime.getTime() < 30 * 60 * 1000) {
          setAlertInfo({ title: 'Invalid end time', message: 'End time must be at least 30 minutes after the start time.' });
          setLoading(false);
          return;
        }
      }

      const ageBounds = ageRangesToMinMax(ageRanges);

      const optimisticNeighborhood = (neighborhood === NEIGHBORHOOD_OTHER
        ? neighborhoodOther.trim()
        : neighborhood.trim()) || null;

      // Prepend the optimistic plan now (past every early-return validation, so
      // we never leave a phantom). Committed to the real id after the host member
      // row lands; rolled back on the orphan early-return and in the catch.
      if (composerUserId) {
        const face = queryClient.getQueryData<MyFace>(['yours', 'my-face', composerUserId]);
        optimistic = prependOptimisticPlan(
          queryClient,
          composerUserId,
          buildOptimisticPlan(
            {
              title: title.trim(),
              start_time: startTime.toISOString(),
              location_text: effectiveLocation || null,
              location_lat: locationLat,
              location_lng: locationLng,
              image_url: (imageUrl && imageUrl.startsWith('http')) ? imageUrl : null,
              primary_vibe: category?.toLowerCase() ?? null,
              gender_rule: genderPref,
              max_invites: groupSize,
              min_invites: MIN_GROUP,
              neighborhood: optimisticNeighborhood,
              status: 'forming',
              host_message: creatorMessage.trim().slice(0, MSG_LIMIT) || null,
              allow_duplicate: allowDuplicate,
            },
            composerUserId,
            {
              id: composerUserId,
              first_name_display: face?.first_name_display ?? null,
              profile_photo_url: face?.profile_photo_url ?? null,
            },
          ),
        );
      }

      const { data: insertedEvent, error } = await supabase
        .from('events')
        .insert({
          title: title.trim(),
          start_time: startTime.toISOString(),
          end_time: endTime ? endTime.toISOString() : null,
          drop_in: dropIn,
          allow_duplicate: allowDuplicate,
          location_text: effectiveLocation || null,
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
          creator_user_id: user.id,
          status: 'forming',
          city: 'Los Angeles',
          explore_event_id: exploreEventId,
          image_url: (imageUrl && imageUrl.startsWith('http')) ? imageUrl : null,
          neighborhood: (neighborhood === NEIGHBORHOOD_OTHER
            ? neighborhoodOther.trim()
            : neighborhood.trim()) || null,
          duplicated_from_event_id: params.duplicatedFromEventId || null,
        })
        .select('id')
        .single();

      if (error) throw error;

      if (insertedEvent?.id) {
        const { error: memberErr } = await supabase.from('event_members').insert({
          event_id: insertedEvent.id,
          user_id: user.id,
          role: 'host',
          status: 'joined',
        });

        if (memberErr) {
          await new Promise(r => setTimeout(r, 500));
          const { error: retryErr } = await supabase.from('event_members').insert({
            event_id: insertedEvent.id,
            user_id: user.id,
            role: 'host',
            status: 'joined',
          });
          if (retryErr) {
            // Roll back the event so it doesn't exist as an orphan with no members
            await supabase.from('events').delete().eq('id', insertedEvent.id);
            // This path returns (not throws), so the catch's rollback won't run:
            // remove the optimistic card here before the alert.
            optimistic?.rollback();
            setAlertInfo({
              title: 'Something went wrong',
              message: 'Could not create your plan. Please try again.',
            });
            return;
          }
        }

        // Event + host member rows both committed: swap the optimistic card's
        // temp id for the real one so it's tappable and routes correctly.
        optimistic?.commit(insertedEvent.id);

        // If this plan was created as a duplicate of another, notify the
        // original plan's waitlist users. Fire-and-forget - a notification
        // failure shouldn't block plan creation.
        if (params.duplicatedFromEventId) {
          supabase.rpc('notify_waitlist_duplicate_plan', {
            p_original_event_id: params.duplicatedFromEventId,
            p_new_event_id: insertedEvent.id,
            p_creator_user_id: user.id,
          }).then(({ error: notifyErr }) => {
            if (notifyErr) console.warn('[post] notify_waitlist_duplicate_plan failed:', notifyErr.message);
          });
        }

        // Next Time! - replay the creator's invite/skip choices against the
        // new event. Only runs after both event creation AND auto-join have
        // succeeded; if we got here those are guaranteed. Fire-and-forget
        // per choice so a single RPC failure doesn't roll back the post.
        if (interestChoices.size > 0) {
          const newEventId = insertedEvent.id;
          const choices = Array.from(interestChoices.entries());
          Promise.allSettled(
            choices.map(([userId, action]) =>
              supabase.rpc('act_on_interest', {
                p_interested_user_id: userId,
                p_new_event_id: newEventId,
                p_action: action,
              })
            )
          ).then(results => {
            const failed = results.filter(r => r.status === 'rejected' || (r as any).value?.error);
            if (failed.length > 0) console.warn('[post] act_on_interest failures:', failed);
          });
          // Clear so a back-nav + re-post doesn't double-fire.
          setInterestChoices(new Map());
        }

        // INVITE PEOPLE (flag-on): deliver the standard invite to every chip
        // (your-people + want-in alike) via the single shared path. Fire-and-
        // forget; a delivery hiccup must not roll back the post. On failure we
        // surface a non-blocking heads-up inside the share modal (which is the
        // post-creation surface that's actually on screen) so the creator isn't
        // left assuming everyone was reached.
        setInviteDeliveryFailed(false);
        if (YOURS_PAGE_ENABLED && invited.length > 0) {
          invitePeopleToPlan.mutate(
            { eventId: insertedEvent.id, recipientIds: invited.map((c) => c.user_id) },
            {
              onError: (e) => {
                console.warn('[post] invite_people_to_plan failed:', e);
                setInviteDeliveryFailed(true);
              },
            },
          );
          setInvited([]);
        }
      }

      hapticSuccess();
      // The Plans feed / "my plans" queries no longer force-refetch on
      // mount (perf fix, incident 2026-05-18), so a freshly-posted plan
      // would otherwise be absent from the cached feed for up to
      // staleTime. Invalidate here - at creation, before the share modal
      // is dismissed - so both are refetched when the user lands back on
      // Plans. Same keys/style as join/leave in app/plan/[id].tsx.
      queryClient.invalidateQueries({ queryKey: ['events', 'feed'] });
      queryClient.invalidateQueries({ queryKey: ['my-plans'] });
      setPostedPlanId(insertedEvent?.id ?? null);
      setPostedPlanTitle(title.trim());
      setPostedSpotsLeft(groupSize);
      setPostedGenderLabel(
        genderPref === 'women_only' ? 'Women only' :
        genderPref === 'men_only' ? 'Men only' :
        genderPref === 'nonbinary_only' ? 'Nonbinary only' : undefined
      );

      // Check if this is the user's first plan ever - show celebration once
      const hasSeen = await AsyncStorage.getItem('hasSeenFirstPlanCelebration');
      if (!hasSeen) {
        const { count } = await supabase
          .from('events')
          .select('id', { count: 'exact', head: true })
          .eq('creator_user_id', user.id);
        if (count === 1) {
          firstPlanPendingRef.current = true;
          await AsyncStorage.setItem('hasSeenFirstPlanCelebration', '1');
        }
      }

      setShareModalVisible(true);
      setImageUrl(null);
      setTitle(''); setLocation(''); setLocationRaw(''); setLocationLat(null); setLocationLng(null); setNeighborhood('');
      setTicketUrl(''); setCategory(null);
      setGenderPref('mixed'); setAgeRanges([]);
      setDescription(''); setCreatorMessage(''); setGroupSize(6);
      setDateSelected(false); setTimeSelected(false);
      setEndTimeSelected(false); setDropIn(true);
      placesRef.current?.clear();
      // Clear URL prefill params so they don't leak into the next post.
      // Without this, tapping "post a duplicate plan" once leaves
      // duplicatedFromEventId in the route state, which would (a) skip
      // the drafts list on the next post and (b) tag a fresh unrelated
      // plan as a duplicate of the prior one - fanning a forged
      // notification to the prior plan's waitlist.
      router.setParams({
        prefillTitle: undefined,
        prefillExploreEventId: undefined,
        prefillStartTime: undefined,
        prefillEventDate: undefined,
        prefillEndTime: undefined,
        prefillDropIn: undefined,
        prefillDescription: undefined,
        prefillImageUrl: undefined,
        prefillLocation: undefined,
        prefillCategory: undefined,
        duplicatedFromEventId: undefined,
        prefillInvitePersonId: undefined,
        prefillInvitePersonName: undefined,
        prefillInvitePersonPhoto: undefined,
      } as any);
    } catch (e: unknown) {
      // Remove the optimistic card (restore the exact prior snapshot) before the alert.
      optimistic?.rollback();
      const rawMsg = e && typeof e === 'object' && 'message' in e
        ? String((e as { message: string }).message)
        : '';
      const msg = rawMsg.includes('events_host_message_length')
        ? `Message must be at least ${MSG_MIN} characters.`
        : rawMsg || 'Could not post your plan. Please try again.';
      setAlertInfo({ title: 'Something went wrong', message: msg });
    } finally {
      setLoading(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────────

  if (!screenReady) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <StatusBar style="dark" />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.terracotta} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar style="dark" />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          decelerationRate="normal"
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="always"
          keyboardDismissMode="on-drag"
        >
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.headerTitle}>Post a Plan</Text>
              <Text style={styles.headerSub}>Find people to go with</Text>
            </View>
            <ProfileButton />
          </View>

          {/* ── Drafts (only if any exist) ── */}
          {drafts.length > 0 && (
            <View style={styles.draftsSection}>
              <Text style={styles.draftsTitle}>Drafts</Text>
              <ScrollView decelerationRate="normal" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.draftsScroll}>
                {drafts.map((d) => (
                  <View key={d.id} style={styles.draftChip}>
                    <TouchableOpacity
                      style={styles.draftChipContent}
                      onPress={() => loadDraft(d)}
                      activeOpacity={0.8}
                    >
                      <FileText size={14} color={Colors.terracotta} strokeWidth={2} />
                      <Text style={styles.draftChipText} numberOfLines={1}>{d.title}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => deleteDraft(d.id)}
                      hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
                      style={styles.draftDeleteBtn}
                    >
                      <Trash2 size={12} color={Colors.textLight} strokeWidth={2} />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            </View>
          )}

          {/* ── Photo (first field) ── */}
          {!imageUrl ? (
            <TouchableOpacity
              style={styles.photoUpload}
              onPress={pickImage}
              activeOpacity={0.8}
            >
              <ImagePlus size={32} color={Colors.terracotta} strokeWidth={2} />
              <Text style={styles.photoUploadText}>Add a photo</Text>
              <Text style={styles.photoUploadHint}>Optional. Your plan works without one.</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.photoPreview}>
              <Image source={{ uri: imageUrl }} style={styles.photoPreviewImage} contentFit="cover" />
              {imageLoading ? (
                <View style={styles.photoLoadingOverlay}>
                  <ActivityIndicator size="large" color={Colors.terracotta} />
                </View>
              ) : (
                <>
                  <TouchableOpacity
                    style={styles.photoRemoveBtn}
                    onPress={() => setImageUrl(null)}
                  >
                    <X size={14} color={Colors.textMedium} strokeWidth={2.5} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.photoChangeBtn}
                    onPress={pickImage}
                  >
                    <Text style={styles.photoChangeBtnText}>Change</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}

          {/* ── Title ── */}
          <View style={styles.field}>
            <Text style={styles.label}>Title <Text style={styles.required}>*</Text></Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Comedy show at The Laugh Factory"
              placeholderTextColor={Colors.textLight}
              value={title}
              onChangeText={setTitle}
              maxLength={80}
              returnKeyType="next"
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />
          </View>

          {/* ── Date (full row) ── */}
          <View style={styles.field}>
            <Text style={styles.label}>Date <Text style={styles.required}>*</Text></Text>
            <TouchableOpacity
              style={[styles.input, styles.pickerButton, !dateSelected && styles.pickerPlaceholder]}
              onPress={openDatePicker}
              activeOpacity={0.8}
            >
              <Text style={[styles.pickerText, !dateSelected && styles.placeholderText]}>
                {dateSelected ? displayDate(dateMonth, dateDay, dateYear) : 'Select date'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* ── Start / End time row ── */}
          <View style={styles.row}>
            <View style={[styles.field, styles.flex]}>
              <Text style={styles.label}>Start time <Text style={styles.required}>*</Text></Text>
              <TouchableOpacity
                style={[styles.input, styles.pickerButton, !timeSelected && styles.pickerPlaceholder]}
                onPress={openTimePicker}
                activeOpacity={0.8}
              >
                <Text style={[styles.pickerText, !timeSelected && styles.placeholderText]}>
                  {timeSelected ? displayTime(timeHour, timeMinute, timePeriod) : 'Select time'}
                </Text>
              </TouchableOpacity>
            </View>
            <View style={styles.rowSpacer} />
            <View style={[styles.field, styles.flex]}>
              <Text style={styles.label}>End time</Text>
              <TouchableOpacity
                style={[styles.input, styles.pickerButton, !endTimeSelected && styles.pickerPlaceholder]}
                onPress={openEndTimePicker}
                activeOpacity={0.8}
              >
                <Text style={[styles.pickerText, !endTimeSelected && styles.placeholderText]}>
                  {endTimeSelected ? displayTime(endHour, endMinute, endPeriod) : 'Optional'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* ── Drop-in toggle ── */}
          <TouchableOpacity
            style={styles.dropInRow}
            onPress={() => { hapticLight(); setDropIn((v) => !v); }}
            activeOpacity={0.7}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: dropIn }}
            accessibilityLabel="drop in anytime"
          >
            <View style={[styles.checkbox, dropIn && styles.checkboxChecked]}>
              {dropIn && <Ionicons name="checkmark" size={16} color={Colors.white} />}
            </View>
            <Text style={styles.dropInLabel}>drop in anytime</Text>
          </TouchableOpacity>
          <Text style={styles.dropInHint}>people can still find and join after it starts</Text>

          {/* ── Allow-duplicate toggle ── */}
          <TouchableOpacity
            style={styles.dropInRow}
            onPress={() => { hapticLight(); setAllowDuplicate((v) => !v); }}
            activeOpacity={0.7}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: allowDuplicate }}
            accessibilityLabel="let others make their own version"
          >
            <View style={[styles.checkbox, allowDuplicate && styles.checkboxChecked]}>
              {allowDuplicate && <Ionicons name="checkmark" size={16} color={Colors.white} />}
            </View>
            <Text style={styles.dropInLabel}>let others make their own version</Text>
          </TouchableOpacity>
          <Text style={styles.dropInHint}>people can duplicate this plan and put their own spin on it</Text>

          {/* ── Location (Google Places) ── */}
          <View style={[styles.field, styles.placesField]}>
            <Text style={styles.label}>Location <Text style={styles.required}>*</Text></Text>
            <GooglePlacesAutocomplete
              ref={placesRef}
              placeholder="Address of the plan"
              fetchDetails
              disableScroll={true}
              onPress={(data, details) => {
                const lat = details?.geometry?.location?.lat ?? null;
                const lng = details?.geometry?.location?.lng ?? null;
                const name = data.structured_formatting?.main_text ?? data.description;
                const locationName = name || data.description;
                // Flag so onChangeText (fired after onPress by the library) doesn't clear these
                placeJustSelectedRef.current = true;
                setLocation(locationName);
                setLocationRaw(locationName);
                setLocationLat(lat);
                setLocationLng(lng);
                // Auto-detect neighborhood via reverse geocoding. If the
                // detected area matches a picker option, pre-select it;
                // otherwise fall back to Other + store the raw string so the
                // creator can correct it.
                if (lat != null && lng != null) {
                  (async () => {
                    try {
                      const results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
                      if (results.length > 0) {
                        const place = results[0];
                        const area = (place.district || place.subregion || place.city || '').trim();
                        if (!area) return;
                        if (NEIGHBORHOOD_SET.has(area)) {
                          setNeighborhood(area);
                          setNeighborhoodOther('');
                        } else {
                          setNeighborhood(NEIGHBORHOOD_OTHER);
                          setNeighborhoodOther(area);
                        }
                      }
                    } catch {}
                  })();
                }
                hapticLight();
              }}
              query={{
                key: GOOGLE_MAPS_API_KEY,
                language: 'en',
                components: 'country:us',
                location: '34.0522,-118.2437',
                radius: '50000',
              }}
              styles={placesStyles}
              textInputProps={{
                placeholderTextColor: Colors.textLight,
                returnKeyType: 'next',
                onChangeText: (text) => {
                  setLocationRaw(text); // always keep raw input state in sync
                  // If the change was triggered by a place selection, skip clearing coordinates
                  if (placeJustSelectedRef.current) {
                    placeJustSelectedRef.current = false;
                    return;
                  }
                  setLocation(text);
                  // User manually edited the text - coordinates no longer match, so clear them
                  setLocationLat(null);
                  setLocationLng(null);
                },
              }}
              enablePoweredByContainer={false}
              debounce={300}
              keepResultsAfterBlur={true}
            />
          </View>

          {/* ── Neighborhood ── */}
          <View style={styles.field}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>Neighborhood</Text>
              <Text style={styles.labelOptional}>(optional)</Text>
            </View>
            <TouchableOpacity
              style={styles.neighborhoodPickerBtn}
              onPress={() => { hapticLight(); Keyboard.dismiss(); setShowNeighborhoodPicker(true); }}
              activeOpacity={0.8}
            >
              <Text style={neighborhood ? styles.neighborhoodPickerValue : styles.neighborhoodPickerPlaceholder}>
                {neighborhood || 'Select neighborhood'}
              </Text>
              <Ionicons name="chevron-down" size={18} color={Colors.textLight} />
            </TouchableOpacity>
            {neighborhood === NEIGHBORHOOD_OTHER && (
              <TextInput
                style={[styles.neighborhoodOtherInput, { marginTop: 8 }]}
                value={neighborhoodOther}
                onChangeText={setNeighborhoodOther}
                placeholder="Where is it?"
                placeholderTextColor={Colors.textLight}
                maxLength={40}
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
                inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
              />
            )}
          </View>

          {/* ── Ticket Link ── */}
          <View style={styles.field}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>Ticket Link</Text>
              <Text style={styles.labelOptional}>(optional)</Text>
            </View>
            <TextInput
              style={styles.input}
              placeholder="e.g. ra.co/events/... or eventbrite.com/..."
              placeholderTextColor={Colors.textLight}
              value={ticketUrl}
              onChangeText={setTicketUrl}
              returnKeyType="next"
              autoCapitalize="none"
              keyboardType="url"
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />
          </View>

          {/* ── Category ── */}
          <View style={styles.field}>
            <Text style={styles.label}>Category <Text style={styles.required}>*</Text></Text>
            <TouchableOpacity
              style={[styles.input, styles.pickerButton, !category && styles.pickerPlaceholder]}
              onPress={() => setShowCategoryPicker(true)}
              activeOpacity={0.8}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={[styles.pickerText, !category && styles.placeholderText]}>
                  {category ?? 'Select a category'}
                </Text>
                <Text style={{ fontSize: FontSizes.bodyMD, color: Colors.textLight }}>▼</Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* ── Who can join ── */}
          <View style={styles.field}>
            <Text style={styles.label}>Who can join</Text>
            {userGender ? (
              <View style={styles.genderRow}>
                {genderOptions.map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.genderPill, genderPref === opt.value && styles.pillSelected]}
                    onPress={() => {
                      hapticLight();
                      setGenderPref(opt.value);
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.pillText, genderPref === opt.value && styles.pillTextSelected]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <ActivityIndicator size="small" color={Colors.terracotta} />
            )}
          </View>

          {/* ── Age range ── */}
          <View style={styles.field}>
            <Text style={styles.label}>Age range</Text>
            <View style={styles.wrapRow}>
              {AGE_RANGES.map((range) => {
                const isSelected = ageRanges.includes(range);
                return (
                  <TouchableOpacity
                    key={range}
                    style={[styles.pill, isSelected && styles.pillSelected]}
                    onPress={() => toggleAgeRange(range)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.pillText, isSelected && styles.pillTextSelected]}>
                      {range}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={styles.stepperHint}>Select up to 2 ranges, or All Ages</Text>
          </View>

          {/* ── Plan description ── */}
          <View style={styles.field}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>Plan description <Text style={styles.required}>*</Text></Text>
              <Text style={styles.charCount}>{description.length}/{DESC_LIMIT}</Text>
            </View>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="What's the plan? Dress code, what to expect, parking tips..."
              placeholderTextColor={Colors.textLight}
              value={description}
              onChangeText={(t) => setDescription(t.slice(0, DESC_LIMIT))}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />
          </View>

          {/* ── Creator note (personal message) ── */}
          <View style={styles.field}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>Your message <Text style={styles.required}>*</Text></Text>
              <Text style={styles.charCount}>{creatorMessage.length}/{MSG_LIMIT}</Text>
            </View>
            <TextInput
              style={[styles.input, { minHeight: 60 }]}
              placeholder="Always wanted to check this out, who's in?"
              placeholderTextColor={Colors.textLight}
              value={creatorMessage}
              onChangeText={(t) => setCreatorMessage(t.slice(0, MSG_LIMIT))}
              multiline
              numberOfLines={2}
              textAlignVertical="top"
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />
            <Text style={styles.stepperHint}>Min {MSG_MIN} characters · Max {MSG_LIMIT}</Text>
          </View>

          {/* ── Group size ── */}
          <View style={styles.field}>
            <Text style={styles.label}>How many</Text>
            <View style={styles.stepperRow}>
              <TouchableOpacity
                style={[styles.stepperBtn, groupSize <= (MIN_GROUP - 1) && styles.stepperBtnDisabled]}
                onPress={() => {
                  if (groupSize > (MIN_GROUP - 1)) {
                    hapticLight();
                    setGroupSize(g => g - 1);
                  }
                }}
                disabled={groupSize <= (MIN_GROUP - 1)}
              >
                <Text style={styles.stepperBtnText}>−</Text>
              </TouchableOpacity>
              <View style={styles.stepperValue}>
                <Text style={styles.stepperValueText}>{groupSize + 1}</Text>
                <Text style={styles.stepperValueSub}>people total</Text>
              </View>
              <TouchableOpacity
                style={[styles.stepperBtn, groupSize >= (MAX_GROUP - 1) && styles.stepperBtnDisabled]}
                onPress={() => {
                  if (groupSize < (MAX_GROUP - 1)) {
                    hapticLight();
                    setGroupSize(g => g + 1);
                  }
                }}
                disabled={groupSize >= (MAX_GROUP - 1)}
              >
                <Text style={styles.stepperBtnText}>+</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.stepperHint}>including you</Text>
          </View>

          {/* INVITE PEOPLE (YOURS_PAGE_ENABLED): your people + want-in suggestions,
              merged, with a removable pre-attached chips row. Replaces the legacy
              "People who want in" section below. Delivery is invite_people_to_plan
              on post. */}
          {YOURS_PAGE_ENABLED && (
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
          )}

          {/* Legacy "People who want in" (flag-off only): surfaces past interest
              signals, invite/skip per row, replayed via act_on_interest on post. */}
          {!YOURS_PAGE_ENABLED && interestSignals.length > 0 && (
            <View style={styles.interestSection}>
              <TouchableOpacity
                style={styles.interestHeaderRow}
                onPress={() => { hapticLight(); setInterestExpanded(e => !e); }}
                activeOpacity={0.7}
              >
                <View style={styles.interestHeaderTextWrap}>
                  <Text style={styles.interestSectionTitle}>People who want in</Text>
                  <Text style={styles.interestSectionSub}>
                    {interestSignals.length === 1
                      ? '1 person said they’d go next time'
                      : `${interestSignals.length} people said they’d go next time`}
                  </Text>
                </View>
                <Ionicons
                  name={interestExpanded ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={Colors.textMedium}
                />
              </TouchableOpacity>
              {interestExpanded && (
                <View style={styles.interestList}>
                  {(interestShowAll ? interestSignals : interestSignals.slice(0, 10)).map(row => {
                    const choice = interestChoices.get(row.interested_user_id);
                    return (
                      <View key={row.signal_id} style={styles.interestRow}>
                        {row.interested_photo_url ? (
                          <Image source={{ uri: row.interested_photo_url }} style={styles.interestAvatar} />
                        ) : (
                          <View style={[styles.interestAvatar, styles.interestAvatarPlaceholder]}>
                            <Text style={styles.interestAvatarInitial}>
                              {row.interested_name?.[0]?.toUpperCase() ?? '?'}
                            </Text>
                          </View>
                        )}
                        <View style={styles.interestRowText}>
                          <Text style={styles.interestRowName} numberOfLines={1}>
                            {row.interested_name ?? 'Someone'}
                          </Text>
                          <Text style={styles.interestRowOrigin} numberOfLines={1}>
                            {row.origin_event_title ?? 'a past plan'}
                          </Text>
                        </View>
                        <View style={styles.interestRowActions}>
                          <TouchableOpacity
                            style={[
                              styles.interestInviteBtn,
                              choice === 'invite' && styles.interestInviteBtnActive,
                            ]}
                            onPress={() => setInterestChoice(row.interested_user_id, 'invite')}
                            activeOpacity={0.8}
                          >
                            <Text
                              style={[
                                styles.interestInviteBtnText,
                                choice === 'invite' && styles.interestInviteBtnTextActive,
                              ]}
                            >
                              {choice === 'invite' ? 'Inviting' : 'Invite to this plan'}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.interestSkipBtn}
                            onPress={() => setInterestChoice(row.interested_user_id, 'skip')}
                            activeOpacity={0.7}
                          >
                            <Text
                              style={[
                                styles.interestSkipBtnText,
                                choice === 'skip' && styles.interestSkipBtnTextActive,
                              ]}
                            >
                              {choice === 'skip' ? 'Maybe next one ✓' : 'Maybe next one'}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
                  {interestSignals.length > 10 && !interestShowAll && (
                    <TouchableOpacity
                      style={styles.interestShowAllBtn}
                      onPress={() => { hapticLight(); setInterestShowAll(true); }}
                    >
                      <Text style={styles.interestShowAllText}>
                        {`Show all ${interestSignals.length}`}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          )}

          {/* Bottom spacer so content isn't hidden behind sticky button */}
          <View style={{ height: 100 }} />
        </ScrollView>

        {/* ── Sticky submit button ── */}
        <View style={[styles.stickyFooter, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          {!canSubmit && (
            <Text style={styles.requiredHint}>
              {title.trim().length === 0
                ? 'Add a title to continue'
                : !dateSelected
                  ? 'Select a date'
                  : !timeSelected
                    ? 'Select a time'
                    : category === null
                      ? 'Select a category'
                      : locationText.length === 0
                        ? 'Add a location'
                        : description.trim().length === 0
                          ? 'Add a plan description'
                          : creatorMessage.trim().length < MSG_MIN
                            ? `Message must be at least ${MSG_MIN} characters`
                            : 'Add a message'}
            </Text>
          )}
          <TouchableOpacity
            style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={loading || imageLoading}
            activeOpacity={0.9}
          >
            {loading
              ? <ActivityIndicator color={Colors.white} size="small" />
              : <Text style={styles.submitBtnText}>Post It  →</Text>
            }
          </TouchableOpacity>
          {title.trim().length > 0 && !loading && (
            <TouchableOpacity
              style={styles.saveDraftBtn}
              onPress={handleSaveDraft}
              activeOpacity={0.8}
            >
              <Text style={styles.saveDraftBtnText}>Save as Draft</Text>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>

      <FirstPlanCelebration
        visible={firstPlanCelebrationVisible}
        onDismiss={() => {
          const planIdToNavigate = postedPlanId;
          setFirstPlanCelebrationVisible(false);
          setPostedPlanId(null);
          setPostedPlanTitle('');
          setTimeout(() => {
            if (planIdToNavigate) router.push(`/plan/${planIdToNavigate}` as any);
            else router.replace('/(tabs)/plans');
          }, 350);
        }}
      />

      <SharePlanModal
        visible={shareModalVisible}
        onClose={() => {
          const planIdToNavigate = postedPlanId;
          setShareModalVisible(false);
          if (firstPlanPendingRef.current) {
            firstPlanPendingRef.current = false;
            setTimeout(() => setFirstPlanCelebrationVisible(true), 400);
          } else {
            const runNav = () => {
              setPostedPlanId(null);
              setPostedPlanTitle('');
              setTimeout(() => {
                if (planIdToNavigate) {
                  router.push(`/plan/${planIdToNavigate}` as any);
                } else {
                  router.replace('/(tabs)/plans');
                }
              }, 350);
            };
            if (YOURS_PAGE_ENABLED && planIdToNavigate) {
              // Ping moment before navigating on (spec: after create).
              pendingNavRef.current = runNav;
              setPingPlanId(planIdToNavigate);
            } else {
              runNav();
            }
          }
        }}
        planTitle={postedPlanTitle}
        planId={postedPlanId || ''}
        slug={null}
        genderLabel={postedGenderLabel}
        variant="posted"
        inviteWarning={inviteDeliveryFailed}
      />

      {YOURS_PAGE_ENABLED && (
        <PingAfterPlanModal
          planId={pingPlanId}
          onDone={() => {
            const nav = pendingNavRef.current;
            pendingNavRef.current = null;
            setPingPlanId(null);
            nav?.();
          }}
        />
      )}

      {/* ── Neighborhood Picker Modal ── */}
      <Modal
        visible={showNeighborhoodPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowNeighborhoodPicker(false)}
        statusBarTranslucent
      >
        <Pressable style={styles.neighborhoodSheetOverlay} onPress={() => setShowNeighborhoodPicker(false)}>
          <Pressable style={styles.neighborhoodSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.neighborhoodSheetHeader}>
              <Text style={styles.neighborhoodSheetTitle}>Select neighborhood</Text>
              <TouchableOpacity
                onPress={() => setShowNeighborhoodPicker(false)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="close" size={22} color={Colors.asphalt} />
              </TouchableOpacity>
            </View>
            <ScrollView decelerationRate="normal" style={styles.neighborhoodSheetList} showsVerticalScrollIndicator={false}>
              {[...NEIGHBORHOOD_OPTIONS, NEIGHBORHOOD_OTHER].map((opt) => {
                const selected = neighborhood === opt;
                return (
                  <TouchableOpacity
                    key={opt}
                    style={styles.neighborhoodOption}
                    onPress={() => {
                      hapticLight();
                      setNeighborhood(opt);
                      setShowNeighborhoodPicker(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.neighborhoodOptionText, selected && styles.neighborhoodOptionTextSelected]}>
                      {opt}
                    </Text>
                    {selected && <Ionicons name="checkmark" size={18} color={Colors.terracotta} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Date Picker Modal ── */}
      <Modal visible={showDatePicker} transparent animationType="slide" onRequestClose={() => setShowDatePicker(false)} statusBarTranslucent>
        <Pressable style={styles.modalOverlay} onPress={() => setShowDatePicker(false)}>
          <Pressable
            style={[styles.modalSheet, { paddingBottom: sheetBottomPad }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={styles.modalTitle}>Select date</Text>
            <WashedUpCalendar
              mode="pick"
              selected={dateSelected ? { year: dateYear, month: dateMonth, day: dateDay } : null}
              onSelect={selectDate}
            />
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Time Picker Modal ── */}
      <Modal visible={showTimePicker} transparent animationType="slide" onRequestClose={() => setShowTimePicker(false)} statusBarTranslucent>
        <Pressable style={styles.modalOverlay} onPress={() => setShowTimePicker(false)}>
          <Pressable
            style={[styles.modalSheet, { paddingBottom: sheetBottomPad }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={styles.modalTitle}>Select time</Text>
            <View style={styles.pickerRow}>
              {/* Hour */}
              <ScrollView decelerationRate="normal" style={styles.pickerCol} showsVerticalScrollIndicator={false}>
                {HOURS.map((h) => (
                  <Pressable
                    key={h}
                    style={[styles.pickerItem, tempHour === h && styles.pickerItemSelected]}
                    onPress={() => setTempHour(h)}
                  >
                    <Text style={[styles.pickerItemText, tempHour === h && styles.pickerItemTextSel]}>
                      {h}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              {/* Minute */}
              <ScrollView decelerationRate="normal" style={styles.pickerCol} showsVerticalScrollIndicator={false}>
                {MINUTE_OPTIONS.map((m) => (
                  <Pressable
                    key={m}
                    style={[styles.pickerItem, tempMinute === m && styles.pickerItemSelected]}
                    onPress={() => setTempMinute(m)}
                  >
                    <Text style={[styles.pickerItemText, tempMinute === m && styles.pickerItemTextSel]}>
                      :{m}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              {/* AM/PM */}
              <ScrollView decelerationRate="normal" style={styles.pickerCol} showsVerticalScrollIndicator={false}>
                {PERIODS.map((p) => (
                  <Pressable
                    key={p}
                    style={[styles.pickerItem, tempPeriod === p && styles.pickerItemSelected]}
                    onPress={() => setTempPeriod(p)}
                  >
                    <Text style={[styles.pickerItemText, tempPeriod === p && styles.pickerItemTextSel]}>
                      {p}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
            <TouchableOpacity style={styles.modalBtn} onPress={confirmTime}>
              <Text style={styles.modalBtnText}>Done</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── End Time Picker Modal ── */}
      <Modal visible={showEndTimePicker} transparent animationType="slide" onRequestClose={() => setShowEndTimePicker(false)} statusBarTranslucent>
        <Pressable style={styles.modalOverlay} onPress={() => setShowEndTimePicker(false)}>
          <Pressable
            style={[styles.modalSheet, { paddingBottom: sheetBottomPad }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={styles.modalTitle}>End time</Text>
            <View style={styles.pickerRow}>
              {/* Hour */}
              <ScrollView decelerationRate="normal" style={styles.pickerCol} showsVerticalScrollIndicator={false}>
                {HOURS.map((h) => (
                  <Pressable
                    key={h}
                    style={[styles.pickerItem, tempEndHour === h && styles.pickerItemSelected]}
                    onPress={() => setTempEndHour(h)}
                  >
                    <Text style={[styles.pickerItemText, tempEndHour === h && styles.pickerItemTextSel]}>
                      {h}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              {/* Minute */}
              <ScrollView decelerationRate="normal" style={styles.pickerCol} showsVerticalScrollIndicator={false}>
                {MINUTE_OPTIONS.map((m) => (
                  <Pressable
                    key={m}
                    style={[styles.pickerItem, tempEndMinute === m && styles.pickerItemSelected]}
                    onPress={() => setTempEndMinute(m)}
                  >
                    <Text style={[styles.pickerItemText, tempEndMinute === m && styles.pickerItemTextSel]}>
                      :{m}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              {/* AM/PM */}
              <ScrollView decelerationRate="normal" style={styles.pickerCol} showsVerticalScrollIndicator={false}>
                {PERIODS.map((p) => (
                  <Pressable
                    key={p}
                    style={[styles.pickerItem, tempEndPeriod === p && styles.pickerItemSelected]}
                    onPress={() => setTempEndPeriod(p)}
                  >
                    <Text style={[styles.pickerItemText, tempEndPeriod === p && styles.pickerItemTextSel]}>
                      {p}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
            <TouchableOpacity style={styles.modalBtn} onPress={confirmEndTime}>
              <Text style={styles.modalBtnText}>Done</Text>
            </TouchableOpacity>
            {endTimeSelected && (
              <TouchableOpacity style={styles.modalClearBtn} onPress={clearEndTime}>
                <Text style={styles.modalClearBtnText}>Clear end time</Text>
              </TouchableOpacity>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Category Picker Modal ── */}
      <Modal visible={showCategoryPicker} transparent animationType="slide" onRequestClose={() => setShowCategoryPicker(false)} statusBarTranslucent>
        <Pressable style={styles.modalOverlay} onPress={() => setShowCategoryPicker(false)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Select category</Text>
            <ScrollView decelerationRate="normal" style={{ maxHeight: 300 }} showsVerticalScrollIndicator={false}>
              {CATEGORIES.map((cat) => (
                <TouchableOpacity
                  key={cat}
                  style={[
                    styles.categoryItem,
                    category === cat && styles.categoryItemSelected,
                  ]}
                  onPress={() => {
                    hapticLight();
                    setCategory(cat);
                    setShowCategoryPicker(false);
                  }}
                >
                  <Text style={[
                    styles.categoryItemText,
                    category === cat && styles.categoryItemTextSelected,
                  ]}>
                    {cat}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <BrandedAlert
        visible={!!alertInfo}
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message}
        buttons={alertInfo?.buttons}
        onClose={() => setAlertInfo(null)}
      />

      <Toast
        key={toastQueue[0]?.userId}
        visible={toastQueue.length > 0}
        message={COPY.inviteDismissToast}
        actionLabel={COPY.inviteUndo}
        onAction={onUndoDismiss}
        onDismiss={onToastDismiss}
      />

      <PeoplePickerSheet
        visible={peoplePickerOpen}
        excludeIds={invited.map((c) => c.user_id)}
        onClose={() => setPeoplePickerOpen(false)}
        onConfirm={onPickedFromPeople}
      />
    </SafeAreaView>
  );
}

// ─── Google Places Styles (matches existing input design) ────────────────────

const placesStyles = {
  container: { flex: 0 },
  textInputContainer: { backgroundColor: 'transparent' },
  textInput: {
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    fontSize: FontSizes.bodyLG,
    fontFamily: Fonts.sans,
    color: Colors.asphalt,
    height: 52,
    marginBottom: 0,
  },
  listView: {
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    marginTop: 4,
    overflow: 'hidden' as const,
    zIndex: 100,
    elevation: 100,
  },
  row: { paddingHorizontal: 16, paddingVertical: 13, backgroundColor: Colors.cardBg },
  separator: { height: 1, backgroundColor: Colors.border, marginHorizontal: 16 },
  description: { color: Colors.asphalt, fontSize: FontSizes.bodyLG, fontFamily: Fonts.sans },
  predefinedPlacesDescription: { color: Colors.terracotta },
  poweredContainer: { display: 'none' as const },
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.parchment },
  centered: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const },
  flex: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 0, paddingBottom: 24 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    paddingBottom: 12,
    marginBottom: 24,
  },
  headerTitle: {
    fontSize: FontSizes.displayLG,
    fontWeight: '700',
    color: '#2C1810',
  },
  headerSub: { fontSize: FontSizes.bodyMD, fontFamily: Fonts.sans, color: Colors.textLight, marginTop: 4 },

  photoUpload: {
    width: '100%',
    aspectRatio: 16 / 10,
    borderRadius: 14,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: Colors.border,
    backgroundColor: Colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  photoUploadText: { fontSize: FontSizes.bodyMD, fontFamily: Fonts.sans, color: Colors.warmGray, marginTop: 8 },
  photoUploadHint: { fontSize: FontSizes.caption, fontFamily: Fonts.sans, color: Colors.textLight, marginTop: 4 },
  photoPreview: {
    width: '100%',
    aspectRatio: 16 / 10,
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 20,
    position: 'relative',
  },
  photoPreviewImage: { width: '100%', height: '100%' },
  photoLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.overlayWhite,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoRemoveBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.shadowMedium,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  photoChangeBtn: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    backgroundColor: Colors.white,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    shadowColor: Colors.shadowMedium,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  photoChangeBtnText: { fontSize: FontSizes.caption, fontFamily: Fonts.sansMedium, color: Colors.asphalt },

  field: { marginBottom: 20 },
  placesField: { zIndex: 100, elevation: 100 },
  label: { fontSize: FontSizes.bodyMD, fontFamily: Fonts.sansMedium, color: Colors.textMedium, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  labelOptional: { fontSize: FontSizes.bodySM, fontFamily: Fonts.sans, color: Colors.textLight, fontStyle: 'italic' },
  charCount: { fontSize: FontSizes.bodySM, fontFamily: Fonts.sans, color: Colors.textLight },

  input: {
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    paddingLeft: 16,
    paddingRight: 16,
    paddingVertical: 14,
    fontSize: FontSizes.bodyLG,
    fontFamily: Fonts.sans,
    color: Colors.asphalt,
    textAlign: 'left',
  },
  textArea: { minHeight: 100, paddingTop: 14 },

  row: { flexDirection: 'row', marginBottom: 20 },
  rowSpacer: { width: 12 },

  pickerButton: { justifyContent: 'center' },
  pickerPlaceholder: { borderColor: Colors.border },
  pickerText: { fontSize: FontSizes.bodyLG, fontFamily: Fonts.sans, color: Colors.asphalt },
  placeholderText: { color: Colors.textLight, fontFamily: Fonts.sans },

  pillRow: { gap: 8, paddingRight: 8 },
  pill: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 20,
  },
  pillSelected: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  pillText: { fontSize: FontSizes.bodyLG, color: Colors.asphalt, fontFamily: Fonts.sansMedium },
  pillTextSelected: { color: Colors.white, fontFamily: Fonts.sansMedium },

  genderRow: { flexDirection: 'row', gap: 10 },
  genderPill: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
  },

  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },

  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 0 },
  stepperBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnDisabled: { opacity: 0.35 },
  stepperBtnText: { fontSize: FontSizes.displayMD, color: Colors.asphalt, fontFamily: Fonts.sans },
  stepperValue: { flex: 1, alignItems: 'center' },
  stepperValueText: { fontSize: FontSizes.displayLG, fontFamily: Fonts.sansBold, color: Colors.terracotta },
  stepperValueSub: { fontSize: FontSizes.caption, color: Colors.textLight, marginTop: -2 },
  stepperHint: { fontSize: FontSizes.caption, color: Colors.textLight, marginTop: 6 },

  // Next Time! "People who want in" section. Gold per CLAUDE.md documented
  // exception: warm/optional invite, not a primary CTA.
  interestSection: {
    marginTop: 28,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  interestHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  interestHeaderTextWrap: { flex: 1 },
  interestSectionTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
  },
  interestSectionSub: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.textMedium,
    marginTop: 2,
  },
  interestList: { marginTop: 12, gap: 12 },
  interestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  interestAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  interestAvatarPlaceholder: {
    backgroundColor: Colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  interestAvatarInitial: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.terracotta,
  },
  interestRowText: { flex: 1, minWidth: 0 },
  interestRowName: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  interestRowOrigin: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.textMedium,
    marginTop: 2,
  },
  interestRowActions: {
    alignItems: 'flex-end',
    gap: 4,
  },
  interestInviteBtn: {
    backgroundColor: Colors.goldAccent,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  interestInviteBtnActive: {
    backgroundColor: Colors.quoteText,
  },
  interestInviteBtnText: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.caption,
    color: Colors.quoteText,
  },
  interestInviteBtnTextActive: {
    color: Colors.white,
  },
  interestSkipBtn: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  interestSkipBtnText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.warmGray,
  },
  interestSkipBtnTextActive: {
    color: Colors.asphalt,
    fontFamily: Fonts.sansSemibold,
  },
  interestShowAllBtn: {
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  interestShowAllText: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
  },

  stickyFooter: {
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 8 : 16,
    paddingTop: 12,
    backgroundColor: Colors.parchment,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  requiredHint: { fontSize: FontSizes.bodySM, fontFamily: Fonts.sans, color: Colors.textLight, textAlign: 'center', marginBottom: 8 },
  submitBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 14,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.terracotta,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  submitBtnDisabled: { opacity: 0.45, shadowOpacity: 0 },
  submitBtnText: { fontSize: FontSizes.bodyLG, fontFamily: Fonts.sansBold, color: Colors.white, letterSpacing: 0.3 },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlayDark,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: Colors.parchment,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  modalTitle: { fontSize: FontSizes.displaySM, fontFamily: Fonts.sansBold, color: Colors.asphalt, marginBottom: 16 },
  pickerRow: { flexDirection: 'row', gap: 8, maxHeight: 200, marginBottom: 20 },
  pickerCol: { flex: 2 },
  pickerColSm: { flex: 1 },
  pickerItem: { paddingVertical: 11, paddingHorizontal: 6, alignItems: 'center', borderRadius: 8 },
  pickerItemSelected: { backgroundColor: Colors.terracotta },
  pickerItemText: { fontSize: FontSizes.bodyLG, fontFamily: Fonts.sans, color: Colors.asphalt },
  pickerItemTextSel: { color: Colors.white, fontFamily: Fonts.sansMedium },
  modalBtn: {
    height: 52,
    borderRadius: 14,
    backgroundColor: Colors.terracotta,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnText: { fontSize: FontSizes.bodyLG, fontFamily: Fonts.sansBold, color: Colors.white },
  modalClearBtn: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  modalClearBtnText: { fontSize: FontSizes.bodyMD, fontFamily: Fonts.sansMedium, color: Colors.textMedium },

  dropInRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingBottom: 4,
    marginTop: -8,
  },
  dropInHint: {
    fontSize: FontSizes.bodySM,
    fontFamily: Fonts.sans,
    color: Colors.textLight,
    marginLeft: 32,
    marginBottom: 20,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.cardBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: Colors.terracotta,
    borderColor: Colors.terracotta,
  },
  dropInLabel: { fontSize: FontSizes.bodyMD, fontFamily: Fonts.sans, color: Colors.asphalt },

  required: { color: Colors.errorRed, fontSize: FontSizes.bodyMD, fontFamily: Fonts.sans },

  categoryItem: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginBottom: 4,
  },
  categoryItemSelected: { backgroundColor: Colors.terracotta },
  categoryItemText: { fontSize: FontSizes.bodyLG, fontFamily: Fonts.sans, color: Colors.asphalt },
  categoryItemTextSelected: { color: Colors.white, fontFamily: Fonts.sansMedium },

  draftsSection: {
    marginBottom: 20,
    marginTop: -8,
  },
  draftsTitle: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.textMedium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  draftsScroll: { gap: 8 },
  draftChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 20,
    paddingLeft: 12,
    paddingRight: 4,
    height: 36,
  },
  draftChipContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 160,
  },
  draftChipText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.asphalt,
  },
  draftDeleteBtn: {
    padding: 8,
  },
  saveDraftBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  saveDraftBtnText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.terracotta,
  },

  neighborhoodPickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F5EDE0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  neighborhoodPickerValue: {
    fontFamily: Fonts.sans,
    fontSize: 15,
    color: '#2C1810',
    flex: 1,
  },
  neighborhoodPickerPlaceholder: {
    fontFamily: Fonts.sans,
    fontSize: 15,
    color: '#A09385',
    flex: 1,
  },
  neighborhoodOtherInput: {
    backgroundColor: '#F5EDE0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: Fonts.sans,
    fontSize: 15,
    color: '#2C1810',
  },
  neighborhoodSheetOverlay: {
    flex: 1,
    backgroundColor: Colors.overlayDark,
    justifyContent: 'flex-end',
  },
  neighborhoodSheet: {
    backgroundColor: Colors.parchment,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    paddingBottom: 32,
    maxHeight: '80%',
  },
  neighborhoodSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  neighborhoodSheetTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
  },
  neighborhoodSheetList: {
    paddingHorizontal: 12,
  },
  neighborhoodOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 10,
  },
  neighborhoodOptionText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
  },
  neighborhoodOptionTextSelected: {
    fontFamily: Fonts.sansBold,
    color: Colors.terracotta,
  },
});
