import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, Modal, Pressable, TextInput, ScrollView, ActivityIndicator,
  KeyboardAvoidingView, Platform, StyleSheet, useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';

// Preview of the photos picked from the attachment panel before sending, with a
// shared caption. Each photo sends as its own message; the caption rides the
// first (parent handles upload + send). One caption per batch (WhatsApp-style).

interface PhotoPreviewModalProps {
  visible: boolean;
  assets: { uri: string }[];
  sending: boolean;
  captionSent?: boolean;
  captionLocked?: boolean;
  initialCaption?: string;
  errorMessage?: string | null;
  onCancel: () => void;
  onSend: (caption: string) => void;
}

const PREVIEW_HORIZONTAL_PADDING = 32;
const THUMB_STRIP_HEIGHT = 64;
const SEND_CIRCLE_SIZE = 44;

export default function PhotoPreviewModal({ visible, assets, sending, captionSent = false, captionLocked = false, initialCaption = '', errorMessage, onCancel, onSend }: PhotoPreviewModalProps) {
  const { width } = useWindowDimensions();
  const pager = useRef<ScrollView>(null);
  const [caption, setCaption] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [pagerHeight, setPagerHeight] = useState(0);

  useEffect(() => {
    if (visible) { setCaption(initialCaption); setActiveIndex(0); }
  }, [visible]);

  useEffect(() => {
    if (captionSent) setCaption('');
  }, [captionSent]);

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(assets.length - 1, 0)));
  }, [assets.length]);

  const pageWidth = width;
  const count = assets.length;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
      <SafeAreaProvider style={styles.container}>
      <SafeAreaView accessibilityViewIsModal style={styles.container} edges={['top', 'bottom']}>
        <PhotoPreviewHeader count={count} activeIndex={activeIndex} sending={sending} onCancel={onCancel} />

        <KeyboardAvoidingView style={styles.previewBody} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={pager}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setActiveIndex(Math.round(e.nativeEvent.contentOffset.x / pageWidth))}
          style={styles.pager}
          onLayout={event => setPagerHeight(event.nativeEvent.layout.height)}
        >
          {assets.map((a, i) => (
            <View key={`${a.uri}:${i}`} style={[styles.page, { width: pageWidth, height: pagerHeight }]}>
              <Image source={{ uri: a.uri }} style={styles.photo} contentFit="contain" />
            </View>
          ))}
        </ScrollView>

        <View style={styles.controls}>
          {count > 1 && (
            <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} style={styles.strip} contentContainerStyle={styles.stripContent}>
              {assets.map((a, i) => (
                <Pressable key={`thumb:${a.uri}:${i}`} style={[styles.thumb, i === activeIndex && styles.thumbActive]}
                  accessibilityRole="button" accessibilityLabel={`Preview photo ${i + 1} of ${count}`} accessibilityState={{ selected: i === activeIndex }}
                  onPress={() => { setActiveIndex(i); pager.current?.scrollTo({ x: i * pageWidth, animated: true }); }}>
                  <Image source={{ uri: a.uri }} style={styles.thumbImg} contentFit="cover" />
                </Pressable>
              ))}
            </ScrollView>
          )}
          {!!errorMessage && <Text style={styles.sendError} accessibilityRole="alert">{errorMessage}</Text>}
          <View style={styles.footer}>
            <TextInput
              style={styles.caption}
              value={captionSent ? '' : caption}
              onChangeText={setCaption}
              editable={!captionSent && !captionLocked && !sending}
              accessibilityLabel="Photo caption"
              placeholder={captionSent ? 'Caption sent' : 'Add a caption...'}
              placeholderTextColor={Colors.warmGray}
              multiline
              maxLength={1000}
            />
            <Pressable
              onPress={() => onSend(caption)}
              disabled={sending}
              style={[styles.sendCircle, sending && styles.sendDisabled]}
              accessibilityRole="button"
              accessibilityLabel={errorMessage ? "Retry photos" : "Send photos"}
            >
              {sending ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <Ionicons name="arrow-up" size={22} color={Colors.white} />
              )}
            </Pressable>
          </View>
        </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

// Caption updates do not change this subtree. Preserve the existing native
// header nodes while the caption input commits each character.
const PhotoPreviewHeader = React.memo(function PhotoPreviewHeader({ count, activeIndex, sending, onCancel }: {
  count: number; activeIndex: number; sending: boolean; onCancel: () => void;
}) {
  return (
        <View style={styles.header}>
          <Pressable onPress={onCancel} disabled={sending} style={styles.headerControl} accessibilityRole="button" accessibilityLabel="Cancel">
            <Ionicons name="close" size={26} color={Colors.white} />
          </Pressable>
          <Text style={styles.count}>{count > 1 ? `${activeIndex + 1} of ${count}` : '1 photo'}</Text>
          <View style={styles.headerSpacer} />
        </View>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.shadowBlack },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  count: { flex: 1, textAlign: 'center', fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  headerControl: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerSpacer: { width: 44 },
  previewBody: { flex: 1, minHeight: 0 },
  controls: { flexShrink: 0 },
  pager: { flex: 1, minHeight: 0 },
  page: { alignItems: 'center', justifyContent: 'center' },
  photo: { width: '100%', height: '100%' },
  strip: { maxHeight: THUMB_STRIP_HEIGHT },
  stripContent: { paddingHorizontal: 12, gap: 8, alignItems: 'center' },
  thumb: { width: 48, height: 48, borderRadius: 8, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
  thumbActive: { borderColor: Colors.terracotta },
  thumbImg: { width: '100%', height: '100%' },
  footer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sendError: { color: Colors.white, fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, paddingHorizontal: 16, paddingTop: 8 },
  caption: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    backgroundColor: Colors.cardBg,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  sendCircle: {
    width: SEND_CIRCLE_SIZE,
    height: SEND_CIRCLE_SIZE,
    borderRadius: SEND_CIRCLE_SIZE / 2,
    backgroundColor: Colors.terracotta,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.5 },
});
