import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Keyboard, Platform, Pressable, ScrollView, StyleSheet,
  Switch, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../../../components/keyboard/KeyboardDoneBar';
import { useObservedUser, type ObservedUser } from '../../../hooks/useObservedUser';
import { requestWithDeadline } from '../../../lib/requestWithDeadline';
import { PageAction } from '../../../components/creator/pages/PageFrame';
import { supabase } from '../../../lib/supabase';
import { enqueueAlbumUploadBatch, AlbumUploadInput } from '../../../lib/uploadAlbumMedia';

const PHOTO_CAP = 20;
const VIDEO_CAP = 6;
const MAX_VIDEO_SEC = 60;
// Hard cap on video file size. The album-media bucket's server-side
// file_size_limit is 100 MB (raised from the project-global 50 MB on
// 2026-06-11); the client cap sits deliberately BELOW it at 75 MB. The whole
// file is read into the JS heap on the current in-memory upload path, so a
// clip approaching the bucket ceiling can OOM low-end Android. 75 MB keeps
// that headroom. An oversize clip is still rejected at pick time with the
// graceful "over N MB" message instead of failing at upload. Streaming upload
// via expo-file-system (v1.1) is what lets this rise back toward the bucket
// limit (and beyond) safely.
const MAX_VIDEO_BYTES = 75 * 1024 * 1024;
const VIDEO_LIMIT_LABEL =
  MAX_VIDEO_SEC % 60 === 0
    ? `${MAX_VIDEO_SEC / 60} min max`
    : `${MAX_VIDEO_SEC} sec max`;

type Attendee = {
  user_id: string;
  first_name_display: string | null;
  profile_photo_url: string | null;
};

type SelectedAsset = {
  uri: string;
  fileName: string;
  contentType: 'photo' | 'video';
  mediaFormat: string;        // 'heic', 'mov', 'jpg', etc.
  fileSizeBytes?: number;
  videoDurationSec?: number;
  width?: number;             // source pixel dims, for the mosaic aspect ratio
  height?: number;
  takenAt?: string;           // EXIF DateTimeOriginal as a UTC ISO string; sort-only
};

// EXIF DateTimeOriginal is "YYYY:MM:DD HH:MM:SS" in the photo's local time with
// no zone. taken_at is used only for chronological SORT within an album (all
// photos share the event's timezone), never for display, so normalize to a
// deterministic UTC ISO string and don't worry about the offset.
function parseExifTakenAt(exif: Record<string, any> | null | undefined): string | undefined {
  const raw = exif?.DateTimeOriginal ?? exif?.['{Exif}']?.DateTimeOriginal ?? exif?.DateTime;
  if (typeof raw !== 'string') return undefined;
  const m = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
}

type RejectionCounts = {
  tooLong: number;
  tooBig: number;
  unreadable: number;
  capDropped: number;
  transcodeFailed: number;
};

function rejectionMessage(r: RejectionCounts): string {
  if (r.transcodeFailed > 0 && r.tooLong + r.tooBig + r.unreadable + r.capDropped === 0) {
    // iOS interrupts the AVFoundation re-encode when the app gets backgrounded
    // mid-pick or the system is busy. Recovery is to retry.
    return "Couldn't process that video. Please try picking it again.";
  }
  const parts: string[] = [];
  if (r.tooLong > 0) {
    parts.push(`${r.tooLong} ${r.tooLong === 1 ? 'video was' : 'videos were'} longer than ${MAX_VIDEO_SEC} seconds`);
  }
  if (r.tooBig > 0) {
    parts.push(`${r.tooBig} ${r.tooBig === 1 ? 'video was' : 'videos were'} over ${Math.round(MAX_VIDEO_BYTES / (1024 * 1024))} MB`);
  }
  if (r.unreadable > 0) {
    parts.push(`${r.unreadable} ${r.unreadable === 1 ? "video's length couldn't be read" : "videos' lengths couldn't be read"}`);
  }
  if (r.capDropped > 0) {
    parts.push(`${r.capDropped} extra over the ${PHOTO_CAP}-photo, ${VIDEO_CAP}-video limit`);
  }
  if (r.transcodeFailed > 0) {
    parts.push(`${r.transcodeFailed} ${r.transcodeFailed === 1 ? 'video' : 'videos'} couldn't be processed`);
  }
  return `Skipped ${parts.join(', ')}. Try a shorter or smaller clip.`;
}

