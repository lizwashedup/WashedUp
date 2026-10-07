import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronRight, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { AfterglowColors as Colors } from '../../constants/Colors';
import { AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';
import { boundPhotoOffset, fitChatPhoto, type PhotoSize } from '../../lib/chatPhotoLayout';
import { useChatPhotoLoad } from '../../hooks/useChatPhotoLoad';

export type ChatPhoto = { id: string; uri: string; senderName?: string | null; caption?: string | null };

/** Only the caller's already-visible messages are eligible. No media fetch or new permission. */
export function useChatPhotoSelection(scope: string, photos: readonly ChatPhoto[]) {
  const visit = useMemo(() => ({}), [scope]);
  const committedVisit = useRef(visit);
  const [selection, setSelection] = useState<{ visit: object; id: string } | null>(null);
  useEffect(() => {
    committedVisit.current = visit;
    return () => { if (committedVisit.current === visit) committedVisit.current = {}; };
  }, [visit]);
  const selectedId = selection?.visit === visit && photos.some(photo => photo.id === selection.id) ? selection.id : null;
  useEffect(() => {
    if (selection && !selectedId) setSelection(null);
  }, [selection, selectedId]);
  const open = useCallback((id: string) => {
    if (committedVisit.current === visit) setSelection({ visit, id });
  }, [visit]);
  const close = useCallback(() => { if (committedVisit.current === visit) setSelection(null); }, [visit]);
  return { selectedId, onSelect: open, onClose: close };
}

type Props = {
  photos: readonly ChatPhoto[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  fonts: AfterglowFontFamilies;
};

export function ChatPhotoViewer({ photos, selectedId, onSelect, onClose, fonts }: Props) {
  const index = photos.findIndex(photo => photo.id === selectedId);
  const photo = index >= 0 ? photos[index] : null;
  const photoVisit = useMemo(() => ({}), [photo?.id, photo?.uri]);
  const navigation = useRef<{ visit: object; index: number; photos: readonly ChatPhoto[] } | null>(null);
  useLayoutEffect(() => {
    navigation.current = { visit: photoVisit, index, photos };
    return () => { if (navigation.current?.visit === photoVisit) navigation.current = null; };
  }, [photoVisit, index, photos]);
  const move = useCallback((step: number) => {
    const current = navigation.current;
    if (current?.visit !== photoVisit) return;
    const next = current.photos[current.index + step];
    if (next) onSelect(next.id);
  }, [photoVisit, onSelect]);
  if (!photo) return null;
  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaProvider style={styles.root}>
      <GestureHandlerRootView style={styles.root}>
        <SafeAreaView style={styles.root} accessibilityViewIsModal>
          <View style={styles.header}>
            <Pressable onPress={onClose} style={styles.action} accessibilityRole="button" accessibilityLabel="Close photo">
              <X size={23} color={Colors.paper} />
            </Pressable>
            <View style={styles.identity}>
              <Text numberOfLines={1} style={[styles.name, { fontFamily: fonts.semibold }]}>{photo.senderName || 'Photo'}</Text>
              {photos.length > 1 && <Text accessibilityLiveRegion="polite" style={[styles.count, { fontFamily: fonts.regular }]}>{index + 1} of {photos.length}</Text>}
            </View>
            <View style={styles.action} />
          </View>
          <ZoomablePhoto key={`${photo.id}:${photo.uri}`} photo={photo} fonts={fonts} onMove={move} />
          {!!photo.caption?.trim() && <ScrollView style={styles.captionScroll} contentContainerStyle={styles.captionBody}>
            <Text selectable style={[styles.caption, { fontFamily: fonts.regular }]}>{photo.caption}</Text>
          </ScrollView>}
          {photos.length > 1 && <View style={styles.navigation}>
            <Pressable onPress={() => move(-1)} disabled={index === 0} accessibilityState={{ disabled: index === 0 }} style={[styles.action, index === 0 && styles.disabled]} accessibilityRole="button" accessibilityLabel="Previous photo"><ChevronLeft size={24} color={Colors.paper} /></Pressable>
            <Text style={[styles.count, { fontFamily: fonts.regular }]}>Photos</Text>
            <Pressable onPress={() => move(1)} disabled={index === photos.length - 1} accessibilityState={{ disabled: index === photos.length - 1 }} style={[styles.action, index === photos.length - 1 && styles.disabled]} accessibilityRole="button" accessibilityLabel="Next photo"><ChevronRight size={24} color={Colors.paper} /></Pressable>
          </View>}
        </SafeAreaView>
      </GestureHandlerRootView>
      </SafeAreaProvider>
    </Modal>
  );
}

function ZoomablePhoto({ photo, fonts, onMove }: { photo: ChatPhoto; fonts: AfterglowFontFamilies; onMove: (step: number) => void }) {
  const [viewport, setViewport] = useState<PhotoSize>({ width: 1, height: 1 });
  const { size: natural, status, attempt, onLoad, onError, retry } = useChatPhotoLoad();
  const [zoomed, setZoomed] = useState(false);
  const image = fitChatPhoto(natural, viewport);
  const scale = useSharedValue(1), x = useSharedValue(0), y = useSharedValue(0);
  const startScale = useSharedValue(1), startX = useSharedValue(0), startY = useSharedValue(0);
  const focalX = useSharedValue(0), focalY = useSharedValue(0);
  useEffect(() => { scale.value = 1; x.value = 0; y.value = 0; }, [viewport.width, viewport.height, scale, x, y]);
  useAnimatedReaction(() => scale.value > 1.01, (value, previous) => { if (value !== previous) runOnJS(setZoomed)(value); });
  const reset = useCallback(() => { scale.value = withTiming(1); x.value = withTiming(0); y.value = withTiming(0); }, [scale, x, y]);
  const zoom = useCallback(() => { if (scale.value > 1.01) reset(); else scale.value = withTiming(2); }, [scale, reset]);
  const gesture = useMemo(() => {
    const pinch = Gesture.Pinch().withTestId('photo-pinch').enabled(status === 'loaded')
      .onStart(event => {
        startScale.value = scale.value; startX.value = x.value; startY.value = y.value;
        focalX.value = event.focalX - viewport.width / 2;
        focalY.value = event.focalY - viewport.height / 2;
      })
      .onUpdate(event => {
        const next = Math.max(1, Math.min(4, startScale.value * event.scale));
        const ratio = next / startScale.value;
        scale.value = next;
        x.value = boundPhotoOffset(event.focalX - viewport.width / 2 - (focalX.value - startX.value) * ratio, image.width, viewport.width, next);
        y.value = boundPhotoOffset(event.focalY - viewport.height / 2 - (focalY.value - startY.value) * ratio, image.height, viewport.height, next);
      });
    const pan = Gesture.Pan().withTestId('photo-pan').maxPointers(1).enabled(status === 'loaded')
      .onStart(() => { startX.value = x.value; startY.value = y.value; })
      .onUpdate(event => {
        if (scale.value <= 1.01) return;
        x.value = boundPhotoOffset(startX.value + event.translationX, image.width, viewport.width, scale.value);
        y.value = boundPhotoOffset(startY.value + event.translationY, image.height, viewport.height, scale.value);
      })
      .onEnd((event, success) => {
        if (success && scale.value <= 1.01 && Math.abs(event.translationX) > Math.max(50, viewport.width * 0.18)
          && Math.abs(event.translationX) > Math.abs(event.translationY) * 1.4) runOnJS(onMove)(event.translationX < 0 ? 1 : -1);
      });
    const doubleTap = Gesture.Tap().numberOfTaps(2).enabled(status === 'loaded').onEnd((_event, success) => { if (success) runOnJS(zoom)(); });
    return Gesture.Exclusive(doubleTap, Gesture.Simultaneous(pinch, pan));
  }, [status, viewport.width, viewport.height, image.width, image.height, onMove, zoom, scale, x, y, startScale, startX, startY, focalX, focalY]);
  const transformed = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }] }));
  return <View style={styles.photoArea}>
    <GestureDetector gesture={gesture}>
      <View style={styles.viewport} onLayout={event => {
        const { width, height } = event.nativeEvent.layout;
        if (width > 0 && height > 0) setViewport(old => old.width === width && old.height === height ? old : { width, height });
      }}>
        <Animated.View style={[{ width: image.width, height: image.height }, transformed]}>
          <Image key={attempt} source={{ uri: photo.uri }} contentFit="contain" cachePolicy="memory-disk"
            accessibilityLabel={`Photo${photo.senderName ? ` from ${photo.senderName}` : ''}`} accessible
            style={StyleSheet.absoluteFill} onLoad={onLoad} onError={onError} />
        </Animated.View>
      </View>
    </GestureDetector>
    {status === 'loading' && <View pointerEvents="none" style={styles.overlay}><ActivityIndicator color={Colors.paper} accessibilityLabel="Loading photo" /></View>}
    {status === 'error' && <View style={styles.overlay}>
      <Text style={[styles.caption, { fontFamily: fonts.medium }]}>This photo couldn’t load.</Text>
      <Pressable style={styles.retry} accessibilityRole="button" accessibilityLabel="Retry photo" onPress={() => { reset(); retry(); }}>
        <RotateCcw size={18} color={Colors.paper} /><Text style={[styles.caption, { fontFamily: fonts.medium }]}>Try again</Text>
      </Pressable>
    </View>}
    <View style={styles.zoomBar}>
      {status === 'loaded' && <Text style={[styles.count, { fontFamily: fonts.regular }]}>{zoomed ? 'Drag to explore' : 'Pinch or double-tap to zoom'}</Text>}
      <Pressable style={styles.action} accessibilityRole="button" accessibilityLabel={zoomed ? 'Reset photo zoom' : 'Zoom in on photo'} disabled={status !== 'loaded'} accessibilityState={{ disabled: status !== 'loaded' }} onPress={zoom}>
        {zoomed ? <ZoomOut size={22} color={Colors.paper} /> : <ZoomIn size={22} color={status === 'loaded' ? Colors.paper : Colors.muted} />}
      </Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.ink },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, minHeight: 60 },
  identity: { flex: 1, minWidth: 0, alignItems: 'center', gap: 2 },
  name: { ...AfterglowType.title, color: Colors.paper },
  count: { ...AfterglowType.caption, color: Colors.paper },
  action: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  photoArea: { flex: 1, minHeight: 88 },
  viewport: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 16 },
  zoomBar: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  retry: { minHeight: 44, paddingHorizontal: 16, flexDirection: 'row', gap: 8, alignItems: 'center', borderWidth: 1, borderColor: Colors.line, borderRadius: 6 },
  captionScroll: { maxHeight: 100, flexGrow: 0 },
  captionBody: { paddingHorizontal: 20, paddingVertical: 8 },
  caption: { ...AfterglowType.body, color: Colors.paper },
  navigation: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 8 },
  disabled: { opacity: 0.35 },
});
