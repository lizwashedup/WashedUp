import React, { useMemo, useCallback } from 'react';
import * as Notifications from 'expo-notifications';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  BackHandler,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { CreatorActionFill } from '../../../components/creator/CreatorActionFill';
import { ChevronDown, ChevronRight, MessageCircle } from 'lucide-react-native';

const wLogo = require('../../../assets/images/w-logo-waves.png');
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { useChatList, ChatPreview } from '../../../hooks/useChatList';
import { comparePreviewTimes } from '../../../lib/chatPreview';
import { consumeChatListDirty } from '../../../lib/chatListSignal';
import { UNREAD_CHATS_KEY } from '../../../constants/QueryKeys';
import {
  CHAT_DELETE_ENABLED,
  COMMUNITIES_ENABLED,
  GROUPS_ENABLED,
  YOURS_PAGE_ENABLED,
  COMMUNITY_CHAT_GROUPING_ENABLED,
  CREATOR_PAGES_ENABLED,
} from '../../../constants/FeatureFlags';
import { COPY } from '../../../components/yours/state/constants';
import { hapticSelection } from '../../../lib/haptics';
import { isObsoleteCircleLeave, useLeaveCircle } from '../../../hooks/useLeaveCircle';
import { useCommunityChatPreference } from '../../../hooks/useCommunityChatPreference';
import { useObservedUser } from '../../../hooks/useObservedUser';
import { useChatResumeRefresh } from '../../../hooks/useChatResumeRefresh';
import { BrandedAlert } from '../../../components/BrandedAlert';
import { type CommunityChatRowData } from '../../../lib/communityChat';
import { useCommunityChatRows } from '../../../hooks/useCommunityChatRows';
import { CommunityChatRow } from '../../../components/chats/CommunityChatRow';
import { CommunityChatHub } from '../../../components/chats/CommunityChatHub';
import { projectCommunityChatInbox } from '../../../lib/communityChatInbox';
import { SkeletonChatList } from '../../../components/SkeletonCard';
import ProfileButton from '../../../components/ProfileButton';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { AfterglowType } from '../../../constants/Typography';
import { useAfterglowFonts } from '../../../hooks/useAfterglowFonts';
import { ChatRow } from '../../../components/chats/ChatListRow';
import { styles, revised } from '../../../components/chats/chatInboxStyles';
import { ChatInboxHeading, ChatInboxFilters } from '../../../components/chats/ChatInboxHeading';

// Chats sections (spec section 5). Only shown when GROUPS_ENABLED; otherwise the
// list behaves exactly as it ships today (events only, no segmented control).
type ChatSection = 'all' | 'plans' | 'circles' | 'communities';
// Communities joins the row as the third sibling only when the flag is on
// (compile-time constant), so the shipped tab row is unchanged when off.
const CHAT_SECTIONS: ReadonlyArray<readonly [ChatSection, string]> = [
  ['all', 'All'],
  ['plans', 'Plans'],
  ['circles', 'Circles'],
  ...(COMMUNITIES_ENABLED ? ([['communities', 'Communities']] as const) : []),
];

