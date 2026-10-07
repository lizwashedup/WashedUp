/**
 * CircleLivingMosaic - the "living cover" tile for a circle with no manual
 * cover: its newest shared plan-album photos (already signed) in a tight
 * mosaic inside the same square slot the monogram/cover occupies.
 *
 * Identity ladder (circles design direction): manual cover > this living
 * mosaic > the serif monogram tile. Layout adapts to what exists: 1 photo
 * fills the tile; 2 split as vertical halves; 3 lead with a tall left half;
 * 4 sit as a 2x2 grid. Purely presentational; no fetching here.
 */
import React, { useLayoutEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import Colors from '../../../constants/Colors';

const GAP = 2; // Hairline seam between tiles, reads as one woven cover

function Tile({ uri, onError }: { uri: string; onError?: (uri: string) => void }) {
  return (
    <Image
      source={{ uri }}
      style={styles.tile}
      contentFit="cover"
      cachePolicy="memory-disk"
      onError={onError ? () => onError(uri) : undefined}
    />
  );
}

type MosaicProps = {
  uris: string[];
  size: number;
  radius: number;
  /** Optional staged fallback; legacy callers keep their existing rendering. */
  fallback?: React.ReactNode;
};
export default function CircleLivingMosaic(props: MosaicProps) {
  return props.fallback === undefined ? <MosaicLayout {...props}/> :
    <ResilientMosaic key={JSON.stringify(props.uris.slice(0, 4))} {...props}/>;
}
function ResilientMosaic({ fallback, ...props }: MosaicProps) {
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const live = useRef(true);
  useLayoutEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const shown = props.uris.slice(0, 4).filter(uri => !failed.has(uri));
  if (shown.length === 0) return <>{fallback}</>;
  return <MosaicLayout {...props} uris={shown} onError={uri => {
    if (live.current) setFailed(previous => new Set(previous).add(uri));
  }}/>;
}
function MosaicLayout({ uris, size, radius, onError }: MosaicProps & { onError?: (uri: string) => void }) {
  const shown = uris.slice(0, 4);
  const frame = { width: size, height: size, borderRadius: radius };

  if (shown.length === 0) return null;

  if (shown.length === 1) {
    return (
      <View style={[styles.frame, frame]}>
        <Tile uri={shown[0]} onError={onError}/>
      </View>
    );
  }

  if (shown.length === 2) {
    return (
      <View style={[styles.frame, styles.row, frame]}>
        <View style={styles.col}><Tile uri={shown[0]} onError={onError}/></View>
        <View style={styles.col}><Tile uri={shown[1]} onError={onError}/></View>
      </View>
    );
  }

  if (shown.length === 3) {
    return (
      <View style={[styles.frame, styles.row, frame]}>
        <View style={styles.col}><Tile uri={shown[0]} onError={onError}/></View>
        <View style={styles.col}>
          <Tile uri={shown[1]} onError={onError}/>
          <Tile uri={shown[2]} onError={onError}/>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.frame, styles.row, frame]}>
      <View style={styles.col}>
        <Tile uri={shown[0]} onError={onError}/>
        <Tile uri={shown[1]} onError={onError}/>
      </View>
      <View style={styles.col}>
        <Tile uri={shown[2]} onError={onError}/>
        <Tile uri={shown[3]} onError={onError}/>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    backgroundColor: Colors.dividerWarm,
  },
  row: { flexDirection: 'row', gap: GAP },
  col: { flex: 1, gap: GAP },
  tile: { flex: 1, width: '100%' },
});
