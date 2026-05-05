import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
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
import { hapticLight, hapticMedium, hapticHeavy, hapticSelection, hapticSuccess, hapticWarning, hapticError } from '../../../lib/haptics';
import * as Location from 'expo-location';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { ImagePlus, X, FileText, Trash2 } from 'lucide-react-native';
import FirstPlanCelebration from '../../../components/FirstPlanCelebration';
import { SharePlanModal } from '../../../components/modals/SharePlanModal';
import ProfileButton from '../../../components/ProfileButton';
import { GooglePlacesAutocomplete, GooglePlacesAutocompleteRef } from 'react-native-google-places-autocomplete';
import { uploadBase64ToStorage } from '../../../lib/uploadPhoto';
import {
  NEIGHBORHOOD_OPTIONS,
  NEIGHBORHOOD_OTHER,
  NEIGHBORHOOD_SET,
} from '../../../constants/Neighborhoods';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../lib/supabase';
import Colors from '../../../constants/Colors';
import { PHOTO_FORMAT_ERROR_MESSAGE } from '../../../constants/PhotoUpload';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { checkContent } from '../../../lib/contentFilter';
import { BrandedAlert, BrandedAlertButton } from '../../../components/BrandedAlert';

// Prefer the EXPO_PUBLIC_ var (available at runtime in all Expo builds).
// Falls back to the hard-coded key so autocomplete works in preview/CI builds
// where only the EAS Secret GOOGLE_MAPS_API_KEY was set (server-side only).
const GOOGLE_MAPS_API_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
  'AIzaSyApjwAgT5x1pw5NgqSvrACmZaKapYuXgCw';

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

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const HOURS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const MINUTE_OPTIONS = ['00', '15', '30', '45'];
const PERIODS: ('AM' | 'PM')[] = ['AM', 'PM'];

const MIN_GROUP = 3;
const MAX_GROUP = 8;
const MSG_MIN = 10;
const MSG_LIMIT = 150;
const DESC_LIMIT = 500;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDaysInMonth(month: number, year: number): number {
  return new Date(year, month + 1, 0).getDate();
}

// "Today" in America/Los_Angeles, returned as 0-indexed month + day-of-month +
// year. Used so the calendar grid disables past days against the LA boundary
// regardless of the device's timezone.
function getTodayInLA(): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(new Date());
  const get = (k: 'year' | 'month' | 'day') =>
    Number(parts.find((p) => p.type === k)!.value);
  return { y: get('year'), m: get('month') - 1, d: get('day') };
}

function isBeforeTodayLA(y: number, m: number, d: number): boolean {
  const t = getTodayInLA();
  if (y !== t.y) return y < t.y;
  if (m !== t.m) return m < t.m;
  return d < t.d;
}

