import React, { useCallback, useMemo, useState } from 'react';
import {
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { Camera, X } from 'lucide-react-native';
import { hapticLight } from '../lib/haptics';
import { supabase } from '../lib/supabase';
import Colors from '../constants/Colors';
import { Fonts, FontSizes } from '../constants/Typography';

const SCREEN_WIDTH = Dimensions.get('window').width;
const GRID_GAP = 2;
const GRID_COLS = 3;
const THUMB_SIZE = (SCREEN_WIDTH - 40 - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS;

interface PlanPhoto {
  id: string;
  storage_path: string;
  media_type: 'photo' | 'video';
  uploaded_by: string;
  is_developing: boolean;
  reveal_at: string | null;
  created_at: string;
  uploader_name: string | null;
}

interface Props {
  eventId: string;
  currentUserId: string;
  isPast: boolean;
  onAddPhotos: () => void;
}

export default function PlanAlbum({ eventId, currentUserId, isPast, onAddPhotos }: Props) {
  const [fullscreenPhoto, setFullscreenPhoto] = useState<PlanPhoto | null>(null);

  // Check if user is marked as no-show
  const { data: isNoShow = false } = useQuery({
    queryKey: ['plan-attendance-noshow', eventId, currentUserId],
    queryFn: async () => {
      const { data } = await supabase
        .from('plan_attendance')
        .select('id')
        .eq('event_id', eventId)
        .eq('user_id', currentUserId)
        .eq('was_present', false)
        .limit(1);
      return (data ?? []).length > 0;
    },
    enabled: isPast,
  });

  // Fetch photos
  const { data: photos = [] } = useQuery({
    queryKey: ['plan-photos', eventId],
    queryFn: async (): Promise<PlanPhoto[]> => {
      const { data: rows, error } = await supabase
        .from('plan_photos')
        .select('id, storage_path, media_type, uploaded_by, is_developing, reveal_at, created_at')
        .eq('event_id', eventId)
        .order('created_at', { ascending: true });

      if (error || !rows?.length) return [];

      // Fetch uploader names
      const uploaderIds = [...new Set(rows.map((r: any) => r.uploaded_by))];
      const { data: profiles } = await supabase
        .from('profiles_public')
        .select('id, first_name_display')
        .in('id', uploaderIds);

      const nameMap: Record<string, string> = {};
      (profiles ?? []).forEach((p: any) => {
        nameMap[p.id] = p.first_name_display ?? null;
      });

      return rows.map((r: any) => ({
        ...r,
        uploader_name: nameMap[r.uploaded_by] ?? null,
      }));
    },
    enabled: isPast && !isNoShow,
  });

  const revealedPhotos = useMemo(() => {
    const now = Date.now();
    return photos.filter(p => !p.reveal_at || new Date(p.reveal_at).getTime() <= now);
  }, [photos]);

  const developingPhotos = useMemo(() => {
    const now = Date.now();
    return photos.filter(p => p.reveal_at && new Date(p.reveal_at).getTime() > now);
  }, [photos]);

  const photoCount = photos.filter(p => p.media_type === 'photo').length;
  const videoCount = photos.filter(p => p.media_type === 'video').length;
  const contributorCount = new Set(photos.map(p => p.uploaded_by)).size;
  const userHasUploaded = photos.some(p => p.uploaded_by === currentUserId);

  const getPublicUrl = useCallback((storagePath: string) => {
    const { data } = supabase.storage.from('plan-albums').getPublicUrl(storagePath);
    return data.publicUrl;
  }, []);

  const openFullscreen = useCallback((photo: PlanPhoto) => {
    hapticLight();
    setFullscreenPhoto(photo);
  }, []);

  // Don't render anything if not a past plan
  if (!isPast) return null;

  // No-show: show nothing
  if (isNoShow) return null;

  // No photos yet
  if (photos.length === 0) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>ALBUM</Text>
        <View style={styles.emptyState}>
          <Camera size={32} color={Colors.terracotta} />
          <Text style={styles.emptyText}>No photos yet — be the first to add yours</Text>
          <TouchableOpacity style={styles.addBtn} onPress={onAddPhotos} activeOpacity={0.85}>
            <Camera size={16} color={Colors.white} />
            <Text style={styles.addBtnText}>Add your photos</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>ALBUM</Text>

      {/* Stats line */}
      <Text style={styles.statsLine}>
        {photoCount > 0 && `${photoCount} photo${photoCount !== 1 ? 's' : ''}`}
        {photoCount > 0 && videoCount > 0 && ' · '}
        {videoCount > 0 && `${videoCount} video${videoCount !== 1 ? 's' : ''}`}
        {contributorCount > 0 && ` · ${contributorCount} ${contributorCount === 1 ? 'person' : 'people'} contributed`}
      </Text>

      {/* Developing photos */}
      {developingPhotos.length > 0 && (
        <View style={styles.developingBanner}>
          <Text style={styles.developingText}>
            📸 {developingPhotos.length} {developingPhotos.length === 1 ? 'photo' : 'photos'} developing. Ready tomorrow.
          </Text>
        </View>
      )}

      {/* Revealed photo grid */}
      {revealedPhotos.length > 0 && (
        <View style={styles.grid}>
          {revealedPhotos.map((photo) => (
            <TouchableOpacity
              key={photo.id}
              style={styles.gridItem}
              onPress={() => openFullscreen(photo)}
              activeOpacity={0.85}
            >
              <Image
                source={{ uri: getPublicUrl(photo.storage_path) }}
                style={styles.gridImage}
                contentFit="cover"
              />
              {photo.uploader_name && (
                <View style={styles.uploaderLabel}>
                  <Text style={styles.uploaderText} numberOfLines={1}>
                    {photo.uploader_name.split(' ')[0]}
                  </Text>
                </View>
              )}
              {photo.media_type === 'video' && (
                <View style={styles.videoBadge}>
                  <Text style={styles.videoBadgeText}>▶</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Developing photo grid (blurred) */}
      {developingPhotos.length > 0 && (
        <View style={styles.grid}>
          {developingPhotos.map((photo) => (
            <View key={photo.id} style={styles.gridItem}>
              <Image
                source={{ uri: getPublicUrl(photo.storage_path) }}
                style={styles.gridImage}
                contentFit="cover"
                blurRadius={30}
              />
              <View style={styles.developingOverlay} />
            </View>
          ))}
        </View>
      )}

      {/* Add your photos CTA */}
      {!userHasUploaded && (
        <TouchableOpacity style={styles.addPhotosRow} onPress={onAddPhotos} activeOpacity={0.8}>
          <Camera size={16} color={Colors.terracotta} />
          <Text style={styles.addPhotosText}>Add your photos</Text>
        </TouchableOpacity>
      )}

      {/* Fullscreen viewer */}
      <Modal visible={!!fullscreenPhoto} transparent animationType="fade" onRequestClose={() => setFullscreenPhoto(null)} statusBarTranslucent>
        <Pressable style={styles.fullscreenOverlay} onPress={() => setFullscreenPhoto(null)}>
          <TouchableOpacity
            style={styles.fullscreenClose}
            onPress={() => setFullscreenPhoto(null)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <X size={24} color={Colors.white} />
          </TouchableOpacity>
          {fullscreenPhoto && (
            <>
              <Image
                source={{ uri: getPublicUrl(fullscreenPhoto.storage_path) }}
                style={styles.fullscreenImage}
                contentFit="contain"
              />
              {fullscreenPhoto.uploader_name && (
                <Text style={styles.fullscreenName}>
                  {fullscreenPhoto.uploader_name.split(' ')[0]}
                </Text>
              )}
            </>
          )}
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 24,
    paddingHorizontal: 20,
  },
  sectionTitle: {
    fontSize: FontSizes.caption,
    fontWeight: '600',
    color: Colors.terracotta,
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  statsLine: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.textMedium,
    marginBottom: 12,
  },
  developingBanner: {
    backgroundColor: `${Colors.terracotta}0A`,
    borderWidth: 1,
    borderColor: `${Colors.terracotta}20`,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  developingText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
    textAlign: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
    marginBottom: 8,
  },
  gridItem: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
  },
  gridImage: {
    width: '100%',
    height: '100%',
  },
  uploaderLabel: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  uploaderText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 10,
    color: Colors.white,
  },
  videoBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoBadgeText: {
    color: Colors.white,
    fontSize: 10,
  },
  developingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(44,24,16,0.45)',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 10,
  },
  emptyText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.textMedium,
    textAlign: 'center',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.terracotta,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 12,
    marginTop: 4,
  },
  addBtnText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.white,
  },
  addPhotosRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    borderRadius: 12,
    marginTop: 4,
  },
  addPhotosText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.terracotta,
  },
  fullscreenOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenClose: {
    position: 'absolute',
    top: 60,
    right: 20,
    zIndex: 10,
    padding: 8,
  },
  fullscreenImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_WIDTH * 1.2,
  },
  fullscreenName: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.white,
    marginTop: 16,
    opacity: 0.8,
  },
});
