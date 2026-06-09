/**
 * CircleMemberStack - the overlapping member-avatar row on a directory card.
 *
 * A short stack of member faces (photo, or initial fallback) with a card-colored
 * ring so they read as separate while overlapping, then a "+N" overflow chip when
 * the circle has more members than faces shown. Faces come from
 * useCircleMemberPreviews; the overflow is computed against member_count so the
 * count stays right even though only a few faces are fetched.
 */
import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
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
}: {
  members: MemberPreview[];
  memberCount: number;
}) {
  if (members.length === 0) return null;

  const faces = members.slice(0, CIRCLE_DIR.maxFaces);
  // Overflow is against the true member count, not just the fetched faces.
  const overflow = Math.max(0, memberCount - faces.length);

  return (
    <View style={styles.row}>
      {faces.map((m, i) => (
        <View key={m.user_id} style={[styles.faceWrap, i > 0 && styles.overlap]}>
          {m.photo_url ? (
            <Image
              source={{ uri: m.photo_url }}
              style={styles.face}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <View style={[styles.face, styles.faceFallback]}>
              <Text style={styles.initial}>{initialOf(m)}</Text>
            </View>
          )}
        </View>
      ))}
      {overflow > 0 && (
        <View style={[styles.faceWrap, styles.overlap, styles.overflowWrap]}>
          <Text style={styles.overflowText}>{COPY.circleDirOverflow(overflow)}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
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
