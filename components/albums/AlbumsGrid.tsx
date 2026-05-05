import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { supabase } from '../../lib/supabase';
import { PolaroidCard, PolaroidStatus } from './PolaroidCard';

type AlbumRow = {
  id: string;
  event_id: string;
  status: PolaroidStatus;
  first_upload_at: string | null;
  prompt_sent_at: string | null;
  created_at: string;
  event_title: string;
  event_start_time: string;
  cover_signed_url: string | null;
};

const SIGNED_URL_TTL_SEC = 3600;

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

  // Step 2: plan_albums for those events. RLS double-checks membership.
  const { data: albums, error: aErr } = await supabase
    .from('plan_albums')
    .select('id, event_id, status, first_upload_at, prompt_sent_at, created_at')
    .in('event_id', eventIds)
    .order('created_at', { ascending: false });
  if (aErr) throw aErr;
  if (!albums || albums.length === 0) return [];

  // Step 3: hydrate event title + start_time for each album.
  const { data: events, error: eErr } = await supabase
    .from('events')
    .select('id, title, start_time')
    .in('id', albums.map((a) => a.event_id));
  if (eErr) throw eErr;
  const eventById = new Map((events ?? []).map((e) => [e.id, e]));

  // Step 4: for ready albums, find a single cover upload (first by created_at)
  // visible to this viewer. RLS filters automatically.
  const readyAlbumIds = albums.filter((a) => a.status === 'ready').map((a) => a.id);
  const coverByAlbumId = new Map<string, string>();
  if (readyAlbumIds.length > 0) {
    const { data: covers } = await supabase
      .from('album_uploads')
      .select('plan_album_id, display_url, media_url, created_at')
      .in('plan_album_id', readyAlbumIds)
      .is('deleted_at', null)
      .eq('content_type', 'photo')
      .order('created_at', { ascending: true });
    // De-dupe to first upload per album.
    for (const c of covers ?? []) {
      if (!coverByAlbumId.has(c.plan_album_id)) {
        const path = c.display_url || c.media_url;
        if (path) coverByAlbumId.set(c.plan_album_id, path);
      }
    }
  }

  // Step 5: sign cover URLs in one batched call per album. Best-effort —
  // if signing fails the card just shows the developing/placeholder state.
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
      event_start_time: ev?.start_time ?? a.created_at,
      cover_signed_url: signedByAlbum.get(a.id) ?? null,
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

  const { data: albums, isLoading, error, refetch } = useQuery({
    queryKey: ['albumsGrid', userId],
    queryFn: () => fetchAlbumsForUser(userId),
    enabled: !!userId,
    staleTime: 60_000,
  });

  // Refresh when the user switches back to this tab after uploading.
  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));

  const handleAlbumPress = useCallback((eventId: string) => {
    router.push(`/album/${eventId}` as any);
  }, [router]);

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
        <Text style={styles.emptyTitle}>Nothing here yet.</Text>
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
    <FlatList
      data={albums}
      keyExtractor={(a) => a.id}
      numColumns={2}
      contentContainerStyle={styles.gridContent}
      columnWrapperStyle={styles.gridRow}
      renderItem={({ item, index }) => (
        <PolaroidCard
          index={index}
          title={item.event_title}
          dateText={formatDate(item.event_start_time)}
          coverUri={item.cover_signed_url}
          status={item.status}
          readyInLabel={item.status === 'developing' ? readyInLabel(item.first_upload_at) : undefined}
          onPress={() => handleAlbumPress(item.event_id)}
        />
      )}
    />
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
  gridRow: { justifyContent: 'space-between' },
});
