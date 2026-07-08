/**
 * One broadcast in the community container: the leader's voice, a small
 * reaction row (react-not-reply is the low-pressure default), and a reply
 * thread that expands under it (Telegram's linked-discussion trick, doc 09).
 * Functionally minimal per decision 15a.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../keyboard/KeyboardDoneBar';
import { friendlyError } from '../../lib/friendlyError';
import { hapticLight, hapticSuccess } from '../../lib/haptics';
import {
  composeIntroLine,
  getBroadcastReplies,
  sendBroadcastReply,
  toggleBroadcastReaction,
  type CommunityBroadcast,
} from '../../lib/communityChat';

const REACTION_SET = ['❤️', '🔥', '👏'];

interface Props {
  broadcast: CommunityBroadcast;
  /** Broadcasts are the community speaking; attribution is its name, never a person. */
  communityName: string;
  onError: (title: string, message: string) => void;
}

export function BroadcastCard({ broadcast, communityName, onError }: Props) {
  const queryClient = useQueryClient();
  const [showReplies, setShowReplies] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const { data: replies = [], isLoading: repliesLoading } = useQuery({
    queryKey: ['broadcast-replies', broadcast.id],
    queryFn: () => getBroadcastReplies(broadcast.id),
    enabled: showReplies,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['community-broadcasts'] });
    queryClient.invalidateQueries({ queryKey: ['broadcast-replies', broadcast.id] });
  };

  const handleReact = async (emoji: string) => {
    const current = broadcast.reactions.find((r) => r.emoji === emoji);
    try {
      hapticLight();
      await toggleBroadcastReaction(broadcast.id, emoji, !current?.mine);
      invalidate();
    } catch (e) {
      onError('That did not land', friendlyError(e, 'Try again in a moment.'));
    }
  };

  const handleReply = async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      await sendBroadcastReply(broadcast.id, draft);
      hapticSuccess();
      setDraft('');
      invalidate();
    } catch (e) {
      onError('That did not send', friendlyError(e, 'Try again in a moment.'));
    } finally {
      setSending(false);
    }
  };

  // an intro is the community introducing a new member (kind='intro'):
  // same reactions and reply thread, its own clothes, client-composed line
  const isIntro = broadcast.kind === 'intro';
  const bodyText = isIntro && broadcast.payload ? composeIntroLine(broadcast.payload) : broadcast.body;

  return (
    <View style={[styles.card, isIntro && styles.cardIntro]}>
      {!!communityName && <Text style={styles.attribution}>{communityName}</Text>}
      {/* LIZ COPY */}
      {isIntro && <Text style={styles.introEyebrow}>just joined</Text>}
      <Text style={styles.body}>{bodyText}</Text>
      <Text style={styles.meta}>{new Date(broadcast.created_at).toLocaleString()}</Text>

      <View style={styles.reactionRow}>
        {REACTION_SET.map((emoji) => {
          const r = broadcast.reactions.find((x) => x.emoji === emoji);
          return (
            <TouchableOpacity
              key={emoji}
              style={[styles.reactionChip, r?.mine && styles.reactionChipMine]}
              onPress={() => handleReact(emoji)}
              hitSlop={6}
            >
              <Text style={styles.reactionText}>
                {emoji}
                {r && r.count > 0 ? ` ${r.count}` : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity onPress={() => setShowReplies((v) => !v)} hitSlop={6}>
          <Text style={styles.repliesLink}>
            {broadcast.reply_count > 0 ? `replies (${broadcast.reply_count})` : 'reply'}
          </Text>
        </TouchableOpacity>
      </View>

      {showReplies && (
        <View style={styles.thread}>
          {repliesLoading ? (
            <ActivityIndicator size="small" color={Colors.terracotta} />
          ) : (
            replies.map((r) => (
              <View key={r.id} style={styles.replyRow}>
                <Text style={styles.replySender}>{r.sender_name ?? 'someone'}</Text>
                <Text style={styles.replyBody}>{r.body}</Text>
              </View>
            ))
          )}
          <View style={styles.replyComposer}>
            <TextInput
              style={styles.replyInput}
              value={draft}
              onChangeText={setDraft}
              placeholder="say something back"
              placeholderTextColor={Colors.inkSoft}
              maxLength={2000}
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />
            <TouchableOpacity
              style={[styles.replySend, (!draft.trim() || sending) && styles.replySendOff]}
              onPress={handleReply}
              disabled={!draft.trim() || sending}
            >
              {sending ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <Text style={styles.replySendText}>send</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    borderLeftWidth: 3,
    borderLeftColor: Colors.gold,
    padding: 14,
    marginBottom: 10,
  },
  cardIntro: {
    backgroundColor: Colors.accentSubtle,
    borderLeftColor: Colors.terracotta,
  },
  attribution: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    marginBottom: 4,
  },
  introEyebrow: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
    marginBottom: 4,
  },
  body: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.darkWarm, lineHeight: LineHeights.bodyMD },
  meta: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.tertiary, marginTop: 6 },
  reactionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  reactionChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.inputBg,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  reactionChipMine: { borderColor: Colors.terracotta, borderWidth: 1.5 },
  reactionText: { fontSize: FontSizes.bodySM },
  repliesLink: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
    marginLeft: 4,
  },
  thread: { marginTop: 12, gap: 8 },
  replyRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  replySender: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.darkWarm },
  replyBody: { flex: 1, fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.darkWarm },
  replyComposer: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  replyInput: {
    flex: 1,
    backgroundColor: Colors.inputBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.darkWarm,
  },
  replySend: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  replySendOff: { opacity: 0.4 },
  replySendText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.white },
});
