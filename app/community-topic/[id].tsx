/**
 * A topic thread inside a community (doc 09: the rooms of the house).
 * Messages, composer, live inserts via realtime (community_topic_messages
 * is in the publication from phase 1), notifications toggle per the doc 09
 * defaults (ON once joined, per-topic mutable). Permanent by construction,
 * no expiry. Functionally minimal per decision 15a.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { ArrowLeft, Bell, BellOff } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { friendlyError } from '../../lib/friendlyError';
import { hapticLight } from '../../lib/haptics';
import { supabase } from '../../lib/supabase';
import {
  getCommunityChatCards,
  getTopicMessages,
  markTopicRead,
  sendTopicMessage,
  setTopicNotifications,
  type TopicMessage,
} from '../../lib/communityChat';

export default function CommunityTopicScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const listRef = useRef<FlatList<TopicMessage>>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMyId(data.user?.id ?? null));
  }, []);

  const { data: cards = [] } = useQuery({
    queryKey: ['community-chat-cards'],
    queryFn: getCommunityChatCards,
  });
  const topic = cards.flatMap((c) => c.topics).find((t) => t.id === id) ?? null;

  const messagesKey = ['topic-messages', id];
  const { data: messages = [], isLoading } = useQuery({
    queryKey: messagesKey,
    queryFn: () => getTopicMessages(id!),
    enabled: !!id,
  });

  // live inserts (house realtime pattern); read marker on open and on new
  useEffect(() => {
    if (!id) return;
    markTopicRead(id).catch(() => {});
    const channel = supabase
      .channel(`community-topic-${id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'community_topic_messages', filter: `topic_id=eq.${id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: messagesKey });
          markTopicRead(id).catch(() => {});
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
      queryClient.invalidateQueries({ queryKey: ['community-chat-cards'] });
      queryClient.invalidateQueries({ queryKey: ['community-chat-rows'] });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleSend = async () => {
    if (!id || !draft.trim() || sending) return;
    setSending(true);
    try {
      await sendTopicMessage(id, draft);
      setDraft('');
      await queryClient.invalidateQueries({ queryKey: messagesKey });
      listRef.current?.scrollToEnd({ animated: true });
    } catch (e) {
      setAlertInfo({ title: 'That did not send', message: friendlyError(e, 'Try again in a moment.') });
    } finally {
      setSending(false);
    }
  };

  const handleNotifications = async () => {
    if (!id || !topic) return;
    try {
      await setTopicNotifications(id, !topic.notifications_on);
      hapticLight();
      queryClient.invalidateQueries({ queryKey: ['community-chat-cards'] });
    } catch (e) {
      setAlertInfo({ title: 'That did not save', message: friendlyError(e, 'Try again in a moment.') });
    }
  };

  const renderMessage = ({ item }: { item: TopicMessage }) => {
    const mine = item.sender_id === myId;
    return (
      <View style={[styles.messageRow, mine && styles.messageRowMine]}>
        {!mine && (item.sender_photo ? (
          <Image source={{ uri: item.sender_photo }} style={styles.face} contentFit="cover" />
        ) : (
          <View style={[styles.face, styles.facePlaceholder]}>
            <Text style={styles.faceInitial}>{(item.sender_name ?? '?').slice(0, 1).toLowerCase()}</Text>
          </View>
        ))}
        <View style={[styles.bubble, mine && styles.bubbleMine]}>
          {!mine && <Text style={styles.senderName}>{item.sender_name ?? 'someone'}</Text>}
          <Text style={[styles.messageText, mine && styles.messageTextMine]}>{item.body}</Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2.5} />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>{topic?.name ?? 'room'}</Text>
          <TouchableOpacity onPress={handleNotifications} hitSlop={12}>
            {topic?.notifications_on ? (
              <Bell size={20} color={Colors.terracotta} strokeWidth={2.5} />
            ) : (
              <BellOff size={20} color={Colors.tertiary} strokeWidth={2.5} />
            )}
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={Colors.terracotta} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={renderMessage}
            contentContainerStyle={styles.listContent}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={
              <Text style={styles.emptyLine}>nobody has said anything here yet. go first.</Text>
            }
          />
        )}

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="say something"
            placeholderTextColor={Colors.inkSoft}
            multiline
            maxLength={4000}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendBtnOff]}
            onPress={handleSend}
            disabled={!draft.trim() || sending}
          >
            {sending ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <Text style={styles.sendBtnText}>send</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

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
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerTitle: {
    flex: 1,
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.darkWarm,
    textAlign: 'center',
  },
  listContent: { padding: 16, gap: 10, flexGrow: 1 },
  emptyLine: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    lineHeight: LineHeights.bodySM,
    textAlign: 'center',
    marginTop: 24,
  },
  messageRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  messageRowMine: { justifyContent: 'flex-end' },
  face: { width: 28, height: 28, borderRadius: 14 },
  facePlaceholder: { backgroundColor: Colors.accentSubtle, alignItems: 'center', justifyContent: 'center' },
  faceInitial: { fontFamily: Fonts.sansBold, fontSize: FontSizes.caption, color: Colors.terracotta },
  bubble: {
    maxWidth: '78%',
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bubbleMine: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  senderName: { fontFamily: Fonts.sansBold, fontSize: FontSizes.caption, color: Colors.terracotta, marginBottom: 2 },
  messageText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  messageTextMine: { color: Colors.white },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.parchment,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    backgroundColor: Colors.inputBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.darkWarm,
  },
  sendBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sendBtnOff: { opacity: 0.4 },
  sendBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
});
