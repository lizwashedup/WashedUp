/**
 * CircleMemberStack - the overlapping member-avatar row on a directory card.
 *
 * A short stack of member faces (photo, or initial fallback) with a card-colored
 * ring so they read as separate while overlapping, then a "+N" overflow chip when
 * the circle has more members than faces shown. Faces come from
 * useCircleMemberPreviews; the overflow is computed against member_count so the
 * count stays right even though only a few faces are fetched.
 */
import React, { useState } from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { ScaledText as Text } from '../../ScaledText';
import { Image } from 'expo-image';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../../constants/Typography';
import { CIRCLE_DIR } from '../../../constants/YoursDesign';
import { COPY } from '../state/constants';
import type { MemberPreview } from '../../../lib/circles/types';

function initialOf(m: MemberPreview): string {
  const first = Array.from((m.name ?? '').trim())[0];
  return first ? first.toUpperCase() : '?';
}

export default function CircleMemberStack({
  members,
  memberCount,
  appearance,
  compact = false,
}: {
  members: MemberPreview[];
  memberCount: number;
  appearance?: { fonts: AfterglowFontFamilies };
  /** Three small real portraits for the grouped directory; defaults unchanged. */
  compact?: boolean;
}) {
  const { fontScale } = useWindowDimensions();
  const compactSize = Math.round(20 * Math.max(1, fontScale));
  const compactFace = { width: compactSize, height: compactSize, borderRadius: compactSize / 2 };
  if (members.length === 0) return null;

  const faces = members.slice(0, compact ? 3 : CIRCLE_DIR.maxFaces);
  // Overflow is against the true member count, not just the fetched faces.
  const overflow = Math.max(0, memberCount - faces.length);

  return (
    <View style={[styles.row, compact && { flexWrap: 'wrap', rowGap: 4 }]} accessible={compact ? false : undefined}>
      {faces.map((m, i) => (
        <View key={m.user_id} style={[styles.faceWrap, appearance && { borderColor: AfterglowColors.paper }, compact && { borderWidth: 1, borderColor: AfterglowColors.white }, i > 0 && (compact ? { marginLeft: -2 } : styles.overlap)]}>
          {appearance ? <MemberFace key={`${m.user_id}:${m.photo_url ?? ''}`} member={m} appearance={appearance} compactSize={compact ? compactSize : undefined}/> : m.photo_url ? (
            <Image
              source={{ uri: m.photo_url }}
              style={[styles.face, compact && compactFace]}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <View style={[styles.face, styles.faceFallback, compact && compactFace]}>
              <Text style={[styles.initial, compact && AfterglowType.timestamp]}>{initialOf(m)}</Text>
            </View>
          )}
        </View>
      ))}
      {overflow > 0 && (compact ? <Text style={[styles.compactOverflow, appearance && { fontFamily: appearance.fonts.regular, color: AfterglowColors.muted }]}>{COPY.circleDirOverflow(overflow)}</Text> : <View style={[styles.faceWrap, styles.overlap, styles.overflowWrap, appearance && { borderColor: AfterglowColors.paper, backgroundColor: AfterglowColors.avatar }]}>
          <Text style={[styles.overflowText, appearance && { ...AfterglowType.timestamp, fontFamily: appearance.fonts.semibold, color: AfterglowColors.muted }]}>{COPY.circleDirOverflow(overflow)}</Text>
        </View>
      )}
    </View>
  );
}

function MemberFace({ member, appearance, compactSize }: { member: MemberPreview; appearance: { fonts: AfterglowFontFamilies }; compactSize?: number }) {
  const face = [styles.face, compactSize ? { width: compactSize, height: compactSize, borderRadius: compactSize / 2 } : undefined];
  const [failed, setFailed] = useState(false);
  return member.photo_url && !failed ? <Image source={{ uri: member.photo_url }} style={face} contentFit="cover" accessibilityIgnoresInvertColors onError={() => setFailed(true)}/> :
    <View style={[face, styles.faceFallback, { backgroundColor: AfterglowColors.avatar }]}><Text style={{ ...(compactSize ? AfterglowType.timestamp : AfterglowType.caption), fontFamily: appearance.fonts.semibold, color: AfterglowColors.muted }}>{initialOf(member)}</Text></View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  compactOverflow: { ...AfterglowType.timestamp, fontFamily: Fonts.sans, color: Colors.secondary, marginLeft: 8 },
  faceWrap: {
    borderRadius: CIRCLE_DIR.avatar / 2,
    borderWidth: CIRCLE_DIR.avatarBorder,
    borderColor: Colors.cardBg,
  },
  overlap: { marginLeft: -CIRCLE_DIR.avatarOverlap },
  face: {
    width: CIRCLE_DIR.avatar,
    height: CIRCLE_DIR.avatar,
    borderRadius: CIRCLE_DIR.avatar / 2,
    backgroundColor: Colors.inputBg,
  },
  faceFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.brandSoft,
  },
  initial: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
  },
  overflowWrap: {
    width: CIRCLE_DIR.avatar,
    height: CIRCLE_DIR.avatar,
    borderRadius: CIRCLE_DIR.avatar / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.brandSoft,
  },
  overflowText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
  },
});
