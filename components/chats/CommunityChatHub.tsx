import { EventMediaImage } from '../events/EventMediaImage';
import React, { useMemo } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { AfterglowColors as Colors } from '../../constants/Colors';
import { AfterglowType } from '../../constants/Typography';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import type { CommunityChatRowData } from '../../lib/communityChat';
import type { CommunityInboxGroup } from '../../lib/communityChatInbox';
import type { useCommunityChatPreference } from '../../hooks/useCommunityChatPreference';
import { CommunityChatRow } from './CommunityChatRow';

interface Props {
  group: CommunityInboxGroup;
  profileAction?: React.ReactNode;
  onBack: () => void;
  onViewCommunity: () => void;
  onBrowseGroups?: () => void;
  onOpenRoom: (row: CommunityChatRowData) => void;
  onRefresh: () => void;
  refreshing: boolean;
  notifications?: ReturnType<typeof useCommunityChatPreference>;
}

/** Presentation over authorized source rows. Opening this directory marks no
 * conversation read and performs no join, rename or preference mutation. */
export function CommunityChatHub({ group, profileAction, onBack, onViewCommunity, onBrowseGroups, onOpenRoom, onRefresh, refreshing, notifications }: Props) {
  const { fonts } = useAfterglowFonts();
  const rows = useMemo(() => [
    { key: 'rooms-heading', heading: 'Your chats' },
    ...group.rooms.map(row => ({ key: row.key, row })),
    ...(group.eventRooms.length ? [
      { key: 'events-heading', heading: 'Event chats' },
      ...group.eventRooms.map(row => ({ key: `event-shortcut:${row.key}`, row })),
    ] : []),
  ], [group]);

  return (
    <View style={styles.container}>
      <View style={styles.top}>
        <TouchableOpacity onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to Chats" style={styles.back}>
          <ChevronLeft color={Colors.clay} size={22} />
          <Text style={[styles.backText, { fontFamily: fonts.medium }]}>Chats</Text>
        </TouchableOpacity>
        {profileAction}
      </View>
      <FlatList
        data={rows}
        keyExtractor={item => item.key}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.clay} />}
        ListHeaderComponent={
          <>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`View ${group.row.title} community`} onPress={onViewCommunity} style={styles.identity}>
              {group.row.image ? <EventMediaImage eventId={group.row.eventId ?? ''} reference={group.row.image} style={styles.image} contentFit="cover" /> :
                <View style={[styles.image, styles.fallback]}><Text allowFontScaling={false} accessible={false} aria-hidden style={[styles.initial, { fontFamily: fonts.display }]}>{Array.from(group.row.title.trim())[0]}</Text></View>}
              <View style={styles.identityText}>
                <Text style={[styles.name, { fontFamily: fonts.display }]}>{group.row.title}</Text>
                <View style={styles.communityLink}><Text style={[styles.link, { fontFamily: fonts.medium }]}>View community</Text><ChevronRight size={16} color={Colors.clay} /></View>
              </View>
            </TouchableOpacity>
          </>
        }
        renderItem={({ item }) => 'heading' in item ? (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { fontFamily: fonts.semibold }]}>{item.heading}</Text>
            {item.key === 'rooms-heading' && group.row.roomRole === 'main' && onBrowseGroups && <TouchableOpacity onPress={onBrowseGroups} accessibilityRole="button" accessibilityLabel="Browse community groups" style={styles.back}>
              <Text style={[styles.link, { fontFamily: fonts.medium }]}>Browse groups</Text><ChevronRight size={16} color={Colors.clay} />
            </TouchableOpacity>}
            {item.key === 'events-heading' && <Text style={[styles.hint, { fontFamily: fonts.regular }]}>Also in your Chats list.</Text>}
          </View>
        ) : (
          <View style={styles.room}>
            <CommunityChatRow
              row={{ ...item.row, ...(item.row.kind === 'community' ? { title: item.row.roomName || item.row.title } : {}),
                ...(notifications && (item.row.kind === 'community' || item.row.eventId === null) ? { communityMuted: notifications.data && !notifications.error && !notifications.pending ? notifications.data.muted : null } : {}) }}
              onPress={() => onOpenRoom(item.row)}
              conversationFonts={fonts}
            />
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.paper },
  top: { paddingHorizontal: 20, paddingTop: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  back: { alignSelf: 'flex-start', minHeight: 44, flexDirection: 'row', alignItems: 'center', paddingRight: 12 },
  backText: { ...AfterglowType.body, color: Colors.clay },
  list: { paddingBottom: 28 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 25 },
  image: { width: 80, height: 80, borderRadius: 8, backgroundColor: Colors.avatar },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  initial: { ...AfterglowType.identity, color: Colors.clay },
  identityText: { flex: 1, gap: 8 },
  name: { ...AfterglowType.identity, color: Colors.ink },
  communityLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  link: { ...AfterglowType.caption, color: Colors.clay },
  hint: { ...AfterglowType.timestamp, color: Colors.muted, flexShrink: 1 },
  section: { minHeight: 44, paddingHorizontal: 20, paddingTop: 13, paddingBottom: 5, gap: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.line },
  sectionTitle: { ...AfterglowType.section, color: Colors.muted },
  room: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.subtleLine },
});
