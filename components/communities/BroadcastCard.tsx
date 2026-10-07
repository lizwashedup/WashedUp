import { CommunityReplyComposer } from './CommunityReplyComposer';
/**
 * One broadcast in the community container: the leader's voice, a small
 * reaction row (react-not-reply is the low-pressure default), and a reply
 * thread that expands under it (Telegram's linked-discussion trick, doc 09).
 * Functionally minimal per decision 15a.
 */

import React from 'react';
import { Image } from 'expo-image';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import Colors, { AfterglowColors } from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights, AfterglowType, AfterglowFallbackFonts, type AfterglowFontFamilies } from '../../constants/Typography';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../keyboard/KeyboardDoneBar';
import {
  composeIntroCard,
  type CommunityBroadcast,
  type CommunityOperationScope,
} from '../../lib/communityChat';
import { formatTimestampLA } from '../../lib/laDate';
import LinkifiedText from '../LinkifiedText';
import { ReactionChips } from '../chat/ReactionChips';
import ReactionEmojiPicker from '../chat/ReactionEmojiPicker';
import { reactionKeyForEmoji } from '../../lib/communityReactionChips';
import { useCommunityMessageInteractions } from './CommunityMessageActions';

interface Props {
  onViewMember?: (id: string) => void;
  onViewReactions?: () => void;
  broadcast: CommunityBroadcast;
  appearance?: { fonts: AfterglowFontFamilies };
  /** Broadcasts are the community speaking; attribution is its name, never a person. */
  communityName: string;
  onError: (title: string, message: string) => void;
  mentionNames?: Set<string>;
  scope?: CommunityOperationScope;
}

