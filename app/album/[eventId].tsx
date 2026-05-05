import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Dimensions, FlatList, Modal, Pressable, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { supabase } from '../../lib/supabase';

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
    status: 'collecting' | 'developing' | 'ready';
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
    .select('user_id, profiles:user_id(first_name_display, profile_photo_url)')
    .eq('event_id', eventId)
    .eq('status', 'joined');
  const attendees: Attendee[] = (members ?? []).map((m: any) => ({
    user_id: m.user_id,
    first_name_display: m.profiles?.first_name_display ?? null,
    profile_photo_url: m.profiles?.profile_photo_url ?? null,
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
        const { data: signedData } = await supabase.storage
          .from('album-media')
          .createSignedUrl(path, SIGNED_URL_TTL);
        return {
          ...u,
          uploader_name: nameByUserId.get(u.user_id) ?? null,
          signed_display_url: signedData?.signedUrl ?? null,
        } as any;
      }),
    );
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
  };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function readyInLabel(firstUploadAt: string | null): string {
  if (!firstUploadAt) return 'Collecting photos';
  const ms = new Date(firstUploadAt).getTime() + 24 * 60 * 60 * 1000 - Date.now();
  if (ms <= 0) return 'Ready';
  const hours = Math.ceil(ms / (60 * 60 * 1000));
  return hours <= 1 ? 'Ready in 1h' : `Ready in ${hours}h`;
}

export default function AlbumDetailScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const router = useRouter();

  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['album', eventId],
    queryFn: () => fetchAlbumByEvent(String(eventId)),
    enabled: !!eventId,
  });

  // Mark album viewed (clears unread badge) when data resolves.
  useEffect(() => {
    if (data?.album?.id) {
      void supabase.rpc('mark_album_viewed', { p_plan_album_id: data.album.id });
    }
  }, [data?.album?.id]);

  const coverUri = useMemo(() => {
    return data?.uploads?.[0]?.signed_display_url ?? null;
  }, [data]);

  const attendeeSummary = useMemo(() => {
    if (!data?.attendees) return '';
    const names = data.attendees
      .filter((a) => a.user_id !== data.myUserId)
      .map((a) => a.first_name_display || 'Friend');
    if (names.length === 0) return 'Just you';
    if (names.length <= 3) return names.join(', ');
    return `${names.slice(0, 3).join(', ')} +${names.length - 3}`;
  }, [data]);

  if (isLoading || !data) {
    return (
      <SafeAreaView style={styles.loadingWrap}>
        <ActivityIndicator color={Colors.terracotta} />
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
  const isReady = album.status === 'ready';

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Hero */}
        <View style={styles.hero}>
          {coverUri ? (
            <Image source={{ uri: coverUri }} style={styles.heroImage} contentFit="cover" />
          ) : (
            <View style={[styles.heroImage, styles.heroPlaceholder]}>
              <Ionicons name="hourglass-outline" size={36} color={Colors.terracotta} />
              <Text style={styles.heroPlaceholderText}>{readyInLabel(album.first_upload_at)}</Text>
            </View>
          )}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.55)']}
            style={styles.heroGradient}
          />
          <SafeAreaView edges={['top']} style={styles.heroOverlay}>
            <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
              <Ionicons name="chevron-back" size={26} color={Colors.white} />
            </Pressable>
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
          <Text style={styles.attendeeNames}>{attendeeSummary}</Text>
        </View>

        {/* Photo grid */}
        {uploads.length === 0 ? (
          <View style={styles.emptyGrid}>
            <Text style={styles.emptyGridTitle}>
              {isReady ? 'No photos yet.' : "Your photos are developing…"}
            </Text>
            <Text style={styles.emptyGridSubtitle}>
              {isReady ? 'You were there, show us what happened.' : readyInLabel(album.first_upload_at)}
            </Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {uploads.map((u, idx) => (
              <Pressable key={u.id} style={styles.tile} onPress={() => setViewerIndex(idx)}>
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
                    {u.uploader_name ? `by ${u.uploader_name}${u.user_id === myUserId ? ' (you)' : ''}` : ''}
                  </Text>
                  {u.heart_count > 0 && (
                    <View style={styles.heartChip}>
                      <Ionicons name="heart" size={11} color={Colors.terracotta} />
                      <Text style={styles.heartCount}>{u.heart_count}</Text>
                    </View>
                  )}
                </View>
              </Pressable>
            ))}
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
          {viewerIndex !== null && uploads[viewerIndex] && (
            <>
              {uploads[viewerIndex].content_type === 'video' ? (
                <View style={styles.viewerVideoFallback}>
                  <Ionicons name="videocam-outline" size={48} color={Colors.white} />
                  <Text style={styles.viewerVideoText}>Video playback coming soon</Text>
                </View>
              ) : (
                <Image
                  source={{ uri: uploads[viewerIndex].signed_display_url ?? '' }}
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
                <Text style={styles.viewerCredit}>
                  {uploads[viewerIndex].uploader_name
                    ? `by ${uploads[viewerIndex].uploader_name}${uploads[viewerIndex].user_id === myUserId ? ' (you)' : ''}`
                    : ''}
                </Text>
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
                    {viewerIndex + 1} / {uploads.length}
                  </Text>
                  <Pressable
                    onPress={() => setViewerIndex((i) => (i === null || i >= uploads.length - 1 ? i : i + 1))}
                    disabled={viewerIndex >= uploads.length - 1}
                    style={[styles.viewerNavBtn, viewerIndex >= uploads.length - 1 && styles.viewerNavBtnDisabled]}
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
    shadowColor: 'rgba(181,82,46,0.3)', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1, shadowRadius: 8,
  },
  addBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  viewerRoot: { flex: 1, backgroundColor: 'black', justifyContent: 'center' },
  viewerImage: { width: '100%', height: '100%' },
  viewerVideoFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  viewerVideoText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.white },
  viewerHeader: { position: 'absolute', top: 0, left: 0, right: 0 },
  viewerClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
  viewerFooter: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 16, paddingVertical: 12, gap: 8,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  viewerCredit: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.white },
  viewerNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  viewerNavBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  viewerNavBtnDisabled: { opacity: 0.3 },
  viewerCount: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.white },
});
