import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { useChat, ChatMessage } from '../../../hooks/useChat';
import { ReportModal } from '../../../components/modals/ReportModal';
import { useBlock } from '../../../hooks/useBlock';

// ─── Event Header Data ────────────────────────────────────────────────────────

interface EventInfo {
  id: string;
  title: string;
  start_time: string;
  tickets_url: string | null;
  member_count: number;
  members: Array<{ id: string; first_name: string | null; avatar_url: string | null }>;
}

async function fetchEventInfo(eventId: string): Promise<EventInfo> {
  const { data: event } = await supabase
    .from('events')
    .select('id, title, start_time, tickets_url, member_count')
    .eq('id', eventId)
    .single();

  // Two-step fetch — avoid FK join on profiles_public view
  const { data: memberRows } = await supabase
    .from('event_members')
    .select('user_id')
    .eq('event_id', eventId)
    .eq('status', 'joined')
    .limit(6);

  const userIds = (memberRows ?? []).map((m: any) => m.user_id).filter(Boolean);

  let members: EventInfo['members'] = [];
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles_public')
      .select('id, first_name_display, profile_photo_url')
      .in('id', userIds);

    members = (profiles ?? []).map((p: any) => ({
      id: p.id,
      first_name: p.first_name_display ?? null,
      avatar_url: p.profile_photo_url ?? null,
    }));
  }

  return {
    id: (event as any).id,
    title: (event as any).title,
    start_time: (event as any).start_time,
    tickets_url: (event as any).tickets_url ?? null,
    member_count: (event as any).member_count ?? 0,
    members,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatChatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const msgDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (msgDate.getTime() === today.getTime()) return 'Today';
  if (msgDate.getTime() === yesterday.getTime()) return 'Yesterday';
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatMessageTime(dateString: string): string {
  return new Date(dateString).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function formatEventDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function isSameDay(a: string, b: string): boolean {
  const da = new Date(a), db = new Date(b);
  return da.getFullYear() === db.getFullYear()
    && da.getMonth() === db.getMonth()
    && da.getDate() === db.getDate();
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

interface BubbleProps {
  message: ChatMessage;
  isOwn: boolean;
  showAvatar: boolean;
  showName: boolean;
  isGrouped: boolean;
  onPhotoPress?: (url: string) => void;
}

function MessageBubble({ message, isOwn, showAvatar, showName, isGrouped, onPhotoPress }: BubbleProps) {
  if (message.message_type === 'system') {
    return (
      <View style={bubbleStyles.systemRow}>
        <Text style={bubbleStyles.systemText}>{message.content}</Text>
      </View>
    );
  }

  const borderRadius = {
    borderTopLeftRadius: isOwn ? 18 : (isGrouped ? 6 : 18),
    borderTopRightRadius: isOwn ? (isGrouped ? 6 : 18) : 18,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
  };

  return (
    <View style={[bubbleStyles.row, isOwn ? bubbleStyles.rowOwn : bubbleStyles.rowOther]}>
      {/* Avatar slot — only for others */}
      {!isOwn && (
        <View style={bubbleStyles.avatarSlot}>
          {showAvatar ? (
            message.sender?.avatar_url ? (
              <Image source={{ uri: message.sender.avatar_url }} style={bubbleStyles.avatar} contentFit="cover" />
            ) : (
              <View style={[bubbleStyles.avatar, bubbleStyles.avatarFallback]}>
                <Text style={bubbleStyles.avatarInitial}>
                  {message.sender?.first_name?.[0]?.toUpperCase() ?? '?'}
                </Text>
              </View>
            )
          ) : null}
        </View>
      )}

      <View style={[bubbleStyles.bubbleWrapper, isOwn ? bubbleStyles.wrapperOwn : bubbleStyles.wrapperOther]}>
        {!isOwn && showName && (
          <View style={bubbleStyles.nameTimeRow}>
            <Text style={bubbleStyles.senderName}>{message.sender?.first_name ?? 'Someone'}</Text>
            <Text style={bubbleStyles.nameTimestamp}>{formatMessageTime(message.created_at)}</Text>
          </View>
        )}

        <View style={[
          bubbleStyles.bubble,
          isOwn ? bubbleStyles.bubbleOwn : bubbleStyles.bubbleOther,
          borderRadius,
        ]}>
          {!!message.image_url ? (
            <TouchableOpacity onPress={() => onPhotoPress?.(message.image_url!)}>
              <Image
                source={{ uri: message.image_url }}
                style={bubbleStyles.messageImage}
                contentFit="cover"
              />
              {message.content ? (
                <Text style={[bubbleStyles.caption, isOwn && bubbleStyles.captionOwn]}>
                  {message.content}
                </Text>
              ) : null}
            </TouchableOpacity>
          ) : (
            <Text style={[bubbleStyles.messageText, isOwn && bubbleStyles.messageTextOwn]}>
              {message.content}
            </Text>
          )}
        </View>

        {(isOwn || !showName) && (
          <Text style={[bubbleStyles.timestamp, isOwn && bubbleStyles.timestampOwn]}>
            {formatMessageTime(message.created_at)}
          </Text>
        )}
      </View>
    </View>
  );
}

const bubbleStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 2, paddingHorizontal: 16 },
  rowOwn: { justifyContent: 'flex-end' },
  rowOther: { justifyContent: 'flex-start' },
  avatarSlot: { width: 28, marginRight: 8, alignSelf: 'flex-end' },
  avatar: { width: 28, height: 28, borderRadius: 14 },
  avatarFallback: { backgroundColor: '#F0E6D3', alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 11, fontWeight: '700', color: '#C4652A' },
  bubbleWrapper: { maxWidth: '75%', gap: 3 },
  wrapperOwn: { alignItems: 'flex-end' },
  wrapperOther: { alignItems: 'flex-start' },
  senderName: { fontSize: 13, fontWeight: '700', color: '#1A1A1A', marginBottom: 0 },
  nameTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 4,
    marginBottom: 2,
  },
  nameTimestamp: {
    fontSize: 11,
    color: '#B8A99A',
  },
  bubble: { paddingHorizontal: 13, paddingVertical: 9, overflow: 'hidden' },
  bubbleOwn: { backgroundColor: '#C4652A' },
  bubbleOther: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  messageText: { fontSize: 15, color: '#1A1A1A', lineHeight: 21 },
  messageTextOwn: { color: '#FFFFFF' },
  messageImage: { width: 220, height: 165, borderRadius: 8 },
  caption: { fontSize: 13, color: '#666666', marginTop: 6, paddingHorizontal: 2 },
  captionOwn: { color: 'rgba(255,255,255,0.85)' },
  timestamp: { fontSize: 10, color: '#9B8B7A', marginLeft: 4 },
  timestampOwn: { textAlign: 'right', marginRight: 4 },
  systemRow: { alignItems: 'center', marginVertical: 8, paddingHorizontal: 16 },
  systemText: {
    fontSize: 12,
    color: '#9B8B7A',
    backgroundColor: '#F0E6D3',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 10,
    overflow: 'hidden',
  },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [inputText, setInputText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [photoViewUrl, setPhotoViewUrl] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ id: string; name: string } | null>(null);
  const listRef = useRef<FlatList>(null);

  const { messages, loading, currentUserId, sendMessage } = useChat(id);
  const { blockUser } = useBlock();

  const { data: event } = useQuery({
    queryKey: ['event-info', id],
    queryFn: () => fetchEventInfo(id),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  const isPast = event
    ? new Date(event.start_time) < new Date(Date.now() - 48 * 60 * 60 * 1000)
    : false;

  const handleReportMenu = useCallback(async () => {
    // Fetch ALL members (no limit) for the report menu
    const { data: memberRows } = await supabase
      .from('event_members')
      .select('user_id')
      .eq('event_id', id)
      .eq('status', 'joined');

    const userIds = (memberRows ?? []).map((m: any) => m.user_id as string).filter(Boolean);
    const otherIds = userIds.filter((uid) => uid !== currentUserId);

    if (otherIds.length === 0) {
      Alert.alert('No other members', 'There are no other members in this plan to report.');
      return;
    }

    const { data: profiles } = await supabase
      .from('profiles_public')
      .select('id, first_name_display, profile_photo_url')
      .in('id', otherIds);

    const members = (profiles ?? []).map((p: any) => ({
      id: p.id as string,
      name: (p.first_name_display as string | null) ?? 'Unknown',
    }));

    // First alert: pick a member
    Alert.alert(
      'Members',
      'Select a member',
      [
        ...members.map((member) => ({
          text: member.name,
          onPress: () => {
            // Second alert: pick an action for that member
            Alert.alert(
              member.name,
              'What would you like to do?',
              [
                {
                  text: 'Report User',
                  onPress: () => {
                    setReportTarget(member);
                    setShowReport(true);
                  },
                },
                {
                  text: 'Block User',
                  style: 'destructive' as const,
                  onPress: () => blockUser(member.id, member.name, () => router.back()),
                },
                { text: 'Cancel', style: 'cancel' as const },
              ],
            );
          },
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ],
    );
  }, [id, currentUserId, blockUser]);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || uploading) return;
    setInputText('');
    await sendMessage(text);
  }, [inputText, uploading, sendMessage]);

  const handlePhotoPress = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: false,
      quality: 0.8,
    });

    if (result.canceled || !result.assets[0]) return;

    setUploading(true);
    try {
      const asset = result.assets[0];
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 1200 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
      );

      const fileName = `${currentUserId}/${Date.now()}.jpg`;
      const response = await fetch(manipulated.uri);
      const blob = await response.blob();

      const { error } = await supabase.storage
        .from('chat-images')
        .upload(fileName, blob, { contentType: 'image/jpeg', upsert: false });

      if (error) throw error;

      const { data: urlData } = supabase.storage
        .from('chat-images')
        .getPublicUrl(fileName);

      await sendMessage('', urlData.publicUrl);
    } catch {
      Alert.alert('Upload failed', 'Could not send photo. Try again.');
    } finally {
      setUploading(false);
    }
  }, [currentUserId, sendMessage]);

  // Build message list with date separators
  type EnrichedItem = ChatMessage | { type: 'date'; label: string; id: string };
  const enrichedItems: EnrichedItem[] = [];
  messages.forEach((msg, i) => {
    const prev = messages[i - 1];
    if (!prev || !isSameDay(prev.created_at, msg.created_at)) {
      enrichedItems.push({ type: 'date', label: formatChatDate(msg.created_at), id: `date-${msg.id}` });
    }
    enrichedItems.push(msg);
  });

  return (
    <View style={{ flex: 1, backgroundColor: '#FFF8F0' }}>
      {/* ── Header ── */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#FFFFFF' }}>
        <View style={chatStyles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={chatStyles.backBtn}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="chevron-back" size={24} color="#1A1A1A" />
          </TouchableOpacity>

          <View style={chatStyles.headerCenter}>
            <Text style={chatStyles.headerTitle} numberOfLines={1}>{event?.title ?? '...'}</Text>
            {event && (
              <Text style={chatStyles.headerSub}>{formatEventDate(event.start_time)}</Text>
            )}
          </View>

          <TouchableOpacity
            onPress={handleReportMenu}
            style={chatStyles.ellipsisBtn}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="ellipsis-horizontal" size={20} color="#9B8B7A" />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.push(`/plan/${id}` as any)}
            style={chatStyles.viewPlanBtn}
          >
            <Text style={chatStyles.viewPlanText}>View Plan</Text>
          </TouchableOpacity>
        </View>

        {/* Ticket banner */}
        {event?.tickets_url && (
          <TouchableOpacity
            style={chatStyles.ticketBanner}
            onPress={() => Linking.openURL(event.tickets_url!)}
          >
            <View style={chatStyles.ticketLeft}>
              <Ionicons name="ticket-outline" size={16} color="#C4652A" />
              <Text style={chatStyles.ticketText}>Tickets available</Text>
            </View>
            <Text style={chatStyles.ticketCta}>Get Tickets</Text>
          </TouchableOpacity>
        )}

        {/* Member avatars bar */}
        {event && event.members.length > 0 && (
          <View style={chatStyles.membersBar}>
            <TouchableOpacity
              onPress={() => router.push(`/plan/${id}` as any)}
              style={chatStyles.membersInner}
            >
              {event.members.slice(0, 5).map((member, i) => (
                <View
                  key={member.id}
                  style={[chatStyles.memberAvatar, { marginLeft: i === 0 ? 0 : -8, zIndex: 5 - i }]}
                >
                  {member.avatar_url ? (
                    <Image source={{ uri: member.avatar_url }} style={chatStyles.memberAvatarImg} contentFit="cover" />
                  ) : (
                    <View style={[chatStyles.memberAvatarImg, chatStyles.memberAvatarFallback]}>
                      <Text style={chatStyles.memberInitial}>
                        {member.first_name?.[0]?.toUpperCase() ?? '?'}
                      </Text>
                    </View>
                  )}
                </View>
              ))}
              {event.member_count > 5 && (
                <Text style={chatStyles.moreMembers}>+{event.member_count - 5}</Text>
              )}
              <Ionicons name="chevron-forward" size={14} color="#9B8B7A" style={{ marginLeft: 8 }} />
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>

      {/* ── Messages ── */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="large" color="#C4652A" />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={enrichedItems}
            keyExtractor={item => item.id}
            contentContainerStyle={chatStyles.messageList}
            showsVerticalScrollIndicator={false}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            renderItem={({ item, index }) => {
              if ('type' in item && item.type === 'date') {
                return (
                  <View style={bubbleStyles.systemRow}>
                    <Text style={bubbleStyles.systemText}>{item.label}</Text>
                  </View>
                );
              }

              const msg = item as ChatMessage;
              const isOwn = msg.user_id === currentUserId;

              const prevItem = enrichedItems[index - 1];
              const prevMsg = prevItem && !('type' in prevItem) ? prevItem as ChatMessage : null;
              const nextItem = enrichedItems[index + 1];
              const nextMsg = nextItem && !('type' in nextItem) ? nextItem as ChatMessage : null;

              const isGroupedWithPrev = !!(prevMsg?.user_id === msg.user_id && isSameDay(prevMsg.created_at, msg.created_at));
              const isGroupedWithNext = !!(nextMsg?.user_id === msg.user_id && isSameDay(msg.created_at, nextMsg.created_at));

              return (
                <View style={{ marginBottom: isGroupedWithNext ? 1 : 10 }}>
                  <MessageBubble
                    message={msg}
                    isOwn={isOwn}
                    showAvatar={!isOwn && !isGroupedWithNext}
                    showName={!isOwn && !isGroupedWithPrev}
                    isGrouped={isGroupedWithPrev}
                    onPhotoPress={setPhotoViewUrl}
                  />
                </View>
              );
            }}
          />
        )}

        {/* Input bar */}
        {isPast ? (
          <View style={[chatStyles.readOnlyBar, { paddingBottom: insets.bottom + 8 }]}>
            <Text style={chatStyles.readOnlyText}>This chat is read-only — the plan has ended</Text>
          </View>
        ) : (
          <View style={[chatStyles.inputBar, { paddingBottom: insets.bottom + 8 }]}>
            <TouchableOpacity onPress={handlePhotoPress} style={chatStyles.cameraBtn} disabled={uploading}>
              {uploading ? (
                <ActivityIndicator size="small" color="#9B8B7A" />
              ) : (
                <Ionicons name="camera-outline" size={24} color="#9B8B7A" />
              )}
            </TouchableOpacity>

            <TextInput
              style={chatStyles.input}
              value={inputText}
              onChangeText={setInputText}
              placeholder="Message..."
              placeholderTextColor="#9B8B7A"
              multiline
              maxLength={1000}
              returnKeyType="default"
            />

            <TouchableOpacity
              onPress={handleSend}
              disabled={!inputText.trim() || uploading}
              style={[chatStyles.sendBtn, inputText.trim() ? chatStyles.sendBtnActive : chatStyles.sendBtnDisabled]}
            >
              <Ionicons name="arrow-up" size={18} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Report user modal */}
      {reportTarget && (
        <ReportModal
          visible={showReport}
          onClose={() => {
            setShowReport(false);
            setReportTarget(null);
          }}
          reportedUserId={reportTarget.id}
          reportedUserName={reportTarget.name}
          eventId={id}
        />
      )}

      {/* Full-screen photo viewer */}
      <Modal visible={!!photoViewUrl} transparent animationType="fade">
        <Pressable style={chatStyles.photoModal} onPress={() => setPhotoViewUrl(null)}>
          {photoViewUrl && (
            <Image source={{ uri: photoViewUrl }} style={chatStyles.photoFull} contentFit="contain" />
          )}
          <TouchableOpacity style={chatStyles.photoClose} onPress={() => setPhotoViewUrl(null)}>
            <Ionicons name="close" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        </Pressable>
      </Modal>
    </View>
  );
}

const chatStyles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0E6D3',
    backgroundColor: '#FFFFFF',
    gap: 8,
  },
  backBtn: { padding: 2 },
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: 15, fontWeight: '700', color: '#1A1A1A' },
  headerSub: { fontSize: 12, color: '#9B8B7A', marginTop: 1 },
  ellipsisBtn: {
    padding: 4,
  },
  viewPlanBtn: {
    borderWidth: 1.5,
    borderColor: '#C4652A',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  viewPlanText: { fontSize: 12, color: '#C4652A', fontWeight: '600' },

  ticketBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#FFF8F0',
    borderLeftWidth: 3,
    borderLeftColor: '#C4652A',
    borderBottomWidth: 1,
    borderBottomColor: '#F0E6D3',
  },
  ticketLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ticketText: { fontSize: 13, color: '#1A1A1A', fontWeight: '500' },
  ticketCta: { fontSize: 13, color: '#C4652A', fontWeight: '700' },

  membersBar: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F0E6D3',
    backgroundColor: '#FFFFFF',
  },
  membersInner: { flexDirection: 'row', alignItems: 'center' },
  memberAvatar: { borderWidth: 2, borderColor: '#FFFFFF', borderRadius: 16 },
  memberAvatarImg: { width: 30, height: 30, borderRadius: 15 },
  memberAvatarFallback: { backgroundColor: '#F0E6D3', alignItems: 'center', justifyContent: 'center' },
  memberInitial: { fontSize: 11, fontWeight: '700', color: '#C4652A' },
  moreMembers: { fontSize: 12, color: '#9B8B7A', marginLeft: 10, fontWeight: '600' },

  messageList: { paddingVertical: 12 },

  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F0E6D3',
    gap: 10,
  },
  cameraBtn: { padding: 4, paddingBottom: 8 },
  input: {
    flex: 1,
    backgroundColor: '#FFF8F0',
    borderWidth: 1,
    borderColor: '#F0E6D3',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: '#1A1A1A',
    maxHeight: 100,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  sendBtnActive: { backgroundColor: '#C4652A' },
  sendBtnDisabled: { backgroundColor: '#F0E6D3' },

  readOnlyBar: {
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F0E6D3',
  },
  readOnlyText: { fontSize: 13, color: '#9B8B7A', fontStyle: 'italic' },

  photoModal: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoFull: { width: '100%', height: '80%' },
  photoClose: {
    position: 'absolute',
    top: 60,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
