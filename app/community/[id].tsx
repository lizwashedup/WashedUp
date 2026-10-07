import { ScaledText as Text } from '../../components/ScaledText';
import ProfileButton from '../../components/ProfileButton';
import { CommunityCreators, CommunityMembers } from '../../components/communities/CommunityPeople';
import { EventMediaImage } from '../../components/events/EventMediaImage';
/** Selected sunset community detail. Home retains the existing member block
 * order and visitor projection; Events lists the already-visible published
 * events, and About uses only blocks available to the current projection.
 * Joining, chat and creator destinations retain their existing authority. */

import { PublishedPageCover } from '../../components/creator/pages/PublishedPageCover';
import { communityCoverReference } from '../../lib/publishedPageCover';
import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { useObservedUser } from '../../hooks/useObservedUser';
import {
  Share,
  View,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Linking,
  useWindowDimensions,
  RefreshControl,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect, Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { ArrowLeft, MessagesSquare, ChevronRight, Share2 } from 'lucide-react-native';
import Colors, { SceneDetailColors as Scene } from '../../constants/Colors';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { JoinCommunityPopup } from '../../components/communities/JoinCommunityPopup';
import { CommunityManageLink } from '../../components/communities/CommunityManageLink';
import { CommunityJoinEntry } from '../../components/communities/CommunityJoinEntry';
import { LegacyCommunityRoomDirectory } from '../../components/chats/LegacyCommunityRoomDirectory';
import { CommunityRoomDirectory } from '../../components/chats/CommunityRoomDirectory';
import { COMMUNITY_CHAT_GROUPING_ENABLED, CREATOR_PAGES_ENABLED } from '../../constants/FeatureFlags';
import { GeneratedPoster } from '../../components/scene/GeneratedPoster';
import { CommunityClassificationSummary } from '../../components/scene/CommunityClassificationSummary';
import { getCommunityPage, getMemberFaces, type CommunityPageEvent } from '../../lib/communityPage';
import { getLeaderCards } from '../../lib/communityLeader';
import { getJoinGate, getMyMembership, leaveCommunity } from '../../lib/communityJoin';
// proposal 91's policy read lives with the leader toggle; the door and the
// toggle must agree, so both read the same self-flipping function
import { buildCommunityPublicLink, getJoinPolicy } from '../../lib/creatorMode';
import { getCommunityChatPayload, joinTopic } from '../../lib/communityChat';
import { formatEventDateLA } from '../../lib/laDate';
import { HOUSE_MARK_LABEL, isHouseCommunity } from '../../lib/houseCommunity';
import { friendlyError } from '../../lib/friendlyError';
import { hapticSuccess } from '../../lib/haptics';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { MEMBER_COUNT_THRESHOLD } from '../../lib/socialProof';
import type { CommunityBlock } from '../../lib/communityBlocks';

// Selected sunset detail: page identity leads, then photography and creator context.
// Existing cover blocks and member/visitor content order remain authoritative.
const HERO_HEIGHT = 240;
const HERO_FALLBACK_HEIGHT = 140;
// Keep the creator visible in the compact trust row below the photograph.
const FACE_CHIP = 36;
// poster-led event rows: photo thumb, generated ground fallback
const EVENT_THUMB = 52;

// the lock view's five-questions order (doc 37 §4) is CANONICAL: identity
// and trust, then the next event before long descriptions, then the person
// behind it. A stranger's read never depends on the leader's block order;
// members get the leader's own arrangement.
const LOCK_BLOCK_ORDER: CommunityBlock['block_type'][] = ['header', 'about', 'founder', 'cadence'];

export default function CommunityPageScreen() {
  const router = useRouter();
  const focused = useIsFocused();
  const viewer = useObservedUser();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { id, preview } = useLocalSearchParams<{ id: string; preview?: string }>();
  const [tab, setTab] = useState<{ id: string; name: 'home' | 'events' | 'about' }>();
  const activeTab = tab?.id === id ? tab.name : 'home';
  const visit = useRef({ id, focused: false });
  visit.current.id = id;
  const shareLock = useRef<object | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const [roomDirectoryFocused, setRoomDirectoryFocused] = useState(false);
  useFocusEffect(useCallback(() => { visit.current.focused = true; setRoomDirectoryFocused(true); return () => { visit.current.focused = false; setRoomDirectoryFocused(false); }; }, []));

  const { data: page, isLoading, error: pageError, refetch, isRefetching } = useQuery({
    queryKey: ['community-page', id],
    queryFn: () => getCommunityPage(id!),
    enabled: !!id,
  });
  // proposal 91: null while the column is absent, which is today's server
  // behavior (every join is reviewed), so the door keeps saying "ask to
  // join" until the migration lands and then tells the truth on its own
  const { data: joinPolicy = null } = useQuery({
    queryKey: ['community-join-policy', id],
    queryFn: () => getJoinPolicy(id!),
    enabled: !!id,
    staleTime: 60_000,
  });
  const joinsInstantly = joinPolicy === 'open';
  // SC-04 (2026-08-19): invite_only used to fall into the same "ask to join"
  // bucket as approval_required, which is a real lie -- there is no review
  // queue to ask into. Label only: the real invite-code redemption flow is
  // a separate, larger build, correctly not started here.
  const isInviteOnly = joinPolicy === 'invite_only';

  const { data: membership } = useQuery({
    queryKey: ['community-membership', id],
    queryFn: () => getMyMembership(id!),
    enabled: !!id,
  });
  const { data: gate } = useQuery({
    queryKey: ['community-gate', id],
    queryFn: () => getJoinGate(id!),
    enabled: !!id && !CREATOR_PAGES_ENABLED,
  });
  // the leader's public card (proposal 41): live-resolved face + name for
  // the chip, the byline, and the founder block; empty pre-apply, faces
  // just stay off
  const { data: leaderCard = null } = useQuery({
    queryKey: ['leader-card', id],
    queryFn: async () => (await getLeaderCards([id!])).get(id!) ?? null,
    enabled: !!id,
    staleTime: 60_000,
  });
  // preview (doc 37 §2, Liz's pull-forward): a leader can force the page to
  // render as a stranger or as a plain member, client-side only. RLS knows
  // who they are, so without this a leader can never see the lock view. The
  // param is honored ONLY for an active leader/co_leader/admin of THIS
  // community (admin is the same tier as co_leader -- see S-03,
  // lib/creatorMode.ts isAdminTier); anyone else gets their real projection.
  const isLeaderHere =
    membership?.status === 'active' &&
    (membership.role === 'leader' || membership.role === 'co_leader' || membership.role === 'admin');
  const previewMode =
    isLeaderHere && (preview === 'visitor' || preview === 'member') ? preview : null;
  const isMember = previewMode ? previewMode === 'member' : membership?.status === 'active';
  const { data: faces = [] } = useQuery({
    queryKey: ['community-faces', id],
    queryFn: () => getMemberFaces(id!),
    enabled: !!id && isMember,
  });

  // rooms live here for discovery (unjoined rooms never clutter the chat list)
  const membershipVisit = useMemo(() => ({ active: false, attempt: null as object | null }),
    [id, focused, viewer.viewerId, viewer.epoch, viewer.isLoading, viewer.error, isMember, previewMode]);
  const committedMembershipVisit = useRef(membershipVisit);
  const membershipVisitIsCurrent = () => membershipVisit.active && committedMembershipVisit.current === membershipVisit
    && focused && viewer.isCurrent() && isMember && !previewMode;
  const membershipIsCurrent = () => membershipVisitIsCurrent() && !!viewer.viewerId && !viewer.isLoading && !viewer.error;
  const [joining, setJoining] = useState<{ visit: typeof membershipVisit; topicId: string } | null>(null);
  const joiningTopicId = joining?.visit === membershipVisit ? joining.topicId : null;
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);
  useLayoutEffect(() => {
    committedMembershipVisit.current = membershipVisit;
    membershipVisit.active = true;
    setAlertInfo(null);
    return () => { membershipVisit.active = false; };
  }, [membershipVisit]);
  const membershipActionReady = () => {
    if (!membershipVisitIsCurrent() || membershipVisit.attempt) return false;
    if (membershipIsCurrent()) return true;
    setAlertInfo({
      title: viewer.isLoading ? 'checking your account' : 'could not check your account',
      message: viewer.isLoading ? 'give it a moment, then try again.' : 'try checking again before changing your membership.',
      buttons: viewer.isLoading ? undefined : [{ text: 'try again', onPress: () => {
        if (membershipVisitIsCurrent() && !membershipVisit.attempt) void viewer.retry();
      } }],
    });
    return false;
  };
  const { data: chatPayload } = useQuery({
    queryKey: ['community-chat-cards'],
    queryFn: getCommunityChatPayload,
    enabled: isMember,
  });
  const card = chatPayload?.cards.find((c) => c.community_id === id) ?? null;
  // Event chats never list as joinable rooms: they are attendance-scoped and
  // RSVP on the event page is the only door (tour part 3; the server half of
  // this rule is proposal 28's S1). With duplicate event titles, the leaked
  // rows also opened the WRONG twin's empty chat (the part-4 "empty thread").
  const rooms = (card?.topics ?? []).filter((t) => !t.explore_event_id);

  const handleJoinTopic = async (topicId: string) => {
    if (previewMode) {
      // LIZ COPY
      setAlertInfo({ title: 'just a preview', message: 'joining works for real members.' });
      return;
    }
    if (!membershipActionReady()) return;
    const attempt = {};
    membershipVisit.attempt = attempt;
    const current = () => membershipIsCurrent() && membershipVisit.attempt === attempt;
    setJoining({ visit: membershipVisit, topicId });
    try {
      await joinTopic(topicId, { userId: viewer.viewerId!, isCurrent: current });
      if (!current()) return;
      hapticSuccess();
      await queryClient.invalidateQueries({ queryKey: ['community-chat-cards'] });
      if (!current()) return;
      router.push(`/community-topic/${topicId}` as never);
    } catch (e) {
      if (!current()) return;
      // the lowercase law: this page's own system copy
      setAlertInfo({ title: 'that did not work', message: friendlyError(e, 'Try again in a moment.') });
    } finally {
      if (current()) setJoining(null);
      if (membershipVisit.attempt === attempt) membershipVisit.attempt = null;
    }
  };

  const legacyRooms = isMember ? <LegacyCommunityRoomDirectory
    rooms={rooms} joiningTopicId={joiningTopicId}
    onOpenMain={() => { if (!previewMode && visit.current.focused) router.push(`/community-thread/${id}` as never); }}
    onOpenTopic={topicId => { if (!previewMode && visit.current.focused) router.push(`/community-topic/${topicId}` as never); }}
    onJoinTopic={topicId => { void handleJoinTopic(topicId); }}
  /> : null;

  if (isLoading || !id || !page) {
    return <LinearGradient colors={[Scene.upper, Scene.middle, Scene.lower]} locations={Scene.gradientLocations} style={styles.container}>
      {roomDirectoryFocused && <StatusBar style="dark" />}
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.navigation}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" style={styles.navigationButton} onPress={() => router.back()}>
            <ArrowLeft size={20} color={Scene.text} />
          </TouchableOpacity>
          <Text style={styles.navigationTitle}>Community</Text>
        </View>
        <View style={styles.centered}>
          {isLoading || !id ? <ActivityIndicator accessibilityLabel="Loading community" size="large" color={Scene.text} /> : <>
            <Text accessibilityRole={pageError ? 'alert' : undefined} style={styles.emptyLine}>
              {pageError ? 'This community could not be loaded.' : 'This community is unavailable.'}
            </Text>
            {!!pageError && <TouchableOpacity accessibilityRole="button" style={styles.joinBtn} onPress={() => { void refetch(); }}>
              <Text numberOfLines={1} style={styles.joinBtnText}>Try again</Text>
            </TouchableOpacity>}
          </>}
        </View>
      </SafeAreaView>
    </LinearGradient>;
  }

  // Build 35 Screen 39: the visitor preview must run the real production
  // authorization, not just re-render the leader's own membership-granted
  // data behind a client-side flag. communities_select
  // (20260901080000_gender_restricted_communities.sql) only opens a
  // community to a non-member when status = 'active'; a leader is always
  // let through by that policy's is_community_member() branch regardless of
  // status, so without this the banner would claim "how a visitor sees it"
  // for a draft/archived community a real stranger's request could never
  // even load. Same conditional-truth shape as app/event/[id].tsx's own
  // guest preview (previewUnpublished): the content still renders so the
  // leader can polish it before publishing, the banner just stops lying
  // about who can currently see it.
  const previewUnpublished = previewMode === 'visitor' && page.community.status !== 'active';

  const accent = page.community.accent_color ?? Colors.terracotta;
  const nextEvent = page.events[0] ?? null;
  const leaderFirstName = leaderCard?.display_name?.trim().split(/\s+/)[0] ?? null;

  // the first visible cover block becomes the hero; any further cover
  // blocks keep rendering in place inside the tree (leader autonomy)
  const heroBlock = page.blocks.find(
    (b) => b.block_type === 'cover' && communityCoverReference(b.content).hasCover,
  ) ?? null;
  const heroCover = communityCoverReference(heroBlock?.content);
  const heroImages = heroCover.images;
  const heroWidth = Math.max(0, width - 40);
  const heroHeight = heroCover.hasCover ? heroWidth * 0.7 : HERO_FALLBACK_HEIGHT;
  const memberLine =
    page.memberCount === null
      ? null
      : page.memberCount >= MEMBER_COUNT_THRESHOLD
        ? `${page.memberCount} in the community`
        : /* social-proof threshold: warmth under five. LIZ COPY */ 'founding members';

  const renderBlock = (block: CommunityBlock) => {
    switch (block.block_type) {
      case 'cover': {
        const cover = communityCoverReference(block.content);
        if (cover.mediaId) return <PublishedPageCover key={block.id} pageId={page.community.id} mediaId={cover.mediaId} height={HERO_HEIGHT} surface="scene" />;
        const images = cover.images;
        if (images.length === 0) return null;
        return (
          <ScrollView key={block.id} horizontal showsHorizontalScrollIndicator={false} style={styles.coverStrip} contentContainerStyle={styles.galleryRow}>
            {images.map((url) => (
              <Image key={url} source={{ uri: url }} style={styles.coverStripImage} contentFit="cover" />
            ))}
          </ScrollView>
        );
      }
      case 'header': {
        const tagline = typeof block.content.tagline === 'string' ? block.content.tagline : null;
        const logo = typeof block.content.logo_url === 'string' ? block.content.logo_url : null;
        if (!tagline && !logo) return null;
        return (
          <View key={block.id} style={styles.headerBlock}>
            {logo && <Image source={{ uri: logo }} style={styles.logo} contentFit="cover" />}
            {!!tagline && <Text style={styles.tagline}>{tagline}</Text>}
          </View>
        );
      }
      case 'about': {
        const text = typeof block.content.text === 'string' ? block.content.text : '';
        if (!text) return null;
        return (
          <View key={block.id} style={styles.block}>
            <Text style={styles.blockLabel}>about</Text>
            <Text style={styles.bodyText}>{text}</Text>
          </View>
        );
      }
      case 'cadence': {
        const text = typeof block.content.text === 'string' ? block.content.text : '';
        if (!text) return null;
        return (
          <View key={block.id} style={styles.block}>
            {/* LIZ COPY */}
            <Text style={styles.blockLabel}>what membership feels like</Text>
            <Text style={styles.bodyText}>{text}</Text>
          </View>
        );
      }
      case 'events_auto':
        return (
          <View key={block.id} style={styles.block}>
            <Text style={styles.blockLabel}>coming up</Text>
            {page.events.length === 0 ? (
              <Text style={styles.quietLine}>nothing on the calendar yet.</Text>
            ) : (
              page.events.map((e) => <EventRow key={e.id} event={e} onPress={() => router.push(`/event/${e.id}` as never)} />)
            )}
          </View>
        );
      case 'members_auto':
        return <View key={block.id} style={styles.block}><CommunityMembers pageId={id}/>{!!memberLine&&<Text style={styles.quietLine}>{memberLine}</Text>}</View>;
      case 'gallery': {
        const images = Array.isArray(block.content.images) ? (block.content.images as string[]) : [];
        if (images.length === 0) return null;
        return (
          <View key={block.id} style={styles.block}>
            <Text style={styles.blockLabel}>the vibe</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.galleryRow}>
              {images.map((url) => (
                <Image key={url} source={{ uri: url }} style={styles.galleryImage} contentFit="cover" />
              ))}
            </ScrollView>
          </View>
        );
      }
      case 'links': {
        const links = Array.isArray(block.content.links)
          ? (block.content.links as { label: string; url: string }[])
          : [];
        if (links.length === 0) return null;
        return (
          <View key={block.id} style={styles.block}>
            <Text style={styles.blockLabel}>links</Text>
            {links.map((l) => (
              <TouchableOpacity key={l.url} onPress={() => Linking.openURL(l.url)}>
                <Text style={styles.link}>{l.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        );
      }
      case 'pinned': {
        const title = typeof block.content.title === 'string' ? block.content.title : null;
        const text = typeof block.content.text === 'string' ? block.content.text : '';
        if (!text && !title) return null;
        return (
          <View key={block.id} style={[styles.block, styles.pinnedBlock]}>
            {!!title && <Text style={styles.pinnedTitle}>{title}</Text>}
            {!!text && <Text style={styles.bodyText}>{text}</Text>}
          </View>
        );
      }
      case 'founder': {
        // the people-first pack: the leader's live-resolved face + her own
        // "why i started this". Face and name come from the leader card
        // (proposal 41), NEVER stored in the block; the text is hers.
        const text = typeof block.content.text === 'string' ? block.content.text : '';
        if (!leaderCard && !text) return null;
        return (
          <View key={block.id} style={styles.block}>
            {/* LIZ COPY */}
            <Text style={styles.blockLabel}>why i started this</Text>
            <View style={styles.founderRow}>
              {!!leaderCard?.avatar_url && (
                <Image source={{ uri: leaderCard.avatar_url }} style={styles.founderFace} contentFit="cover" />
              )}
              {!!leaderCard?.display_name && (
                /* decision 16: the locked role grammar */
                <Text style={styles.founderName}>
                  {leaderCard.display_name.toLowerCase()} · community creator
                </Text>
              )}
            </View>
            {!!text && <Text style={styles.bodyText}>{text}</Text>}
          </View>
        );
      }
      default:
        return null;
    }
  };

  // the lock view renders the five questions in canonical order; the next
  // event (what happens next) comes BEFORE the long descriptions
  const lockSections: React.ReactNode[] = [];
  for (const type of LOCK_BLOCK_ORDER) {
    lockSections.push(...page.blocks.filter((b) => b.block_type === type).map(renderBlock));
    if (type === 'header' && nextEvent) {
      lockSections.push(
        <View key="lock-next-event" style={styles.block}>
          <Text style={styles.blockLabel}>coming up</Text>
          <EventRow event={nextEvent} onPress={() => router.push(`/event/${nextEvent.id}` as never)} />
        </View>,
      );
    }
  }

  const handleLeave = () => {
    if (!membershipActionReady()) return;
    if (!id) return;
    setAlertInfo({
      /* copy to the taste gate */
      title: 'leave this community?',
      message: joinsInstantly
        ? 'you can join again whenever you like.'
        : 'you can ask to join again later.',
      buttons: [
        { text: 'stay', style: 'cancel' },
        {
          text: 'leave',
          style: 'destructive',
          onPress: async () => {
            if (!membershipActionReady()) return;
            const attempt = {};
            membershipVisit.attempt = attempt;
            const current = () => membershipIsCurrent() && membershipVisit.attempt === attempt;
            try {
              await leaveCommunity(id);
              queryClient.invalidateQueries({ queryKey: ['community-membership', id] });
              queryClient.invalidateQueries({ queryKey: ['community-chat-cards'] });
              queryClient.invalidateQueries({ queryKey: ['community-chat-rows'] });
              if (current()) router.back();
            } catch (e) {
              if (!current()) return;
              // the RPC's last-leader guard raises here; surface it, do not swallow
              setAlertInfo({ title: 'still here', message: friendlyError(e, 'You could not leave right now.') });
            } finally {
              if (membershipVisit.attempt === attempt) membershipVisit.attempt = null;
            }
          },
        },
      ],
    });
  };

  const memberBlocks = page.blocks.filter((b) => b.id !== heroBlock?.id).map(renderBlock);
  const aboutTypes = ['header', 'about', 'founder', 'cadence', 'links'];
  const aboutBlocks = (isMember ? page.blocks.filter(block => aboutTypes.includes(block.block_type))
    : LOCK_BLOCK_ORDER.flatMap(type => page.blocks.filter(block => block.block_type === type))).map(renderBlock);
  const sharePage = async () => {
    if (shareLock.current || !visit.current.focused || page.community.status !== 'active') return;
    const communityId = id, attempt = {};
    shareLock.current = attempt; setSharing(communityId);
    try { await Share.share({ message: buildCommunityPublicLink(page.community.handle) }); }
    catch {
      if (visit.current.id === communityId && visit.current.focused) setAlertInfo({ title: 'Sharing didn’t open', message: 'Try Share again when you’re ready.' });
    } finally {
      if (shareLock.current === attempt) { shareLock.current = null; setSharing(null); }
    }
  };


  return (
    <LinearGradient colors={[Scene.upper, Scene.middle, Scene.lower]} locations={Scene.gradientLocations} style={styles.container}>
      {roomDirectoryFocused && <StatusBar style="dark" />}
      <Stack.Screen options={{ headerShown: false }} />

      {previewMode && (
        <View style={[styles.previewBar, { paddingTop: insets.top + 4 }]}>
          <Text style={styles.previewBarText}>
            {previewUnpublished ? (
              // Build 35 Screen 39: real authorization, not the "sees it"
              // claim below -- a draft/archived community returns nothing
              // to a real stranger's request, so the banner says what it
              // WILL look like once published instead of overstating what
              // is true right now.
              page.community.status === 'archived'
                ? 'your page is archived. visitors cannot see this.'
                : 'how your page will look to visitors once you publish'
            ) : (
              /* LIZ COPY */
              previewMode === 'visitor' ? 'how a visitor sees it' : 'how a member sees it'
            )}
          </Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Done previewing" style={styles.navigationButton} onPress={() => router.back()}>
            {/* LIZ COPY */}
            <Text style={styles.previewBarDone}>done</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={[styles.navigation, !previewMode && { paddingTop: insets.top }]}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" style={styles.navigationButton} onPress={() => router.back()}>
          <ArrowLeft size={20} color={Scene.text} />
        </TouchableOpacity>
        <Text numberOfLines={1} style={styles.navigationTitle}>{page.community.name}</Text>
        {isMember && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Open community chat" style={styles.navigationButton}
          onPress={() => router.push(`/community-thread/${id}` as never)}>
          <MessagesSquare size={20} color={Scene.text} />
        </TouchableOpacity>}
        <ProfileButton compact surface="scene"/>
      </View>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, isMember && { paddingBottom: Math.max(insets.bottom, 32) }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Scene.text} />}
      >
        <View style={styles.identity}>
          <Text style={styles.houseMark}>{isHouseCommunity(page.community.handle) ? HOUSE_MARK_LABEL : 'COMMUNITY'}</Text>
          <Text accessibilityRole="header" style={styles.name}>{page.community.name}</Text>
          <CommunityClassificationSummary classification={page.classification} />
          {!!page.community.description && !isMember && <Text style={styles.description}>{page.community.description}</Text>}
          <View style={styles.identityActions}>
          {page.community.status === 'active' && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Share community"
            accessibilityState={{ disabled: sharing === id }} disabled={sharing === id} style={styles.shareButton} onPress={() => { void sharePage(); }}>
            <Share2 size={16} color={Scene.text} /><Text numberOfLines={1} style={styles.shareText}>{sharing === id ? 'Opening…' : 'Share'}</Text>
          </TouchableOpacity>}
          {!previewMode && <CommunityManageLink communityId={id}/>}
          </View>
        </View>
        <View style={[styles.heroContainer, { height: heroHeight }]}>
          {heroCover.mediaId ? <PublishedPageCover pageId={page.community.id} mediaId={heroCover.mediaId} height={heroHeight} surface="scene" /> : heroImages.length > 1 ? (
            <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
              {heroImages.map((url) => <Image key={url} source={{ uri: url }} style={{ width: heroWidth, height: heroHeight }} contentFit="cover" accessibilityLabel="Community cover" />)}
            </ScrollView>
          ) : heroImages.length === 1 ? <Image source={{ uri: heroImages[0] }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel="Community cover" /> : (
            <View style={[styles.coverFallback, { backgroundColor: accent }]}>
              <Text accessible={false} style={styles.coverInitial}>{page.community.name.slice(0, 1).toUpperCase()}</Text>
            </View>
          )}
        </View>
        <CommunityCreators pageId={id} fallback={(leaderCard?.avatar_url || leaderFirstName) && <View style={styles.trustRow}>
          {!!leaderCard?.avatar_url && <Image source={{ uri: leaderCard.avatar_url }} style={styles.faceChip} contentFit="cover" />}
          {!!leaderFirstName && <Text style={styles.byLine}>Created by {leaderFirstName}</Text>}
        </View>} />

        <View style={styles.tabs}>
          {(['home', 'events', 'about'] as const).map(name => <TouchableOpacity key={name} accessibilityRole="tab"
            accessibilityLabel={name === 'home' ? 'Home' : name === 'events' ? 'Events' : 'About'} accessibilityState={{ selected: activeTab === name }} aria-selected={activeTab === name}
            onPress={() => setTab({ id, name })} style={[styles.tab, activeTab === name && styles.tabSelected]}>
            <Text numberOfLines={1} style={[styles.tabText, activeTab === name && styles.tabTextSelected]}>{name === 'home' ? 'Home' : name === 'events' ? 'Events' : 'About'}</Text>
          </TouchableOpacity>)}
        </View>
        <View style={styles.content}>
          {activeTab === 'home' ? isMember ? memberBlocks : lockSections : activeTab === 'about' ? aboutBlocks : <View style={styles.block}>
            <Text accessibilityRole="header" style={styles.blockLabel}>coming up</Text>
            {page.events.length ? page.events.map(event => <EventRow key={event.id} event={event} onPress={() => router.push(`/event/${event.id}` as never)} />)
              : <Text style={styles.bodyText}>The next gathering is taking shape. Come back soon.</Text>}
          </View>}

          {activeTab === 'home' && isMember && (CREATOR_PAGES_ENABLED && COMMUNITY_CHAT_GROUPING_ENABLED ? <View style={!previewMode && styles.chatDirectory}><CommunityRoomDirectory
            communityId={id} enabled={roomDirectoryFocused} preview={!!previewMode}
            onOpen={room => router.push((room.storage === 'broadcast' ? `/community-thread/${room.id}` : `/community-topic/${room.id}`) as never)}
            fallback={legacyRooms} /></View> : legacyRooms)}

          {activeTab === 'home' && isMember && !previewMode && membership?.status === 'active' && (
            <TouchableOpacity onPress={handleLeave} hitSlop={8} style={styles.leaveWrap} accessibilityRole="button">
              {/* copy to the taste gate */}
              <Text style={styles.leaveLink}>leave community</Text>
            </TouchableOpacity>
          )}

          {!isMember && (
            <View style={styles.lockFooter}>
              {!!memberLine && <Text style={styles.quietLine}>{memberLine}</Text>}
              {/* LIZ COPY: the comfort signal (doc 37): the question a
                  stranger at the door is really asking */}
              <Text style={styles.quietLine}>most people come on their own.</Text>

            </View>
          )}
          <Text style={styles.poweredBy}>powered by washedup</Text>
        </View>
      </ScrollView>
      {!isMember && <View style={[styles.joinFooter, { paddingBottom: Math.max(insets.bottom, 12) }]}>
              {membership?.status === 'pending' ? (
                <View style={styles.pendingCard}>
                  <Text style={styles.pendingText}>
                    your request is in. a real person reads every one.
                  </Text>
                </View>
              ) : membership && ['declined', 'removed', 'banned'].includes(membership.status) ? (
                <Text style={styles.quietLine}>this community is not open to you right now.</Text>
              ) : isInviteOnly ? (
                /* SC-04: its own real label, not the approval-required copy.
                   copy to the taste gate */
                <Text style={styles.quietLine}>this community is invite only.</Text>
              ) : (
                /* Keep the existing join/preview handler on the Scene action surface. */
                <TouchableOpacity
                  style={styles.joinBtn}
                  accessibilityRole="button"
                  activeOpacity={0.85}
                  onPress={() => {
                    if (previewMode) {
                      // LIZ COPY
                      setAlertInfo({
                        title: 'just a preview',
                        message: joinsInstantly
                          ? 'the join button works for visitors.'
                          : 'the ask to join button works for visitors.',
                      });
                      return;
                    }
                    setPopupOpen(true);
                  }}
                >
                  {/* LIZ COPY: proposal 91 - the door says what it does. an
                      open community lets someone in on the spot, so calling
                      it "ask to join" would be a lie in both directions */}
                  <Text numberOfLines={1} style={styles.joinBtnText}>
                    {joinsInstantly ? 'Join community' : 'Request to join'}
                  </Text>
                </TouchableOpacity>
              )}
      </View>}

      <BrandedAlert
        visible={!!alertInfo}
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message}
        buttons={alertInfo?.buttons}
        onClose={() => setAlertInfo(null)}
      />

      {CREATOR_PAGES_ENABLED && id ? <CommunityJoinEntry communityId={id} visible={popupOpen} legacyJoinsInstantly={joinsInstantly}
        onOpen={() => setPopupOpen(true)} onClose={() => setPopupOpen(false)} onConfirmed={() => {
          setPopupOpen(false);
          queryClient.invalidateQueries({ queryKey: ['community-membership', id] });
          queryClient.invalidateQueries({ queryKey: ['community-page', id] });
          queryClient.invalidateQueries({ queryKey: ['community-chat-cards'] });
          queryClient.invalidateQueries({ queryKey: ['community-chat-rows'] });
        }} /> : gate && (
        <JoinCommunityPopup
          visible={popupOpen}
          gate={gate}
          joinsInstantly={joinsInstantly}
          onClose={() => setPopupOpen(false)}
          onRequested={() => {
            setPopupOpen(false);
            queryClient.invalidateQueries({ queryKey: ['community-membership', id] });
          }}
        />
      )}
    </LinearGradient>
  );
}

function EventRow({ event, onPress }: { event: CommunityPageEvent; onPress: () => void }) {
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Open ${event.title}`} style={styles.eventRow} onPress={onPress} activeOpacity={0.85}>
      {event.image_url ? (
        <EventMediaImage eventId={event.id} reference={event.image_url} style={styles.eventThumb} contentFit="cover" />
      ) : (
        <GeneratedPoster title={event.title} category={event.category} venue={null} height={EVENT_THUMB} compact />
      )}
      <View style={styles.eventText}>
        <Text style={styles.eventTitle} numberOfLines={2}>{event.title}</Text>
        <Text style={styles.eventMeta} numberOfLines={2}>
          {event.event_date ? formatEventDateLA(event.event_date) : 'date coming'}
          {event.venue ? ` · ${event.venue}` : ''}
        </Text>
      </View>
      <ChevronRight size={16} color={Scene.supporting} strokeWidth={2} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  navigation: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8 },
  navigationButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  tabs: { flexDirection: 'row', marginHorizontal: 20, marginTop: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Scene.border },
  tab: { minHeight: 48, flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 2 },
  tabSelected: { paddingBottom: 0, borderBottomWidth: 2, borderBottomColor: Scene.text },
  tabText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Scene.supporting },
  tabTextSelected: { fontFamily: Fonts.sansBold, color: Scene.text },
  identityActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 16 },
  shareButton: { alignSelf: 'flex-start', flexShrink: 0, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', minHeight: 44, paddingHorizontal: 14, borderRadius: 6, borderWidth: 1, borderColor: Scene.border },
  shareText: { flexShrink: 0, fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyMD, color: Scene.text },
  navigationTitle: { flex: 1, fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyMD, color: Scene.text },
  trustRow: { paddingHorizontal: 20, paddingTop: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  coverFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  coverInitial: { fontFamily: Fonts.displayBold, fontSize: FontSizes.displayLG, color: Scene.text },
  chatDirectory: { borderRadius: 20 },
  joinFooter: { backgroundColor: Scene.lower, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Scene.border, paddingHorizontal: 20, paddingTop: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, gap: 12 },
  scrollContent: { paddingBottom: 32 },
  heroContainer: { marginHorizontal: 20, position: 'relative', overflow: 'hidden', borderRadius: 8 },
  identity: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 18 },
  faceChip: { width: FACE_CHIP, height: FACE_CHIP, borderRadius: FACE_CHIP / 2 },
  houseMark: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Scene.text,
    letterSpacing: 1,
    marginBottom: 12,
  },
  name: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayLG,
    color: Scene.text,
    lineHeight: LineHeights.displayLG,
  },
  byLine: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Scene.supporting,
    marginTop: 2,
  },
  description: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Scene.supporting,
    lineHeight: LineHeights.bodyMD,
    marginTop: 8,
  },
  founderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  founderFace: { width: 56, height: 56, borderRadius: 28 },
  founderName: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Scene.supporting },
  // preview banner: neutral status strip, quiet on purpose; "done" is the
  // standard ghost link (the gold exception list stays closed)
  previewBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Scene.surface,
    borderBottomWidth: 1,
    borderBottomColor: Scene.border,
    paddingHorizontal: 20,
    paddingBottom: 4,
    gap: 12,
  },
  previewBarText: { flex: 1, fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Scene.supporting },
  previewBarDone: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Scene.text },
  content: { paddingHorizontal: 20, paddingTop: 20 },
  coverStrip: { marginBottom: 20 },
  coverStripImage: { width: 220, height: 130, borderRadius: 12 },
  headerBlock: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  logo: { width: 44, height: 44, borderRadius: 999 },
  tagline: {
    flex: 1,
    fontFamily: Fonts.display,
    fontSize: FontSizes.bodyLG,
    color: Scene.text,
    lineHeight: LineHeights.bodyLG,
  },
  block: { marginBottom: 20 },
  blockLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Scene.text,
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  bodyText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Scene.text, lineHeight: LineHeights.bodyMD },
  quietLine: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Scene.supporting, marginTop: 4 },
  // leaving is a quiet action, never the terracotta accent
  leaveWrap: { alignItems: 'center', marginTop: 28, paddingVertical: 12 },
  leaveLink: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Scene.supporting },
  emptyLine: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Scene.supporting },
  // poster-led event rows (slice-1 compact-card language): thumb, words in
  // their own zone, the house separator in the meta line
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Scene.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Scene.border,
    padding: 10,
    marginBottom: 8,
  },
  eventThumb: { width: EVENT_THUMB, height: EVENT_THUMB, borderRadius: 12 },
  eventText: { flex: 1, minWidth: 0, gap: 4 },
  eventTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Scene.text },
  eventMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Scene.supporting },
  facesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  face: { width: 36, height: 36, borderRadius: 18 },
  facePlaceholder: { backgroundColor: Scene.surface, alignItems: 'center', justifyContent: 'center' },
  faceInitial: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Scene.text },
  galleryRow: { gap: 8 },
  galleryImage: { width: 130, height: 130, borderRadius: 12 },
  link: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Scene.text, paddingVertical: 4 },
  pinnedBlock: {
    backgroundColor: Scene.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Scene.border,
    borderLeftWidth: 3,
    borderLeftColor: Colors.gold,
    padding: 14,
  },
  pinnedTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Scene.text, marginBottom: 4 },
  roomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: Scene.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Scene.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  roomName: { flex: 1, fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Scene.text },
  roomOpen: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Scene.text },
  roomJoinPill: {
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: Scene.action,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  roomJoinText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Scene.text },
  lockFooter: { marginTop: 4, gap: 6 },
  pendingCard: {
    backgroundColor: Scene.surface,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: Colors.gold,
    padding: 14,
  },
  pendingText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Scene.text, lineHeight: LineHeights.bodyMD },
  // Bone action surface shared with the selected Scene event detail.
  joinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Scene.action,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: Scene.action,
    paddingVertical: 14,
    minHeight: 48,
    paddingHorizontal: 16,
  },
  joinBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Scene.actionText },
  poweredBy: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Scene.supporting,
    textAlign: 'center',
    marginTop: 24,
  },
});
