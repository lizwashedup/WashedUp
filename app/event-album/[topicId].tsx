/**
 * SC-09/C-24: the album view for an event-chat room's photos. Reachable
 * from the room's header (community-topic/[id].tsx). Deliberately smaller
 * than the Plans album (app/album/[eventId].tsx): no hearts, no cover/name/
 * note personalization, no mute -- see lib/topicAlbum.ts's header for why.
 * Self-flipping: if the migration behind this hasn't applied yet, the
 * screen says so plainly instead of a raw error (never a crash either way).
 */

import React, { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  FlatList, Dimensions, Modal, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { ArrowLeft, Camera, CirclePlay, X } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { friendlyError } from '../../lib/friendlyError';
import { hapticLight, hapticSuccess } from '../../lib/haptics';
import { supabase } from '../../lib/supabase';
import {
  getTopicAlbum,
  uploadTopicAlbumMedia,
  softDeleteTopicAlbumUpload,
  type TopicAlbumUpload,
} from '../../lib/topicAlbum';

const { width: SCREEN_W } = Dimensions.get('window');
const GRID_COLS = 3;
const GRID_GAP = 3;
const GRID_PADDING = 12;
const TILE_SIZE = (SCREEN_W - GRID_PADDING * 2 - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS;
const MAX_PHOTOS_PER_ADD = 10;

export default function EventAlbumScreen() {
  const router = useRouter();
  const { topicId } = useLocalSearchParams<{ topicId: string }>();
  const [myId, setMyId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);

  React.useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMyId(data.user?.id ?? null)).catch(() => {});
  }, []);

  const albumKey = ['topic-album', topicId];
  const { data: album, isLoading, refetch, isRefetching } = useQuery({
    queryKey: albumKey,
    queryFn: () => getTopicAlbum(topicId!),
    enabled: !!topicId,
  });

  const handleAddPhotos = async () => {
    if (!topicId || uploading) return;
    hapticLight();
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setAlertInfo({ title: 'Photo access needed', message: 'Turn on photo access in Settings to add pictures here.' });
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: MAX_PHOTOS_PER_ADD,
      quality: 1,
    });
    if (res.canceled || res.assets.length === 0) return;
    setUploading(true);
    try {
      await uploadTopicAlbumMedia(
        topicId,
        res.assets.map((a) => ({
          localUri: a.uri,
          contentType: 'photo',
          mediaFormat: (a.fileName?.split('.').pop() || 'jpg').toLowerCase(),
        })),
      );
      hapticSuccess();
      await refetch();
    } catch (e) {
      setAlertInfo({ title: 'That did not upload', message: friendlyError(e, 'Try again in a moment.') });
    } finally {
      setUploading(false);
    }
  };

  const confirmDelete = (upload: TopicAlbumUpload) => {
    hapticLight();
    setAlertInfo({
      title: 'Delete this photo?',
      message: 'It disappears from the room for everyone.',
      buttons: [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await softDeleteTopicAlbumUpload(upload.id);
              await refetch();
            } catch (e) {
              setAlertInfo({ title: 'That did not delete', message: friendlyError(e, 'Try again in a moment.') });
            }
          },
        },
      ],
    });
  };

  const uploads = album?.uploads ?? [];
  const viewerUpload = uploads.find((u) => u.id === viewerId) ?? null;

  const renderTile = useCallback(({ item }: { item: TopicAlbumUpload }) => {
    const isOwn = item.userId === myId;
    return (
      <Pressable
        style={styles.tile}
        onPress={() => setViewerId(item.id)}
        onLongPress={() => { if (isOwn) confirmDelete(item); }}
        delayLongPress={280}
        accessibilityRole="imagebutton"
        accessibilityLabel={item.uploaderName ? `Photo by ${item.uploaderName}${isOwn ? ', yours' : ''}` : 'Photo'}
        accessibilityHint={isOwn ? 'double tap to view, hold to delete' : 'double tap to view'}
      >
        {item.signedThumbUrl ? (
          <Image source={{ uri: item.signedThumbUrl }} style={styles.tileImage} contentFit="cover" transition={150} />
        ) : (
          <View style={[styles.tileImage, styles.tilePlaceholder]}>
            {item.contentType === 'video' && <CirclePlay size={22} color={Colors.terracotta} strokeWidth={2} />}
          </View>
        )}
      </Pressable>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>photos</Text>
        <View style={{ width: 22 }} />
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.terracotta} />
        </View>
      ) : !album?.available ? (
        <View style={styles.centered}>
          {/* self-flipping: the migration behind this hasn't landed yet */}
          <Text style={styles.emptyTitle}>photos aren&apos;t live here yet</Text>
          <Text style={styles.emptyBody}>check back soon.</Text>
        </View>
      ) : (
        <FlatList
          data={uploads}
          numColumns={GRID_COLS}
          keyExtractor={(u) => u.id}
          renderItem={renderTile}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={uploads.length > 0 ? { gap: GRID_GAP } : undefined}
          onRefresh={refetch}
          refreshing={isRefetching}
          ListEmptyComponent={
            <View style={styles.emptyGrid}>
              <Text style={styles.emptyTitle}>no photos yet -- be the first.</Text>
              <Text style={styles.emptyBody}>whoever's here can add what they took.</Text>
            </View>
          }
          ListFooterComponent={
            <TouchableOpacity
              style={[styles.addBtn, uploading && styles.addBtnBusy]}
              onPress={handleAddPhotos}
              disabled={uploading}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Add photos"
              accessibilityState={{ disabled: uploading, busy: uploading }}
            >
              {uploading ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <>
                  <Camera size={18} color={Colors.white} strokeWidth={2.5} />
                  <Text style={styles.addBtnText}>add photos</Text>
                </>
              )}
            </TouchableOpacity>
          }
        />
      )}

      <Modal visible={!!viewerUpload} transparent animationType="fade" onRequestClose={() => setViewerId(null)}>
        <View style={styles.viewerRoot}>
          {viewerUpload && (
            <>
              {viewerUpload.contentType === 'video' || !viewerUpload.signedDisplayUrl ? (
                <View style={styles.viewerVideoFallback}>
                  <CirclePlay size={44} color={Colors.white} strokeWidth={1.5} />
                  <Text style={styles.viewerVideoText}>video playback coming soon</Text>
                </View>
              ) : (
                <Image
                  source={{ uri: viewerUpload.signedDisplayUrl }}
                  style={styles.viewerImage}
                  contentFit="contain"
                  transition={150}
                />
              )}
              <SafeAreaView edges={['top']} style={styles.viewerHeader}>
                <Pressable
                  onPress={() => setViewerId(null)}
                  hitSlop={12}
                  style={styles.viewerClose}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                >
                  <X size={26} color={Colors.white} strokeWidth={2.5} />
                </Pressable>
              </SafeAreaView>
              {!!viewerUpload.uploaderName && (
                <SafeAreaView edges={['bottom']} style={styles.viewerFooter}>
                  <Text style={styles.viewerCredit}>
                    by {viewerUpload.uploaderName}{viewerUpload.userId === myId ? ' (you)' : ''}
                  </Text>
                </SafeAreaView>
              )}
            </>
          )}
        </View>
      </Modal>

      <BrandedAlert
        visible={!!alertInfo}
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message}
        buttons={alertInfo?.buttons}
        onClose={() => setAlertInfo(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 4 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerTitle: { flex: 1, fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.darkWarm, textAlign: 'center' },
  grid: { padding: GRID_PADDING, flexGrow: 1 },
  tile: { width: TILE_SIZE, height: TILE_SIZE, marginBottom: GRID_GAP },
  tileImage: { width: '100%', height: '100%', borderRadius: 4, backgroundColor: Colors.inputBg },
  tilePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  emptyGrid: { paddingVertical: 48, alignItems: 'center', gap: 6 },
  emptyTitle: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyLG, color: Colors.darkWarm, textAlign: 'center' },
  emptyBody: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.secondary, textAlign: 'center' },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    alignSelf: 'center',
    backgroundColor: Colors.terracotta,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 999,
    marginTop: 20,
  },
  addBtnBusy: { opacity: 0.6 },
  addBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  viewerRoot: { flex: 1, backgroundColor: Colors.shadowBlack, justifyContent: 'center' },
  viewerImage: { width: '100%', height: '100%' },
  viewerVideoFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  viewerVideoText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.white },
  viewerHeader: { position: 'absolute', top: 0, left: 0, right: 0 },
  viewerClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
  viewerFooter: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 16, paddingVertical: 12 },
  viewerCredit: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.white },
});