function formatExtFromName(filename: string | null | undefined): string {
  if (!filename) return '';
  const m = /\.([a-z0-9]+)$/i.exec(filename);
  return m ? m[1].toLowerCase() : '';
}

async function fetchEventAttendees(eventId: string, myUserId: string, isCurrent: () => boolean): Promise<Attendee[]> {
  const { data: members, error: mErr } = await supabase
    .from('event_members')
    .select('user_id')
    .eq('event_id', eventId)
    .eq('status', 'joined');
  if (!isCurrent()) throw new Error('Upload visit changed.');
  if (mErr) throw mErr;

  const userIds = (members ?? []).map((m) => m.user_id).filter((uid) => uid !== myUserId);
  if (userIds.length === 0) return [];

  const { data: profs, error: pErr } = await supabase
    .from('profiles')
    .select('id, first_name_display, profile_photo_url')
    .in('id', userIds);
  if (!isCurrent()) throw new Error('Upload visit changed.');
  if (pErr) throw pErr;

  const profilesById = new Map(
    (profs ?? []).map((p) => [p.id, {
      first_name_display: p.first_name_display ?? null,
      profile_photo_url: p.profile_photo_url ?? null,
    }]),
  );

  return userIds.map((uid) => ({
    user_id: uid,
    first_name_display: profilesById.get(uid)?.first_name_display ?? null,
    profile_photo_url: profilesById.get(uid)?.profile_photo_url ?? null,
  }));
}

export default function AlbumUploadScreen() {
  const params = useLocalSearchParams<{ eventId: string }>();
  const eventId = typeof params.eventId === 'string' ? params.eventId : '';
  const router = useRouter();
  const identity = useObservedUser({ allowSignedOut: true });
  const retryLock = useRef(false);
  const retryIdentity = () => {
    if (!identity.isCurrent() || retryLock.current) return;
    retryLock.current = true;
    void identity.retry().finally(() => { retryLock.current = false; });
  };
  if (identity.isLoading) return <SafeAreaView style={styles.loadingWrap}><ActivityIndicator accessibilityLabel="Checking your account" color={Colors.terracotta} /></SafeAreaView>;
  if (!eventId || identity.error || !identity.viewerId) return <SafeAreaView style={styles.loadingWrap}>
    <Text style={styles.sectionSubtitle}>{identity.error ? 'We couldn’t check your account.' : !identity.viewerId ? 'Sign in to add photos.' : 'This plan is unavailable.'}</Text>
    {!!identity.error && <PageAction primary compact singleLine title="Try again" onPress={retryIdentity} />}
    <PageAction compact singleLine title="Go back" onPress={() => { if (identity.isCurrent()) router.back(); }} />
  </SafeAreaView>;
  return <AlbumUploadVisit key={`${identity.viewerId}:${identity.epoch}:${eventId}`} eventId={eventId} identity={identity} />;
}

