import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback } from 'react';
import { ActivityIndicator, Alert, Dimensions, FlatList, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { supabase } from '../../lib/supabase';
import { PolaroidCard, PolaroidStatus } from './PolaroidCard';
import { PolaroidEmptyIcon } from './PolaroidEmptyIcon';

// Same AsyncStorage key the upload-prompt modal uses to remember which prompt
// notifications the user has dismissed locally.
const PROMPT_DISMISSED_KEY = 'albumUploadPrompt.dismissedV1';

type DismissedPrompt = { event_id: string; title: string };

async function fetchDismissedPrompt(userId: string): Promise<DismissedPrompt | null> {
  const raw = await AsyncStorage.getItem(PROMPT_DISMISSED_KEY);
  if (!raw) return null;
  let ids: string[];
  try { ids = JSON.parse(raw) as string[]; } catch { return null; }
  if (ids.length === 0) return null;

  // For each dismissed notification id, find its event + title and check
  // whether the user has uploaded yet. Return the first one that's still
  // "open" (no uploads from this user).
  const { data: notifs } = await supabase
    .from('app_notifications')
    .select('id, event_id, title')
    .in('id', ids)
    .eq('type', 'album_upload_prompt');
  if (!notifs || notifs.length === 0) return null;

  const eventIds = notifs.map((n) => n.event_id).filter(Boolean) as string[];
  if (eventIds.length === 0) return null;

  // Find which of these events the user has already uploaded to.
  const { data: myAlbums } = await supabase
    .from('plan_albums').select('id, event_id').in('event_id', eventIds);
  const albumIdByEvent = new Map((myAlbums ?? []).map((a) => [a.event_id, a.id]));
  const albumIds = (myAlbums ?? []).map((a) => a.id);
  let uploadedEventIds = new Set<string>();
  if (albumIds.length > 0) {
    const { data: ups } = await supabase
      .from('album_uploads').select('plan_album_id')
      .in('plan_album_id', albumIds).eq('user_id', userId).is('deleted_at', null);
    const uploadedAlbumIds = new Set((ups ?? []).map((u) => u.plan_album_id));
    uploadedEventIds = new Set(
      Array.from(albumIdByEvent.entries())
        .filter(([, id]) => uploadedAlbumIds.has(id))
        .map(([eventId]) => eventId),
    );
  }

  const stillOpen = notifs.find((n) => n.event_id && !uploadedEventIds.has(n.event_id));
  if (!stillOpen) return null;
  return { event_id: stillOpen.event_id!, title: stillOpen.title ?? 'Plan' };
}

type AlbumRow = {
  id: string;
  event_id: string;
  status: PolaroidStatus;
  first_upload_at: string | null;
  prompt_sent_at: string | null;
  created_at: string;
  event_title: string;
  custom_name: string | null;   // caller's personal album name, if set
  event_start_time: string;
  cover_signed_url: string | null;
};

const SIGNED_URL_TTL_SEC = 3600;

// Fixed card width so a lone album reads as an intentional card, not a
// full-width stretched polaroid. Mirrors the in-album tile math: screen
// minus gridContent padding (12 each side) and PolaroidCard margin (8 each
// side, both columns), split across 2 columns.
const SCREEN_W = Dimensions.get('window').width;
const CARD_W = Math.floor((SCREEN_W - 24 - 32) / 2);

async function fetchAlbumsForUser(userId: string): Promise<AlbumRow[]> {
  // Step 1: events the user is currently joined to.
  const { data: memberRows, error: mErr } = await supabase
    .from('event_members')
    .select('event_id')
    .eq('user_id', userId)
    .eq('status', 'joined');
  if (mErr) throw mErr;
  const eventIds = (memberRows ?? []).map((r) => r.event_id);
  if (eventIds.length === 0) return [];

  // Step 2: plan_albums for those events (skip archived). RLS double-checks
  // membership.
  const { data: albums, error: aErr } = await supabase
    .from('plan_albums')
    .select('id, event_id, status, first_upload_at, prompt_sent_at, created_at')
    .in('event_id', eventIds)
    .is('archived_at', null)
    .order('created_at', { ascending: false });
  if (aErr) throw aErr;
  if (!albums || albums.length === 0) return [];

  // Step 3: hydrate event title + start_time + cover-image fallback.
  const { data: events, error: eErr } = await supabase
    .from('events')
    .select('id, title, start_time, image_url')
    .in('id', albums.map((a) => a.event_id));
  if (eErr) throw eErr;
  const eventById = new Map((events ?? []).map((e) => [e.id, e]));

  // Step 3b: caller's per-album personalisation (custom name + chosen cover).
  const albumIds = albums.map((a) => a.id);
  const { data: metaRows } = await supabase
    .from('album_user_metadata')
    .select('plan_album_id, custom_name, cover_upload_id')
    .eq('user_id', userId)
    .in('plan_album_id', albumIds);
  const customNameByAlbum = new Map<string, string | null>();
  const chosenCoverByAlbum = new Map<string, string>();
  for (const m of metaRows ?? []) {
    customNameByAlbum.set(m.plan_album_id, m.custom_name ?? null);
    if (m.cover_upload_id) chosenCoverByAlbum.set(m.plan_album_id, m.cover_upload_id);
  }

  // Step 4: for ready albums pick a cover storage path. Resolution order:
  // caller's chosen photo -> first photo by created_at. (events.image_url is
  // applied later as a final fallback; it is a plain URL, not a signed path.)
  const readyAlbumIds = albums.filter((a) => a.status === 'ready').map((a) => a.id);
  const coverByAlbumId = new Map<string, string>();
  if (readyAlbumIds.length > 0) {
    const { data: covers } = await supabase
      .from('album_uploads')
      .select('id, plan_album_id, display_url, media_url, created_at')
      .in('plan_album_id', readyAlbumIds)
      .is('deleted_at', null)
      .eq('content_type', 'photo')
      .order('created_at', { ascending: true });
    const firstByAlbum = new Map<string, string>();
    for (const c of covers ?? []) {
      const path = c.display_url || c.media_url;
      if (!path) continue;
      if (!firstByAlbum.has(c.plan_album_id)) firstByAlbum.set(c.plan_album_id, path);
      // If this upload is the caller's chosen cover, it wins.
      if (chosenCoverByAlbum.get(c.plan_album_id) === c.id) {
        coverByAlbumId.set(c.plan_album_id, path);
      }
    }
    for (const [albumId, path] of firstByAlbum) {
      if (!coverByAlbumId.has(albumId)) coverByAlbumId.set(albumId, path);
    }
  }

  // Step 5: sign cover URLs in one batched call per album. Best-effort —
  // if signing fails the card falls back to the plan image / placeholder.
  const signedByAlbum = new Map<string, string | null>();
  await Promise.all(
    Array.from(coverByAlbumId.entries()).map(async ([albumId, path]) => {
      const { data, error } = await supabase.storage
        .from('album-media')
        .createSignedUrl(path, SIGNED_URL_TTL_SEC);
      signedByAlbum.set(albumId, error ? null : (data?.signedUrl ?? null));
    }),
  );

  return albums.map((a) => {
    const ev = eventById.get(a.event_id);
    return {
      ...a,
      status: a.status as PolaroidStatus,
      event_title: ev?.title ?? 'Plan',
      custom_name: customNameByAlbum.get(a.id) ?? null,
      event_start_time: ev?.start_time ?? a.created_at,
      cover_signed_url: signedByAlbum.get(a.id) ?? ev?.image_url ?? null,
    };
  });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function readyInLabel(firstUploadAt: string | null): string | undefined {
  if (!firstUploadAt) return 'Collecting photos';
  const ms = new Date(firstUploadAt).getTime() + 24 * 60 * 60 * 1000 - Date.now();
  if (ms <= 0) return 'Ready now';
  const hours = Math.ceil(ms / (60 * 60 * 1000));
  return hours <= 1 ? 'Ready in 1h' : `Ready in ${hours}h`;
}

type Props = { userId: string };

export function AlbumsGrid({ userId }: Props) {
  const router = useRouter();

  const { data: albums, isLoading, error, refetch, isStale: albumsStale } = useQuery({
    queryKey: ['albumsGrid', userId],
    queryFn: () => fetchAlbumsForUser(userId),
    enabled: !!userId,
    staleTime: 60_000,
  });

  const { data: dismissedPrompt, refetch: refetchPrompt, isStale: promptStale } = useQuery({
    queryKey: ['albumsGrid.dismissedPrompt', userId],
    queryFn: () => fetchDismissedPrompt(userId),
    enabled: !!userId,
    staleTime: 60_000,
  });

  // Refresh when the user switches back to this tab after uploading — but
  // only if the data is actually stale. Unconditionally refetching both
  // queries on every focus bypassed staleTime and churned the grid on
  // every quick tab switch (2026-05-18 app-wide slowness incident). The
  // upload path invalidates these keys, so a real upload still refreshes.
  useFocusEffect(useCallback(() => {
    if (albumsStale) void refetch();
    if (promptStale) void refetchPrompt();
  }, [albumsStale, promptStale, refetch, refetchPrompt]));

  const handleAlbumPress = useCallback((eventId: string) => {
    router.push(`/album/${eventId}` as any);
  }, [router]);

  // Manual archive: only offered for albums that still have zero photos.
  const handleArchive = useCallback((eventId: string, title: string) => {
    Alert.alert(
      'Archive this album?',
      `No one added photos to ${title}. Archiving hides it from your albums.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          style: 'destructive',
          onPress: async () => {
            const { error: archiveErr } = await supabase.rpc('archive_empty_album', { p_event_id: eventId });
            if (archiveErr) {
              Alert.alert('Could not archive', 'Please try again.');
              return;
            }
            void refetch();
          },
        },
      ],
    );
  }, [refetch]);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.terracotta} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Couldn't load albums. Pull to retry.</Text>
      </View>
    );
  }

  if (!albums || albums.length === 0) {
    return (
      <View style={styles.empty}>
        <View style={styles.emptyIcon}>
          <PolaroidEmptyIcon size={96} />
        </View>
        <Text style={styles.emptyTitle}>Your albums will live here.</Text>
        <Text style={styles.emptySubtitle}>Go do something, then relive it here.</Text>
        <TouchableOpacity
          style={styles.emptyButton}
          onPress={() => router.push('/(tabs)/plans' as any)}
          activeOpacity={0.85}
        >
          <Text style={styles.emptyButtonText}>Browse plans</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {dismissedPrompt && (
        <Pressable
          onPress={() => router.push(`/album/upload/${dismissedPrompt.event_id}` as any)}
          style={styles.dismissedBanner}
        >
          <Ionicons name="camera-outline" size={16} color={Colors.terracotta} />
          <Text style={styles.dismissedBannerText} numberOfLines={2}>
            <Text style={styles.dismissedBannerTitle}>{dismissedPrompt.title}</Text>
            <Text> album is collecting photos. Add yours.</Text>
          </Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.terracotta} />
        </Pressable>
      )}
      {albums.length === 1 ? (
        <ScrollView contentContainerStyle={styles.singleContent}>
          <PolaroidCard
            index={0}
            cardWidth={CARD_W}
            title={albums[0].custom_name ?? albums[0].event_title}
            dateText={formatDate(albums[0].event_start_time)}
            coverUri={albums[0].cover_signed_url}
            status={albums[0].status}
            readyInLabel={albums[0].status === 'developing' ? readyInLabel(albums[0].first_upload_at) : undefined}
            onPress={() => handleAlbumPress(albums[0].event_id)}
            onLongPress={albums[0].first_upload_at == null
              ? () => handleArchive(albums[0].event_id, albums[0].custom_name ?? albums[0].event_title)
              : undefined}
          />
        </ScrollView>
      ) : (
        <FlatList
          data={albums}
          keyExtractor={(a) => a.id}
          numColumns={2}
          contentContainerStyle={styles.gridContent}
          columnWrapperStyle={styles.gridRow}
          renderItem={({ item, index }) => (
            <PolaroidCard
              index={index}
              cardWidth={CARD_W}
              title={item.custom_name ?? item.event_title}
              dateText={formatDate(item.event_start_time)}
              coverUri={item.cover_signed_url}
              status={item.status}
              readyInLabel={item.status === 'developing' ? readyInLabel(item.first_upload_at) : undefined}
              onPress={() => handleAlbumPress(item.event_id)}
              onLongPress={item.first_upload_at == null
                ? () => handleArchive(item.event_id, item.custom_name ?? item.event_title)
                : undefined}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  errorText: {
    fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.warmGray,
  },
  empty: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 32, paddingVertical: 64, gap: 12,
  },
  emptyIcon: { marginBottom: 12 },
  emptyTitle: {
    fontFamily: Fonts.displayBold, fontSize: FontSizes.displaySM,
    color: Colors.asphalt, textAlign: 'center',
  },
  emptySubtitle: {
    fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD,
    color: Colors.warmGray, textAlign: 'center',
  },
  emptyButton: {
    marginTop: 8, backgroundColor: Colors.terracotta,
    paddingVertical: 12, paddingHorizontal: 24, borderRadius: 999,
    shadowColor: Colors.terracotta, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3, shadowRadius: 8,
  },
  emptyButtonText: {
    color: Colors.white, fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD,
  },
  gridContent: {
    paddingHorizontal: 12, paddingVertical: 8, paddingBottom: 60,
  },
  singleContent: {
    alignItems: 'center', paddingTop: 24, paddingBottom: 60, paddingHorizontal: 12,
  },
  gridRow: { justifyContent: 'space-between' },
  dismissedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 16, marginTop: 8,
    paddingHorizontal: 14, paddingVertical: 12,
    backgroundColor: Colors.brandSoft, borderRadius: 12,
  },
  dismissedBannerText: { flex: 1, fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.asphalt },
  dismissedBannerTitle: { fontFamily: Fonts.sansBold },
});
