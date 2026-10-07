import React, { useEffect, useRef, useState } from 'react';
import { CommunityReplyComposer } from './CommunityReplyComposer';
import type { CommunityReplyComposerState } from '../../hooks/useCommunityReplyComposer';
import { ActivityIndicator, FlatList, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors, { AfterglowColors } from '../../constants/Colors';
import { AfterglowFallbackFonts, AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';
import type { BroadcastReply, CommunityBroadcast } from '../../lib/communityChat';
import { formatChatTime } from '../../lib/communityChatUi';
import { CommunityChatComposer } from '../chat/CommunityChatComposer';
import { ChatBubbleFill } from '../chat/ChatBubbleFill';
import LinkifiedText from '../LinkifiedText';

interface Props {
  replyComposer?: CommunityReplyComposerState;
  onViewMember?: (id: string) => void;
  message: CommunityBroadcast;
  viewerId?: string;
  fonts?: AfterglowFontFamilies;
  replies: BroadcastReply[];
  hasOlder?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
  loading: boolean;
  error: boolean;
  draft: string;
  sending: boolean;
  onChange: (text: string) => void;
  onSend: () => void;
  onRetry: () => void;
  onClose: () => void;
}

/** Existing nested reply history, presented independently of the message row.
 * State and write ownership remain with the initiating conversation entry. */
export function CommunityRepliesPanel({ replyComposer, onViewMember, message, viewerId, fonts = AfterglowFallbackFonts, replies, hasOlder, loadingOlder, onLoadOlder, loading, error, draft, sending, onChange, onSend, onRetry, onClose }: Props) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(true);
  const [keyboardVisible, setKeyboardVisible] = useState(() => Keyboard.isVisible());
  useEffect(() => {
    const shown = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardVisible(true));
    const hidden = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardVisible(false));
    return () => { shown.remove(); hidden.remove(); };
  }, []);
  const pendingMember = useRef<string | null>(null);
  const finishProfile = () => { const id = pendingMember.current; pendingMember.current = null; if(id){onClose();onViewMember?.(id);} };
  useEffect(() => { if (!visible && Platform.OS !== 'ios') finishProfile(); }, [visible]);
  const openMember = onViewMember ? (id: string) => { pendingMember.current=id;setVisible(false); } : undefined;
  return <Modal visible={visible} onDismiss={finishProfile} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
    <KeyboardAvoidingView style={[s.backdrop, { paddingTop: insets.top + 12 }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close replies" />
      <View accessibilityViewIsModal style={[s.sheet, { height: Math.max(240, height * 0.82), maxHeight: height - insets.top - 12, paddingBottom: keyboardVisible ? 8 : Math.max(insets.bottom, 8) }]}>
        <View style={s.heading}>
          <Text style={[s.title, { fontFamily: fonts.semibold }]} accessibilityRole="header">Replies</Text>
          <TouchableOpacity style={s.close} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close replies"><X size={21} color={AfterglowColors.ink} /></TouchableOpacity>
        </View>
        <View style={s.original}>
          <Text style={[s.name, { fontFamily: fonts.semibold }]}>{message.sender_id === viewerId ? 'You' : message.sender_name ?? 'Member'}</Text>
          <Text style={[s.originalBody, { fontFamily: fonts.regular }]} numberOfLines={3}>{message.body || (message.image_url ? 'Photo' : 'Message')}</Text>
        </View>
        <FlatList cssInterop={false} data={[...replies].reverse()} inverted
          maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 40 }}
          onEndReached={() => { if (hasOlder && !loadingOlder && !error) onLoadOlder?.(); }} onEndReachedThreshold={0.2} keyExtractor={reply => reply.id} style={s.list} contentContainerStyle={s.messages} ItemSeparatorComponent={() => <View style={s.separator} />} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive"
          renderItem={({ item }) => {
            const mine = item.sender_id === viewerId;
            return <View style={[s.row, mine && s.rowOwn]}>
              {!mine && (item.sender_photo ? <Image source={{ uri: item.sender_photo }} style={s.avatar} contentFit="cover" /> : <View style={[s.avatar, s.initial]}><Text style={[s.initialText, { fontFamily: fonts.medium }]}>{item.sender_name?.slice(0, 1).toUpperCase() ?? '·'}</Text></View>)}
              <View style={[s.bubble, mine && s.bubbleOwn]}>
                {mine && <ChatBubbleFill />}
                {!mine && <Text style={[s.name, { fontFamily: fonts.semibold }]}>{item.sender_name ?? 'Member'}</Text>}
                <LinkifiedText text={item.body} mentionDocument={item.mention_data} onMentionPress={openMember} style={[s.body, { fontFamily: fonts.regular }, mine && s.light]} linkStyle={mine ? s.light : undefined} mentionStyle={mine ? s.light : undefined} />
                <Text style={[s.time, { fontFamily: fonts.regular }, mine && s.light]}>{formatChatTime(item.created_at)}</Text>
              </View>
            </View>;
          }}
          ListFooterComponent={hasOlder || error ? <View style={s.historyNotice}>
            {hasOlder && !error && <TouchableOpacity onPress={onLoadOlder} disabled={loadingOlder} style={s.notice} accessibilityRole="button" accessibilityLabel="Load earlier replies">
              {loadingOlder ? <ActivityIndicator color={AfterglowColors.clay} /> : <Text style={[s.noticeText, { fontFamily: fonts.medium }]}>Earlier replies</Text>}
            </TouchableOpacity>}
            {error ? <TouchableOpacity onPress={onRetry} style={s.notice} accessibilityRole="button" accessibilityLabel="Retry loading replies"><Text style={[s.noticeText, { fontFamily: fonts.medium }]}>{replies.length ? 'Replies may be out of date. Tap to retry.' : 'Replies couldn’t load. Tap to retry.'}</Text></TouchableOpacity> : null}
          </View> : null}
          ListEmptyComponent={loading ? <View style={s.empty} accessibilityRole="progressbar" accessibilityLabel="Loading replies"><ActivityIndicator color={AfterglowColors.clay} /></View> : !error && !hasOlder ? <Text style={[s.emptyText, { fontFamily: fonts.regular }]}>Be the first to reply.</Text> : null}
        />
        {replyComposer ? <CommunityReplyComposer state={replyComposer} fonts={fonts}/> : <CommunityChatComposer fonts={fonts} attachmentsVisible={false} inputProps={{ value: draft, onChangeText: onChange, placeholder: 'Reply…', accessibilityLabel: 'Reply', multiline: true, maxLength: 2000 }}
          photo={{ disabled: true, busy: false, onPress: () => {} }} location={{ disabled: true, onPress: () => {} }}
          onSend={onSend} sendDisabled={!draft.trim() || sending} sending={sending} editing={false} sendLabel="Send reply" />}
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

