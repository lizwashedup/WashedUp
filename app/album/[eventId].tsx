import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS, ActivityIndicator, Alert, Dimensions, FlatList, Keyboard, Modal,
  Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../../components/keyboard/KeyboardDoneBar';
import { captureRef } from 'react-native-view-shot';
import { BrandedShareCanvas } from '../../components/albums/BrandedShareCanvas';
import { COPY } from '../../components/yours/state/constants';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { ALBUM } from '../../constants/YoursDesign';
import { supabase } from '../../lib/supabase';
import { logError } from '../../lib/logger';

const { width: SCREEN_W } = Dimensions.get('window');
const GRID_COLS = 2;
const GRID_GAP = 4;
const GRID_PADDING = 12;
const TILE_SIZE = (SCREEN_W - GRID_PADDING * 2 - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS;
const SIGNED_URL_TTL = 3600;

type AlbumUpload = {
  id: string;
  user_id: string;
  media_url: string;
  thumbnail_url: string | null;
  display_url: string | null;
  content_type: 'photo' | 'video';
  heart_count: number;
  created_at: string;
};

type Attendee = {
  user_id: string;
  first_name_display: string | null;
  profile_photo_url: string | null;
};

type AlbumPayload = {
  album: {
    id: string;
    event_id: string;
    status: 'collecting' | 'ready';
    first_upload_at: string | null;
    event_title: string;
    event_start_time: string;
    event_location: string | null;
  } | null;
  uploads: Array<AlbumUpload & {
    uploader_name: string | null;
    signed_display_url: string | null;
  }>;
  attendees: Attendee[];
  myUserId: string;
  // Set of upload_ids the caller has already hearted.
  myHeartedIds: Set<string>;
  // Caller's per-album personalisation (custom name, memory note, mute).
  myMetadata: {
    custom_name: string | null;
    memory_note: string | null;
    notifications_muted: boolean;
    cover_upload_id: string | null;
  } | null;
};

async function fetchAlbumByEvent(eventId: string): Promise<AlbumPayload> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not authenticated');

  // 1. plan_albums (RLS filters to joined members)
  const { data: albumRow } = await supabase
    .from('plan_albums')
    .select('id, event_id, status, first_upload_at')
    .eq('event_id', eventId)
    .maybeSingle();

  // 2. event meta
  const { data: eventRow } = await supabase
    .from('events')
    .select('id, title, start_time, location_text')
    .eq('id', eventId)
    .maybeSingle();

  // 3. attendees
  const { data: members } = await supabase
    .from('event_members')
    .select('user_id')
    .eq('event_id', eventId)
    .eq('status', 'joined');
  const userIds = (members ?? []).map((m) => m.user_id);
  let profilesById = new Map<string, { first_name_display: string | null; profile_photo_url: string | null }>();
  if (userIds.length > 0) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, first_name_display, profile_photo_url')
      .in('id', userIds);
    profilesById = new Map(
      (profs ?? []).map((p) => [p.id, {
        first_name_display: p.first_name_display ?? null,
        profile_photo_url: p.profile_photo_url ?? null,
      }]),
    );
  }
  const attendees: Attendee[] = userIds.map((uid) => ({
    user_id: uid,
    first_name_display: profilesById.get(uid)?.first_name_display ?? null,
    profile_photo_url: profilesById.get(uid)?.profile_photo_url ?? null,
  }));
  const nameByUserId = new Map(attendees.map((a) => [a.user_id, a.first_name_display]));

  // 4. uploads (RLS filters by visibility)
  let uploads: Array<AlbumUpload & { uploader_name: string | null; signed_display_url: string | null }> = [];
  if (albumRow) {
    const { data: rawUploads } = await supabase
      .from('album_uploads')
      .select('id, user_id, media_url, thumbnail_url, display_url, content_type, heart_count, created_at')
      .eq('plan_album_id', albumRow.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });

    uploads = await Promise.all(
      (rawUploads ?? []).map(async (u) => {
        const path = u.display_url || u.media_url;
        let signedUrl: string | null = null;
        try {
          const { data: signedData, error } = await supabase.storage
            .from('album-media')
            .createSignedUrl(path, SIGNED_URL_TTL);
          if (error) throw error;
          signedUrl = signedData?.signedUrl ?? null;
        } catch (err) {
          // One bad signed URL shouldn't take down the whole album. Log and
          // keep going — that asset just renders without an image.
          logError(err, 'album.createSignedUrl');
        }
        return {
          ...u,
          uploader_name: nameByUserId.get(u.user_id) ?? null,
          signed_display_url: signedUrl,
        } as any;
      }),
    );
  }

  // 5. Caller's existing hearts on these uploads (drives the heart-toggle UI).
  let myHeartedIds = new Set<string>();
  if (uploads.length > 0) {
    const { data: hearts } = await supabase
      .from('album_hearts')
      .select('upload_id')
      .eq('user_id', user.id)
      .in('upload_id', uploads.map((u) => u.id));
    myHeartedIds = new Set((hearts ?? []).map((h) => h.upload_id));
  }

  // 6. Caller's per-album metadata (custom name, memory note, mute flag).
  let myMetadata: AlbumPayload['myMetadata'] = null;
  if (albumRow) {
    const { data: meta } = await supabase
      .from('album_user_metadata')
      .select('custom_name, memory_note, notifications_muted, cover_upload_id')
      .eq('plan_album_id', albumRow.id)
      .eq('user_id', user.id)
      .maybeSingle();
    myMetadata = meta ?? null;
  }

  return {
    album: albumRow ? {
      id: albumRow.id,
      event_id: albumRow.event_id,
      status: albumRow.status,
      first_upload_at: albumRow.first_upload_at,
      event_title: eventRow?.title ?? 'Plan',
      event_start_time: eventRow?.start_time ?? new Date().toISOString(),
      event_location: eventRow?.location_text ?? null,
    } : null,
    uploads,
    attendees,
    myUserId: user.id,
    myHeartedIds,
    myMetadata,
  };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function AlbumDetailScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const router = useRouter();

  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  // Optimistic per-upload state. Keyed by upload_id. Lets the heart icon
  // animate on tap before the round-trip + refetch completes.
  const [optimisticHearted, setOptimisticHearted] = useState<Record<string, boolean>>({});
  const [optimisticHiddenIds, setOptimisticHiddenIds] = useState<Set<string>>(new Set());
  const [sharing, setSharing] = useState(false);
  const shareCanvasRef = useRef<View>(null);

  // Personal-name + memory-note state, debounced-saved to album_user_metadata.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  // Caller's chosen cover photo (personal, persisted in album_user_metadata).
  const [savedCover, setSavedCover] = useState<string | null>(null);
  // Album-name editing is explicit (pencil to enter, checkmark to commit) so
  // it cannot be edited accidentally and never autosaves mid-typing.
  const [isEditingName, setIsEditingName] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const nameInputRef = useRef<TextInput>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['album', eventId],
    queryFn: () => fetchAlbumByEvent(String(eventId)),
    enabled: !!eventId,
  });

  // Refetch when the screen regains focus — covers returning from the upload
  // flow with new uploads, and refreshes signed URLs that may have aged out.
  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));

  // Mark album viewed (clears unread badge) when data resolves.
  useEffect(() => {
    if (data?.album?.id) {
      void supabase.rpc('mark_album_viewed', { p_plan_album_id: data.album.id });
    }
  }, [data?.album?.id]);

  // Hydrate metadata drafts from server when payload changes.
  useEffect(() => {
    const nm = data?.myMetadata?.custom_name ?? null;
    const nt = data?.myMetadata?.memory_note ?? null;
    setNameDraft(nm);
    setNoteDraft(nt);
    setSavedName(nm);
    setSavedNote(nt);
    setMuted(!!data?.myMetadata?.notifications_muted);
    setSavedCover(data?.myMetadata?.cover_upload_id ?? null);
  }, [data?.myMetadata?.custom_name, data?.myMetadata?.memory_note, data?.myMetadata?.notifications_muted, data?.myMetadata?.cover_upload_id]);

  // Debounced save for the memory NOTE only. The album name is intentionally
  // excluded here: it persists explicitly via commitName (pencil -> checkmark),
  // so typing in the name field never autosaves. p_custom_name keeps the
  // already-committed savedName so a note save never clobbers the name.
  useEffect(() => {
    if (!data?.album?.id) return;
    if ((noteDraft ?? '') === (savedNote ?? '')) return;

    const t = setTimeout(async () => {
      const { error } = await supabase.rpc('set_album_user_metadata', {
        p_plan_album_id: data.album!.id,
        p_custom_name: savedName ?? '',
        p_memory_note: noteDraft ?? '',
        p_notifications_muted: muted,
        p_cover_upload_id: savedCover,
      });
      if (!error) {
        setSavedNote(noteDraft);
      } else {
        Alert.alert('Could not save', 'Your note did not save. Please try again.');
      }
    }, 600);
    return () => clearTimeout(t);
  }, [noteDraft, savedNote, savedName, data?.album?.id, muted, savedCover]);

  const toggleMute = useCallback(async () => {
    if (!data?.album?.id) return;
    const next = !muted;
    setMuted(next);
    const { error } = await supabase.rpc('set_album_user_metadata', {
      p_plan_album_id: data.album.id,
      p_custom_name: savedName ?? '',
      p_memory_note: savedNote ?? '',
      p_notifications_muted: next,
      p_cover_upload_id: savedCover,
    });
    if (error) {
      setMuted(!next);
      Alert.alert('Could not update notifications', 'Please try again.');
    }
  }, [data?.album?.id, muted, savedName, savedNote, savedCover]);

  // Enter name-edit mode. Idempotent: rapid taps while already editing are
  // no-ops, so the pencil cannot thrash. Seeds the draft from the committed
  // name and focuses the field on the next frame.
  const startEditName = useCallback(() => {
    if (isEditingName) return;
    setNameDraft(savedName ?? '');
    setIsEditingName(true);
    requestAnimationFrame(() => nameInputRef.current?.focus());
  }, [isEditingName, savedName]);

  // Commit the edited name. Mirrors toggleMute/setAsCover: sends all five
  // params so a rename never clobbers note/mute/cover. No-op (just exits edit
  // mode) when nothing changed. Clearing the name reverts to the plan title.
  const commitName = useCallback(async () => {
    if (savingName) return;
    const next = (nameDraft ?? '').trim();
    if (!data?.album?.id || next === (savedName ?? '')) {
      setIsEditingName(false);
      Keyboard.dismiss();
      return;
    }
    setSavingName(true);
    try {
      const { error } = await supabase.rpc('set_album_user_metadata', {
        p_plan_album_id: data.album.id,
        p_custom_name: next,
        p_memory_note: savedNote ?? '',
        p_notifications_muted: muted,
        p_cover_upload_id: savedCover,
      });
      if (error) {
        Alert.alert('Could not save', 'Your album name did not save. Please try again.');
        return;
      }
      setSavedName(next || null);
      setIsEditingName(false);
      Keyboard.dismiss();
    } finally {
      setSavingName(false);
    }
  }, [savingName, nameDraft, data?.album?.id, savedName, savedNote, muted, savedCover]);

  const handleShareViewedPhoto = useCallback(async () => {
    if (sharing) return;
    if (viewerIndex == null) return;
    setSharing(true);
    try {
      // Capture the off-screen BrandedShareCanvas which is already rendered
      // with the current viewer photo + plan title. Brief delay lets the
      // image asset settle before capture.
      await new Promise((r) => setTimeout(r, 300));
      const uri = await captureRef(shareCanvasRef as any, {
        format: 'jpg',
        quality: 0.95,
        result: 'tmpfile',
      });
      // iOS supports `url` for file shares; Android falls back to text+url.
      // expo-sharing would handle Android files better — defer to 1.0.4.
      await Share.share(
        Platform.OS === 'ios'
          ? { url: uri }
          : { message: 'Check out our album from washedup', url: uri },
      );
    } catch (err) {
      Alert.alert('Could not share', 'Please try again.');
    } finally {
      setSharing(false);
    }
  }, [sharing, viewerIndex]);

  const showHeaderMenu = useCallback(() => {
    const muteLabel = muted ? 'Unmute notifications' : 'Mute notifications';
    const onPick = (idx: number) => {
      if (idx === 0) void toggleMute();
    };
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: [muteLabel, 'Cancel'], cancelButtonIndex: 1 },
        onPick,
      );
    } else {
      Alert.alert('Album options', undefined, [
        { text: muteLabel, onPress: () => onPick(0) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }, [muted, toggleMute]);

  const coverUri = useMemo(() => {
    const uploads = data?.uploads ?? [];
    if (savedCover) {
      const chosen = uploads.find((u) => u.id === savedCover);
      if (chosen?.signed_display_url) return chosen.signed_display_url;
    }
    return uploads[0]?.signed_display_url ?? null;
  }, [data, savedCover]);

  // ── Action handlers (heart / hide / delete) ────────────────────────────────
  const isHearted = useCallback((uploadId: string): boolean => {
    if (uploadId in optimisticHearted) return optimisticHearted[uploadId];
    return !!data?.myHeartedIds?.has(uploadId);
  }, [optimisticHearted, data]);

  const toggleHeart = useCallback(async (uploadId: string) => {
    const wasHearted = isHearted(uploadId);
    setOptimisticHearted((prev) => ({ ...prev, [uploadId]: !wasHearted }));
    try {
      const fn = wasHearted ? 'remove_album_heart' : 'record_album_heart';
      const { error } = await supabase.rpc(fn, { p_upload_id: uploadId });
      if (error) throw error;
      void refetch();
    } catch (err) {
      // Revert optimistic state on failure.
      setOptimisticHearted((prev) => ({ ...prev, [uploadId]: wasHearted }));
      Alert.alert('Could not update heart', 'Please try again.');
    }
  }, [isHearted, refetch]);

  const hideFromView = useCallback(async (uploadId: string) => {
    setOptimisticHiddenIds((prev) => {
      const next = new Set(prev); next.add(uploadId); return next;
    });
    const { error } = await supabase
      .from('album_visibility')
      .update({ hidden_by_viewer: true })
      .eq('upload_id', uploadId);
    if (error) {
      setOptimisticHiddenIds((prev) => {
        const next = new Set(prev); next.delete(uploadId); return next;
      });
      Alert.alert('Could not hide', 'Please try again.');
      return;
    }
    void refetch();
  }, [refetch]);

  const deleteOwnUpload = useCallback(async (uploadId: string) => {
    setOptimisticHiddenIds((prev) => {
      const next = new Set(prev); next.add(uploadId); return next;
    });
    const { error } = await supabase.rpc('soft_delete_album_upload', { p_upload_id: uploadId });
    if (error) {
      setOptimisticHiddenIds((prev) => {
        const next = new Set(prev); next.delete(uploadId); return next;
      });
      Alert.alert('Could not delete', 'Please try again.');
      return;
    }
    void refetch();
  }, [refetch]);

  // Personal cover: tap toggles this photo as the caller's album cover.
  // Persisted alongside the rest of album_user_metadata so name/note/mute
  // are preserved (the RPC upserts every column).
  const setAsCover = useCallback(async (uploadId: string) => {
    if (!data?.album?.id) return;
    const next = savedCover === uploadId ? null : uploadId;
    const prev = savedCover;
    setSavedCover(next);
    const { error } = await supabase.rpc('set_album_user_metadata', {
      p_plan_album_id: data.album.id,
      p_custom_name: savedName ?? '',
      p_memory_note: savedNote ?? '',
      p_notifications_muted: muted,
      p_cover_upload_id: next,
    });
    if (error) {
      setSavedCover(prev);
      Alert.alert('Could not update cover', 'Please try again.');
      return;
    }
    void refetch();
  }, [data?.album?.id, savedCover, savedName, savedNote, muted, refetch]);

  const showTileActions = useCallback((uploadId: string, isOwn: boolean, isPhoto: boolean) => {
    // Spec includes a "Save to phone" option here. Deferred to 1.0.4 — needs
    // expo-media-library (native module). Once installed, add a third option
    // that fetches the original signed URL and writes it to the photo album
    // via MediaLibrary.saveToLibraryAsync(localPath).
    const hearted = isHearted(uploadId);
    const heartLabel = hearted ? 'Unheart' : 'Heart';
    const ownActionLabel = isOwn ? 'Delete' : 'Hide from my view';

    const runOwnAction = () => {
      if (isOwn) {
        Alert.alert(
          'Delete this for everyone?',
          'It will disappear from everyone\'s album immediately.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => void deleteOwnUpload(uploadId) },
          ],
        );
      } else {
        void hideFromView(uploadId);
      }
    };

    // Build the action list dynamically: a cover toggle is only offered for
    // photos (videos can't be a cover).
    const actions: { label: string; destructive?: boolean; run: () => void }[] = [
      { label: heartLabel, run: () => void toggleHeart(uploadId) },
    ];
    if (isPhoto) {
      actions.push({
        label: savedCover === uploadId ? 'Remove as album cover' : 'Set as album cover',
        run: () => void setAsCover(uploadId),
      });
    }
    actions.push({ label: ownActionLabel, destructive: true, run: runOwnAction });

    if (Platform.OS === 'ios') {
      const options = [...actions.map((a) => a.label), 'Cancel'];
      const cancelIndex = options.length - 1;
      const destructiveIndex = actions.findIndex((a) => a.destructive);
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: cancelIndex, destructiveButtonIndex: destructiveIndex },
        (idx) => { if (idx < actions.length) actions[idx].run(); },
      );
    } else {
      Alert.alert('Photo options', undefined, [
        ...actions.map((a) => ({
          text: a.label,
          style: (a.destructive ? 'destructive' : 'default') as 'destructive' | 'default',
          onPress: a.run,
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    }
  }, [isHearted, toggleHeart, hideFromView, deleteOwnUpload, savedCover, setAsCover]);

  const attendeeSummary = useMemo(() => {
    if (!data?.attendees) return '';
    const names = data.attendees
      .filter((a) => a.user_id !== data.myUserId)
      .map((a) => a.first_name_display || 'Friend');
    if (names.length === 0) return 'Just you';
    if (names.length <= 3) return names.join(', ');
    return `${names.slice(0, 3).join(', ')} +${names.length - 3}`;
  }, [data]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.loadingWrap}>
        <ActivityIndicator color={Colors.terracotta} />
      </SafeAreaView>
    );
  }

  // Catches three failure modes that all otherwise wedge the screen on a
  // forever-spinner: cold-start push deep-link with no eventId param, a
  // thrown error inside fetchAlbumByEvent, or any other path where data
  // never materialized. Friendly bail-out instead of infinite loading.
  if (!eventId || isError || !data) {
    return (
      <SafeAreaView style={styles.loadingWrap}>
        <Text style={styles.emptyText}>{COPY.albumOpenFailed}</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backTextBtn}>
          <Text style={styles.backText}>Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (!data.album) {
    return (
      <SafeAreaView style={styles.loadingWrap}>
        <Text style={styles.emptyText}>This album hasn't started yet.</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backTextBtn}>
          <Text style={styles.backText}>Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const { album, uploads, attendees, myUserId } = data;
  // The grid and the full-screen viewer must index the SAME list. The grid
  // hides optimistically-removed uploads; if the viewer kept indexing the
  // raw `uploads`, tapping a thumbnail after a hidden one opened the wrong
  // photo (and the counter/nav/share canvas were off too). Derive the
  // visible list once and use it everywhere `viewerIndex` is dereferenced.
  // Cheap per-render filter (album sizes are small; the grid filtered
  // inline every render already) — kept as a plain const because the early
  // returns above forbid adding a hook here.
  const visibleUploads = uploads.filter((u) => !optimisticHiddenIds.has(u.id));
  // Photos the current user has personally added. Drives the "Add yours" pill
  // and the zero-upload banner. Photos only, mirroring the server-side cap.
  const myPhotoCount = uploads.filter(
    (u) => u.user_id === myUserId && u.content_type === 'photo',
  ).length;

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {/* Hero */}
        <View style={styles.hero}>
          {coverUri ? (
            <Image source={{ uri: coverUri }} style={styles.heroImage} contentFit="cover" />
          ) : (
            <View style={[styles.heroImage, styles.heroPlaceholder]}>
              <Ionicons name="images-outline" size={36} color={Colors.terracotta} />
              <Text style={styles.heroPlaceholderText}>{COPY.albumCollecting}</Text>
            </View>
          )}
          <LinearGradient
            colors={['transparent', Colors.overlayDark55]}
            style={styles.heroGradient}
          />
          <SafeAreaView edges={['top']} style={styles.heroOverlay}>
            <View style={styles.heroBar}>
              <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
                <Ionicons name="chevron-back" size={26} color={Colors.white} />
              </Pressable>
              <Pressable onPress={showHeaderMenu} hitSlop={12} style={styles.backBtn}>
                <Ionicons name="ellipsis-horizontal" size={22} color={Colors.white} />
              </Pressable>
            </View>
          </SafeAreaView>
          <View style={styles.heroText}>
            <Text style={styles.heroTitle} numberOfLines={2}>{album.event_title}</Text>
            <Text style={styles.heroMeta} numberOfLines={1}>
              {formatDate(album.event_start_time)}
              {album.event_location ? ` · ${album.event_location}` : ''}
            </Text>
          </View>
        </View>

        {/* Attendee row */}
        <View style={styles.section}>
          <FlatList
            data={attendees}
            keyExtractor={(a) => a.user_id}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.attendeeRow}
            renderItem={({ item }) => (
              item.profile_photo_url ? (
                <Image source={{ uri: item.profile_photo_url }} style={styles.attendeeAvatar} contentFit="cover" />
              ) : (
                <View style={[styles.attendeeAvatar, styles.attendeeFallback]}>
                  <Text style={styles.attendeeFallbackText}>
                    {(item.first_name_display ?? '?').charAt(0).toUpperCase()}
                  </Text>
                </View>
              )
            )}
          />
          <View style={styles.attendeeFooter}>
            <Text style={styles.attendeeNames}>{attendeeSummary}</Text>
            {myPhotoCount < ALBUM.uploadPhotoCap && (
              <TouchableOpacity
                style={styles.addYoursPill}
                onPress={() => router.push(`/album/upload/${eventId}` as any)}
                activeOpacity={0.85}
              >
                <Ionicons name="add" size={ALBUM.ctaIconSize} color={Colors.white} />
                <Text style={styles.addYoursPillText}>{COPY.albumAddYours}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Personal name + memory note (per-user; others see their own) */}
        <View style={styles.personalSection}>
          <View style={styles.nameRow}>
            {isEditingName ? (
              <>
                <TextInput
                  ref={nameInputRef}
                  style={styles.nameInput}
                  value={nameDraft ?? ''}
                  onChangeText={(v) => setNameDraft(v)}
                  placeholder={album.event_title}
                  placeholderTextColor={Colors.warmGray}
                  maxLength={80}
                  returnKeyType="done"
                  onSubmitEditing={commitName}
                  blurOnSubmit
                  inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
                />
                <Pressable
                  onPress={commitName}
                  disabled={savingName}
                  hitSlop={10}
                  accessibilityLabel="Save album name"
                >
                  <Ionicons name="checkmark" size={20} color={Colors.terracotta} />
                </Pressable>
              </>
            ) : (
              <>
                <Text numberOfLines={2} style={styles.nameDisplay}>
                  {savedName ?? album.event_title}
                </Text>
                <Pressable
                  onPress={startEditName}
                  hitSlop={10}
                  accessibilityLabel="Rename album"
                >
                  <Ionicons name="pencil-outline" size={18} color={Colors.warmGray} />
                </Pressable>
              </>
            )}
          </View>
          <View style={styles.noteWrap}>
            <TextInput
              style={styles.noteInput}
              value={noteDraft ?? ''}
              onChangeText={(v) => setNoteDraft(v)}
              placeholder="Add a memory or note about this day..."
              placeholderTextColor={Colors.warmGray}
              multiline
              maxLength={500}
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />
          </View>
        </View>

        {/* Zero-upload nudge: you have not added any, but others have. The
            totally-empty album is covered by the empty-grid invite below. */}
        {myPhotoCount === 0 && visibleUploads.length > 0 && (
          <TouchableOpacity
            style={styles.addBanner}
            onPress={() => router.push(`/album/upload/${eventId}` as any)}
            activeOpacity={0.85}
          >
            <Ionicons name="camera-outline" size={ALBUM.ctaIconSize} color={Colors.terracotta} />
            <Text style={styles.addBannerText}>{COPY.albumAddYoursBanner}</Text>
            <Ionicons name="chevron-forward" size={ALBUM.ctaIconSize} color={Colors.terracotta} />
          </TouchableOpacity>
        )}

        {/* Photo grid */}
        {visibleUploads.length === 0 ? (
          <View style={styles.emptyGrid}>
            <Text style={styles.emptyGridTitle}>Be the first to add some photos.</Text>
            <Text style={styles.emptyGridSubtitle}>You were there, show us what happened.</Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {visibleUploads
              .map((u, idx) => {
                const hearted = isHearted(u.id);
                const isOwn = u.user_id === myUserId;
                return (
                  <Pressable
                    key={u.id}
                    style={styles.tile}
                    onPress={() => setViewerIndex(idx)}
                    onLongPress={() => showTileActions(u.id, isOwn, u.content_type === 'photo')}
                    delayLongPress={250}
                  >
                    {u.signed_display_url ? (
                      <Image source={{ uri: u.signed_display_url }} style={styles.tileImage} contentFit="cover" />
                    ) : (
                      <View style={[styles.tileImage, styles.tilePlaceholder]} />
                    )}
                    {u.content_type === 'video' && (
                      <View style={styles.playOverlay}>
                        <Ionicons name="play-circle" size={36} color={Colors.white} />
                      </View>
                    )}
                    <View style={styles.tileFooter}>
                      <Text style={styles.tileCredit} numberOfLines={1}>
                        {u.uploader_name ? `by ${u.uploader_name}${isOwn ? ' (you)' : ''}` : ''}
                      </Text>
                      {(u.heart_count > 0 || hearted) && (
                        <View style={styles.heartChip}>
                          <Ionicons
                            name={hearted ? 'heart' : 'heart-outline'}
                            size={11}
                            color={Colors.terracotta}
                          />
                          {u.heart_count > 0 && <Text style={styles.heartCount}>{u.heart_count}</Text>}
                        </View>
                      )}
                    </View>
                  </Pressable>
                );
              })}
          </View>
        )}

        {/* Add more photos button */}
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => router.push(`/album/upload/${eventId}` as any)}
          activeOpacity={0.85}
        >
          <Ionicons name="add" size={18} color={Colors.white} />
          <Text style={styles.addBtnText}>Add photos</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Full-screen viewer */}
      <Modal
        visible={viewerIndex !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setViewerIndex(null)}
      >
        <View style={styles.viewerRoot}>
          {viewerIndex !== null && visibleUploads[viewerIndex] && (
            <>
              {visibleUploads[viewerIndex].content_type === 'video' ? (
                <View style={styles.viewerVideoFallback}>
                  <Ionicons name="videocam-outline" size={48} color={Colors.white} />
                  <Text style={styles.viewerVideoText}>Video playback coming soon</Text>
                </View>
              ) : (
                <Image
                  source={{ uri: visibleUploads[viewerIndex].signed_display_url ?? '' }}
                  style={styles.viewerImage}
                  contentFit="contain"
                />
              )}
              <SafeAreaView edges={['top']} style={styles.viewerHeader}>
                <Pressable onPress={() => setViewerIndex(null)} hitSlop={12} style={styles.viewerClose}>
                  <Ionicons name="close" size={28} color={Colors.white} />
                </Pressable>
              </SafeAreaView>
              <SafeAreaView edges={['bottom']} style={styles.viewerFooter}>
                <View style={styles.viewerCreditRow}>
                  <Text style={styles.viewerCredit}>
                    {visibleUploads[viewerIndex].uploader_name
                      ? `by ${visibleUploads[viewerIndex].uploader_name}${visibleUploads[viewerIndex].user_id === myUserId ? ' (you)' : ''}`
                      : ''}
                  </Text>
                  <Pressable
                    onPress={handleShareViewedPhoto}
                    hitSlop={10}
                    style={styles.viewerShareBtn}
                    disabled={sharing}
                  >
                    {sharing ? (
                      <ActivityIndicator color={Colors.white} />
                    ) : (
                      <Ionicons name="share-outline" size={22} color={Colors.white} />
                    )}
                  </Pressable>
                </View>
                <View style={styles.viewerNav}>
                  <Pressable
                    onPress={() => setViewerIndex((i) => (i === null || i <= 0 ? i : i - 1))}
                    disabled={viewerIndex <= 0}
                    style={[styles.viewerNavBtn, viewerIndex <= 0 && styles.viewerNavBtnDisabled]}
                    hitSlop={8}
                  >
                    <Ionicons name="chevron-back" size={24} color={Colors.white} />
                  </Pressable>
                  <Text style={styles.viewerCount}>
                    {viewerIndex + 1} / {visibleUploads.length}
                  </Text>
                  <Pressable
                    onPress={() => setViewerIndex((i) => (i === null || i >= visibleUploads.length - 1 ? i : i + 1))}
                    disabled={viewerIndex >= visibleUploads.length - 1}
                    style={[styles.viewerNavBtn, viewerIndex >= visibleUploads.length - 1 && styles.viewerNavBtnDisabled]}
                    hitSlop={8}
                  >
                    <Ionicons name="chevron-forward" size={24} color={Colors.white} />
                  </Pressable>
                </View>
              </SafeAreaView>
            </>
          )}
        </View>
      </Modal>

      {/* Off-screen branded share canvas — captured on share button press. */}
      <BrandedShareCanvas
        ref={shareCanvasRef}
        photoUri={viewerIndex != null ? (visibleUploads[viewerIndex]?.signed_display_url ?? null) : null}
        title={album.event_title}
        dateText={formatDate(album.event_start_time)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.parchment },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.parchment, gap: 12 },
  emptyText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.warmGray },
  backTextBtn: { padding: 12 },
  backText: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  scroll: { paddingBottom: 80 },
  hero: { width: '100%', height: 320, backgroundColor: Colors.inputBg },
  heroImage: { width: '100%', height: '100%' },
  heroPlaceholder: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  heroPlaceholderText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  heroGradient: { ...StyleSheet.absoluteFillObject },
  heroOverlay: { position: 'absolute', top: 0, left: 0, right: 0 },
  heroBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  heroText: { position: 'absolute', bottom: 18, left: 18, right: 18 },
  heroTitle: { fontFamily: Fonts.displayBold, fontSize: FontSizes.displayLG, color: Colors.white },
  heroMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.white, marginTop: 4, opacity: 0.92 },
  section: { paddingHorizontal: GRID_PADDING, paddingTop: 16, gap: 8 },
  attendeeRow: { gap: 6, paddingVertical: 4 },
  attendeeAvatar: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: Colors.white },
  attendeeFallback: { backgroundColor: Colors.inputBg, alignItems: 'center', justifyContent: 'center' },
  attendeeFallbackText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.caption, color: Colors.warmGray },
  attendeeNames: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.warmGray },
  personalSection: { paddingHorizontal: GRID_PADDING, paddingTop: 16, gap: 10 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameInput: {
    flex: 1, fontFamily: Fonts.displayBold, fontSize: FontSizes.displayMD,
    color: Colors.asphalt, paddingVertical: 4,
  },
  nameDisplay: {
    flex: 1, fontFamily: Fonts.displayBold, fontSize: FontSizes.displayMD,
    color: Colors.asphalt, paddingVertical: 4,
  },
  noteWrap: {
    borderLeftWidth: 2, borderLeftColor: Colors.brandBorderSoft,
    paddingLeft: 12, paddingVertical: 4,
  },
  noteInput: {
    fontFamily: Fonts.displayItalic, fontSize: FontSizes.bodyMD,
    color: Colors.textMedium, lineHeight: 22, minHeight: 22,
  },
  emptyGrid: { paddingHorizontal: 24, paddingVertical: 48, alignItems: 'center', gap: 6 },
  emptyGridTitle: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyLG, color: Colors.asphalt, textAlign: 'center' },
  emptyGridSubtitle: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.warmGray, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: GRID_PADDING, paddingTop: 16, gap: GRID_GAP },
  tile: { width: TILE_SIZE, marginBottom: GRID_GAP },
  tileImage: { width: TILE_SIZE, height: TILE_SIZE, borderRadius: 4, backgroundColor: Colors.inputBg },
  tilePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  playOverlay: {
    position: 'absolute', top: 0, left: 0, width: TILE_SIZE, height: TILE_SIZE,
    alignItems: 'center', justifyContent: 'center',
  },
  tileFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 4, paddingHorizontal: 2 },
  tileCredit: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.textLight, flex: 1 },
  heartChip: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  heartCount: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.terracotta },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'center', backgroundColor: Colors.terracotta,
    paddingHorizontal: 22, paddingVertical: 12, borderRadius: 999, marginTop: 28,
    shadowColor: Colors.terracotta, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3, shadowRadius: 8,
  },
  addBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  attendeeFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  addYoursPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.terracotta,
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999,
  },
  addYoursPillText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.white },
  addBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: GRID_PADDING, marginTop: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    backgroundColor: Colors.brandSoft, borderRadius: 12,
  },
  addBannerText: { flex: 1, fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.asphalt },
  viewerRoot: { flex: 1, backgroundColor: Colors.shadowBlack, justifyContent: 'center' },
  viewerImage: { width: '100%', height: '100%' },
  viewerVideoFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  viewerVideoText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.white },
  viewerHeader: { position: 'absolute', top: 0, left: 0, right: 0 },
  viewerClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
  viewerFooter: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 16, paddingVertical: 12, gap: 8,
    backgroundColor: Colors.overlayDark40,
  },
  viewerCreditRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  viewerCredit: { flex: 1, fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.white },
  viewerShareBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  viewerNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  viewerNavBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  viewerNavBtnDisabled: { opacity: 0.3 },
  viewerCount: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.white },
});
