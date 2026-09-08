import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../keyboard/KeyboardDoneBar';
import { friendlyError } from '../../lib/friendlyError';
import { hapticLight, hapticSuccess } from '../../lib/haptics';
import {
  getBroadcastReplies,
  sendBroadcastReply,
  toggleBroadcastReaction,
  type CommunityBroadcast,
} from '../../lib/communityChat';

const REACTIONS = ['❤️', '🔥', '👏'];

interface Props {
  message: CommunityBroadcast;
  onError: (title: string, message: string) => void;
}

export function CommunityMessageActions({ message, onError }: Props) {
  const queryClient = useQueryClient();
  const [showReplies, setShowReplies] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const { data: replies = [], isLoading } = useQuery({
    queryKey: ['broadcast-replies', message.id],
    queryFn: () => getBroadcastReplies(message.id),
    enabled: showReplies,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['community-broadcasts'] });
    queryClient.invalidateQueries({ queryKey: ['broadcast-replies', message.id] });
  };

  const react = async (emoji: string) => {
    const mine = message.reactions.find((reaction) => reaction.mine);
    try {
      hapticLight();
      if (mine?.emoji === emoji) await toggleBroadcastReaction(message.id, emoji, false);
      else {
        if (mine) await toggleBroadcastReaction(message.id, mine.emoji, false);
        await toggleBroadcastReaction(message.id, emoji, true);
      }
      refresh();
    } catch (error) {
      onError('That did not land', friendlyError(error, 'Try again in a moment.'));
    }
  };

  const send = async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      await sendBroadcastReply(message.id, draft);
      setDraft('');
      setShowReplies(true);
      hapticSuccess();
      refresh();
    } catch (error) {
      onError('That did not send', friendlyError(error, 'Try again in a moment.'));
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.actions}>
        {REACTIONS.map((emoji) => {
          const reaction = message.reactions.find((item) => item.emoji === emoji);
          return (
            <TouchableOpacity
              key={emoji}
              style={[styles.reaction, reaction?.mine && styles.reactionMine]}
              onPress={() => { void react(emoji); }}
              accessibilityRole="button"
              accessibilityLabel={`React ${emoji}`}
            >
              <Text style={styles.reactionText}>{emoji}{reaction?.count ? ` ${reaction.count}` : ''}</Text>
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity onPress={() => setShowReplies((shown) => !shown)} accessibilityRole="button" accessibilityLabel="Reply to this message">
          <Text style={styles.replyLink}>{message.reply_count ? `replies (${message.reply_count})` : 'reply'}</Text>
        </TouchableOpacity>
      </View>
      {showReplies && (
        <View style={styles.thread}>
          {isLoading ? <ActivityIndicator size="small" color={Colors.terracotta} /> : replies.map((reply) => (
            <View key={reply.id} style={styles.replyRow}>
              <Text style={styles.replyName}>{reply.sender_name ?? 'someone'}</Text>
              <Text style={styles.replyBody}>{reply.body}</Text>
            </View>
          ))}
          <View style={styles.composer}>
            <TextInput style={styles.input} value={draft} onChangeText={setDraft} placeholder="say something back" placeholderTextColor={Colors.inkSoft} maxLength={2000} inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID} />
            <TouchableOpacity style={[styles.send, (!draft.trim() || sending) && styles.sendDisabled]} onPress={() => { void send(); }} disabled={!draft.trim() || sending}>
              {sending ? <ActivityIndicator size="small" color={Colors.white} /> : <Text style={styles.sendText}>send</Text>}
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 5 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reaction: { minWidth: 34, minHeight: 28, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 999, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.inputBg },
  reactionMine: { borderColor: Colors.terracotta, borderWidth: 1.5 },
  reactionText: { fontFamily: Fonts.sans, fontSize: FontSizes.caption },
  replyLink: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.terracotta, marginLeft: 2 },
  thread: { gap: 7, marginTop: 8, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: Colors.goldAccent },
  replyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  replyName: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.darkWarm },
  replyBody: { flex: 1, fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.darkWarm },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  input: { flex: 1, minHeight: 38, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.inputBg, fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.darkWarm },
  send: { minHeight: 38, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 999, backgroundColor: Colors.terracotta },
  sendDisabled: { opacity: 0.45 },
  sendText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.white },
});
