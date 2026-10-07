/**
 * CircleMembersRow - the circle's roster as a horizontal row of face chips
 * (photo + first name). Read-only in v1; admin management lands in Step 8.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Plus } from 'lucide-react-native';
import Colors, { AfterglowColors, CreatorSurfaceColors, SceneDetailColors as Scene } from '../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';
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

type Appearance = { fonts: AfterglowFontFamilies };
function MemberChip({ member, appearance }: { member: CircleMember; appearance?: Appearance }) {
  const name = displayName(member);
  const { fontScale } = useWindowDimensions();
  const [failed, setFailed] = useState(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const s = useMemo(() => appearance ? { ...styles, ...memberAppearance(appearance.fonts) } : styles, [appearance?.fonts]);
  return (
    <View style={[s.chip, appearance && { width: Math.max(58, 58 * fontScale) }]} accessible accessibilityLabel={name}>
      {member.profile_photo_url && !failed ? (
        <Image
          source={{ uri: member.profile_photo_url }}
          style={s.avatar}
          contentFit="cover" cachePolicy="memory-disk" recyclingKey={member.profile_photo_url}
          accessible={false} onError={() => { if (mounted.current) setFailed(true); }}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[s.avatar, s.avatarFallback]}>
          <Text style={s.initial} accessible={false}>{initialOf(member)}</Text>
        </View>
      )}
      <Text style={s.name} numberOfLines={appearance ? undefined : 1} accessible={false}>
        {name}
      </Text>
    </View>
  );
}

export default function CircleMembersRow({
  members,
  onAdd,
  appearance,
}: {
  members: CircleMember[];
  onAdd?: () => void;
  appearance?: Appearance;
}) {
  const s = useMemo(() => appearance ? { ...styles, ...memberAppearance(appearance.fonts) } : styles, [appearance?.fonts]);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.row}
      keyboardShouldPersistTaps="handled"
    >
      {members.map((m) => (
        <MemberChip key={JSON.stringify([m.user_id, m.profile_photo_url])} member={m} appearance={appearance}/>
      ))}
      {onAdd && (
        <Pressable
          onPress={onAdd}
          style={s.chip}
          accessibilityRole="button"
          accessibilityLabel={COPY.circleAddTitle}
        >
          <View style={[s.avatar, s.addAvatar]}>
            <Plus size={20} color={appearance ? AfterglowColors.clay : Colors.terracotta} strokeWidth={2} />
          </View>
          <Text style={[s.name, s.addName]} numberOfLines={1}>
            {appearance ? 'Add' : COPY.circleAddCell}
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

function memberAppearance(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  row: { ...styles.row, gap: 12, paddingHorizontal: 20 },
  chip: { ...styles.chip, width: 58, minHeight: 66 },
  avatar: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: AfterglowColors.white, backgroundColor: CreatorSurfaceColors.sunsetGoldLight, opacity: 1 },
  avatarFallback: { ...styles.avatarFallback, backgroundColor: CreatorSurfaceColors.sunsetGoldLight },
  initial: { ...AfterglowType.body, fontFamily: fonts.regular, color: Scene.text },
  name: { ...AfterglowType.caption, fontFamily: fonts.regular, color: Scene.text, marginTop: 5, textAlign: 'center' },
  addAvatar: { ...styles.addAvatar, backgroundColor: AfterglowColors.paper, borderColor: AfterglowColors.line, borderStyle: 'solid' },
  addName: { fontFamily: fonts.semibold, color: AfterglowColors.clay },
}); }
