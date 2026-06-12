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
import { ImagePlus, X, ChevronDown, ChevronUp } from 'lucide-react-native';

import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { hapticLight, hapticMedium, hapticSelection, hapticSuccess } from '../../lib/haptics';
import { supabase } from '../../lib/supabase';
import { checkContent } from '../../lib/contentFilter';
import { uploadBase64ToStorage } from '../../lib/uploadPhoto';
import { PHOTO_FORMAT_ERROR_MESSAGE } from '../../constants/PhotoUpload';
import { MONTHS, getTodayInLA } from '../../lib/laDate';
import {
  NEIGHBORHOOD_OPTIONS,
  NEIGHBORHOOD_OTHER,
} from '../../constants/Neighborhoods';
import { type PlanCategory } from '../../constants/Categories';
import { COPY } from '../yours/state/constants';
import { useAuthUserId } from '../yours/state/useAuthUserId';
import { useInviteInterestSignals } from '../../hooks/useInviteInterestSignals';
import { useDismissSuggestion } from '../../hooks/useDismissSuggestion';
import { useInvitePeopleToPlan } from '../../hooks/useInvitePeopleToPlan';
import { BrandedAlert } from '../../components/BrandedAlert';
import { SharePlanModal } from '../../components/modals/SharePlanModal';
import { type CalendarDay } from '../../components/calendar/WashedUpCalendar';
import EditorialTitleField from '../composer/EditorialTitleField';
import CategoryChips from '../composer/CategoryChips';
import CollapsibleCalendar from '../composer/CollapsibleCalendar';
import TimePicker, { displayTime } from '../composer/TimePicker';
import InlineNudge from '../composer/InlineNudge';
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
  return new Date(year, month, day, h, parseInt(minute, 10));
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

  // ── How many + audience ──
  const [groupSize, setGroupSize] = useState(6); // max_invites; UI shows groupSize+1 total
  const [genderPref, setGenderPref] = useState<GenderPreference>('mixed');
  const [ageRanges, setAgeRanges] = useState<AgeRange[]>([]);

  // ── More options ──
  const [moreOpen, setMoreOpen] = useState(false);
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

  // ── Prefill: pre-attached person from "Make a plan with {Name}" ──
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.prefillTitle, params.prefillInvitePersonId, params.prefillInvitePersonName, params.prefillInvitePersonPhoto]);

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

  const whenSummary = dateSelected
    ? `${MONTHS[dateMonth]} ${dateDay}${timeSelected ? ` · ${displayTime(timeHour, timeMinute, timePeriod).toLowerCase()}` : ''}`
    : 'add a day';
  const placeSummary = location.trim() ? location.trim().toLowerCase() : 'add a place';
  const peopleSummary = invited.length > 0 ? invited.map((c) => c.name.toLowerCase()).join(', ') : `open to ${groupSize}`;
  const summaryMeta = [whenSummary, placeSummary, peopleSummary].join(' · ');

  const canPost = title.trim().length > 0 && dateSelected && timeSelected && category !== null && !loading && !imageLoading;

  const resetForm = () => {
    setTitle(''); setCategory(null); setImageUrl(null); setCreatorMessage('');
    setLocation(''); setLocationLat(null); setLocationLng(null); setNeighborhood('');
    setTicketUrl(''); setDescription(''); setGenderPref('mixed'); setAgeRanges([]);
    setGroupSize(6); setDateSelected(false); setTimeSelected(false); setDropIn(true);
    setAllowDuplicate(true); setMoreOpen(false); setInvited([]);
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
    if (creatorMessage.trim().length > 0 && creatorMessage.trim().length < MSG_MIN) {
      missing.push(`Your message (at least ${MSG_MIN} characters, or leave it blank)`);
    }
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

    // Snapshot everything the insert needs - the form resets immediately.
    const ageBounds = ageRangesToMinMax(ageRanges);
    const row = {
      title: title.trim(),
      start_time: startTime.toISOString(),
      end_time: null as string | null,
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

    // Background insert.
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
            await supabase.from('events').delete().eq('id', insertedEvent.id);
            throw new Error('member');
          }
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
      setPostedPlanId(insertedEvent?.id ?? null);
      if (isFirst) {
        await AsyncStorage.setItem('hasSeenFirstPlanCelebration', '1');
        neverPostedRef.current = false;
      }
      resetForm();
    } catch {
      // Quiet gold recovery: pull the moment, reopen the composer with the data
      // intact and a gold nudge. No red, never a hard error dialog.
      setConfirmVisible(false);
      setShareWanted(false);
      setRecoveryNudge(true);
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

        {/* YOUR MESSAGE (optional) */}
        <View style={styles.section}>
          <Text style={styles.label}>your message<Text style={styles.labelOptional}> · optional</Text></Text>
          <TextInput
            style={styles.messageInput}
            value={creatorMessage}
            onChangeText={setCreatorMessage}
            placeholder="going up the back trail, golden hour pace, no rush..."
            placeholderTextColor={Colors.inkSoft}
            multiline
            maxLength={MSG_LIMIT}
          />
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
          {activeQuick === 'tonight' ? <InlineNudge text={COPY.composerTonightNudge} /> : null}
        </View>

        {/* WHERE */}
        <View style={styles.section}>
          <Text style={styles.label}>where</Text>
          <PlacePicker value={place} onChange={onPlaceChange} />
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

        {/* MORE OPTIONS */}
        <View style={styles.section}>
          <TouchableOpacity style={styles.moreToggle} onPress={() => { hapticLight(); setMoreOpen((v) => !v); }} activeOpacity={0.7}>
            <Text style={styles.moreToggleText}>more options</Text>
            {moreOpen ? <ChevronUp size={16} color={Colors.secondary} /> : <ChevronDown size={16} color={Colors.secondary} />}
          </TouchableOpacity>
          {moreOpen && (
            <View style={styles.moreBody}>
              {/* Ticket link */}
              <Text style={styles.subLabel}>ticket link<Text style={styles.labelOptional}> · optional</Text></Text>
              <TextInput
                style={styles.textField}
                value={ticketUrl}
                onChangeText={setTicketUrl}
                placeholder="https://"
                placeholderTextColor={Colors.inkSoft}
                autoCapitalize="none"
                keyboardType="url"
              />
              {/* Neighborhood */}
              <Text style={styles.subLabel}>neighborhood</Text>
              <TouchableOpacity style={styles.selectField} onPress={() => setShowNeighborhoodPicker(true)} activeOpacity={0.7}>
                <Text style={[styles.selectFieldText, !neighborhood && styles.selectFieldPlaceholder]}>
                  {neighborhood || 'pick a neighborhood'}
                </Text>
                <ChevronDown size={16} color={Colors.tertiary} />
              </TouchableOpacity>
              {/* Description */}
              <Text style={styles.subLabel}>description</Text>
              <TextInput
                style={[styles.textField, styles.textArea]}
                value={description}
                onChangeText={setDescription}
                placeholder="anything else worth knowing"
                placeholderTextColor={Colors.inkSoft}
                multiline
                maxLength={DESC_LIMIT}
              />
              {/* Drop-in toggle */}
              <TouchableOpacity style={styles.toggleRow} onPress={() => { hapticLight(); setDropIn((v) => !v); }} activeOpacity={0.7}>
                <View style={styles.toggleTextWrap}>
                  <Text style={styles.toggleTitle}>drop-in welcome</Text>
                  <Text style={styles.toggleSub}>people can still join after it starts</Text>
                </View>
                <View style={[styles.switchTrack, dropIn && styles.switchTrackOn]}>
                  <View style={[styles.switchThumb, dropIn && styles.switchThumbOn]} />
                </View>
              </TouchableOpacity>
              {/* Allow duplicate toggle */}
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
          )}
        </View>
      </ScrollView>

      {/* Sticky live post bar */}
      <View style={[styles.postBar, { paddingBottom: sheetBottomPad }]}>
        {recoveryNudge ? (
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

  // More options
  moreToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  moreToggleText: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyMD, color: Colors.secondary },
  moreBody: { marginTop: 14, gap: 4 },
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
