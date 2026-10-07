import { useCommunityReplyComposer } from '../../hooks/useCommunityReplyComposer';
import { subscribeCommunityReplies } from '../../lib/communityConversationRealtime';
import { MessageCircle, ChevronRight } from 'lucide-react-native';
import { requestWithDeadline } from '../../lib/requestWithDeadline';
import { compareChatSequence } from '../../lib/chatPaging';
import { CommunityRepliesPanel } from './CommunityRepliesPanel';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, type AfterglowFontFamilies } from '../../constants/Typography';
import { friendlyError } from '../../lib/friendlyError';
import { hapticLight, hapticSuccess } from '../../lib/haptics';
import {
  getBroadcastReplies,
  isObsoleteCommunityOperation,
  ObsoleteCommunityOperationError,
  sendBroadcastReply,
  toggleBroadcastReaction,
  type CommunityBroadcast,
  type BroadcastReplyPage,
  type CommunityOperationScope,
} from '../../lib/communityChat';
import { ReactionChips } from '../chat/ReactionChips';

interface Props {
  onViewMember?: (id: string) => void;
  onViewReactions?: () => void;
  replyRequest?: object;
  onRepliesClose?: () => void;
  compactReplies?: boolean;
  message: CommunityBroadcast;
  appearance?: { fonts: AfterglowFontFamilies };
  onError: (title: string, message: string) => void;
  onAddReaction: () => void;
  /** Capture the page's initiating viewer and admission visit. */
  scope?: CommunityOperationScope;
  /** The main room shares this with its full-picker reaction lock. */
  onReact?: (emoji: string) => Promise<void> | void;
}

let nextReplyVisit = 0;

