import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Keyboard, Platform, Pressable, ScrollView, StyleSheet,
  Switch, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../../../components/keyboard/KeyboardDoneBar';
import { supabase } from '../../../lib/supabase';
import { enqueueAlbumUploadBatch, AlbumUploadInput } from '../../../lib/uploadAlbumMedia';

const PHOTO_CAP = 20;
const VIDEO_CAP = 6;
const MAX_VIDEO_SEC = 60;
// Hard memory cap on video file size. Defends against React Native's
// ~200-400 MB JS heap getting blown out when the orchestrator reads the
// whole file via fetch().arrayBuffer(). 200 MB safely covers iPhone HEVC
// 4K@60 (~150 MB / 60s) and any reasonable H.264 recording. Streaming
// upload via expo-file-system is the v1.1 fix that lifts this cap.
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
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
};

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

async function fetchEventAttendees(eventId: string, myUserId: string): Promise<Attendee[]> {
  const { data: members, error: mErr } = await supabase
    .from('event_members')
    .select('user_id')
    .eq('event_id', eventId)
    .eq('status', 'joined');
  if (mErr) throw mErr;

  const userIds = (members ?? []).map((m) => m.user_id).filter((uid) => uid !== myUserId);
  if (userIds.length === 0) return [];

  const { data: profs, error: pErr } = await supabase
    .from('profiles')
    .select('id, first_name_display, profile_photo_url')
    .in('id', userIds);
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
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scrollRef = React.useRef<ScrollView>(null);

  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [eventTitle, setEventTitle] = useState<string>('');
  const [assets, setAssets] = useState<SelectedAsset[]>([]);
  const [excludedUserIds, setExcludedUserIds] = useState<Set<string>>(new Set());
  const [marketingConsent, setMarketingConsent] = useState(true);
  const [tagMe, setTagMe] = useState(true);
  const [instagram, setInstagram] = useState('');
  const [tiktok, setTiktok] = useState('');
  const [testimonial, setTestimonial] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [rejection, setRejection] = useState<RejectionCounts | null>(null);

  // Resolve user + event title.
  React.useEffect(() => {
    let cancel = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancel) return;
      setMyUserId(user?.id ?? null);
      if (eventId) {
        const { data: ev } = await supabase
          .from('events').select('title').eq('id', eventId).maybeSingle();
        if (!cancel) setEventTitle(ev?.title ?? '');
      }
    })();
    return () => { cancel = true; };
  }, [eventId]);

  const { data: attendees } = useQuery({
    queryKey: ['albumUpload.attendees', eventId, myUserId],
    queryFn: () => fetchEventAttendees(String(eventId), myUserId!),
    enabled: !!eventId && !!myUserId,
  });

  const photoCount = useMemo(() => assets.filter((a) => a.contentType === 'photo').length, [assets]);
  const videoCount = useMemo(() => assets.filter((a) => a.contentType === 'video').length, [assets]);

  const pickAssets = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
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
        // No videoMaxDuration here on purpose: setting it forces iOS into the
        // legacy single-select video picker, so users could only add one video
        // at a time. The MAX_VIDEO_SEC cap is enforced post-pick instead (the
        // tooLong / tooBig / unreadable rejections below), which keeps videos
        // multi-selectable via PHPicker.
        ...(Platform.OS === 'ios'
          ? { videoExportPreset: ImagePicker.VideoExportPreset.HighestQuality }
          : {}),
      });
    } catch (err) {
      // iOS AVFoundation throws "Operation Interrupted" when the re-encode is
      // cut short (app backgrounded mid-pick, system load, etc). Surface it as
      // an inline note rather than letting it propagate to onunhandledrejection.
      if (__DEV__) console.warn('[AlbumUpload] picker failed:', err);
      setRejection({ tooLong: 0, tooBig: 0, unreadable: 0, capDropped: 0, transcodeFailed: 1 });
      return;
    }
    if (result.canceled || !result.assets) return;

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
      });
    }

    // Enforce caps after adding. Compute the merged set against the current
    // closure value of `assets` so we can read the dropped count before the
    // next render — using setAssets's updater would defer that to the commit
    // phase, after we've already called setRejection.
    const merged = [...assets, ...newAssets];
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
  }, [assets]);

  const removeAsset = useCallback((uri: string) => {
    setAssets((prev) => prev.filter((a) => a.uri !== uri));
  }, []);

  const scrollToBottomOnFocus = useCallback(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 250);
  }, []);

  const toggleAttendee = useCallback((uid: string) => {
    setExcludedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });
  }, []);

  const visibleToUserIds = useMemo(() => {
    if (!attendees) return [];
    return attendees.filter((a) => !excludedUserIds.has(a.user_id)).map((a) => a.user_id);
  }, [attendees, excludedUserIds]);

  const onUpload = useCallback(async () => {
    if (assets.length === 0 || !myUserId || !eventId) return;
    setSubmitting(true);
    try {
      const inputs: AlbumUploadInput[] = assets.map((a) => ({
        localUri: a.uri,
        contentType: a.contentType,
        mediaFormat: a.mediaFormat,
        fileSizeBytes: a.fileSizeBytes,
        videoDurationSec: a.videoDurationSec,
      }));

      await enqueueAlbumUploadBatch(String(eventId), myUserId, inputs, {
        visibleToUserIds,
        marketingConsent,
        instagram: marketingConsent && instagram.trim() ? instagram.trim() : undefined,
        tiktok:    marketingConsent && tiktok.trim()    ? tiktok.trim()    : undefined,
        testimonial: marketingConsent && testimonial.trim() ? testimonial.trim() : undefined,
      });

      // Navigate to album detail; the queue uploads in background.
      router.replace(`/album/${eventId}` as any);
    } catch (err) {
      Alert.alert('Upload error', 'Could not start upload. Please try again.');
      setSubmitting(false);
    }
  }, [assets, myUserId, eventId, visibleToUserIds, marketingConsent, instagram, tiktok, testimonial, router]);

  if (!myUserId) {
    return (
      <SafeAreaView style={styles.loadingWrap}>
        <ActivityIndicator color={Colors.terracotta} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerBtn}>
          <Ionicons name="close" size={26} color={Colors.asphalt} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{eventTitle || 'Plan'}</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView ref={scrollRef} contentContainerStyle={[styles.scroll, { paddingBottom: 120 + insets.bottom }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {/* Pitch */}
        <Text style={styles.pitch}>
          Everyone took photos. Now put them together. Upload yours and get everyone else's back.
        </Text>

        {/* Picker section */}
        <TouchableOpacity style={styles.pickerBtn} onPress={pickAssets} activeOpacity={0.85}>
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
            <Ionicons name="information-circle-outline" size={16} color={Colors.gold} />
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
          {(attendees ?? []).length === 0 ? (
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
            onPress={() => WebBrowser.openBrowserAsync('https://washedup.app/photo-consent')}
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
          style={[styles.uploadBtn, submitting && styles.uploadBtnDisabled]}
          onPress={assets.length === 0 ? pickAssets : onUpload}
          disabled={submitting}
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
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.parchment },
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
