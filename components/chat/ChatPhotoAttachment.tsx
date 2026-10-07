import React, { memo, useCallback } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { ChatSizedText } from './ChatSizedText';
import { Image } from 'expo-image';
import { Expand, RotateCcw } from 'lucide-react-native';
import { AfterglowColors as Colors } from '../../constants/Colors';
import { AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';
import { fitChatPhoto, type PhotoSize } from '../../lib/chatPhotoLayout';
import { useChatPhotoLoad } from '../../hooks/useChatPhotoLoad';

// Dimensions only; bound the cache so a long scrollback does not grow it forever.
const dimensions = new Map<string, PhotoSize>();
const rememberSize = (uri: string, size: PhotoSize) => {
  if (dimensions.size >= 200 && !dimensions.has(uri)) dimensions.delete(dimensions.keys().next().value!);
  dimensions.set(uri, size);
};

type Props = {
  uri: string;
  senderName?: string | null;
  maxWidth: number;
  fonts: AfterglowFontFamilies;
  onOpen: () => void;
  onLongPress: () => void;
};

export const ChatPhotoAttachment = memo(function ChatPhotoAttachment(props: Props) {
  // A reused row must never inherit another photo's size, error or late load.
  return <PhotoAttachmentSource key={props.uri} {...props} />;
});

function PhotoAttachmentSource({ uri, senderName, maxWidth, fonts, onOpen, onLongPress }: Props) {
  const remember = useCallback((size: PhotoSize) => rememberSize(uri, size), [uri]);
  const { size, status, attempt, onLoad, onError, retry } = useChatPhotoLoad(dimensions.get(uri) ?? null, remember);
  const fitted = fitChatPhoto(status === 'error' ? null : size, { width: Math.max(44, maxWidth), height: 320 });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={status === 'error' ? 'Retry loading photo' : `Open photo${senderName ? ` from ${senderName}` : ''}`}
      accessibilityHint="View the whole photo and zoom in. Hold for message actions."
      accessibilityActions={[{ name: 'messageActions', label: 'Message actions and reactions' }]}
      onAccessibilityAction={({ nativeEvent }) => {
        if (nativeEvent.actionName === 'messageActions') onLongPress();
      }}
      onPress={status === 'error' ? retry : onOpen}
      onLongPress={onLongPress} delayLongPress={400}
      style={[styles.frame, { width: fitted.width, height: Math.max(44, fitted.height) }]}
    >
      <Image key={attempt} source={{ uri }} style={StyleSheet.absoluteFill}
        contentFit="contain" cachePolicy="memory-disk" recyclingKey={uri}
        accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        onLoad={onLoad} onError={onError}
      />
      {status === 'loading' && <ActivityIndicator color={Colors.clay} />}
      {status === 'error' && <View style={styles.error}>
        <RotateCcw size={20} color={Colors.clay} />
        <ChatSizedText style={[styles.errorText, { fontFamily: fonts.medium }]}>Photo didn’t load</ChatSizedText>
        <ChatSizedText style={[styles.errorText, { fontFamily: fonts.regular }]}>Tap to retry</ChatSizedText>
      </View>}
      {status === 'loaded' && <View pointerEvents="none" style={styles.expand}><Expand size={15} color={Colors.ink} /></View>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: { minWidth: 44, borderRadius: 18, overflow: 'hidden', backgroundColor: Colors.avatar, justifyContent: 'center', alignItems: 'center', marginVertical: 4 },
  error: { alignItems: 'center', gap: 4, padding: 8 },
  errorText: { ...AfterglowType.caption, color: Colors.ink, textAlign: 'center' },
  expand: { position: 'absolute', bottom: 8, right: 8, padding: 6, borderRadius: 4, backgroundColor: Colors.paper },
});