/** Shared lifetime for the two views of the same reply/reaction tables. */
export function useCommunityMessageInteractions(
  message: CommunityBroadcast,
  onError: Props['onError'],
  scope?: CommunityOperationScope,
  reactionPolicy: 'single' | 'per-emoji' = 'single',
  onReact?: Props['onReact'],
) {
  const queryClient = useQueryClient();
  const [showReplies, setShowReplies] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const draftRef = useRef('');
  const draftRevision = useRef(0);
  const replyAttempt = useRef<object | null>(null);
  const reactionAttempt = useRef<object | null>(null);
  const ownReactions = useRef(new Set<string>());
  // A unique scalar makes returning A -> B -> A a new cache visit. Message IDs
  // and the existing unscoped query prefix remain unchanged.
  const visit = useMemo(() => ({ key: ++nextReplyVisit }), [message.id, scope]);
  const activeVisit = useRef<typeof visit | null>(null);
  const isCurrent = useCallback(() => activeVisit.current === visit &&
    (!scope || (!!scope.userId && scope.isCurrent())), [visit, scope]);
  const operationScope = useMemo<CommunityOperationScope | undefined>(() => scope
    ? { userId: scope.userId, isCurrent }
    : undefined, [scope, isCurrent]);
  const queryKey = useMemo(() => scope
    ? ['broadcast-replies', message.id, scope.userId, visit.key]
    : ['broadcast-replies', message.id], [message.id, scope, visit]);

  useLayoutEffect(() => {
    activeVisit.current = visit;
    replyAttempt.current = null; reactionAttempt.current = null;
    draftRef.current = ''; draftRevision.current = 0;
    setDraft(''); setSending(false); setShowReplies(false); setShowReactionPicker(false);
    return () => { if (activeVisit.current === visit) activeVisit.current = null; };
  }, [visit]);
  useLayoutEffect(() => {
    ownReactions.current = new Set(message.reactions.filter(reaction => reaction.mine).map(reaction => reaction.emoji));
  }, [visit, message.reactions]);
  useEffect(() => () => {
    // Scoped keys belong to this component visit. Do not cancel an unscoped
    // query which another legacy card may still observe.
    if (scope) void queryClient.cancelQueries({ queryKey, exact: true }).catch(() => {});
  }, [queryClient, queryKey, scope]);

  const query = useInfiniteQuery<BroadcastReplyPage, Error, InfiniteData<BroadcastReplyPage>, readonly unknown[], { created_at: string; id: string } | undefined>({
    queryKey,
    initialPageParam: undefined as { created_at: string; id: string } | undefined,
    getNextPageParam: page => page.hasMore ? page.olderCursor ?? undefined : undefined,
    queryFn: async ({ signal, pageParam }) => {
      let active = true;
      const current = () => active && isCurrent() && !signal.aborted;
      if (!current()) throw new ObsoleteCommunityOperationError();
      let retireRead: (() => void) | undefined;
      try {
        const cancelled = new Promise<never>((_, reject) => {
          retireRead = () => reject(new ObsoleteCommunityOperationError());
          signal.addEventListener('abort', retireRead, { once: true });
        });
        const replies = await requestWithDeadline(Promise.race([
          getBroadcastReplies(message.id, scope ? { userId: scope.userId, isCurrent: current } : undefined, pageParam), cancelled,
        ]), 12_000);
        if (!current()) throw new ObsoleteCommunityOperationError();
        return replies;
      } catch (error) {
        if (!current()) throw new ObsoleteCommunityOperationError();
        throw error;
      } finally { active = false; if (retireRead) signal.removeEventListener('abort', retireRead); }
    },
    enabled: showReplies && (!scope || !!scope.userId),
    retry: false,
  });
  const replies = useMemo(() => [...new Map((query.data?.pages ?? []).slice().reverse()
    .flatMap(page => page.replies).map(reply => [reply.id, reply])).values()].sort(compareChatSequence), [query.data]);
  const visibleReplies = useRef(replies); visibleReplies.current = replies;
  useEffect(() => {
    if (!showReplies || !isCurrent()) return;
    return subscribeCommunityReplies({
      channelName: `community-replies-${message.id}-${scope?.userId ?? 'current'}-${visit.key}`,
      broadcastId: message.id, isCurrent,
      hasReply: id => !!visibleReplies.current?.some(reply => reply.id === id),
      refresh: () => queryClient.invalidateQueries({ queryKey, exact: true }),
    });
  }, [showReplies, message.id, scope?.userId, visit.key, isCurrent, queryClient, queryKey]);
  const refresh = () => {
    if (!isCurrent()) return;
    void queryClient.invalidateQueries({ queryKey: ['community-broadcasts'] }).catch(() => {});
    void queryClient.invalidateQueries({ queryKey, exact: true }).catch(() => {});
  };
  const replyComposer = useCommunityReplyComposer(message.id, operationScope, showReplies, () => { hapticSuccess(); refresh(); });
  const currentAction = (action: () => void) => () => { if (isCurrent()) action(); };
  const changeDraft = (text: string) => {
    if (!isCurrent()) return;
    draftRevision.current++;
    draftRef.current = text;
    setDraft(text);
  };
  const send = async () => {
    const text = draftRef.current;
    if (!isCurrent() || !text.trim() || replyAttempt.current) return;
    const attempt = {}; replyAttempt.current = attempt;
    const revision = draftRevision.current;
    setSending(true);
    try {
      await sendBroadcastReply(message.id, text, operationScope);
      if (!isCurrent() || replyAttempt.current !== attempt) return;
      if (draftRevision.current === revision) { draftRef.current = ''; setDraft(''); }
      hapticSuccess();
      refresh();
    } catch (error) {
      if (isCurrent() && !isObsoleteCommunityOperation(error)) onError('That did not send', friendlyError(error, 'Try again in a moment.'));
    } finally {
      if (isCurrent() && replyAttempt.current === attempt) { replyAttempt.current = null; setSending(false); }
    }
  };
  const react = async (emoji: string) => {
    if (!isCurrent() || reactionAttempt.current) return;
    const attempt = {}; reactionAttempt.current = attempt;
    try {
      if (onReact) { await onReact(emoji); return; }
      hapticLight();
      const previous = reactionPolicy === 'single' ? ownReactions.current.values().next().value : undefined;
      const selected = reactionPolicy === 'single' ? previous === emoji : ownReactions.current.has(emoji);
      if (!selected && previous) {
        await toggleBroadcastReaction(message.id, previous, false, operationScope);
        if (!isCurrent()) return;
        ownReactions.current.delete(previous);
      }
      await toggleBroadcastReaction(message.id, emoji, !selected, operationScope);
      if (!isCurrent()) return;
      if (selected) ownReactions.current.delete(emoji); else ownReactions.current.add(emoji);
      refresh();
    } catch (error) {
      if (isCurrent() && !isObsoleteCommunityOperation(error)) onError('That did not land', friendlyError(error, 'Try again in a moment.'));
    } finally {
      if (isCurrent() && reactionAttempt.current === attempt) reactionAttempt.current = null;
    }
  };

  const openReplies = useCallback(() => { if (isCurrent()) setShowReplies(true); }, [isCurrent]);
  const closeReplies = useCallback(() => { if (isCurrent()) setShowReplies(false); }, [isCurrent]);
  return {
    openReplies, closeReplies, showReplies, draft: scope ? replyComposer.text : draft, sending: scope ? replyComposer.sending : sending, showReactionPicker,
    replyComposer: scope ? replyComposer : undefined,
    replies, repliesLoading: query.isLoading, repliesError: query.isError,
    repliesHaveOlder: !!query.hasNextPage, repliesLoadingOlder: query.isFetchingNextPage,
    loadOlderReplies: currentAction(() => { if (query.hasNextPage && !query.isFetching) void query.fetchNextPage(); }),
    changeDraft: scope ? replyComposer.change : changeDraft, send: scope ? () => replyComposer.send() : send, react, currentAction,
    toggleReplies: currentAction(() => setShowReplies(shown => !shown)),
    openReactionPicker: currentAction(() => setShowReactionPicker(true)),
    closeReactionPicker: currentAction(() => setShowReactionPicker(false)),
    retryReplies: currentAction(() => { void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch()); }),
  };
}