/** Full-width underline tabs (active: asphalt + terracotta underline). */
function ChatSegments({
  value,
  onChange,
}: {
  value: ChatSection;
  onChange: (s: ChatSection) => void;
}) {
  return (
    <View style={styles.segmentRow}>
      {CHAT_SECTIONS.map(([key, label]) => {
        const on = value === key;
        return (
          <TouchableOpacity
            key={key}
            onPress={() => onChange(key)}
            style={styles.segmentTab}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            activeOpacity={0.7}
          >
            <Text style={[styles.segmentLabel, on && styles.segmentLabelOn]}>{label}</Text>
            {on && <View style={styles.segmentUnderline} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// Route a chat row to its screen by kind. Circle chats use the gated circle
// route stub; plan chats keep the existing /(tabs)/chats/[id] route.
function chatHref(chat: ChatPreview): string {
  return chat.kind === 'circle'
    ? `/(tabs)/chats/circle/${chat.conversationId}`
    : `/(tabs)/chats/${chat.conversationId}`;
}

const ChatSeparator = () => <View style={[styles.separator, COMMUNITY_CHAT_GROUPING_ENABLED && revised.separator]} />;

export default function ChatsScreen() {
  const { fonts } = useAfterglowFonts(COMMUNITY_CHAT_GROUPING_ENABLED);
  const conversationFonts = COMMUNITY_CHAT_GROUPING_ENABLED ? fonts : undefined;
  const router = useRouter();
  // One bounded, event-aware identity owns both reads and scoped actions.
  const leaveViewer = useObservedUser();
  const authUserId = leaveViewer.viewerId;
  const { chats, loading: chatLoading, loadError: chatLoadError, refetch, removeChat } = useChatList(authUserId);
  const loading = chatLoading && !leaveViewer.error;
  const loadError = chatLoadError || !!leaveViewer.error;
  const [refreshing, setRefreshing] = React.useState(false);
  // Delete chat / leave circle from the list (doc 120, CHAT_DELETE_ENABLED).
  // Cached rows and destructive actions must belong to this account.
  const leaveReady = !!leaveViewer.viewerId && leaveViewer.viewerId === authUserId && !leaveViewer.isLoading && !leaveViewer.error;
  const leaveScope = useMemo(() => ({}), [leaveViewer.viewerId, leaveViewer.epoch, authUserId, leaveReady]);
  const activeLeaveScope = React.useRef<typeof leaveScope | null>(null);
  type LeaveConfirmation = { scope: typeof leaveScope; chat: ChatPreview };
  const [leaveConfirmation, setLeaveConfirmation] = React.useState<LeaveConfirmation | null>(null);
  const confirmationRef = React.useRef<LeaveConfirmation | null>(null);
  const leaveAttempt = React.useRef<LeaveConfirmation | null>(null);
  const [leaveFailure, setLeaveFailure] = React.useState<{ scope: typeof leaveScope; message: string } | null>(null);
  const isCurrentLeave = useCallback(() => activeLeaveScope.current === leaveScope && leaveReady && leaveViewer.isCurrent(), [leaveScope, leaveReady, leaveViewer.isCurrent]);
  React.useLayoutEffect(() => {
    activeLeaveScope.current = leaveScope;
    confirmationRef.current = null;
    leaveAttempt.current = null;
    setLeaveConfirmation(null);
    setLeaveFailure(null);
    return () => { if (activeLeaveScope.current === leaveScope) activeLeaveScope.current = null; };
  }, [leaveScope]);
  const leaveOperationScope = useMemo(() => leaveViewer.viewerId ? { userId: leaveViewer.viewerId, isCurrent: isCurrentLeave } : null, [leaveViewer.viewerId, isCurrentLeave]);
  const leaveCircle = useLeaveCircle(leaveViewer.viewerId, leaveOperationScope);
  const pendingLeave = leaveConfirmation?.scope === leaveScope && isCurrentLeave() ? leaveConfirmation.chat : null;
  const leaveError = leaveFailure?.scope === leaveScope && isCurrentLeave() ? leaveFailure.message : null;
  const [pastExpanded, setPastExpanded] = React.useState(false);
  // Off prod (GROUPS_ENABLED false) this stays 'all' and the segmented control
  // is never rendered, so the list is identical to today.
  const [section, setSection] = React.useState<ChatSection>('all');
  const [communityId, setCommunityId] = React.useState<string | null>(null);

  const queryClient = useQueryClient();

  // Communities section (doc 09): one card per joined community, above the
  // plan chats. Query disabled when the flag is off, so today's screen is
  // byte-identical for live users.
  const { data: communityRows = [], viewerId: communityViewerId, isLoading: communityLoading, error: communityError, refetch: refreshCommunityRows } = useCommunityChatRows(COMMUNITIES_ENABLED, COMMUNITY_CHAT_GROUPING_ENABLED && CREATOR_PAGES_ENABLED);
  const communityInbox = useMemo(() => projectCommunityChatInbox(communityRows), [communityRows]);
  const selectedCommunity = communityInbox.communities.find(group => group.row.communityId === communityId);
  const [notificationsFocused, setNotificationsFocused] = React.useState(false);
  const inboxFocused = React.useRef(false);
  useFocusEffect(useCallback(() => {
    inboxFocused.current = true;
    setNotificationsFocused(true);
    return () => { inboxFocused.current = false; setNotificationsFocused(false); };
  }, []));
  const hubNotifications = useCommunityChatPreference(communityId ?? '', leaveViewer,
    COMMUNITY_CHAT_GROUPING_ENABLED && CREATOR_PAGES_ENABLED && notificationsFocused && !!selectedCommunity && communityViewerId === leaveViewer.viewerId);

  React.useEffect(() => { setCommunityId(null); }, [communityViewerId]);
  useFocusEffect(useCallback(() => {
    if (!COMMUNITY_CHAT_GROUPING_ENABLED || !communityId) return;
    const back = BackHandler.addEventListener('hardwareBackPress', () => { setCommunityId(null); return true; });
    return () => back.remove();
  }, [communityId]));

  // Throttle the focus-driven chat-list refetch. It runs ~5 parallel
  // Supabase queries; firing it on *every* tab focus (the prior behavior)
  // was a primary contributor to the 2026-05-18 "chat is slow" reports.
  // Still refreshes when you open Chats, just not on rapid tab-switching.
  const lastChatsFocusFetchRef = React.useRef(0);
  const hasFocusedChatsRef = React.useRef(false);
  const resumeOwner = useMemo(() => ({}), [authUserId, leaveViewer.epoch]);
  const resumePending = React.useRef<{ owner: object; work: Promise<void> } | null>(null);
  const refreshOnResume = useCallback(async () => {
    if (!authUserId || !leaveViewer.isCurrent() || !inboxFocused.current) return;
    if (resumePending.current?.owner === resumeOwner) return resumePending.current.work;
    lastChatsFocusFetchRef.current = Date.now();
    // Resume is read-only: preserve visible rows, and refresh each inbox source
    // independently. It must not replay the tab-focus notification mutations.
    const work = Promise.allSettled([
      refetch(true),
      ...(COMMUNITIES_ENABLED && communityViewerId === authUserId ? [refreshCommunityRows()] : []),
    ]).then(() => undefined);
    const attempt = { owner: resumeOwner, work };
    resumePending.current = attempt;
    try { await work; }
    finally { if (resumePending.current === attempt) resumePending.current = null; }
  }, [authUserId, leaveViewer.isCurrent, resumeOwner, refetch, communityViewerId, refreshCommunityRows]);
  useChatResumeRefresh(refreshOnResume, leaveViewer.isCurrent, inboxFocused);


  useFocusEffect(
    React.useCallback(() => {
      const nowTs = Date.now();
      const isFirstFocus = !hasFocusedChatsRef.current;
      hasFocusedChatsRef.current = true;
      const isDirty = consumeChatListDirty();
      if (isFirstFocus) lastChatsFocusFetchRef.current = nowTs;
      // A just-created conversation (e.g. a new DM) sets the dirty flag so we
      // refetch immediately, bypassing the throttle; otherwise throttle to 30s.
      // The hook already fetches on mount, so the first focus must not start a
      // duplicate copy of the same multi-query request.
      if (!isFirstFocus && (isDirty || nowTs - lastChatsFocusFetchRef.current > 30_000)) {
        lastChatsFocusFetchRef.current = nowTs;
        // T1 (doc 121): silent. The loud form flips the whole screen to the
        // skeleton for the seconds the ~5 queries take, wiping content that
        // was already on screen every time the tab regains focus.
        refetch(true);
        // communities section rides the same throttle; no-op when the flag is off
        if (COMMUNITIES_ENABLED) {
          queryClient.invalidateQueries({ queryKey: ['community-chat-rows'] });
          queryClient.invalidateQueries({ queryKey: ['community-chat-cards'] });
        }
      }
      // Opening the Chats tab means the user is looking at their messages.
      // Clear the app icon badge AND mark all new_message notifications as
      // read in the DB so the tab badge (driven by the unread count query)
      // also clears. Previously we only cleared the iOS badge but left the
      // DB rows unread, so the red "1" on the Chats tab persisted even
      // though there was nothing new to see.
      Notifications.setBadgeCountAsync(0).catch(() => {});
      (async () => {
        try {
          if (!authUserId) return;
          await supabase
            .from('app_notifications')
            .update({ status: 'read' })
            .eq('user_id', authUserId)
            .eq('type', 'new_message')
            .eq('status', 'unread');
          queryClient.invalidateQueries({ queryKey: UNREAD_CHATS_KEY });
        } catch {}
      })();
    }, [refetch, queryClient, authUserId]),
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    // silent: the RefreshControl spinner is the loading indicator here; the
    // loud form would blank the list to the skeleton under the user's pull
    try {
      if (leaveViewer.error || leaveViewer.viewerId === undefined) {
        await leaveViewer.retry();
        // A newly resolved identity starts its own list read. Never refetch
        // through this callback's old/unknown account after the retry.
        if (!leaveViewer.viewerId || !leaveViewer.isCurrent()) return;
      }
      await Promise.allSettled([refetch(true), ...(COMMUNITIES_ENABLED && communityViewerId ? [refreshCommunityRows()] : [])]);
    } finally { setRefreshing(false); }
  }, [refetch, refreshCommunityRows, communityViewerId, leaveViewer.error, leaveViewer.viewerId, leaveViewer.retry, leaveViewer.isCurrent]);

  // Keep the row until this account's request confirms the membership ended.
  // The ref blocks repeated taps before the mutation's pending render arrives.
  const confirmLeave = useCallback(async () => {
    const confirmation = leaveConfirmation;
    if (!confirmation || confirmationRef.current !== confirmation || !isCurrentLeave() || leaveAttempt.current || leaveCircle.isPending) return;
    confirmationRef.current = null;
    leaveAttempt.current = confirmation;
    setLeaveConfirmation(null);
    setLeaveFailure(null);
    const current = () => isCurrentLeave() && leaveAttempt.current === confirmation;
    try {
      const result = await leaveCircle.mutateAsync(confirmation.chat.conversationId);
      if (!current()) return;
      if (result !== 'left' && result !== 'not_member') throw new Error('Could not confirm the leave.');
      removeChat(confirmation.chat.conversationId);
    } catch (error) {
      if (!current() || isObsoleteCircleLeave(error)) return;
      setLeaveFailure({ scope: leaveScope, message: confirmation.chat.is_dm ? COPY.dmDeleteError : COPY.circleLeaveError });
    } finally {
      if (leaveAttempt.current === confirmation) leaveAttempt.current = null;
    }
  }, [leaveConfirmation, isCurrentLeave, leaveCircle, removeChat, leaveScope]);

  const closeLeaveConfirmation = useCallback(() => {
    const confirmation = leaveConfirmation;
    if (!confirmation || confirmationRef.current !== confirmation || !isCurrentLeave()) return;
    setLeaveConfirmation(null);
    // Alert dismissal may precede its button action in the same event. Retire
    // the saved action after that event, so later callbacks cannot reuse it.
    void Promise.resolve().then(() => {
      if (confirmationRef.current === confirmation) confirmationRef.current = null;
    });
  }, [leaveConfirmation, isCurrentLeave]);

  // Long-press affordance on circle rows only (flag-gated): DMs read as
  // "delete chat", named circles as "leave circle" (doc 120 N1/N2). Plan
  // rows never get one (N3: no delete that quietly exits a plan).
  const handleRowLongPress = useCallback((chat: ChatPreview) => {
    if (!CHAT_DELETE_ENABLED || chat.kind !== 'circle' || !isCurrentLeave() || leaveAttempt.current || leaveCircle.isPending) return;
    hapticSelection();
    const confirmation = { scope: leaveScope, chat };
    confirmationRef.current = confirmation;
    setLeaveConfirmation(confirmation);
    setLeaveFailure(null);
  }, [isCurrentLeave, leaveCircle.isPending, leaveScope]);

  // Filter by section first (plans = event chats, circles = circle chats),
  // then split active vs past within the section.
  const sectionChats = useMemo(() => {
    if (section === 'plans') return chats.filter(c => c.kind === 'event');
    if (section === 'circles') return chats.filter(c => c.kind === 'circle');
    // Communities rows render in the list header; no plan/circle chats here.
    if (section === 'communities') return [];
    return chats;
  }, [chats, section]);
  const activeChats = useMemo(() => sectionChats.filter(c => !c.is_past), [sectionChats]);

  // One unified list (Liz, final structure): every chat type mixed, sorted
  // purely by most recent message, the WhatsApp model. Rows keep their
  // type's personality; the LIST is what unifies. Flag off or no community
  // rows -> exactly the shipped list, untouched order.
  type ListItem =
    | { t: 'chat'; chat: ChatPreview }
    | { t: 'community'; row: CommunityChatRowData }
    | { t: 'past-header'; count: number };
  const listItems = useMemo<Exclude<ListItem, { t: 'past-header' }>[]>(() => {
    const chatItems: Exclude<ListItem, { t: 'past-header' }>[] = activeChats.map((c) => ({ t: 'chat' as const, chat: c }));
    const visibleCommunityRows = COMMUNITY_CHAT_GROUPING_ENABLED
      ? [
          ...((section === 'all' || section === 'communities') ? [
            ...communityInbox.communities.map(group => group.row), ...communityInbox.unclassifiedRooms,
          ] : []),
          ...((section === 'all' || section === 'plans') ? communityInbox.eventRooms : []),
        ]
      : (section === 'all' || section === 'communities') ? communityRows : [];
    const communityItems: Exclude<ListItem, { t: 'past-header' }>[] = COMMUNITIES_ENABLED
      ? visibleCommunityRows.map(r => ({ t: 'community' as const, row: r })) : [];
    if (communityItems.length === 0) return chatItems;
    return [...chatItems, ...communityItems].sort((a, b) => {
      const ka = a.t === 'chat' ? a.chat.last_message_at ?? '' : a.row.lastAt ?? '';
      const kb = b.t === 'chat' ? b.chat.last_message_at ?? '' : b.row.lastAt ?? '';
      return comparePreviewTimes(kb, ka);
    });
  }, [activeChats, communityRows, communityInbox, section]);
  // Circle chats are persistent (never is_past), so pastChats is always empty in
  // the Circles section and its "Past Plans" footer never renders there.
  const pastChats = useMemo(() => sectionChats.filter(c => c.is_past), [sectionChats]);
  // Past history belongs to the same virtualized list. Rendering every old
  // conversation inside a footer mounts all its photos and rows at once.
  const visibleItems = useMemo<ListItem[]>(() => [
    ...listItems,
    ...(pastChats.length ? [
      { t: 'past-header' as const, count: pastChats.length },
      ...(pastExpanded ? pastChats.map(chat => ({ t: 'chat' as const, chat })) : []),
    ] : []),
  ], [listItems, pastChats, pastExpanded]);

  const renderListItem = useCallback(({ item }: { item: ListItem }) => {
    if (item.t === 'past-header') {
      return (
        <TouchableOpacity style={styles.pastHeader} accessibilityRole="button"
          accessibilityLabel={`Past Plans (${item.count})`}
          accessibilityState={{ expanded: pastExpanded }}
          onPress={() => setPastExpanded(previous => !previous)} activeOpacity={0.7}>
          <View style={styles.pastHeaderLeft}>
            {pastExpanded
              ? <ChevronDown size={16} color={conversationFonts ? AfterglowColors.muted : Colors.tertiary} />
              : <ChevronRight size={16} color={conversationFonts ? AfterglowColors.muted : Colors.tertiary} />}
            <Text style={[styles.pastLabel, conversationFonts && { ...AfterglowType.body, fontFamily: conversationFonts.medium, color: AfterglowColors.muted }]}>Past Plans ({item.count})</Text>
          </View>
        </TouchableOpacity>
      );
    }
    if (item.t === 'community') {
      const r = item.row;
      return (
        <CommunityChatRow
          row={r}
          conversationFonts={conversationFonts}
          showCommunityContext
          onPress={() => {
            if (COMMUNITY_CHAT_GROUPING_ENABLED && r.kind === 'community') {
              setCommunityId(r.communityId);
              return;
            }
            router.push(
              (r.kind === 'community'
                ? `/community-thread/${r.targetId}`
                : `/community-topic/${r.targetId}`) as any,
            );
          }}
        />
      );
    }
    return (
      <ChatRow
        chat={item.chat}
        conversationFonts={conversationFonts}
        onPress={() => router.push(chatHref(item.chat) as any)}
        onLongPress={
          CHAT_DELETE_ENABLED && item.chat.kind === 'circle'
            ? () => handleRowLongPress(item.chat)
            : undefined
        }
      />
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, handleRowLongPress, conversationFonts, pastExpanded]);

  if (COMMUNITY_CHAT_GROUPING_ENABLED && communityId) {
    return (
      <SafeAreaView style={[styles.container, conversationFonts && revised.container]} edges={['top']}>
        {selectedCommunity && !communityError && communityViewerId ? (
          <CommunityChatHub
            group={selectedCommunity}
            profileAction={<ProfileButton compact />}
            notifications={CREATOR_PAGES_ENABLED ? hubNotifications : undefined}
            onBack={() => setCommunityId(null)}
            onViewCommunity={() => router.push(`/community/${communityId}` as any)}
            onBrowseGroups={CREATOR_PAGES_ENABLED ? () => router.push(`/community-rooms/${communityId}` as any) : undefined}
            onOpenRoom={r => router.push((r.kind === 'community' ? `/community-thread/${r.targetId}` : `/community-topic/${r.targetId}`) as any)}
            refreshing={refreshing}
            onRefresh={() => { void handleRefresh(); void hubNotifications.refresh(); }}
          />
        ) : (
          <View style={styles.emptyState}>
            {communityLoading ? <ActivityIndicator color={Colors.terracotta} accessibilityLabel="Loading community chats" /> : (
              <>
                <Text style={styles.emptyTitle}>{communityError ? 'Chats couldn’t load' : 'Community chats unavailable'}</Text>
                <Text style={styles.emptySubtitle}>{communityError ? 'Check your connection and try again.' : 'Your access may have changed. Return to Chats to see your conversations.'}</Text>
                {!!communityError && <TouchableOpacity style={styles.noActiveButton} onPress={handleRefresh} accessibilityRole="button"><Text style={styles.noActiveButtonText}>Try again</Text></TouchableOpacity>}
              </>
            )}
            <TouchableOpacity style={styles.noActiveButton} onPress={() => setCommunityId(null)} accessibilityRole="button"><Text style={styles.noActiveButtonText}>Back to Chats</Text></TouchableOpacity>
          </View>
        )}
      </SafeAreaView>
    );
  }

  // The independent community query may finish before Plans/Circles. Only
  // confirmed rows for this account can release the initial inbox skeleton.
  const hasReadyCommunityRows = COMMUNITIES_ENABLED && communityRows.length > 0
    && !!leaveViewer.viewerId && communityViewerId === leaveViewer.viewerId
    && !leaveViewer.isLoading && !leaveViewer.error && !communityError;
  if (loading && !hasReadyCommunityRows) {
    return (
      <SafeAreaView style={[styles.container, conversationFonts && revised.container]} edges={['top']}>
        {conversationFonts ? <ChatInboxHeading fonts={conversationFonts}><ProfileButton /></ChatInboxHeading> : <View style={styles.header}>
          <Text style={styles.headerTitle}>Chats</Text>
          <ProfileButton />
        </View>}
        <SkeletonChatList />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, conversationFonts && revised.container]} edges={['top']}>
      {conversationFonts ? <ChatInboxHeading fonts={conversationFonts}><ProfileButton /></ChatInboxHeading> : <View style={styles.header}>
        <Text style={styles.headerTitle}>Chats</Text>
        <ProfileButton />
      </View>}

      {GROUPS_ENABLED && (chats.length > 0 || communityRows.length > 0) && (
        <>{conversationFonts ? <ChatInboxFilters fonts={conversationFonts} value={section} onChange={setSection} choices={CHAT_SECTIONS} /> : <ChatSegments value={section} onChange={setSection} />}</>
      )}

      {loadError && section !== 'communities' && (
        chats.length ? <View style={styles.communityStatus}>
          <Text style={styles.communityStatusText} accessibilityRole="alert">Some chats may be out of date. Check your connection and try again.</Text>
          <TouchableOpacity style={styles.communityRetry} onPress={handleRefresh} disabled={refreshing} accessibilityRole="button" accessibilityLabel="Retry loading chats">
            <Text style={styles.communityRetryText}>{refreshing ? 'Trying…' : 'Try again'}</Text>
          </TouchableOpacity>
        </View> : <View style={styles.loadErrorCard}>
          <View style={styles.loadErrorIcon}><MessageCircle size={26} color={Colors.terracotta} accessibilityElementsHidden importantForAccessibility="no" /></View>
          <Text style={styles.loadErrorTitle} accessibilityRole="alert">Your chats couldn’t load</Text>
          <Text style={styles.loadErrorBody}>Check your connection and try again.</Text>
          <TouchableOpacity style={styles.loadErrorButton} onPress={handleRefresh} disabled={refreshing} accessibilityRole="button" accessibilityLabel="Retry loading chats" accessibilityState={{busy:refreshing,disabled:refreshing}}>
            <CreatorActionFill /><Text style={styles.loadErrorButtonText}>{refreshing ? 'Trying…' : 'Try again'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {COMMUNITIES_ENABLED && section !== 'circles' && (communityLoading || communityError) && (
        <View style={styles.communityStatus}>
          {communityLoading ? <ActivityIndicator color={Colors.terracotta} accessibilityLabel="Loading community chats" /> : (
            <>
              <Text style={styles.communityStatusText} accessibilityRole="alert">Community chats couldn’t load. Check your connection and try again.</Text>
              <TouchableOpacity style={styles.communityRetry} onPress={() => { void refreshCommunityRows(); }} accessibilityRole="button">
                <Text style={styles.communityRetryText}>Try again</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {chats.length === 0 && communityRows.length === 0 ? (
        loadError || (COMMUNITIES_ENABLED && (communityLoading || communityError)) ? null : <View style={styles.emptyState}>
          <Image source={wLogo} style={styles.emptyLogo} contentFit="contain" />
          <Text style={styles.emptyTitle}>Join a plan to start chatting</Text>
          <Text style={styles.emptySubtitle}>
            The chat opens once 2 people are going.
          </Text>
          <TouchableOpacity
            style={styles.emptyButton}
            onPress={() => router.push('/(tabs)/plans')}
          >
            <Text style={styles.emptyButtonText}>Browse Plans</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          decelerationRate="normal"
          data={visibleItems}
          keyExtractor={(item) => item.t === 'past-header' ? 'past-plans-header' : item.t === 'chat' ? `${item.chat.kind}:${item.chat.conversationId}` : item.row.key}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.terracotta} />
          }
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={ChatSeparator}
          // The Active label dies with the unified list (Liz), but flag-off
          // users keep today's screen byte-identical until the flip.
          ListHeaderComponent={
            !COMMUNITIES_ENABLED && activeChats.length > 0 ? (
              <Text style={styles.sectionLabel}>Active</Text>
            ) : null
          }
          renderItem={renderListItem}
          ListEmptyComponent={
            loading && section !== 'communities' ? (
              <View style={styles.communityStatus}><ActivityIndicator color={Colors.terracotta} accessibilityLabel={section === 'circles' ? 'Loading circle chats' : 'Loading plan chats'} /></View>
            ) : (loadError && section !== 'communities') || (COMMUNITIES_ENABLED && section !== 'circles' && (communityLoading || communityError)) ? null : section === 'communities' ? (
                <View style={styles.noActiveState}>
                  <Text style={styles.noActiveText}>
                    Join a community and its chat lives here.
                  </Text>
                  <TouchableOpacity
                    style={styles.noActiveButton}
                    onPress={() => router.push('/(tabs)/explore' as any)}
                  >
                    <Text style={styles.noActiveButtonText}>Browse the Scene</Text>
                  </TouchableOpacity>
                </View>
            ) : section === 'circles' ? (
              <View style={styles.noActiveState}>
                <Text style={styles.noActiveText}>
                  Your circles show up here. Make one from your people.
                </Text>
                {/* The create entry point lives on Yours > Circles, which needs
                    YOURS_PAGE_ENABLED (independent of GROUPS_ENABLED). Only show
                    the CTA when that destination actually works, so it can never
                    dead-end on the legacy People screen. */}
                {YOURS_PAGE_ENABLED && (
                  <TouchableOpacity
                    style={styles.noActiveButton}
                    onPress={() => router.push('/(tabs)/friends?tab=circles' as any)}
                  >
                    <Text style={styles.noActiveButtonText}>Make a circle</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <View style={styles.noActiveState}>
                <Text style={styles.noActiveText}>No active chats yet. Join a plan to start chatting.</Text>
                <TouchableOpacity
                  style={styles.noActiveButton}
                  onPress={() => router.push('/(tabs)/plans')}
                >
                  <Text style={styles.noActiveButtonText}>Browse Plans</Text>
                </TouchableOpacity>
              </View>
            )
          }

        />
      )}

      {/* Delete chat / leave circle confirm (doc 120). DMs get the honest
          "your list only, they keep their copy" frame; named circles reuse
          the exact strings the circle-settings leave path shows. */}
      <BrandedAlert
        visible={pendingLeave != null}
        title={pendingLeave?.is_dm ? COPY.dmDeleteTitle : COPY.circleLeaveTitle}
        message={
          pendingLeave?.is_dm
            ? COPY.dmDeleteBody(pendingLeave.title)
            : COPY.circleLeaveBody
        }
        buttons={[
          {
            text: pendingLeave?.is_dm ? COPY.dmDeleteKeep : COPY.circleLeaveStay,
            style: 'cancel',
            onPress: () => {
              if (confirmationRef.current !== leaveConfirmation || !isCurrentLeave()) return;
              confirmationRef.current = null;
              setLeaveConfirmation(null);
            },
          },
          {
            text: pendingLeave?.is_dm ? COPY.dmDeleteGo : COPY.circleLeaveGo,
            style: 'destructive',
            onPress: confirmLeave,
          },
        ]}
        onClose={closeLeaveConfirmation}
      />
      <BrandedAlert
        visible={leaveError != null}
        title={leaveError ?? ''}
        onClose={() => { if (isCurrentLeave()) setLeaveFailure(previous => previous === leaveFailure ? null : previous); }}
      />
    </SafeAreaView>
  );
}