export function BroadcastCard({ broadcast, communityName, onError, mentionNames, scope, appearance, onViewReactions, onViewMember }: Props) {
  const { showReplies, draft, sending, replies, repliesLoading, repliesError, showReactionPicker, replyComposer,
    changeDraft, send: handleReply, react: handleReact, toggleReplies, retryReplies,
    openReactionPicker, closeReactionPicker, currentAction, repliesHaveOlder, repliesLoadingOlder, loadOlderReplies,
  } = useCommunityMessageInteractions(broadcast, onError, scope, 'per-emoji');

  // an intro is the community introducing a new member (kind='intro'):
  // same reactions and reply thread, its own clothes, client-composed text.
  // Short questions weave inline; long ones get their own line (part-2 rule).
  const isIntro = broadcast.kind === 'intro';
  const intro = isIntro && broadcast.payload ? composeIntroCard(broadcast.payload) : null;

  const revisedBody = appearance && { ...AfterglowType.body, fontFamily: appearance.fonts.regular, color: AfterglowColors.ink };
  const revisedCaption = appearance && { ...AfterglowType.caption, fontFamily: appearance.fonts.regular, color: AfterglowColors.muted };
  const revisedAction = appearance && { ...AfterglowType.caption, fontFamily: appearance.fonts.medium, color: AfterglowColors.clay };
  return (
    <View style={[styles.card, isIntro && styles.cardIntro, appearance && { backgroundColor: AfterglowColors.white, borderColor: AfterglowColors.line, borderLeftColor: AfterglowColors.clay }]}>
      {!!communityName && <Text style={[styles.attribution, revisedAction]}>{communityName}</Text>}
      {/* LIZ COPY */}
      {isIntro && <Text style={[styles.introEyebrow, revisedCaption]}>just joined</Text>}
      {!!broadcast.image_url && <Image source={{ uri: broadcast.image_url }} style={styles.image} contentFit="cover" />}
      <LinkifiedText text={intro ? intro.lead : broadcast.body} style={[styles.body, revisedBody]} mentionNames={mentionNames} />
      {!!intro?.qa && <LinkifiedText text={intro.qa} style={[styles.body, revisedBody]} mentionNames={mentionNames} />}
      <Text style={[styles.meta, revisedCaption]}>{formatTimestampLA(broadcast.created_at)}</Text>

      <ReactionChips
        onViewReactions={onViewReactions}
        appearance={appearance}
        reactions={broadcast.reactions}
        onReact={(key) => { void handleReact(key); }}
        onAddReaction={openReactionPicker}
        style={styles.reactionRow}
      >
        <TouchableOpacity onPress={toggleReplies} hitSlop={6} accessibilityRole="button" accessibilityLabel="Reply to this message">
          <Text style={[styles.repliesLink, revisedAction]}>
            {broadcast.reply_count > 0 ? `replies (${broadcast.reply_count})` : 'reply'}
          </Text>
        </TouchableOpacity>
      </ReactionChips>
      {showReactionPicker && <ReactionEmojiPicker
        visible
        onSelect={(emoji) => currentAction(() => {
          closeReactionPicker();
          void handleReact(reactionKeyForEmoji(emoji, broadcast.reactions));
        })()}
        onClose={closeReactionPicker}
      />}

      {showReplies && (
        <View style={styles.thread}>
          {repliesHaveOlder && <TouchableOpacity onPress={loadOlderReplies} disabled={repliesLoadingOlder}
            style={styles.earlierReplies} accessibilityRole="button" accessibilityLabel="Load earlier replies">
            {repliesLoadingOlder ? <ActivityIndicator size="small" color={Colors.terracotta} /> : <Text style={[styles.repliesLink, revisedAction]}>Earlier replies</Text>}
          </TouchableOpacity>}
          {repliesLoading ? (
            <ActivityIndicator size="small" color={Colors.terracotta} />
          ) : repliesError && !replies.length ? (
            <TouchableOpacity onPress={retryReplies} accessibilityRole="button" accessibilityLabel="Retry loading replies">
              <Text style={[styles.repliesLink, revisedAction]}>Replies couldn’t load. Tap to retry.</Text>
            </TouchableOpacity>
          ) : (
            replies.map((r) => (
              <View key={r.id} style={styles.replyRow}>
                <Text style={[styles.replySender, revisedAction]}>{r.sender_name ?? 'someone'}</Text>
                <LinkifiedText text={r.body} mentionDocument={r.mention_data} onMentionPress={onViewMember ? id => { if (!scope || scope.isCurrent()) onViewMember(id); } : undefined} style={[styles.replyBody, revisedBody]}/>
              </View>
            ))
          )}
          {repliesError && replies.length > 0 && <TouchableOpacity onPress={retryReplies} style={styles.earlierReplies} accessibilityRole="button" accessibilityLabel="Retry loading replies">
            <Text style={[styles.repliesLink, revisedAction]}>Replies may be out of date. Tap to retry.</Text>
          </TouchableOpacity>}
          {replyComposer ? <CommunityReplyComposer state={replyComposer} fonts={appearance?.fonts ?? AfterglowFallbackFonts}/> : <View style={styles.replyComposer}>
            <TextInput
              style={[styles.replyInput, revisedBody, appearance && { backgroundColor: AfterglowColors.paper, borderColor: AfterglowColors.line }]}
              value={draft}
              onChangeText={changeDraft}
              placeholder="say something back"
              placeholderTextColor={appearance ? AfterglowColors.muted : Colors.inkSoft}
              maxLength={2000}
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />
            <TouchableOpacity
              style={[styles.replySend, appearance && { backgroundColor: AfterglowColors.clay }, (!draft.trim() || sending) && styles.replySendOff]}
              onPress={handleReply}
              disabled={!draft.trim() || sending}
              accessibilityRole="button"
              accessibilityLabel="Send reply"
            >
              {sending ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <Text style={[styles.replySendText, appearance && { ...AfterglowType.caption, fontFamily: appearance.fonts.semibold, color: AfterglowColors.white }]}>send</Text>
              )}
            </TouchableOpacity>
          </View>}
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
  image: { width: '100%', height: 180, borderRadius: 12, backgroundColor: Colors.inputBg, marginBottom: 8 },
  meta: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.tertiary, marginTop: 6 },
  reactionRow: { marginTop: 10 },
  earlierReplies: { minHeight: 44, justifyContent: 'center' },
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
