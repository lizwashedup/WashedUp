/**
 * The community page, member projection (doc 09: one block tree, three
 * projections; this is the app home). Non-members get the lock view (cover,
 * header, about, member count, next event, ask to join); pending requesters
 * get the waiting state; members get the full tree plus the door into the
 * chat. Hosts the JoinCommunityPopup, which completes the join loop end to
 * end. Functionally minimal per decision 15a; the design pass reshapes this
 * with Liz later.
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { ArrowLeft, MessagesSquare } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { JoinCommunityPopup } from '../../components/communities/JoinCommunityPopup';
import { getCommunityPage, getMemberFaces, type CommunityPageEvent } from '../../lib/communityPage';
import { getJoinGate, getMyMembership } from '../../lib/communityJoin';
import type { CommunityBlock } from '../../lib/communityBlocks';

const LOCK_VIEW_BLOCKS = ['cover', 'header', 'about'];
const COVER_HEIGHT_RATIO = 0.56;

export default function CommunityPageScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { width } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
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
  const isMember = membership?.status === 'active';
  const { data: faces = [] } = useQuery({
    queryKey: ['community-faces', id],
    queryFn: () => getMemberFaces(id!),
    enabled: !!id && isMember,
  });

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
  const visibleBlocks = isMember
    ? page.blocks
    : page.blocks.filter((b) => LOCK_VIEW_BLOCKS.includes(b.block_type));
  const nextEvent = page.events[0] ?? null;

  const renderBlock = (block: CommunityBlock) => {
    switch (block.block_type) {
      case 'cover': {
        const images = Array.isArray(block.content.images) ? (block.content.images as string[]) : [];
        if (images.length === 0) return null;
        return (
          <ScrollView key={block.id} horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={styles.coverStrip}>
            {images.map((url) => (
              <Image
                key={url}
                source={{ uri: url }}
                style={{ width: width - 40, height: (width - 40) * COVER_HEIGHT_RATIO, borderRadius: 16 }}
                contentFit="cover"
              />
            ))}
          </ScrollView>
        );
      }
      case 'header': {
        const tagline = typeof block.content.tagline === 'string' ? block.content.tagline : null;
        const logo = typeof block.content.logo_url === 'string' ? block.content.logo_url : null;
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
            {page.memberCount !== null && (
              <Text style={styles.quietLine}>{page.memberCount} in the community</Text>
            )}
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
      default:
        return null;
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2.5} />
        </TouchableOpacity>
        {isMember && (
          <TouchableOpacity
            style={styles.chatLink}
            onPress={() => router.push(`/community-chat/${id}` as never)}
            hitSlop={8}
          >
            <MessagesSquare size={18} color={Colors.terracotta} strokeWidth={2.5} />
            <Text style={styles.chatLinkText}>open the chat</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.terracotta} />}
      >
        <Text style={[styles.name, { color: accent }]}>{page.community.name}</Text>
        {!!page.community.description && !isMember && (
          <Text style={styles.description}>{page.community.description}</Text>
        )}

        {visibleBlocks.map(renderBlock)}

        {!isMember && (
          <View style={styles.lockFooter}>
            {page.memberCount !== null && (
              <Text style={styles.quietLine}>{page.memberCount} in the community</Text>
            )}
            {nextEvent && (
              <Text style={styles.quietLine}>
                next up: {nextEvent.title}
                {nextEvent.event_date ? `, ${new Date(nextEvent.event_date).toLocaleDateString()}` : ''}
              </Text>
            )}
            {membership?.status === 'pending' ? (
              <View style={styles.pendingCard}>
                <Text style={styles.pendingText}>
                  your request is with the leader. they read every one personally.
                </Text>
              </View>
            ) : membership && ['declined', 'removed', 'banned'].includes(membership.status) ? (
              <Text style={styles.quietLine}>this community is not open to you right now.</Text>
            ) : (
              <TouchableOpacity
                style={[styles.joinBtn, { backgroundColor: accent }]}
                onPress={() => setPopupOpen(true)}
              >
                <Text style={styles.joinBtnText}>ask to join</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        <Text style={styles.poweredBy}>powered by washedup</Text>
      </ScrollView>

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
    </SafeAreaView>
  );
}

function EventRow({ event, onPress }: { event: CommunityPageEvent; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.eventRow} onPress={onPress}>
      <View style={styles.eventText}>
        <Text style={styles.eventTitle} numberOfLines={1}>{event.title}</Text>
        <Text style={styles.eventMeta}>
          {event.event_date ? new Date(event.event_date).toLocaleDateString() : 'date coming'}
          {event.venue ? `  ${event.venue}` : ''}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  chatLink: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chatLinkText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  content: { padding: 20, paddingBottom: 60 },
  name: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayLG,
    lineHeight: LineHeights.displayLG,
    marginBottom: 6,
  },
  description: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.secondary,
    lineHeight: LineHeights.bodyMD,
    marginBottom: 14,
  },
  coverStrip: { marginBottom: 16 },
  headerBlock: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
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
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  bodyText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.darkWarm, lineHeight: LineHeights.bodyMD },
  quietLine: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary, marginTop: 4 },
  emptyLine: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.secondary },
  eventRow: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    marginBottom: 8,
  },
  eventText: { gap: 2 },
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
  joinBtn: {
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  joinBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.white },
  poweredBy: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
    textAlign: 'center',
    marginTop: 24,
  },
});
