/**
 * CircleChat — the persistent circle conversation, stacked beneath the
 * noticeboard on one surface (the "stacked" circle home). A non-inverted
 * FlatList renders the noticeboard as its header and the messages below it.
 *
 * Land position: the TOP (noticeboard visible) on open, since this surface is
 * the circle *home* reached from Yours > Circles. New messages auto-follow only
 * when the reader is already near the bottom; sending always scrolls to the
 * newest. (A future Chats > Circles entry can pass a param to open at the chat.)
 *
 * Mounted only behind GROUPS_ENABLED (the route + the Yours tab gate it).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { CIRCLE_CHAT } from '../../constants/YoursDesign';
import { COPY } from '../yours/state/constants';
import { useChat, type ChatMessage } from '../../hooks/useChat';
import type { CirclePayload } from '../../lib/circles/types';
import CircleNoticeboard from './CircleNoticeboard';
import CircleMessageBubble from './CircleMessageBubble';
import CircleComposer from './CircleComposer';

export default function CircleChat({
  circleId,
  payload,
  headerOffset,
}: {
  circleId: string;
  payload: CirclePayload;
  headerOffset: number;
}) {
  const insets = useSafeAreaInsets();
  const { messages, loading, currentUserId, sendMessage, toggleReaction } = useChat({
    kind: 'circle',
    id: circleId,
  });
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const nearBottomRef = useRef(false);
  const [draft, setDraft] = useState('');

  // Drop the home-indicator inset while the keyboard is up: the KAV already
  // pads by the keyboard frame on iOS, so keeping insets.bottom there would
  // leave a blank gap between the composer and the keyboard.
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardUp(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardUp(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const scrollToEnd = useCallback((animated: boolean) => {
    listRef.current?.scrollToEnd({ animated });
  }, []);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distanceFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
    nearBottomRef.current = distanceFromBottom < CIRCLE_CHAT.nearBottomPx;
  }, []);

  const onContentSizeChange = useCallback(() => {
    // Land at the top on open; only follow new content when already near the
    // bottom, so reading the noticeboard isn't interrupted by an incoming line.
    if (nearBottomRef.current) scrollToEnd(true);
  }, [scrollToEnd]);

  const onSend = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    sendMessage(text);
    nearBottomRef.current = true;
    requestAnimationFrame(() => scrollToEnd(true));
  }, [draft, sendMessage, scrollToEnd]);

  const renderItem = useCallback(
    ({ item, index }: { item: ChatMessage; index: number }) => {
      const isOwn = item.user_id === currentUserId;
      const prev = index > 0 ? messages[index - 1] : null;
      // Start of a run from this sender (or right after a system line): show
      // the avatar + name. Own messages never show either.
      const runStart =
        !prev || prev.user_id !== item.user_id || prev.message_type === 'system';
      return (
        <CircleMessageBubble
          message={item}
          isOwn={isOwn}
          showAvatar={!isOwn && runStart}
          showName={!isOwn && runStart}
          currentUserId={currentUserId}
          onToggleReaction={(id) => toggleReaction(id)}
        />
      );
    },
    [messages, currentUserId, toggleReaction],
  );

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={headerOffset}
    >
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={renderItem}
        ListHeaderComponent={<CircleNoticeboard payload={payload} />}
        ListFooterComponent={
          !loading && messages.length === 0 ? (
            <Text style={styles.startWhisper}>{COPY.circleChatStart}</Text>
          ) : null
        }
        contentContainerStyle={styles.listContent}
        onScroll={onScroll}
        scrollEventThrottle={64}
        onContentSizeChange={onContentSizeChange}
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      />
      <View style={{ paddingBottom: keyboardUp ? 0 : insets.bottom }}>
        <CircleComposer value={draft} onChange={setDraft} onSend={onSend} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  listContent: {
    paddingTop: CIRCLE_CHAT.listPadTop,
    paddingBottom: CIRCLE_CHAT.listPadBottom,
  },
  startWhisper: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    lineHeight: LineHeights.bodySM,
    color: Colors.tertiary,
    textAlign: 'center',
    paddingHorizontal: 40,
    paddingTop: 8,
  },
});
