import React, { useEffect, useState } from 'react';
import {
  View, Text, Modal, Pressable, TextInput, ScrollView, ActivityIndicator,
  KeyboardAvoidingView, Platform, StyleSheet, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
  onCancel: () => void;
  onSend: (caption: string) => void;
}

const PREVIEW_HORIZONTAL_PADDING = 32;
const THUMB_STRIP_HEIGHT = 64;
const SEND_CIRCLE_SIZE = 44;

export default function PhotoPreviewModal({ visible, assets, sending, onCancel, onSend }: PhotoPreviewModalProps) {
  const { width } = useWindowDimensions();
  const [caption, setCaption] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (visible) { setCaption(''); setActiveIndex(0); }
  }, [visible]);

  const pageWidth = width;
  const count = assets.length;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable onPress={onCancel} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel">
            <Ionicons name="close" size={26} color={Colors.white} />
          </Pressable>
          <Text style={styles.count}>{count > 1 ? `${activeIndex + 1} of ${count}` : '1 photo'}</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setActiveIndex(Math.round(e.nativeEvent.contentOffset.x / pageWidth))}
          style={styles.pager}
        >
          {assets.map((a, i) => (
            <View key={`${a.uri}:${i}`} style={[styles.page, { width: pageWidth }]}>
              <Image source={{ uri: a.uri }} style={styles.photo} contentFit="contain" />
            </View>
          ))}
        </ScrollView>

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {count > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.strip} contentContainerStyle={styles.stripContent}>
              {assets.map((a, i) => (
                <View key={`thumb:${a.uri}:${i}`} style={[styles.thumb, i === activeIndex && styles.thumbActive]}>
                  <Image source={{ uri: a.uri }} style={styles.thumbImg} contentFit="cover" />
                </View>
              ))}
            </ScrollView>
          )}
          <View style={styles.footer}>
            <TextInput
              style={styles.caption}
              value={caption}
              onChangeText={setCaption}
              placeholder="Add a caption..."
              placeholderTextColor={Colors.warmGray}
              multiline
              maxLength={1000}
            />
            <Pressable
              onPress={() => onSend(caption)}
              disabled={sending}
              style={[styles.sendCircle, sending && styles.sendDisabled]}
              accessibilityRole="button"
              accessibilityLabel="Send photos"
            >
              {sending ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <Ionicons name="arrow-up" size={22} color={Colors.white} />
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.shadowBlack },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  count: { flex: 1, textAlign: 'center', fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  headerSpacer: { width: 26 },
  pager: { flex: 1 },
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