function AlbumUploadVisit({ eventId, identity }: { eventId: string; identity: ObservedUser }) {
  const router = useRouter();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const isCurrent = useCallback(() => mounted.current && identity.isCurrent(), [identity.isCurrent]);
  const myUserId = identity.viewerId!;
  const pickerLock = useRef(false);
  const submitLock = useRef(false);
  const retryLock = useRef(false);
  const [picking, setPicking] = useState(false);
  const insets = useSafeAreaInsets();
  const scrollRef = React.useRef<ScrollView>(null);

  const [assets, setAssets] = useState<SelectedAsset[]>([]);
  const [excludedUserIds, setExcludedUserIds] = useState<Set<string>>(new Set());
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [tagMe, setTagMe] = useState(true);
  const [instagram, setInstagram] = useState('');
  const [tiktok, setTiktok] = useState('');
  const [testimonial, setTestimonial] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [rejection, setRejection] = useState<RejectionCounts | null>(null);

  const titleQuery = useQuery({
    queryKey: ['albumUpload.event', eventId, myUserId, identity.epoch],
    queryFn: async ({ signal }) => {
      if (!isCurrent() || signal.aborted) throw new Error('Upload visit changed.');
      const { data, error } = await requestWithDeadline(
        supabase.from('events').select('title').eq('id', eventId).maybeSingle(), 12_000,
      );
      if (!isCurrent() || signal.aborted) throw new Error('Upload visit changed.');
      if (error) throw error;
      return data;
    },
    retry: false,
  });
  const audienceQuery = useQuery({
    queryKey: ['albumUpload.attendees', eventId, myUserId, identity.epoch],
    queryFn: async ({ signal }) => {
      let active = true;
      const current = () => active && isCurrent() && !signal.aborted;
      try {
        if (!current()) throw new Error('Upload visit changed.');
        const result = await requestWithDeadline(fetchEventAttendees(eventId, myUserId, current), 12_000);
        if (!current()) throw new Error('Upload visit changed.');
        return result;
      } finally { active = false; }
    },
    retry: false,
  });
  const attendees = audienceQuery.data;
  const eventTitle = titleQuery.data?.title ?? '';
  const readsBusy = titleQuery.isFetching || audienceQuery.isFetching;
  const readsReady = !!titleQuery.data && attendees !== undefined && !titleQuery.isError && !audienceQuery.isError && !readsBusy;
  const readyRef = useRef(false);
  readyRef.current = readsReady;
  const assetsRef = useRef(assets);
  assetsRef.current = assets;
  const unavailable = titleQuery.isSuccess && !titleQuery.data;
  const readFailure = titleQuery.isError || audienceQuery.isError || unavailable;
  const retryReads = () => {
    if (!isCurrent() || retryLock.current || readsBusy) return;
    retryLock.current = true;
    const attempts = [];
    if (titleQuery.isError || !titleQuery.data) attempts.push(titleQuery.refetch({ cancelRefetch: false }));
    if (audienceQuery.isError || attendees === undefined) attempts.push(audienceQuery.refetch({ cancelRefetch: false }));
    void Promise.allSettled(attempts).finally(() => { retryLock.current = false; });
  };

  const photoCount = useMemo(() => assets.filter((a) => a.contentType === 'photo').length, [assets]);
  const videoCount = useMemo(() => assets.filter((a) => a.contentType === 'video').length, [assets]);

  const pickAssets = useCallback(async () => {
    if (!isCurrent() || pickerLock.current || submitLock.current) return;
    pickerLock.current = true;
    setPicking(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!isCurrent()) return;
      if (!perm.granted) {
        Alert.alert('Photos access needed', 'WashedUp needs access to your photos to add them to the album.');
        return;
      }
      setRejection(null);
      const rej: RejectionCounts = { tooLong: 0, tooBig: 0, unreadable: 0, capDropped: 0, transcodeFailed: 0 };

      // videoExportPreset is iOS-only (silently ignored on Android). Wrapping it
      // in a Platform check makes the divergence intentional: iOS forces H.264
      // MP4 re-export at pick time so iPhone MOV files play in cross-platform
      // clients; Android takes the device's native export (typically H.264 MP4
      // already on modern cameras). Server-side ffmpeg transcode for non-MP4
      // edge cases is deferred to v1.1.
      let result: ImagePicker.ImagePickerResult;
      try {
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images', 'videos'],
          allowsMultipleSelection: true,
          selectionLimit: PHOTO_CAP + VIDEO_CAP,
          quality: 1,
          videoMaxDuration: MAX_VIDEO_SEC,
          exif: true,
          ...(Platform.OS === 'ios'
            ? { videoExportPreset: ImagePicker.VideoExportPreset.HighestQuality }
            : {}),
        });
      } catch (err) {
        if (!isCurrent()) return;
        // iOS AVFoundation throws "Operation Interrupted" when the re-encode is
        // cut short (app backgrounded mid-pick, system load, etc). Surface it as
        // an inline note rather than letting it propagate to onunhandledrejection.
        if (__DEV__) console.warn('[AlbumUpload] picker failed:', err);
        setRejection({ tooLong: 0, tooBig: 0, unreadable: 0, capDropped: 0, transcodeFailed: 1 });
        return;
      }
      if (!isCurrent() || result.canceled || !result.assets) return;

      const newAssets: SelectedAsset[] = [];
      for (const a of result.assets) {
        const isVideo = a.type === 'video';
        const ext = formatExtFromName(a.fileName) || (isVideo ? 'mp4' : 'jpg');
        if (isVideo && (a.duration ?? 0) > MAX_VIDEO_SEC * 1000) {
          rej.tooLong += 1;
          continue;
        }
        if (isVideo && (a.fileSize ?? 0) > MAX_VIDEO_BYTES) {
          rej.tooBig += 1;
          continue;
        }
        if (isVideo && !a.duration) {
          // Defense against malformed video metadata that would slip past the
          // 60-second cap on the server (the duration column allows NULL).
          rej.unreadable += 1;
          continue;
        }
        newAssets.push({
          uri: a.uri,
          fileName: a.fileName ?? `upload.${ext}`,
          contentType: isVideo ? 'video' : 'photo',
          mediaFormat: ext,
          fileSizeBytes: a.fileSize,
          videoDurationSec: isVideo && a.duration ? Math.round(a.duration / 1000) : undefined,
          width: a.width,
          height: a.height,
          takenAt: isVideo ? undefined : parseExifTakenAt(a.exif),
        });
      }

      // Use the current selection if a photo was removed while the picker was open.
      const merged = [...assetsRef.current, ...newAssets];
      const photos: SelectedAsset[] = [];
      const videos: SelectedAsset[] = [];
      for (const item of merged) {
        if (item.contentType === 'photo' && photos.length < PHOTO_CAP) photos.push(item);
        else if (item.contentType === 'video' && videos.length < VIDEO_CAP) videos.push(item);
      }
      rej.capDropped = merged.length - (photos.length + videos.length);
      setAssets([...photos, ...videos]);

      const total = rej.tooLong + rej.tooBig + rej.unreadable + rej.capDropped;
      setRejection(total > 0 ? rej : null);
    } catch {
      if (isCurrent()) Alert.alert('Photos unavailable', 'Could not open your photos. Please try again.');
    } finally {
      pickerLock.current = false;
      if (isCurrent()) setPicking(false);
    }
  }, [isCurrent]);

  const removeAsset = useCallback((uri: string) => {
    if (!isCurrent() || submitLock.current) return;
    setAssets((prev) => prev.filter((a) => a.uri !== uri));
  }, [isCurrent]);

  const scrollToBottomOnFocus = useCallback(() => {
    setTimeout(() => { if (isCurrent()) scrollRef.current?.scrollToEnd({ animated: true }); }, 250);
  }, [isCurrent]);

  const toggleAttendee = useCallback((uid: string) => {
    if (!isCurrent() || submitLock.current) return;
    setExcludedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });
  }, [isCurrent]);

  const visibleToUserIds = useMemo(() => {
    if (!attendees) return [];
    return attendees.filter((a) => !excludedUserIds.has(a.user_id)).map((a) => a.user_id);
  }, [attendees, excludedUserIds]);

  const onUpload = useCallback(async () => {
    if (!isCurrent() || !readyRef.current || pickerLock.current || submitLock.current || assets.length === 0 || !myUserId || !eventId) return;
    submitLock.current = true;
    setSubmitting(true);
    try {
      const inputs: AlbumUploadInput[] = assets.map((a) => ({
        localUri: a.uri,
        contentType: a.contentType,
        mediaFormat: a.mediaFormat,
        fileSizeBytes: a.fileSizeBytes,
        videoDurationSec: a.videoDurationSec,
        width: a.width,
        height: a.height,
        takenAt: a.takenAt,
      }));

      await enqueueAlbumUploadBatch(String(eventId), myUserId, inputs, {
        visibleToUserIds,
        marketingConsent,
        instagram: marketingConsent && instagram.trim() ? instagram.trim() : undefined,
        tiktok:    marketingConsent && tiktok.trim()    ? tiktok.trim()    : undefined,
        testimonial: marketingConsent && testimonial.trim() ? testimonial.trim() : undefined,
      });

      // Navigate to album detail; the queue uploads in background.
      if (isCurrent()) router.dismissTo(`/album/${eventId}` as any);
    } catch (err) {
      if (!isCurrent()) return;
      submitLock.current = false;
      Alert.alert('Upload error', 'Could not start upload. Please try again.');
      setSubmitting(false);
    }
  }, [assets, myUserId, eventId, visibleToUserIds, marketingConsent, instagram, tiktok, testimonial, router, isCurrent]);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to album" onPress={() => { if (isCurrent()) router.back(); }} hitSlop={12} style={styles.headerBtn}>
          <Ionicons name="close" size={26} color={Colors.asphalt} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{eventTitle || 'Add photos'}</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView ref={scrollRef} contentContainerStyle={[styles.scroll, { paddingBottom: 120 + insets.bottom }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {readFailure && <View style={styles.recovery}>
          <Text style={styles.recoveryText}>{unavailable ? 'This plan is unavailable.' : titleQuery.isError ? 'We couldn’t load this plan. Try again before uploading.' : 'We couldn’t check who can see your uploads. Try again before uploading.'}</Text>
          <PageAction compact singleLine title={readsBusy ? 'Retrying…' : 'Try again'} disabled={readsBusy} onPress={retryReads} />
        </View>}
        {titleQuery.isPending && <View style={styles.audienceLoading}>
          <ActivityIndicator color={Colors.terracotta} accessibilityLabel="Checking this plan" />
          <Text style={[styles.sectionSubtitle, { flex: 1 }]}>Checking this plan…</Text>
        </View>}
        {/* Pitch */}
        <Text style={styles.pitch}>
          Upload your photos so you can share them with everyone.
        </Text>

        {/* Picker section */}
        <TouchableOpacity style={styles.pickerBtn} onPress={pickAssets} disabled={picking || submitting} accessibilityLabel="Pick photos and videos" accessibilityState={{ busy: picking, disabled: picking || submitting }} activeOpacity={0.85}>
          <Ionicons name="images-outline" size={18} color={Colors.terracotta} />
          <Text style={styles.pickerBtnText}>
            {assets.length === 0 ? 'Pick photos and videos' : 'Add more'}
          </Text>
        </TouchableOpacity>
        <Text style={styles.limitsHint}>
          Up to {PHOTO_CAP} photos and {VIDEO_CAP} videos ({VIDEO_LIMIT_LABEL})
        </Text>
        {assets.length > 0 && (
          <Text style={styles.countText}>
            {photoCount} {photoCount === 1 ? 'photo' : 'photos'}, {videoCount} {videoCount === 1 ? 'video' : 'videos'} selected
          </Text>
        )}
        {rejection && (
          <View style={styles.rejectionRow}>
            <Ionicons name="information-circle-outline" size={16} color={Colors.errorBrand} />
            <Text style={styles.rejectionText}>{rejectionMessage(rejection)}</Text>
          </View>
        )}
        {assets.length > 0 && (
          <View style={styles.preview}>
            {assets.map((a) => (
              <View key={a.uri} style={styles.previewTile}>
                <Image source={{ uri: a.uri }} style={styles.previewImage} contentFit="cover" />
                {a.contentType === 'video' && (
                  <View style={styles.previewVideo}>
                    <Ionicons name="videocam" size={14} color={Colors.white} />
                  </View>
                )}
                <Pressable style={styles.previewRemove} onPress={() => removeAsset(a.uri)} hitSlop={8}>
                  <Ionicons name="close-circle" size={20} color={Colors.white} />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {/* Privacy toggles */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Who can see your uploads?</Text>
          <Text style={styles.sectionSubtitle}>
            Only people who attended. Uncheck anyone you'd prefer not to share with.
          </Text>
          {(audienceQuery.isPending || audienceQuery.isFetching) && <View style={styles.audienceLoading}><ActivityIndicator color={Colors.terracotta} accessibilityLabel="Checking upload audience" /><Text style={[styles.sectionSubtitle, { flex: 1 }]}>Checking who can see your uploads…</Text></View>}
          {audienceQuery.isError && <Text style={styles.sectionSubtitle}>Your audience couldn’t be checked. Uploading is paused until you retry.</Text>}
          {attendees !== undefined && !audienceQuery.isError && !audienceQuery.isPending && !audienceQuery.isFetching && attendees.length === 0 ? (
            <Text style={styles.sectionEmpty}>It's just you! Your photos are private to you.</Text>
          ) : (
            (attendees ?? []).map((a) => {
              const included = !excludedUserIds.has(a.user_id);
              return (
                <View key={a.user_id} style={styles.attendeeRow}>
                  {a.profile_photo_url ? (
                    <Image source={{ uri: a.profile_photo_url }} style={styles.attendeeAvatar} contentFit="cover" />
                  ) : (
                    <View style={[styles.attendeeAvatar, styles.attendeeFallback]}>
                      <Text style={styles.attendeeFallbackText}>
                        {(a.first_name_display ?? '?').charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <Text style={styles.attendeeName} numberOfLines={1}>
                    {a.first_name_display ?? 'Friend'}
                  </Text>
                  <Switch
                    value={included}
                    onValueChange={() => toggleAttendee(a.user_id)}
                    trackColor={{ false: Colors.border, true: Colors.terracotta }}
                    thumbColor={Colors.white}
                  />
                </View>
              );
            })
          )}
        </View>

        {/* Marketing consent */}
        <View style={styles.divider} />
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Marketing consent</Text>
          <Pressable style={styles.consentRow} onPress={() => setMarketingConsent((v) => !v)}>
            <Ionicons
              name={marketingConsent ? 'checkbox' : 'square-outline'}
              size={22}
              color={marketingConsent ? Colors.terracotta : Colors.warmGray}
            />
            <Text style={styles.consentText}>
              Let WashedUp use these for promotion. Your photos and videos may appear on our social channels and website.
            </Text>
          </Pressable>
          <Pressable
            onPress={() => { if (isCurrent()) void WebBrowser.openBrowserAsync('https://washedup.app/photo-consent'); }}
            style={styles.learnMoreWrap}
            hitSlop={8}
            accessibilityRole="link"
            accessibilityLabel="Learn more about how WashedUp uses your photos"
          >
            <Text style={styles.learnMoreLink}>Learn more</Text>
          </Pressable>

          {marketingConsent && (
            <View style={styles.consentDetails}>
              <Pressable style={styles.consentRow} onPress={() => setTagMe((v) => !v)}>
                <Ionicons
                  name={tagMe ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={tagMe ? Colors.terracotta : Colors.warmGray}
                />
                <Text style={styles.consentText}>Tag me if posted!</Text>
              </Pressable>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Instagram</Text>
                <View style={styles.handleWrap}>
                  <Text style={styles.handlePrefix}>@</Text>
                  <TextInput
                    style={styles.handleInput}
                    value={instagram}
                    onChangeText={setInstagram}
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder=""
                    returnKeyType="done"
                    onFocus={scrollToBottomOnFocus}
                    onSubmitEditing={Keyboard.dismiss}
                    inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
                  />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>TikTok</Text>
                <View style={styles.handleWrap}>
                  <Text style={styles.handlePrefix}>@</Text>
                  <TextInput
                    style={styles.handleInput}
                    value={tiktok}
                    onChangeText={setTiktok}
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder=""
                    returnKeyType="done"
                    onFocus={scrollToBottomOnFocus}
                    onSubmitEditing={Keyboard.dismiss}
                    inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
                  />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>
                  Tell us about your experience! (may be featured on our socials or website)
                </Text>
                <TextInput
                  style={styles.testimonial}
                  value={testimonial}
                  onChangeText={setTestimonial}
                  multiline
                  numberOfLines={3}
                  placeholder=""
                  onFocus={scrollToBottomOnFocus}
                  inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
                />
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: 16 + insets.bottom }]}>
        <TouchableOpacity
          style={[styles.uploadBtn, (assets.length === 0 || submitting || picking || !readsReady) && styles.uploadBtnDisabled]}
          onPress={onUpload}
          disabled={assets.length === 0 || submitting || picking || !readsReady}
          accessibilityLabel="Upload selected photos and videos"
          activeOpacity={0.9}
        >
          {submitting ? (
            <ActivityIndicator color={Colors.white} />
          ) : (
            <Text style={styles.uploadBtnText}>
              {assets.length === 0
                ? 'Pick photos to continue'
                : `Upload ${photoCount} ${photoCount === 1 ? 'photo' : 'photos'}, ${videoCount} ${videoCount === 1 ? 'video' : 'videos'}`}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.parchment },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.parchment, padding: 24, gap: 16 },
  recovery: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  recoveryText: { flex: 1, minWidth: 0, fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.warmGray },
  audienceLoading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingTop: 4, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerBtn: { width: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: {
    flex: 1, textAlign: 'center', fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG, color: Colors.asphalt,
  },
  scroll: { padding: 16, paddingBottom: 120 },
  pitch: {
    fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD,
    color: Colors.textMedium, marginBottom: 16, lineHeight: 22,
  },
  pickerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.white, borderWidth: 1.5, borderColor: Colors.terracotta,
    paddingVertical: 14, borderRadius: 12,
  },
  pickerBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  limitsHint: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.warmGray,
    textAlign: 'center',
    marginTop: 8,
  },
  countText: {
    fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM,
    color: Colors.textMedium, marginTop: 8,
  },
  rejectionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 4,
  },
  rejectionText: {
    flex: 1,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.warmGray,
    lineHeight: 18,
  },
  preview: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  previewTile: { width: 84, height: 84, borderRadius: 8, overflow: 'hidden', backgroundColor: Colors.inputBg },
  previewImage: { width: '100%', height: '100%' },
  previewVideo: {
    position: 'absolute', bottom: 4, left: 4,
    width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.overlayDark55,
    alignItems: 'center', justifyContent: 'center',
  },
  previewRemove: { position: 'absolute', top: 2, right: 2 },
  section: { marginTop: 24, gap: 8 },
  sectionTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  sectionSubtitle: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.warmGray },
  sectionEmpty: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.warmGray, marginTop: 8 },
  attendeeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  attendeeAvatar: { width: 36, height: 36, borderRadius: 18 },
  attendeeFallback: { backgroundColor: Colors.inputBg, alignItems: 'center', justifyContent: 'center' },
  attendeeFallbackText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.warmGray },
  attendeeName: { flex: 1, fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  divider: { height: 1, backgroundColor: Colors.border, marginTop: 24 },
  consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8 },
  consentText: { flex: 1, fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium, lineHeight: 20 },
  learnMoreWrap: { paddingLeft: 32, paddingVertical: 4 },
  learnMoreLink: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
  },
  consentDetails: { gap: 12, marginTop: 4 },
  field: { gap: 6 },
  fieldLabel: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  handleWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.inputBg, borderRadius: 8, paddingHorizontal: 12,
  },
  handlePrefix: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.warmGray, marginRight: 4 },
  handleInput: {
    flex: 1, paddingVertical: 12, fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD, color: Colors.asphalt,
  },
  testimonial: {
    backgroundColor: Colors.inputBg, borderRadius: 8, padding: 12,
    fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.asphalt,
    minHeight: 80, textAlignVertical: 'top',
  },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    padding: 16, borderTopWidth: 1, borderTopColor: Colors.border,
    backgroundColor: Colors.parchment,
  },
  uploadBtn: {
    backgroundColor: Colors.terracotta, paddingVertical: 14, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: Colors.terracotta, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3, shadowRadius: 8,
  },
  uploadBtnDisabled: { opacity: 0.45 },
  uploadBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
});
