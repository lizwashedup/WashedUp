/**
 * The community page, member projection (doc 09: one block tree, three
 * projections; this is the app home). Design pass slice 3 (doc 37 §4): the
 * page answers the five questions IN ORDER for a stranger at the door:
 * what is this / who is it for / what happens next / who is behind it /
 * will I be comfortable showing up alone. The cover leads as a full-bleed
 * hero (community imagery first; the person is the trust element, never
 * the whole card), the founder's face chip overlaps the hero boundary (the
 * reference card anatomy at page scale), the next event renders BEFORE the
 * long descriptions on the lock view, and the comfort signal rides above
 * the door. Members get the leader's own block order (autonomy holds);
 * the canonical five-questions order governs only the lock view, which is
 * ours. No text ever sits over the cover photo (the legibility rule);
 * words live below in their own zone.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Linking,
  useWindowDimensions,
  RefreshControl,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { ArrowLeft, MessagesSquare, ChevronRight } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { JoinCommunityPopup } from '../../components/communities/JoinCommunityPopup';
import { GeneratedPoster } from '../../components/scene/GeneratedPoster';
import { getCommunityPage, getMemberFaces, type CommunityPageEvent } from '../../lib/communityPage';
import { getLeaderCards } from '../../lib/communityLeader';
import { getJoinGate, getMyMembership } from '../../lib/communityJoin';
import { getCommunityChatPayload, joinTopic } from '../../lib/communityChat';
import { formatEventDateLA } from '../../lib/laDate';
import { HOUSE_MARK_LABEL, isHouseCommunity } from '../../lib/houseCommunity';
import { friendlyError } from '../../lib/friendlyError';
import { hapticSuccess } from '../../lib/haptics';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { MEMBER_COUNT_THRESHOLD } from '../../lib/socialProof';
import type { CommunityBlock } from '../../lib/communityBlocks';

// the hero: community imagery leads (doc 37: the face is an ingredient,
// never the whole card); without a cover the accent ground stands in at a
// quieter height so the page never opens on a void
const HERO_HEIGHT = 240;
const HERO_FALLBACK_HEIGHT = 140;
// the founder's face chip overlapping the hero/text boundary: the trust
// element, page-scale sibling of the rail card's 40px chip
const FACE_CHIP = 48;
// poster-led event rows: photo thumb, generated ground fallback
const EVENT_THUMB = 52;
// the hero's floating circle controls (slice-2 pattern; non-load-bearing
// marks over imagery, allowed by the overlay rule)
const HERO_CONTROL_TOP = 8;

// the lock view's five-questions order (doc 37 §4) is CANONICAL: identity
// and trust, then the next event before long descriptions, then the person
// behind it. A stranger's read never depends on the leader's block order;
// members get the leader's own arrangement.
const LOCK_BLOCK_ORDER: CommunityBlock['block_type'][] = ['header', 'about', 'founder'];

export default function CommunityPageScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { id, preview } = useLocalSearchParams<{ id: string; preview?: string }>();
  const [popupOpen, setPopupOpen] = useState(false);

  const { data: page, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['community-page', id],
    queryFn: () => getCommunityPage(id!),
    enabled: !!id,
  });
  const { data: membership } = useQuery({
    queryKey: ['community-membership', id],
    queryFn: () => getMyMembership(id!),
    enabled: !!id,
  });
  const { data: gate } = useQuery({
    queryKey: ['community-gate', id],
    queryFn: () => getJoinGate(id!),
    enabled: !!id,
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
  // param is honored ONLY for an active leader/co_leader of THIS community;
  // anyone else gets their real projection.
  const isLeaderHere =
    membership?.status === 'active' && (membership.role === 'leader' || membership.role === 'co_leader');
  const previewMode =
    isLeaderHere && (preview === 'visitor' || preview === 'member') ? preview : null;
  const isMember = previewMode ? previewMode === 'member' : membership?.status === 'active';
  const { data: faces = [] } = useQuery({
    queryKey: ['community-faces', id],
    queryFn: () => getMemberFaces(id!),
    enabled: !!id && isMember,
  });

  // rooms live here for discovery (unjoined rooms never clutter the chat list)
  const [joiningTopicId, setJoiningTopicId] = useState<string | null>(null);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);
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
    setJoiningTopicId(topicId);
    try {
      await joinTopic(topicId);
      hapticSuccess();
      await queryClient.invalidateQueries({ queryKey: ['community-chat-cards'] });
      router.push(`/community-topic/${topicId}` as never);
    } catch (e) {
      // the lowercase law: this page's own system copy
      setAlertInfo({ title: 'that did not work', message: friendlyError(e, 'Try again in a moment.') });
    } finally {
      setJoiningTopicId(null);
    }
  };

  if (isLoading || !id) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.terracotta} />
        </View>
      </SafeAreaView>
    );
  }
  if (!page) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.centered}>
          <Text style={styles.emptyLine}>this community is not around anymore.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const accent = page.community.accent_color ?? Colors.terracotta;
  const nextEvent = page.events[0] ?? null;
  const leaderFirstName = leaderCard?.display_name?.trim().split(/\s+/)[0] ?? null;

  // the first visible cover block becomes the hero; any further cover
  // blocks keep rendering in place inside the tree (leader autonomy)
  const heroBlock = page.blocks.find(
    (b) => b.block_type === 'cover' && Array.isArray(b.content.images) && (b.content.images as string[]).length > 0,
  ) ?? null;
  const heroImages = heroBlock ? (heroBlock.content.images as string[]) : [];
  const heroHeight = heroImages.length > 0 ? HERO_HEIGHT : HERO_FALLBACK_HEIGHT;
  // in preview the status strip already clears the status bar, so the hero
  // controls only need their own margin
  const controlTop = previewMode ? HERO_CONTROL_TOP : insets.top + HERO_CONTROL_TOP;

  const memberLine =
    page.memberCount === null
      ? null
      : page.memberCount >= MEMBER_COUNT_THRESHOLD
        ? `${page.memberCount} in the community`
        : /* social-proof threshold: warmth under five. LIZ COPY */ 'founding members';

  const renderBlock = (block: CommunityBlock) => {
    switch (block.block_type) {
      case 'cover': {
        const images = Array.isArray(block.content.images) ? (block.content.images as string[]) : [];
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
        return (
          <View key={block.id} style={styles.block}>
            <Text style={styles.blockLabel}>who is here</Text>
            <View style={styles.facesRow}>
              {faces.map((f) => (
                f.photo ? (
                  <Image key={f.id} source={{ uri: f.photo }} style={styles.face} contentFit="cover" />
                ) : (
                  <View key={f.id} style={[styles.face, styles.facePlaceholder]}>
                    <Text style={styles.faceInitial}>{(f.name ?? '?').slice(0, 1).toLowerCase()}</Text>
                  </View>
                )
              ))}
            </View>
            {!!memberLine && <Text style={styles.quietLine}>{memberLine}</Text>}
          </View>
        );
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

  const memberBlocks = page.blocks.filter((b) => b.id !== heroBlock?.id).map(renderBlock);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      {previewMode && (
        <View style={[styles.previewBar, { paddingTop: insets.top + 4 }]}>
          {/* LIZ COPY */}
          <Text style={styles.previewBarText}>
            {previewMode === 'visitor' ? 'how a visitor sees it' : 'how a member sees it'}
          </Text>
          <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
            {/* LIZ COPY */}
            <Text style={styles.previewBarDone}>done</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.terracotta} />}
      >
        {/* the hero: community imagery first, words never over it */}
        <View style={[styles.heroContainer, { height: heroHeight }]}>
          {heroImages.length > 1 ? (
            <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
              {heroImages.map((url) => (
                <Image key={url} source={{ uri: url }} style={{ width, height: heroHeight }} contentFit="cover" />
              ))}
            </ScrollView>
          ) : heroImages.length === 1 ? (
            <Image source={{ uri: heroImages[0] }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: accent }]} />
          )}

          <TouchableOpacity
            style={[styles.circleButton, { top: controlTop, left: 16 }]}
            onPress={() => router.back()}
          >
            <ArrowLeft size={20} color={Colors.asphalt} strokeWidth={2} />
          </TouchableOpacity>
          {isMember && (
            <TouchableOpacity
              style={[styles.circleButton, { top: controlTop, right: 16 }]}
              onPress={() => router.push(`/community-thread/${id}` as never)}
            >
              <MessagesSquare size={18} color={Colors.terracotta} strokeWidth={2} />
            </TouchableOpacity>
          )}
        </View>

        {/* identity + trust: face chip over the boundary, then the name,
            the person, and (for a stranger) the one-line promise */}
        <View style={styles.identity}>
          {!!leaderCard?.avatar_url && (
            <Image source={{ uri: leaderCard.avatar_url }} style={styles.faceChip} contentFit="cover" />
          )}
          {isHouseCommunity(page.community.handle) && (
            <Text style={styles.houseMark}>{HOUSE_MARK_LABEL}</Text>
          )}
          <Text style={[styles.name, { color: accent }]}>{page.community.name}</Text>
          {!!leaderFirstName && (
            /* the card grammar: the person is visible and accountable */
            <Text style={styles.byLine}>by {leaderFirstName.toLowerCase()}</Text>
          )}
          {!!page.community.description && !isMember && (
            <Text style={styles.description}>{page.community.description}</Text>
          )}
        </View>

        <View style={styles.content}>
          {isMember ? memberBlocks : lockSections}

          {isMember && rooms.length > 0 && (
            <View style={styles.block}>
              <Text style={styles.blockLabel}>rooms</Text>
              {rooms.map((t) => (
                <View key={t.id} style={styles.roomRow}>
                  <Text style={styles.roomName} numberOfLines={1}>{t.name}</Text>
                  {t.joined ? (
                    <TouchableOpacity
                      onPress={() => router.push(`/community-topic/${t.id}` as never)}
                      hitSlop={8}
                    >
                      <Text style={styles.roomOpen}>open</Text>
                    </TouchableOpacity>
                  ) : joiningTopicId === t.id ? (
                    <ActivityIndicator size="small" color={Colors.terracotta} />
                  ) : (
                    <TouchableOpacity style={styles.roomJoinPill} onPress={() => handleJoinTopic(t.id)}>
                      <Text style={styles.roomJoinText}>join in</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </View>
          )}

          {!isMember && (
            <View style={styles.lockFooter}>
              {!!memberLine && <Text style={styles.quietLine}>{memberLine}</Text>}
              {/* LIZ COPY: the comfort signal (doc 37): the question a
                  stranger at the door is really asking */}
              <Text style={styles.quietLine}>most people come on their own.</Text>
              {membership?.status === 'pending' ? (
                <View style={styles.pendingCard}>
                  <Text style={styles.pendingText}>
                    your request is in. a real person reads every one.
                  </Text>
                </View>
              ) : membership && ['declined', 'removed', 'banned'].includes(membership.status) ? (
                <Text style={styles.quietLine}>this community is not open to you right now.</Text>
              ) : (
                /* the action pill (doc 37 button canon): terracotta outline,
                   fully rounded, the tap that does something now */
                <TouchableOpacity
                  style={styles.joinBtn}
                  activeOpacity={0.85}
                  onPress={() => {
                    if (previewMode) {
                      // LIZ COPY
                      setAlertInfo({ title: 'just a preview', message: 'the ask to join button works for visitors.' });
                      return;
                    }
                    setPopupOpen(true);
                  }}
                >
                  {/* LIZ COPY */}
                  <Text style={styles.joinBtnText}>ask to join {'→'}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          <Text style={styles.poweredBy}>powered by washedup</Text>
        </View>
      </ScrollView>

      <BrandedAlert
        visible={!!alertInfo}
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message}
        buttons={alertInfo?.buttons}
        onClose={() => setAlertInfo(null)}
      />

      {gate && (
        <JoinCommunityPopup
          visible={popupOpen}
          gate={gate}
          onClose={() => setPopupOpen(false)}
          onRequested={() => {
            setPopupOpen(false);
            queryClient.invalidateQueries({ queryKey: ['community-membership', id] });
          }}
        />
      )}
    </View>
  );
}

function EventRow({ event, onPress }: { event: CommunityPageEvent; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.eventRow} onPress={onPress} activeOpacity={0.85}>
      {event.image_url ? (
        <Image source={{ uri: event.image_url }} style={styles.eventThumb} contentFit="cover" />
      ) : (
        <GeneratedPoster title={event.title} category={event.category} venue={null} height={EVENT_THUMB} compact />
      )}
      <View style={styles.eventText}>
        <Text style={styles.eventTitle} numberOfLines={1}>{event.title}</Text>
        <Text style={styles.eventMeta} numberOfLines={1}>
          {event.event_date ? formatEventDateLA(event.event_date) : 'date coming'}
          {event.venue ? ` · ${event.venue}` : ''}
        </Text>
      </View>
      <ChevronRight size={16} color={Colors.textLight} strokeWidth={2} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrollContent: { paddingBottom: 60 },
  heroContainer: { width: '100%', position: 'relative' },
  circleButton: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.overlayWhite90,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.shadowBlack,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  identity: {
    paddingHorizontal: 20,
    paddingTop: FACE_CHIP / 2 + 8,
    position: 'relative',
  },
  faceChip: {
    position: 'absolute',
    left: 20,
    top: -(FACE_CHIP / 2),
    width: FACE_CHIP,
    height: FACE_CHIP,
    borderRadius: FACE_CHIP / 2,
    borderWidth: 2,
    borderColor: Colors.white,
    backgroundColor: Colors.cardBg,
  },
  houseMark: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1,
    marginBottom: 2,
  },
  name: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayLG,
    lineHeight: LineHeights.displayLG,
  },
  byLine: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    marginTop: 2,
  },
  description: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.secondary,
    lineHeight: LineHeights.bodyMD,
    marginTop: 8,
  },
  founderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  founderFace: { width: 56, height: 56, borderRadius: 28 },
  founderName: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.secondary },
  // preview banner: neutral status strip, quiet on purpose; "done" is the
  // standard ghost link (the gold exception list stays closed)
  previewBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.inputBg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  previewBarText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.secondary },
  previewBarDone: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  content: { paddingHorizontal: 20, paddingTop: 20 },
  coverStrip: { marginBottom: 20 },
  coverStripImage: { width: 220, height: 130, borderRadius: 12 },
  headerBlock: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  logo: { width: 44, height: 44, borderRadius: 999 },
  tagline: {
    flex: 1,
    fontFamily: Fonts.displayItalic,
    fontSize: FontSizes.bodyLG,
    color: Colors.darkWarm,
    lineHeight: LineHeights.bodyLG,
  },
  block: { marginBottom: 20 },
  blockLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  bodyText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.darkWarm, lineHeight: LineHeights.bodyMD },
  quietLine: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary, marginTop: 4 },
  emptyLine: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.secondary },
  // poster-led event rows (slice-1 compact-card language): thumb, words in
  // their own zone, the house separator in the meta line
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 10,
    marginBottom: 8,
  },
  eventThumb: { width: EVENT_THUMB, height: EVENT_THUMB, borderRadius: 12 },
  eventText: { flex: 1, gap: 2 },
  eventTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  eventMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary },
  facesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  face: { width: 36, height: 36, borderRadius: 18 },
  facePlaceholder: { backgroundColor: Colors.accentSubtle, alignItems: 'center', justifyContent: 'center' },
  faceInitial: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  galleryRow: { gap: 8 },
  galleryImage: { width: 130, height: 130, borderRadius: 12 },
  link: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.terracotta, paddingVertical: 4 },
  pinnedBlock: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    borderLeftWidth: 3,
    borderLeftColor: Colors.gold,
    padding: 14,
  },
  pinnedTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm, marginBottom: 4 },
  roomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  roomName: { flex: 1, fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  roomOpen: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  roomJoinPill: {
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  roomJoinText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  lockFooter: { marginTop: 4, gap: 6 },
  pendingCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: Colors.gold,
    padding: 14,
    marginTop: 10,
  },
  pendingText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.darkWarm, lineHeight: LineHeights.bodyMD },
  // the action pill (button canon): terracotta outline on white, fully
  // rounded, warm shadow: matching the plans-feed canon screen
  joinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    paddingVertical: 14,
    marginTop: 12,
    shadowColor: Colors.terracotta,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },
  joinBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.terracotta },
  poweredBy: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
    textAlign: 'center',
    marginTop: 24,
  },
});
