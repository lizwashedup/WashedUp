import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MessageCircle, Users } from 'lucide-react-native';
import Colors, { AfterglowColors, CreatorSurfaceColors } from '../../constants/Colors';
import { AfterglowType } from '../../constants/Typography';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { CreatorActionFill } from '../creator/CreatorActionFill';

type Props = {
  rooms: ReadonlyArray<{ id: string; name: string; joined: boolean }>;
  joiningTopicId: string | null;
  onOpenMain: () => void;
  onOpenTopic: (id: string) => void;
  onJoinTopic: (id: string) => void;
};

/** The original community/thread identities, using the same compact room anatomy. */
export function LegacyCommunityRoomDirectory({ rooms, joiningTopicId, onOpenMain, onOpenTopic, onJoinTopic }: Props) {
  const { fonts } = useAfterglowFonts();
  const row = (id: string, name: string, joined: boolean, main = false) => {
    const pending = joiningTopicId === id;
    return <View key={id} style={styles.row}>
      <View style={styles.icon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {main ? <MessageCircle size={22} color={AfterglowColors.ink} /> : <Users size={22} color={AfterglowColors.ink} />}
      </View>
      <Text style={[styles.name, { fontFamily: fonts.semibold }]}>{name}</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={pending ? `Joining ${name}` : `${joined ? 'Open' : 'Join'} ${name}`}
        accessibilityState={{ disabled: pending, busy: pending }} disabled={pending}
        onPress={() => main ? onOpenMain() : joined ? onOpenTopic(id) : onJoinTopic(id)} style={styles.action}>
        <CreatorActionFill />
        {pending ? <ActivityIndicator color={Colors.white} /> : <Text style={[styles.actionText, { fontFamily: fonts.semibold }]}>{joined ? 'Open' : 'Join'}</Text>}
      </TouchableOpacity>
    </View>;
  };
  return <View style={styles.section}>
    <LinearGradient pointerEvents="none" colors={[CreatorSurfaceColors.sunsetGoldLight, CreatorSurfaceColors.sunsetGoldMiddle, CreatorSurfaceColors.sunsetGoldWarm]}
      locations={[0, 0.55, 1]} start={{x:0,y:0}} end={{x:1,y:1}} style={StyleSheet.absoluteFill} />
    <Text accessibilityRole="header" style={[styles.heading, { fontFamily: fonts.semibold }]}>Chats</Text>
    {row('main', 'Community chat', true, true)}
    {rooms.map(room => row(room.id, room.name, room.joined))}
  </View>;
}

const styles = StyleSheet.create({
  section: { width: '100%', alignSelf: 'stretch', borderRadius: 20, overflow: 'hidden', padding: 12, gap: 10 },
  heading: { ...AfterglowType.contextTitle, color: AfterglowColors.ink, padding: 2 },
  row: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 68, padding: 10,
    borderRadius: 14, backgroundColor: AfterglowColors.white, borderWidth: 1, borderColor: CreatorSurfaceColors.goldEdge },
  icon: { width: 28, alignItems: 'center', flexShrink: 0 },
  name: { ...AfterglowType.body, color: AfterglowColors.ink, flex: 1, minWidth: 0 },
  action: { minWidth: 62, minHeight: 44, flexShrink: 0, borderRadius: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  actionText: { ...AfterglowType.caption, color: Colors.white },
});
