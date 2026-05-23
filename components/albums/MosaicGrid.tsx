import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Colors from '../../constants/Colors';
import { Fonts } from '../../constants/Typography';
import { MOSAIC } from '../../constants/YoursDesign';

// One photo as the mosaic needs it. width/height may be null (existing rows that
// predate the dimensions column, or photos whose EXIF couldn't be read) — the
// layout falls back to a square for those.
export type MosaicPhoto = {
  id: string;
  uri: string | null;            // signed thumbnail URL
  cacheKey: string;              // stable storage-identity key, survives URL rotation
  width: number | null;
  height: number | null;
  uploaderName: string | null;
  isOwn: boolean;
  isVideo: boolean;
  videoDurationSec?: number | null;
};

type TileLayout = MosaicPhoto & { index: number; w: number; h: number };
export type MosaicRowData = { key: string; height: number; tiles: TileLayout[] };

function clampAspect(width: number | null, height: number | null): number {
  const a = width && height && width > 0 && height > 0 ? width / height : MOSAIC.fallbackAspect;
  return Math.min(MOSAIC.maxAspect, Math.max(MOSAIC.minAspect, a));
}

// Google-Photos justified layout: greedily fill each row at the target height,
// then scale the row to fill the container width exactly. The last row keeps the
// target height and is left-aligned (never stretched). Dividing by the aspect
// SUM (never a single height) means a null/garbage dimension can't break a row.
export function buildMosaicRows(photos: MosaicPhoto[], containerWidth: number): MosaicRowData[] {
  const { targetRowHeight, gap } = MOSAIC;
  const rows: MosaicRowData[] = [];
  let cur: { photo: MosaicPhoto; aspect: number; index: number }[] = [];
  let aspectSum = 0;

  const flush = (isLast: boolean) => {
    if (cur.length === 0) return;
    const totalGap = gap * (cur.length - 1);
    const rowHeight = isLast ? targetRowHeight : (containerWidth - totalGap) / aspectSum;
    const tiles: TileLayout[] = cur.map(({ photo, aspect, index }) => ({
      ...photo, index, w: rowHeight * aspect, h: rowHeight,
    }));
    rows.push({ key: cur[0].photo.id, height: rowHeight, tiles });
    cur = [];
    aspectSum = 0;
  };

  photos.forEach((photo, index) => {
    const aspect = clampAspect(photo.width, photo.height);
    cur.push({ photo, aspect, index });
    aspectSum += aspect;
    if (targetRowHeight * aspectSum + gap * (cur.length - 1) >= containerWidth) flush(false);
  });
  flush(true);
  return rows;
}

function formatDuration(sec?: number | null): string {
  const s = Math.max(0, Math.round(sec ?? 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

type RowProps = {
  row: MosaicRowData;
  onPressPhoto: (index: number) => void;
  onLongPressPhoto: (index: number) => void;
  onPhotoError?: (index: number) => void;   // image load failed (e.g. expired URL) -> re-sign
  onPhotoMeasured?: (index: number, width: number, height: number) => void;  // real dims from onLoad
};

// One justified row of tiles. Per-tile width/height are computed, so they ride
// inline via the array form (style={[static, {dynamic}]}); everything else lives
// in StyleSheet.
export const MosaicRow = React.memo<RowProps>(({ row, onPressPhoto, onLongPressPhoto, onPhotoError, onPhotoMeasured }) => {
  return (
    <View style={styles.row}>
      {row.tiles.map((t) => (
        <Pressable
          key={t.id}
          style={[styles.tile, { width: t.w, height: t.h }]}
          onPress={() => onPressPhoto(t.index)}
          onLongPress={() => onLongPressPhoto(t.index)}
          delayLongPress={250}
        >
          {t.uri ? (
            <Image
              source={{ uri: t.uri, cacheKey: t.cacheKey }}
              onError={() => onPhotoError?.(t.index)}
              onLoad={(e) => onPhotoMeasured?.(t.index, e.source?.width ?? 0, e.source?.height ?? 0)}
              style={styles.image}
              contentFit="cover"
              transition={150}
            />
          ) : (
            <View style={[styles.image, styles.placeholder]} />
          )}
          {t.isVideo ? (
            <>
              <View style={styles.playOverlay}>
                <Ionicons name="play-circle" size={MOSAIC.playIconSize} color={Colors.white} />
              </View>
              <View style={styles.durationBadge}>
                <Text style={styles.durationText}>{formatDuration(t.videoDurationSec)}</Text>
              </View>
            </>
          ) : null}
          {!t.isOwn && t.uploaderName ? (
            <Text numberOfLines={1} style={styles.uploader}>{t.uploaderName}</Text>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
});

MosaicRow.displayName = 'MosaicRow';

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: MOSAIC.gap, marginBottom: MOSAIC.gap, marginHorizontal: MOSAIC.edgePadding },
  tile: { borderRadius: MOSAIC.tileRadius, overflow: 'hidden', backgroundColor: Colors.inputBg },
  image: { ...StyleSheet.absoluteFillObject },
  placeholder: { backgroundColor: Colors.inputBg },
  playOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  durationBadge: {
    position: 'absolute', bottom: 4, right: 4,
    backgroundColor: Colors.overlayDark55, borderRadius: 4,
    paddingHorizontal: 5, paddingVertical: 1,
  },
  durationText: { fontFamily: Fonts.sansMedium, fontSize: MOSAIC.overlayFontSize, color: Colors.white },
  uploader: {
    position: 'absolute', bottom: 4, left: 5, maxWidth: '90%',
    fontFamily: Fonts.sansMedium, fontSize: MOSAIC.overlayFontSize,
    color: Colors.white, opacity: 0.85,
    textShadowColor: Colors.shadowBlack, textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
  },
});