// Sunday-first month grid: rows of 7, leading/trailing nulls for cells that
// don't belong to the displayed month.
function buildMonthGrid(year: number, month: number): (number | null)[][] {
  const firstWeekday = new Date(year, month, 1).getDay();
  const days = getDaysInMonth(month, year);
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

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

export default function PostScreen() {
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
    prefillDescription?: string;
    prefillImageUrl?: string;
    prefillLocation?: string;
    prefillCategory?: string;
    duplicatedFromEventId?: string;
  }>();
  const [exploreEventId, setExploreEventId] = useState<string | null>(null);

  useEffect(() => {
    if (params.prefillTitle && !title) {
      setTitle(params.prefillTitle);
    }
    if (params.prefillExploreEventId) {
      setExploreEventId(params.prefillExploreEventId);
    }

    // Date — prefer event_date (always a local date string like "2025-03-22")
    if (params.prefillEventDate) {
      const d = new Date(`${params.prefillEventDate}T12:00:00`);
      if (!isNaN(d.getTime())) {
        setDateMonth(d.getMonth());
        setDateDay(d.getDate());
        setDateYear(d.getFullYear());
        setDateSelected(true);
      }
    }

    // Time — from start_time (ISO timestamp or "HH:MM:SS" time-only)
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

    // End time prefill — same parser as start_time
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

    // Drop-in prefill — duplicates pass "true"/"false" as a string
    if (params.prefillDropIn !== undefined) {
      setDropIn(params.prefillDropIn !== 'false');
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.prefillTitle, params.prefillExploreEventId, params.prefillStartTime,
      params.prefillEventDate, params.prefillEndTime, params.prefillDropIn,
      params.prefillDescription, params.prefillImageUrl,
      params.prefillLocation, params.prefillCategory]);

  const placesRef = useRef<GooglePlacesAutocompleteRef>(null);
  // Used to prevent onChangeText from clearing coordinates after a Place selection
  const placeJustSelectedRef = useRef(false);

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
  // Calendar view state — independent of the committed selection so the user
  // can browse months without changing what's actually picked yet. Initialised
  // from LA today so the first open lands on the right month regardless of
  // device timezone.
  const [viewMonth, setViewMonth] = useState(() => getTodayInLA().m);
  const [viewYear, setViewYear] = useState(() => getTodayInLA().y);

  // Time
  const [timeHour, setTimeHour] = useState(8);
  const [timeMinute, setTimeMinute] = useState<string>('00');
  const [timePeriod, setTimePeriod] = useState<'AM' | 'PM'>('PM');
  const [timeSelected, setTimeSelected] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [tempHour, setTempHour] = useState(8);
  const [tempMinute, setTempMinute] = useState<string>('00');
  const [tempPeriod, setTempPeriod] = useState<'AM' | 'PM'>('PM');

  // End time (optional — disappears from feed at this point if drop_in is off, or
  // caps the "happening now" window if drop_in is on)
  const [endHour, setEndHour] = useState(11);
  const [endMinute, setEndMinute] = useState<string>('00');
  const [endPeriod, setEndPeriod] = useState<'AM' | 'PM'>('PM');
  const [endTimeSelected, setEndTimeSelected] = useState(false);
  const [showEndTimePicker, setShowEndTimePicker] = useState(false);
  const [tempEndHour, setTempEndHour] = useState(11);
  const [tempEndMinute, setTempEndMinute] = useState<string>('00');
  const [tempEndPeriod, setTempEndPeriod] = useState<'AM' | 'PM'>('PM');

  // Drop-in flag — when false, plan vanishes from the feed for non-members
  // the moment start_time passes (used for one-shot moments like a movie)
  const [dropIn, setDropIn] = useState(true);

  // Submit
  const [loading, setLoading] = useState(false);
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [firstPlanCelebrationVisible, setFirstPlanCelebrationVisible] = useState(false);
  const [postedPlanId, setPostedPlanId] = useState<string | null>(null);
  const [postedPlanTitle, setPostedPlanTitle] = useState('');
  const [postedSpotsLeft, setPostedSpotsLeft] = useState<number | undefined>();
  const [postedGenderLabel, setPostedGenderLabel] = useState<string | undefined>();
  const [alertInfo, setAlertInfo] = useState<{ title: string; message: string; buttons?: BrandedAlertButton[] } | null>(null);

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

  // locationText is used for hint display only — location is validated at submit time via ref
  const locationText = locationRaw.trim() || location.trim() || '';
  const canSubmit = title.trim().length > 0 && dateSelected && timeSelected && category !== null && description.trim().length > 0 && creatorMessage.trim().length >= MSG_MIN && creatorMessage.trim().length <= MSG_LIMIT && !loading && !imageLoading;

  // ─── Date picker (calendar grid) ─────────────────────────────────────────────

  const openDatePicker = () => {
    // Browse from the currently-selected month if there is one; otherwise
    // start at this month in LA.
    if (dateSelected) {
      setViewMonth(dateMonth);
      setViewYear(dateYear);
    } else {
      const t = getTodayInLA();
      setViewMonth(t.m);
      setViewYear(t.y);
    }
    setShowDatePicker(true);
  };

  const selectDate = (day: number) => {
    setDateMonth(viewMonth);
    setDateDay(day);
    setDateYear(viewYear);
    setDateSelected(true);
    setShowDatePicker(false);
    hapticLight();
  };

  const stepMonth = (delta: -1 | 1) => {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    // Clamp: never let the user view a month entirely before today in LA.
    const t = getTodayInLA();
    if (y < t.y || (y === t.y && m < t.m)) return;
    setViewMonth(m);
    setViewYear(y);
    hapticSelection();
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
    if (!canSubmit) return;

    // Read location from ref at tap time — this is always current regardless of state sync issues
    const effectiveLocation = locationRaw.trim() || location.trim() || placesRef.current?.getAddressText()?.trim() || '';
    if (!effectiveLocation) {
      setAlertInfo({ title: 'Add a location', message: 'Please add a location for your plan.' });
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

      const { data: insertedEvent, error } = await supabase
        .from('events')
        .insert({
          title: title.trim(),
          start_time: startTime.toISOString(),
          end_time: endTime ? endTime.toISOString() : null,
          drop_in: dropIn,
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
            setAlertInfo({
              title: 'Something went wrong',
              message: 'Could not create your plan. Please try again.',
            });
            return;
          }
        }

        // If this plan was created as a duplicate of another, notify the
        // original plan's waitlist users. Fire-and-forget — a notification
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
      }

      hapticSuccess();
      setPostedPlanId(insertedEvent?.id ?? null);
      setPostedPlanTitle(title.trim());
      setPostedSpotsLeft(groupSize);
      setPostedGenderLabel(
        genderPref === 'women_only' ? 'Women only' :
        genderPref === 'men_only' ? 'Men only' :
        genderPref === 'nonbinary_only' ? 'Nonbinary only' : undefined
      );

      // Check if this is the user's first plan ever — show celebration once
      const hasSeen = await AsyncStorage.getItem('hasSeenFirstPlanCelebration');
      if (!hasSeen) {
        const { count } = await supabase
          .from('events')
          .select('id', { count: 'exact', head: true })
          .eq('creator_user_id', user.id);
        if (count === 1) {
          setFirstPlanCelebrationVisible(true);
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
      // plan as a duplicate of the prior one — fanning a forged
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
      } as any);
    } catch (e: unknown) {
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
              <Text style={styles.photoUploadHint}>Optional — your plan works without one</Text>
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
                  // User manually edited the text — coordinates no longer match, so clear them
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
            />
            <Text style={styles.stepperHint}>Min {MSG_MIN} characters · Max {MSG_LIMIT}</Text>
          </View>

          {/* ── Group size ── */}
          <View style={styles.field}>
            <Text style={styles.label}>Group size</Text>
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
            disabled={!canSubmit}
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
        onDismiss={() => setFirstPlanCelebrationVisible(false)}
      />

      <SharePlanModal
        visible={shareModalVisible}
        onClose={() => {
          const planIdToNavigate = postedPlanId;
          setShareModalVisible(false);
          setPostedPlanId(null);
          setPostedPlanTitle('');
          setTimeout(() => {
            if (planIdToNavigate) {
              router.push(`/plan/${planIdToNavigate}` as any);
            } else {
              router.replace('/(tabs)/plans');
            }
          }, 350);
        }}
        planTitle={postedPlanTitle}
        planId={postedPlanId || ''}
        slug={null}
        spotsLeft={postedSpotsLeft}
        genderLabel={postedGenderLabel}
        variant="posted"
      />

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

            {/* Month nav */}
            <View style={styles.calendarHeader}>
              {(() => {
                const t = getTodayInLA();
                const onCurrentMonth = viewYear === t.y && viewMonth <= t.m;
                return (
                  <>
                    <TouchableOpacity
                      onPress={() => stepMonth(-1)}
                      disabled={onCurrentMonth}
                      style={styles.calendarNavBtn}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityLabel="previous month"
                    >
                      <Ionicons
                        name="chevron-back"
                        size={22}
                        color={onCurrentMonth ? Colors.textLight : Colors.asphalt}
                      />
                    </TouchableOpacity>
                    <Text style={styles.calendarMonthLabel}>
                      {MONTHS[viewMonth]} {viewYear}
                    </Text>
                    <TouchableOpacity
                      onPress={() => stepMonth(1)}
                      style={styles.calendarNavBtn}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityLabel="next month"
                    >
                      <Ionicons name="chevron-forward" size={22} color={Colors.asphalt} />
                    </TouchableOpacity>
                  </>
                );
              })()}
            </View>

            {/* Weekday header */}
            <View style={styles.weekdayRow}>
              {WEEKDAY_LABELS.map((label, i) => (
                <Text key={i} style={styles.weekdayLabel}>{label}</Text>
              ))}
            </View>

            {/* Grid */}
            {buildMonthGrid(viewYear, viewMonth).map((row, ri) => (
              <View key={ri} style={styles.calendarRow}>
                {row.map((day, ci) => {
                  if (day === null) {
                    return <View key={ci} style={styles.calendarCell} />;
                  }
                  const isPast = isBeforeTodayLA(viewYear, viewMonth, day);
                  const t = getTodayInLA();
                  const isToday = viewYear === t.y && viewMonth === t.m && day === t.d;
                  const isSelected =
                    dateSelected && dateYear === viewYear && dateMonth === viewMonth && dateDay === day;
                  return (
                    <TouchableOpacity
                      key={ci}
                      style={[
                        styles.calendarCell,
                        isToday && !isSelected && styles.calendarCellToday,
                        isSelected && styles.calendarCellSelected,
                      ]}
                      onPress={() => selectDate(day)}
                      disabled={isPast}
                      activeOpacity={0.75}
                      accessibilityRole="button"
                      accessibilityLabel={`${MONTHS[viewMonth]} ${day}, ${viewYear}`}
                      accessibilityState={{ disabled: isPast, selected: isSelected }}
                    >
                      <Text
                        style={[
                          styles.calendarCellText,
                          isPast && styles.calendarCellTextDisabled,
                          isSelected && styles.calendarCellTextSelected,
                        ]}
                      >
                        {day}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
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

  calendarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  calendarMonthLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.displaySM,
    color: Colors.asphalt,
  },
  calendarNavBtn: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  weekdayRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  weekdayLabel: {
    flex: 1,
    textAlign: 'center',
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.textLight,
    letterSpacing: 0.5,
  },
  calendarRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  calendarCell: {
    flex: 1,
    aspectRatio: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 2,
    borderRadius: 12,
  },
  calendarCellToday: {
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
  },
  calendarCellSelected: {
    backgroundColor: Colors.terracotta,
  },
  calendarCellText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
  },
  calendarCellTextDisabled: {
    color: Colors.textLight,
    opacity: 0.4,
  },
  calendarCellTextSelected: {
    color: Colors.white,
    fontFamily: Fonts.sansMedium,
  },

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