/**
 * Main-community messages share the existing broadcast reaction/reply tables.
 * Reactions attach to messages; the existing long-press menu opens the picker.
 * The reply link preserves access to the existing nested reply history.
 */
export function CommunityMessageActions({ message, onError, onAddReaction, scope, onReact, appearance, onViewReactions, replyRequest, onRepliesClose, onViewMember, compactReplies = false }: Props) {
  const { showReplies, draft, sending, replies, repliesLoading, repliesError, replyComposer, repliesHaveOlder, repliesLoadingOlder, loadOlderReplies,
    changeDraft, send, react, toggleReplies, retryReplies, currentAction, openReplies, closeReplies,
  } = useCommunityMessageInteractions(message, onError, scope, 'single', onReact);

  const consumedRequest = useRef<object | undefined>(undefined);
  useEffect(() => {
    if (replyRequest && consumedRequest.current !== replyRequest) {
      consumedRequest.current = replyRequest;
      openReplies();
    }
  }, [replyRequest, openReplies]);
  return (
    <View style={styles.wrap}>
      <ReactionChips onViewReactions={onViewReactions} attached appearance={appearance} reactions={message.reactions} onReact={(key) => { void react(key); }} onAddReaction={currentAction(onAddReaction)}>
        {(!compactReplies || message.reply_count > 0) && <TouchableOpacity
          style={styles.replyTarget}
          onPress={toggleReplies}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={message.reply_count > 0 ? `View ${message.reply_count} ${message.reply_count === 1 ? 'reply' : 'replies'}` : 'Reply to this message'}
        >
          <View style={styles.replyBadge}><MessageCircle size={12} color={Colors.secondary}/><Text style={styles.replyLink}>{message.reply_count ? `${message.reply_count} ${message.reply_count === 1 ? 'reply' : 'replies'}` : 'Reply'}</Text><ChevronRight size={11} color={Colors.secondary}/></View>
        </TouchableOpacity>}
      </ReactionChips>

      {showReplies && <CommunityRepliesPanel replyComposer={replyComposer} onViewMember={onViewMember} message={message} viewerId={scope?.userId} fonts={appearance?.fonts}
        replies={replies} loading={repliesLoading} error={repliesError} draft={draft} sending={sending}
        hasOlder={repliesHaveOlder} loadingOlder={repliesLoadingOlder} onLoadOlder={loadOlderReplies}
        onChange={changeDraft} onSend={() => { void send(); }} onRetry={retryReplies}
        onClose={currentAction(() => { closeReplies(); onRepliesClose?.(); })} />}

    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 0 },
  replyTarget: { minHeight: 44, justifyContent: 'center' },
  replyBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 28, paddingHorizontal: 8, borderRadius: 14, backgroundColor: Colors.cardBg, borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.border },
  replyLink: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.secondary },
});
