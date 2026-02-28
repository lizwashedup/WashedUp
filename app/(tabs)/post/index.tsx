import { useState, useRef, useEffect, useMemo } from 'react';
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
  Alert,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { ImagePlus, X } from 'lucide-react-native';
import ProfileButton from '../../../components/ProfileButton';
import { ShareLinkModal } from '../../../components/modals/ShareLinkModal';
import { GooglePlacesAutocomplete, GooglePlacesAutocompleteRef } from 'react-native-google-places-autocomplete';
import { supabase } from '../../../lib/supabase';
import Colors from '../../../constants/Colors';

const GOOGLE_MAPS_API_KEY = 'AIzaSyApjwAgT5x1pw5NgqSvrACmZaKapYuXgCw';

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
const MSG_LIMIT = 150;
const DESC_LIMIT = 500;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDaysInMonth(month: number, year: number): number {
  return new Date(year, month + 1, 0).getDate();
}

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

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function PostScreen() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const years = [currentYear, currentYear + 1];

  const [userGender, setUserGender] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('gender')
        .eq('id', user.id)
        .single();
      if (profile?.gender) setUserGender(profile.gender);
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
  const [locationLat, setLocationLat] = useState<number | null>(null);
  const [locationLng, setLocationLng] = useState<number | null>(null);
  const [ticketUrl, setTicketUrl] = useState('');
  const [category, setCategory] = useState<Category | null>(null);
  const [genderPref, setGenderPref] = useState<GenderPreference>('mixed');
  const [ageRanges, setAgeRanges] = useState<AgeRange[]>([]);
  const [description, setDescription] = useState('');
  const [hostMessage, setHostMessage] = useState('');
  const [groupSize, setGroupSize] = useState(6);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);

  const params = useLocalSearchParams<{ prefillTitle?: string; prefillExploreEventId?: string }>();
  const [exploreEventId, setExploreEventId] = useState<string | null>(null);

  useEffect(() => {
    if (params.prefillTitle && !title) {
      setTitle(params.prefillTitle);
    }
    if (params.prefillExploreEventId) {
      setExploreEventId(params.prefillExploreEventId);
    }
  }, [params.prefillTitle, params.prefillExploreEventId]);

  const placesRef = useRef<GooglePlacesAutocompleteRef>(null);

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Go to Settings and allow photo access.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [16, 10],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setImageUrl(result.assets[0].uri);
      uploadPhoto(result.assets[0].uri);
    }
  };

  const uploadPhoto = async (uri: string) => {
    setImageLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const response = await fetch(uri);
      const blob = await response.blob();
      const fileName = `${user.id}/${Date.now()}.jpg`;

      const { error } = await supabase.storage
        .from('event-images')
        .upload(fileName, blob, { contentType: 'image/jpeg', upsert: false });

      if (error) throw error;

      const { data: urlData } = supabase.storage
        .from('event-images')
        .getPublicUrl(fileName);

      setImageUrl(`${urlData.publicUrl}?t=${Date.now()}`);
    } catch {
      setImageUrl(null);
      Alert.alert('Upload failed', 'Could not upload photo. Try again.');
    } finally {
      setImageLoading(false);
    }
  };

  const toggleAgeRange = (range: AgeRange) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
  const [tempMonth, setTempMonth] = useState(now.getMonth());
  const [tempDay, setTempDay] = useState(now.getDate());
  const [tempYear, setTempYear] = useState(currentYear);

  // Time
  const [timeHour, setTimeHour] = useState(8);
  const [timeMinute, setTimeMinute] = useState<string>('00');
  const [timePeriod, setTimePeriod] = useState<'AM' | 'PM'>('PM');
  const [timeSelected, setTimeSelected] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [tempHour, setTempHour] = useState(8);
  const [tempMinute, setTempMinute] = useState<string>('00');
  const [tempPeriod, setTempPeriod] = useState<'AM' | 'PM'>('PM');

  // Submit
  const [loading, setLoading] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [createdPlanId, setCreatedPlanId] = useState<string | null>(null);

  const daysInTempMonth = getDaysInMonth(tempMonth, tempYear);
  const safeTempDay = Math.min(tempDay, daysInTempMonth);

  const canSubmit = title.trim().length > 0 && dateSelected && timeSelected && category !== null && description.trim().length > 0 && hostMessage.trim().length > 0 && !loading && !imageLoading;

  // ─── Date picker ─────────────────────────────────────────────────────────────

  const openDatePicker = () => {
    setTempMonth(dateMonth);
    setTempDay(dateDay);
    setTempYear(dateYear);
    setShowDatePicker(true);
  };

  const confirmDate = () => {
    setDateMonth(tempMonth);
    setDateDay(safeTempDay);
    setDateYear(tempYear);
    setDateSelected(true);
    setShowDatePicker(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  // ─── Submit ───────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!canSubmit) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert('Error', 'Please sign in again.');
        return;
      }

      const startTime = buildDatetime(dateMonth, dateDay, dateYear, timeHour, timeMinute, timePeriod);
      if (startTime <= new Date()) {
        Alert.alert('Invalid time', 'Please choose a future date and time.');
        setLoading(false);
        return;
      }

      const ageBounds = ageRangesToMinMax(ageRanges);

      const { data: insertedEvent, error } = await supabase
        .from('events')
        .insert({
          title: title.trim(),
          start_time: startTime.toISOString(),
          location_text: location.trim() || null,
          location_lat: locationLat,
          location_lng: locationLng,
          tickets_url: ticketUrl.trim() || null,
          primary_vibe: category?.toLowerCase() ?? null,
          gender_rule: genderPref,
          target_age_min: ageBounds.min,
          target_age_max: ageBounds.max,
          description: description.trim() || null,
          host_message: hostMessage.trim() || null,
          max_invites: groupSize,
          min_invites: MIN_GROUP,
          creator_user_id: user.id,
          status: 'forming',
          city: 'Los Angeles',
          explore_event_id: exploreEventId,
          image_url: (imageUrl && imageUrl.startsWith('http')) ? imageUrl : null,
        })
        .select('id')
        .single();

      if (error) throw error;

      if (insertedEvent?.id) {
        await supabase.from('event_members').insert({
          event_id: insertedEvent.id,
          user_id: user.id,
          role: 'host',
          status: 'joined',
        });
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCreatedPlanId(insertedEvent?.id ?? null);
      setShowShareModal(true);
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e
        ? String((e as { message: string }).message)
        : 'Could not post your plan. Please try again.';
      Alert.alert('Something went wrong', msg);
    } finally {
      setLoading(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar style="dark" />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.headerTitle}>Post a Plan</Text>
              <Text style={styles.headerSub}>Create something for people to join</Text>
            </View>
            <ProfileButton />
          </View>

          {/* ── Photo (first field) ── */}
          {!imageUrl ? (
            <TouchableOpacity
              style={styles.photoUpload}
              onPress={pickImage}
              activeOpacity={0.8}
            >
              <ImagePlus size={32} color="#C4652A" strokeWidth={2} />
              <Text style={styles.photoUploadText}>Add a photo</Text>
              <Text style={styles.photoUploadHint}>Optional — your plan works without one</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.photoPreview}>
              <Image source={{ uri: imageUrl }} style={styles.photoPreviewImage} contentFit="cover" />
              {imageLoading ? (
                <View style={styles.photoLoadingOverlay}>
                  <ActivityIndicator size="large" color="#C4652A" />
                </View>
              ) : (
                <>
                  <TouchableOpacity
                    style={styles.photoRemoveBtn}
                    onPress={() => setImageUrl(null)}
                  >
                    <X size={14} color="#666666" strokeWidth={2.5} />
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

          {/* ── Date & Time row ── */}
          <View style={styles.row}>
            <View style={[styles.field, styles.flex]}>
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
            <View style={styles.rowSpacer} />
            <View style={[styles.field, styles.flex]}>
              <Text style={styles.label}>Time <Text style={styles.required}>*</Text></Text>
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
          </View>

          {/* ── Location (Google Places) ── */}
          <View style={[styles.field, styles.placesField]}>
            <Text style={styles.label}>Location</Text>
            <GooglePlacesAutocomplete
              ref={placesRef}
              placeholder="Venue or neighborhood"
              fetchDetails
              disableScroll={true}
              onPress={(data, details) => {
                const lat = details?.geometry?.location?.lat ?? null;
                const lng = details?.geometry?.location?.lng ?? null;
                const name = data.structured_formatting?.main_text ?? data.description;
                setLocation(name || data.description);
                setLocationLat(lat);
                setLocationLng(lng);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
              }}
              enablePoweredByContainer={false}
              debounce={300}
              keepResultsAfterBlur={false}
              nearbyPlacesAPI="GooglePlacesSearch"
            />
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
                <Text style={{ fontSize: 14, color: '#999' }}>▼</Text>
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
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
              <ActivityIndicator size="small" color="#C4652A" />
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

          {/* ── Host message (personal note) ── */}
          <View style={styles.field}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>Your message <Text style={styles.required}>*</Text></Text>
              <Text style={styles.charCount}>{hostMessage.length}/{MSG_LIMIT}</Text>
            </View>
            <TextInput
              style={[styles.input, { minHeight: 60 }]}
              placeholder="Always wanted to check this out, who's in?"
              placeholderTextColor={Colors.textLight}
              value={hostMessage}
              onChangeText={(t) => setHostMessage(t.slice(0, MSG_LIMIT))}
              multiline
              numberOfLines={2}
              textAlignVertical="top"
            />
            <Text style={styles.stepperHint}>This shows on your plan card as a personal note</Text>
          </View>

          {/* ── Group size ── */}
          <View style={styles.field}>
            <Text style={styles.label}>Group size</Text>
            <View style={styles.stepperRow}>
              <TouchableOpacity
                style={[styles.stepperBtn, groupSize <= MIN_GROUP && styles.stepperBtnDisabled]}
                onPress={() => {
                  if (groupSize > MIN_GROUP) {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setGroupSize(g => g - 1);
                  }
                }}
                disabled={groupSize <= MIN_GROUP}
              >
                <Text style={styles.stepperBtnText}>−</Text>
              </TouchableOpacity>
              <View style={styles.stepperValue}>
                <Text style={styles.stepperValueText}>{groupSize}</Text>
                <Text style={styles.stepperValueSub}>people</Text>
              </View>
              <TouchableOpacity
                style={[styles.stepperBtn, groupSize >= MAX_GROUP && styles.stepperBtnDisabled]}
                onPress={() => {
                  if (groupSize < MAX_GROUP) {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setGroupSize(g => g + 1);
                  }
                }}
                disabled={groupSize >= MAX_GROUP}
              >
                <Text style={styles.stepperBtnText}>+</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.stepperHint}>Min {MIN_GROUP} · Max {MAX_GROUP}</Text>
          </View>

          {/* Bottom spacer so content isn't hidden behind sticky button */}
          <View style={{ height: 100 }} />
        </ScrollView>

        {/* ── Sticky submit button ── */}
        <View style={styles.stickyFooter}>
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
                      : description.trim().length === 0
                        ? 'Add a plan description'
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
              ? <ActivityIndicator color="#FFFFFF" size="small" />
              : <Text style={styles.submitBtnText}>Post It  →</Text>
            }
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <ShareLinkModal
        visible={showShareModal}
        onClose={() => {
          setShowShareModal(false);
          setImageUrl(null);
          setTitle(''); setLocation(''); setLocationLat(null); setLocationLng(null);
          setTicketUrl(''); setCategory(null);
          setGenderPref('mixed'); setAgeRanges([]);
          setDescription(''); setHostMessage(''); setGroupSize(6);
          setDateSelected(false); setTimeSelected(false);
          placesRef.current?.clear();
          setCreatedPlanId(null);
          router.replace('/(tabs)/plans');
        }}
        shareUrl={createdPlanId ? `https://washedup.app/plan/${createdPlanId}` : 'https://washedup.app'}
        shareTitle="Share your plan"
        shareMessage={title.trim() ? `Join me for "${title}" on WashedUp!\nhttps://washedup.app/plan/${createdPlanId}` : undefined}
      />

      {/* ── Date Picker Modal ── */}
      <Modal visible={showDatePicker} transparent animationType="slide">
        <Pressable style={styles.modalOverlay} onPress={() => setShowDatePicker(false)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Select date</Text>
            <View style={styles.pickerRow}>
              {/* Month */}
              <ScrollView style={styles.pickerCol} showsVerticalScrollIndicator={false}>
                {MONTHS.map((m, i) => (
                  <Pressable
                    key={m}
                    style={[styles.pickerItem, tempMonth === i && styles.pickerItemSelected]}
                    onPress={() => setTempMonth(i)}
                  >
                    <Text style={[styles.pickerItemText, tempMonth === i && styles.pickerItemTextSel]}>
                      {m.slice(0, 3)}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              {/* Day */}
              <ScrollView style={styles.pickerColSm} showsVerticalScrollIndicator={false}>
                {Array.from({ length: daysInTempMonth }, (_, i) => i + 1).map((d) => (
                  <Pressable
                    key={d}
                    style={[styles.pickerItem, safeTempDay === d && styles.pickerItemSelected]}
                    onPress={() => setTempDay(d)}
                  >
                    <Text style={[styles.pickerItemText, safeTempDay === d && styles.pickerItemTextSel]}>
                      {d}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              {/* Year */}
              <ScrollView style={styles.pickerColSm} showsVerticalScrollIndicator={false}>
                {years.map((y) => (
                  <Pressable
                    key={y}
                    style={[styles.pickerItem, tempYear === y && styles.pickerItemSelected]}
                    onPress={() => setTempYear(y)}
                  >
                    <Text style={[styles.pickerItemText, tempYear === y && styles.pickerItemTextSel]}>
                      {y}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
            <TouchableOpacity style={styles.modalBtn} onPress={confirmDate}>
              <Text style={styles.modalBtnText}>Done</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Time Picker Modal ── */}
      <Modal visible={showTimePicker} transparent animationType="slide">
        <Pressable style={styles.modalOverlay} onPress={() => setShowTimePicker(false)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Select time</Text>
            <View style={styles.pickerRow}>
              {/* Hour */}
              <ScrollView style={styles.pickerCol} showsVerticalScrollIndicator={false}>
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
              <ScrollView style={styles.pickerCol} showsVerticalScrollIndicator={false}>
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
              <ScrollView style={styles.pickerCol} showsVerticalScrollIndicator={false}>
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

      {/* ── Category Picker Modal ── */}
      <Modal visible={showCategoryPicker} transparent animationType="slide">
        <Pressable style={styles.modalOverlay} onPress={() => setShowCategoryPicker(false)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Select category</Text>
            <ScrollView style={{ maxHeight: 300 }} showsVerticalScrollIndicator={false}>
              {CATEGORIES.map((cat) => (
                <TouchableOpacity
                  key={cat}
                  style={[
                    styles.categoryItem,
                    category === cat && styles.categoryItemSelected,
                  ]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
    </SafeAreaView>
  );
}

// ─── Google Places Styles (matches existing input design) ────────────────────

const placesStyles = {
  container: { flex: 0 },
  textInputContainer: { backgroundColor: 'transparent' },
  textInput: {
    backgroundColor: Colors.cardBackground,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    color: Colors.textDark,
    height: 52,
    marginBottom: 0,
  },
  listView: {
    backgroundColor: Colors.cardBackground,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    marginTop: 4,
    overflow: 'hidden' as const,
  },
  row: { paddingHorizontal: 16, paddingVertical: 13, backgroundColor: Colors.cardBackground },
  separator: { height: 1, backgroundColor: Colors.border, marginHorizontal: 16 },
  description: { color: Colors.textDark, fontSize: 15 },
  predefinedPlacesDescription: { color: Colors.primaryOrange },
  poweredContainer: { display: 'none' as const },
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.backgroundCream },
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
    fontFamily: 'DMSerifDisplay_400Regular',
    fontSize: 28,
    color: '#C4652A',
    textShadowColor: 'rgba(0,0,0,0.2)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  profileButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F0E6D3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSub: { fontSize: 14, color: Colors.textLight, marginTop: 4 },

  photoUpload: {
    width: '100%',
    aspectRatio: 16 / 10,
    borderRadius: 14,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#D4C5B4',
    backgroundColor: '#F5EDE4',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  photoUploadText: { fontSize: 14, color: '#9B8B7A', marginTop: 8 },
  photoUploadHint: { fontSize: 12, color: '#BBAA99', marginTop: 4 },
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
    backgroundColor: 'rgba(255,255,255,0.6)',
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
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  photoChangeBtn: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  photoChangeBtnText: { fontSize: 12, fontWeight: '600', color: '#1A1A1A' },

  field: { marginBottom: 20 },
  placesField: { zIndex: 10 },
  label: { fontSize: 14, fontWeight: '600', color: Colors.textMedium, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  labelOptional: { fontSize: 13, color: Colors.textLight, fontStyle: 'italic' },
  charCount: { fontSize: 13, color: Colors.textLight },

  input: {
    backgroundColor: Colors.cardBackground,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: Colors.textDark,
  },
  textArea: { minHeight: 100, paddingTop: 14 },

  row: { flexDirection: 'row', marginBottom: 20 },
  rowSpacer: { width: 12 },

  pickerButton: { justifyContent: 'center' },
  pickerPlaceholder: { borderColor: Colors.border },
  pickerText: { fontSize: 16, color: Colors.textDark },
  placeholderText: { color: Colors.textLight },

  pillRow: { gap: 8, paddingRight: 8 },
  pill: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: Colors.cardBackground,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 20,
  },
  pillSelected: { backgroundColor: Colors.primaryOrange, borderColor: Colors.primaryOrange },
  pillText: { fontSize: 15, color: Colors.textDark, fontWeight: '500' },
  pillTextSelected: { color: '#FFFFFF', fontWeight: '600' },

  genderRow: { flexDirection: 'row', gap: 10 },
  genderPill: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: Colors.cardBackground,
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
    backgroundColor: Colors.cardBackground,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnDisabled: { opacity: 0.35 },
  stepperBtnText: { fontSize: 22, color: Colors.textDark, fontWeight: '300' },
  stepperValue: { flex: 1, alignItems: 'center' },
  stepperValueText: { fontSize: 32, fontWeight: '700', color: Colors.primaryOrange },
  stepperValueSub: { fontSize: 12, color: Colors.textLight, marginTop: -2 },
  stepperHint: { fontSize: 12, color: Colors.textLight, marginTop: 6 },

  stickyFooter: {
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 8 : 16,
    paddingTop: 12,
    backgroundColor: Colors.backgroundCream,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  requiredHint: { fontSize: 13, color: Colors.textLight, textAlign: 'center', marginBottom: 8 },
  submitBtn: {
    backgroundColor: Colors.primaryOrange,
    borderRadius: 14,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primaryOrange,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  submitBtnDisabled: { opacity: 0.45, shadowOpacity: 0 },
  submitBtnText: { fontSize: 17, fontWeight: '700', color: '#FFFFFF', letterSpacing: 0.3 },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: Colors.backgroundCream,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.textDark, marginBottom: 16 },
  pickerRow: { flexDirection: 'row', gap: 8, maxHeight: 200, marginBottom: 20 },
  pickerCol: { flex: 2 },
  pickerColSm: { flex: 1 },
  pickerItem: { paddingVertical: 11, paddingHorizontal: 6, alignItems: 'center', borderRadius: 8 },
  pickerItemSelected: { backgroundColor: Colors.primaryOrange },
  pickerItemText: { fontSize: 16, color: Colors.textDark },
  pickerItemTextSel: { color: '#FFFFFF', fontWeight: '600' },
  modalBtn: {
    height: 52,
    borderRadius: 14,
    backgroundColor: Colors.primaryOrange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },

  required: { color: '#DC2626', fontSize: 14, fontWeight: '400' },

  categoryItem: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginBottom: 4,
  },
  categoryItemSelected: { backgroundColor: Colors.primaryOrange },
  categoryItemText: { fontSize: 16, fontWeight: '400', color: Colors.textDark },
  categoryItemTextSelected: { color: '#FFFFFF', fontWeight: '600' },
});
