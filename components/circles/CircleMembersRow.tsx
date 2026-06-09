/**
 * CircleMembersRow - the circle's roster as a horizontal row of face chips
 * (photo + first name). Read-only in v1; admin management lands in Step 8.
 */
import React from 'react';
import { View, Text, Image, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Plus } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { CIRCLE_HOME } from '../../constants/YoursDesign';
import { COPY } from '../yours/state/constants';
import type { CircleMember } from '../../lib/circles/types';

function displayName(m: CircleMember): string {
  return m.first_name_display?.trim() || m.handle?.trim() || COPY.circleMemberFallback;
}

function initialOf(m: CircleMember): string {
  // displayName never returns empty (it falls back to COPY.circleMemberFallback),
  // so the first grapheme is always present.
  return Array.from(displayName(m))[0].toUpperCase();
}

function MemberChip({ member }: { member: CircleMember }) {
  const name = displayName(member);
  return (
    <View style={styles.chip}>
      {member.profile_photo_url ? (
        <Image
          source={{ uri: member.profile_photo_url }}
          style={styles.avatar}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback]}>
          <Text style={styles.initial}>{initialOf(member)}</Text>
        </View>
      )}
      <Text style={styles.name} numberOfLines={1}>
        {name}
      </Text>
    </View>
  );
}

export default function CircleMembersRow({
  members,
  onAdd,
}: {
  members: CircleMember[];
  onAdd?: () => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {members.map((m) => (
        <MemberChip key={m.user_id} member={m} />
      ))}
      {onAdd && (
        <Pressable
          onPress={onAdd}
          style={styles.chip}
          accessibilityRole="button"
          accessibilityLabel={COPY.circleAddTitle}
        >
          <View style={[styles.avatar, styles.addAvatar]}>
            <Plus size={20} color={Colors.terracotta} strokeWidth={2} />
          </View>
          <Text style={[styles.name, styles.addName]} numberOfLines={1}>
            {COPY.circleAddCell}
          </Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: CIRCLE_HOME.sectionPadH,
    gap: CIRCLE_HOME.memberChipGap,
  },
  chip: {
    alignItems: 'center',
    width: CIRCLE_HOME.memberChipWidth,
  },
  avatar: {
    width: CIRCLE_HOME.memberAvatar,
    height: CIRCLE_HOME.memberAvatar,
    borderRadius: CIRCLE_HOME.memberAvatar / 2,
    backgroundColor: Colors.inputBg,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.brandSoft,
  },
  addAvatar: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.brandSoft,
    borderWidth: 1,
    borderColor: Colors.terracotta,
    borderStyle: 'dashed',
  },
  initial: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.terracotta,
  },
  name: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.secondary,
    marginTop: CIRCLE_HOME.memberNameGap,
    textAlign: 'center',
  },
  addName: {
    fontFamily: Fonts.sansBold,
    color: Colors.terracotta,
  },
});
