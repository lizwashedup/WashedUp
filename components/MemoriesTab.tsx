import React, { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { Camera, Clock } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { hapticLight } from '../lib/haptics';
import { supabase } from '../lib/supabase';
import Colors from '../constants/Colors';
import { Fonts, FontSizes } from '../constants/Typography';

const SCREEN_WIDTH = Dimensions.get('window').width;
const PREVIEW_GAP = 2;
const PREVIEW_COLS = 3;
const PREVIEW_SIZE = (SCREEN_WIDTH - 40 - 16 - PREVIEW_GAP * (PREVIEW_COLS - 1)) / PREVIEW_COLS;

interface Props {
  userId: string;
}

interface AlbumSummary {
  eventId: string;
  title: string;
  startTime: string;
  photoCount: number;
  videoCount: number;
  contributorCount: number;
  contributors: { id: string; name: string | null; photo: string | null }[];
  previewUrls: string[];
  totalMedia: number;
  isDeveloping: boolean;
  developingCount: number;
  developingContributors: number;
  revealAt: string | null;
}

export default function MemoriesTab({ userId }: Props) {
  const router = useRouter();

  const { data: albums = [], isLoading } = useQuery({
    queryKey: ['memories-albums', userId],
    queryFn: async (): Promise<AlbumSummary[]> => {
      // Get events the user is a member of
      const { data: memberships } = await supabase
        .from('event_members')
        .select('event_id, events (id, title, start_time, status)')
        .eq('user_id', userId)
        .eq('status', 'joined');

      if (!memberships?.length) return [];

      // Filter to past events only
      const now = new Date();
      const pastEvents = memberships
        .map((m: any) => m.events)
        .filter((e: any) => e && new Date(e.start_time) < now && e.status !== 'cancelled');

      if (!pastEvents.length) return [];

      const eventIds = pastEvents.map((e: any) => e.id);

      // Check no-show status — exclude events where user was marked absent
      const { data: noShowRows } = await supabase
        .from('plan_attendance')
        .select('event_id')
        .in('event_id', eventIds)
        .eq('user_id', userId)
        .eq('was_present', false);

      const noShowEventIds = new Set((noShowRows ?? []).map((r: any) => r.event_id));
      const eligibleEvents = pastEvents.filter((e: any) => !noShowEventIds.has(e.id));

      if (!eligibleEvents.length) return [];

      const eligibleIds = eligibleEvents.map((e: any) => e.id);

      // Fetch all photos for eligible events
      const { data: photos } = await supabase
        .from('plan_photos')
        .select('id, event_id, storage_path, media_type, uploaded_by, is_developing, reveal_at')
        .in('event_id', eligibleIds)
        .order('created_at', { ascending: true });

      if (!photos?.length) return [];

      // Fetch uploader profiles
      const uploaderIds = Array.from(new Set(photos.map((p: any) => p.uploaded_by)));
      const { data: profiles } = await supabase
        .from('profiles_public')
        .select('id, first_name_display, profile_photo_url')
        .in('id', uploaderIds);

      const profileMap: Record<string, any> = {};
      (profiles ?? []).forEach((p: any) => { profileMap[p.id] = p; });

      // Group by event
      const eventMap = new Map(eligibleEvents.map((e: any) => [e.id, e]));
      const grouped: Record<string, any[]> = {};
      photos.forEach((p: any) => {
        if (!grouped[p.event_id]) grouped[p.event_id] = [];
        grouped[p.event_id].push(p);
      });

      const nowTime = now.getTime();

      return Object.entries(grouped)
        .map(([eventId, eventPhotos]) => {
          const event = eventMap.get(eventId);
          if (!event) return null;

          const revealed = eventPhotos.filter((p: any) => !p.reveal_at || new Date(p.reveal_at).getTime() <= nowTime);
          const developing = eventPhotos.filter((p: any) => p.reveal_at && new Date(p.reveal_at).getTime() > nowTime);
          const uploaders = Array.from(new Set(eventPhotos.map((p: any) => p.uploaded_by)));

          const previewUrls = revealed.slice(0, 6).map((p: any) => {
            const { data } = supabase.storage.from('plan-albums').getPublicUrl(p.storage_path);
            return data.publicUrl;
          });

          return {
            eventId,
            title: event.title,
            startTime: event.start_time,
            photoCount: eventPhotos.filter((p: any) => p.media_type === 'photo').length,
            videoCount: eventPhotos.filter((p: any) => p.media_type === 'video').length,
            contributorCount: uploaders.length,
            contributors: uploaders.map(uid => ({
              id: uid,
              name: profileMap[uid]?.first_name_display ?? null,
              photo: profileMap[uid]?.profile_photo_url ?? null,
            })),
            previewUrls,
            totalMedia: eventPhotos.length,
            isDeveloping: developing.length > 0,
            developingCount: developing.length,
            developingContributors: new Set(developing.map((p: any) => p.uploaded_by)).size,
            revealAt: developing.length > 0 ? developing[0].reveal_at : null,
          } as AlbumSummary;
        })
        .filter((a): a is AlbumSummary => !!a)
        .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    },
    enabled: !!userId,
  });

  const developingAlbums = useMemo(() => albums.filter(a => a.isDeveloping), [albums]);
  const allAlbums = albums;

  const totalPhotos = useMemo(() => albums.reduce((sum, a) => sum + a.photoCount + a.videoCount, 0), [albums]);
  const totalPeople = useMemo(() => {
    const ids = new Set<string>();
    albums.forEach(a => a.contributors.forEach(c => ids.add(c.id)));
    return ids.size;
  }, [albums]);

  const formatDate = useCallback((dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }, []);

  const formatRevealTime = useCallback((dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }, []);

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.terracotta} />
      </View>
    );
  }

  if (albums.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <View style={styles.emptyGlow} />
        <View style={styles.emptyIconWrap}>
          <Camera size={36} color={Colors.terracotta} />
        </View>
        <Text style={styles.emptyHeading}>nothing developing yet</Text>
        <Text style={styles.emptyBody}>
          photos from your plans will show up here. after a plan wraps, drop yours in and they'll develop by morning.
          {'\n\n'}
          only people who were actually there can see the album.
        </Text>
        <View style={styles.filmStrip}>
          <View style={styles.filmFrame} />
          <View style={styles.filmFrame} />
          <View style={styles.filmFrame} />
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {/* Developing cards */}
      {developingAlbums.map(album => (
        <TouchableOpacity
          key={`dev-${album.eventId}`}
          style={styles.developingCard}
          onPress={() => { hapticLight(); router.push(`/plan/${album.eventId}` as any); }}
          activeOpacity={0.85}
        >
          <View style={styles.developingHeader}>
            <Clock size={14} color={Colors.terracotta} />
            <Text style={styles.developingLabel}>Developing now</Text>
          </View>
          <Text style={styles.developingTitle}>{album.title}</Text>
          <Text style={styles.developingMeta}>
            {album.developingCount} {album.developingCount === 1 ? 'photo' : 'photos'} from {album.developingContributors} {album.developingContributors === 1 ? 'person' : 'people'}
          </Text>
          {/* Blurred preview */}
          {album.previewUrls.length > 0 && (
            <View style={styles.developingPreview}>
              {album.previewUrls.slice(0, 3).map((url, i) => (
                <Image key={i} source={{ uri: url }} style={styles.developingThumb} contentFit="cover" blurRadius={25} />
              ))}
            </View>
          )}
          {album.revealAt && (
            <Text style={styles.developingReveal}>
              Ready tomorrow
            </Text>
          )}
        </TouchableOpacity>
      ))}

      {/* Album cards */}
      {allAlbums.map(album => (
        <TouchableOpacity
          key={album.eventId}
          style={styles.albumCard}
          onPress={() => { hapticLight(); router.push(`/plan/${album.eventId}` as any); }}
          activeOpacity={0.85}
        >
          <View style={styles.albumCardHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.albumTitle}>{album.title}</Text>
              <Text style={styles.albumDate}>{formatDate(album.startTime)}</Text>
            </View>
            <Text style={styles.albumStats}>
              {album.photoCount + album.videoCount} {album.photoCount + album.videoCount === 1 ? 'photo' : 'photos'}
              {album.videoCount > 0 ? ` · ${album.videoCount} video${album.videoCount !== 1 ? 's' : ''}` : ''}
            </Text>
          </View>

          {/* Photo grid preview */}
          {album.previewUrls.length > 0 && (
            <View style={styles.previewGrid}>
              {album.previewUrls.slice(0, 6).map((url, i) => (
                <View key={i} style={styles.previewItem}>
                  <Image source={{ uri: url }} style={styles.previewImage} contentFit="cover" />
                </View>
              ))}
              {album.totalMedia > 6 && (
                <View style={[styles.previewItem, styles.previewMore]}>
                  <Text style={styles.previewMoreText}>+{album.totalMedia - 6}</Text>
                </View>
              )}
            </View>
          )}

          {/* Contributor avatars */}
          <View style={styles.albumFooter}>
            <View style={styles.avatarRow}>
              {album.contributors.slice(0, 5).map((c, i) => (
                c.photo ? (
                  <Image
                    key={c.id}
                    source={{ uri: c.photo }}
                    style={[styles.miniAvatar, i > 0 && styles.miniAvatarOverlap]}
                    contentFit="cover"
                  />
                ) : (
                  <View key={c.id} style={[styles.miniAvatar, styles.miniAvatarFallback, i > 0 && styles.miniAvatarOverlap]}>
                    <Text style={styles.miniAvatarInitial}>{(c.name ?? '?')[0].toUpperCase()}</Text>
                  </View>
                )
              ))}
            </View>
            <Text style={styles.contributorLabel}>
              {album.contributorCount} {album.contributorCount === 1 ? 'person' : 'people'} contributed
            </Text>
          </View>
        </TouchableOpacity>
      ))}

      {/* Summary card */}
      {albums.length > 0 && (
        <View style={styles.summaryCard}>
          <Text style={styles.summaryText}>
            You've made {totalPhotos} {totalPhotos === 1 ? 'memory' : 'memories'} across {albums.length} {albums.length === 1 ? 'plan' : 'plans'} with {totalPeople} {totalPeople === 1 ? 'person' : 'people'}.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { flex: 1, alignItems: 'center', paddingTop: 40, paddingHorizontal: 32 },
  emptyGlow: { position: 'absolute', top: 60, width: 280, height: 280, borderRadius: 140, backgroundColor: 'rgba(242,163,45,0.06)', alignSelf: 'center' },
  emptyIconWrap: { width: 68, height: 68, borderRadius: 34, backgroundColor: Colors.emptyIconBg, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  emptyHeading: { fontFamily: Fonts.display, fontSize: FontSizes.displaySM, color: Colors.asphalt, textAlign: 'center', marginTop: 16 },
  emptyBody: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.warmGray, textAlign: 'center', lineHeight: 20, marginTop: 10 },
  filmStrip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  filmFrame: { width: 52, height: 38, borderRadius: 6, backgroundColor: Colors.inputBg, marginHorizontal: 4 },

  // Developing card
  developingCard: {
    backgroundColor: `${Colors.terracotta}08`,
    borderWidth: 1,
    borderColor: `${Colors.terracotta}20`,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  developingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  developingLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  developingTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
    marginBottom: 4,
  },
  developingMeta: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.textMedium,
    marginBottom: 10,
  },
  developingPreview: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 10,
  },
  developingThumb: {
    width: 56,
    height: 56,
    borderRadius: 8,
  },
  developingReveal: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
  },

  // Album card
  albumCard: {
    backgroundColor: Colors.white,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    shadowColor: Colors.darkWarm,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  albumCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  albumTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  albumDate: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.textLight,
    marginTop: 2,
  },
  albumStats: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.textMedium,
  },
  previewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: PREVIEW_GAP,
    marginBottom: 12,
  },
  previewItem: {
    width: PREVIEW_SIZE,
    height: PREVIEW_SIZE,
    borderRadius: 6,
    overflow: 'hidden',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  previewMore: {
    backgroundColor: Colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewMoreText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.textMedium,
  },
  albumFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  avatarRow: {
    flexDirection: 'row',
  },
  miniAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: Colors.white,
  },
  miniAvatarOverlap: {
    marginLeft: -8,
  },
  miniAvatarFallback: {
    backgroundColor: Colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniAvatarInitial: {
    fontFamily: Fonts.sansBold,
    fontSize: 9,
    color: Colors.terracotta,
  },
  contributorLabel: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.textLight,
  },

  // Summary card
  summaryCard: {
    backgroundColor: `${Colors.terracotta}08`,
    borderRadius: 14,
    padding: 20,
    marginTop: 8,
    alignItems: 'center',
  },
  summaryText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
    textAlign: 'center',
    lineHeight: 22,
  },
});