const s = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', backgroundColor: Colors.scrimSepia },
  sheet: { flexShrink: 1, minHeight: 0, width: '100%', maxWidth: 480, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden', backgroundColor: AfterglowColors.paper },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 18, paddingRight: 8, paddingTop: 4 },
  title: { ...AfterglowType.body, color: AfterglowColors.ink }, close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  original: { marginHorizontal: 16, marginBottom: 12, paddingVertical: 8, paddingHorizontal: 12, borderLeftWidth: 3, borderLeftColor: Colors.goldAccent, borderRadius: 8, backgroundColor: AfterglowColors.white, gap: 3 },
  originalBody: { ...AfterglowType.body, color: AfterglowColors.muted },
  list: { flex: 1, minHeight: 0, marginHorizontal: 12 }, messages: { paddingTop: 12, paddingBottom: 16 }, separator: { height: 10 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 }, rowOwn: { justifyContent: 'flex-end' },
  avatar: { width: 24, height: 24, borderRadius: 12, marginTop: 2 }, initial: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.inputBg },
  initialText: { ...AfterglowType.caption, color: AfterglowColors.clay },
  bubble: { maxWidth: '85%', borderRadius: 16, borderBottomLeftRadius: 5, paddingHorizontal: 11, paddingVertical: 8, backgroundColor: AfterglowColors.white, borderWidth: StyleSheet.hairlineWidth, borderColor: AfterglowColors.line, gap: 3, overflow: 'hidden' },
  bubbleOwn: { borderBottomLeftRadius: 16, borderBottomRightRadius: 5, backgroundColor: AfterglowColors.clay },
  name: { ...AfterglowType.caption, color: AfterglowColors.clay }, body: { ...AfterglowType.message, color: AfterglowColors.ink },
  time: { ...AfterglowType.timestamp, color: AfterglowColors.muted, alignSelf: 'flex-end' }, light: { color: Colors.white },
  historyNotice: { paddingBottom: 10 },
  notice: { minHeight: 44, justifyContent: 'center', padding: 10, borderRadius: 12, backgroundColor: AfterglowColors.white },
  noticeText: { ...AfterglowType.caption, color: AfterglowColors.clay }, empty: { paddingVertical: 28 }, emptyText: { ...AfterglowType.body, color: AfterglowColors.muted, textAlign: 'center', paddingVertical: 28 },
});
