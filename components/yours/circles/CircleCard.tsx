/**
 * CircleCard - a compact joined conversation row in the inspected appearance.
 * Legacy rich-card presentation remains opt-out.
 *
 * Refined rows show a compact identity tile, full name, true member count,
 * supplied last-message time and a few real member portraits. No preview or
 * activity is invented when the data is absent.
 *
 * The identity tile follows the same ladder as the circle home: a manual cover
 * wins; with none, the living cover is a tight mosaic of the circle's newest
 * shared plan-album photos (get_circle().recent_together, signed); with
 * neither, the serif monogram tile. The get_circle fetch is skipped entirely
 * for circles that already have a manual cover, and its payload pre-warms the
 * circle home (same React Query key).
 */
import React, { useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { ScaledText as Text } from '../../ScaledText';
import { Image } from 'expo-image';
import { ChevronRight } from 'lucide-react-native';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../../constants/Typography';
import { CIRCLE_DIR, TYPE } from '../../../constants/YoursDesign';
import { COPY } from '../state/constants';
import { hapticSelection } from '../../../lib/haptics';
import type { MyCircle, MemberPreview } from '../../../lib/circles/types';
import { buildCircleCoverUrl } from '../../../lib/circles/coverUrl';
import { relativeActivity } from '../../../lib/circles/relativeActivity';
import { useCircle } from '../../../hooks/useCircle';
import { useSignedAlbumUrls } from '../../../hooks/useSignedAlbumUrls';
import CircleCover from './CircleCover';
import CircleLivingMosaic from './CircleLivingMosaic';
import CircleMemberStack from './CircleMemberStack';

export default function CircleCard({
  circle,
  members,
  onPress,
  appearance,
  groupPosition = 'single',
}: {
  circle: MyCircle;
  members: MemberPreview[];
  onPress: (id: string) => void;
  appearance?: { fonts: AfterglowFontFamilies };
  groupPosition?: 'first' | 'middle' | 'last' | 'single';
}) {
  const title =
    (circle.name ?? '').trim() || circle.display_name || COPY.circleUnnamed;

  // Identity ladder: manual cover > living mosaic > monogram. The detail fetch
  // only runs for circles WITHOUT a manual cover (useCircle disables on null).
  const manualCoverUrl = buildCircleCoverUrl(circle.id, circle.cover_upload_id);
  const { data: detail } = useCircle(manualCoverUrl ? null : circle.id);
  const recentPaths = (detail?.recent_together ?? [])
    .slice(0, 4)
    .map((p) => p.media_path);
  const { data: signed = {} } = useSignedAlbumUrls(recentPaths);
  const mosaicUris = recentPaths
    .map((p) => signed[p])
    .filter((u): u is string => !!u);

  // Warm last-activity clause; falls to the quiet line when nothing recent.
  const rel = relativeActivity(circle.last_message_at);
  const activity = rel ? COPY.circleActive(rel) : COPY.circleQuiet;

  if (appearance) {
    const styled = afterglow(appearance.fonts);
    const first = groupPosition === 'first' || groupPosition === 'single';
    const last = groupPosition === 'last' || groupPosition === 'single';
    const label = `${title}, ${COPY.circleMembers(circle.member_count)}${rel ? `, last message ${rel}` : ''}`;
    return <Pressable cssInterop={false} onPress={() => { hapticSelection(); onPress(circle.id); }}
      accessibilityRole="button" accessibilityLabel={label} style={styled.hit}>
      {({ pressed }) => <View style={[styled.surface, first && styled.first, last && styled.last, pressed && styled.pressed]}>
        <View style={styled.row}>
          <View accessible={false}>
            {!manualCoverUrl && mosaicUris.length > 0 ? <CircleLivingMosaic uris={mosaicUris} size={50} radius={14}
              fallback={<CircleCover name={title} size={50} radius={14} monogramSize={AfterglowType.identity.fontSize} appearance={appearance}/>}/> :
              <DirectoryCover key={`${circle.id}:${manualCoverUrl ?? ''}`} title={title} url={manualCoverUrl} appearance={appearance}/>}
          </View>
          <View style={styled.body}>
            <Text style={styled.name}>{title}</Text>
            <View style={styled.metadata}>
              <Text style={styled.meta}>{COPY.circleMembers(circle.member_count)}</Text>
              {rel && <Text style={styled.activity} accessibilityLabel={`Last message ${rel}`}>{rel}</Text>}
            </View>
            <CircleMemberStack members={members} memberCount={circle.member_count} appearance={appearance} compact/>
          </View>
          <ChevronRight size={16} color={AfterglowColors.muted}/>
        </View>
        {!last && <View style={styled.separator} importantForAccessibility="no"/>}
      </View>}
    </Pressable>;
  }

  return (
    <Pressable
      onPress={() => {
        hapticSelection();
        onPress(circle.id);
      }}
      style={styles.hit}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${COPY.circleMembers(circle.member_count)}`}
    >
      {({ pressed }) => (
        // The fill (bg + shadow + border) lives on this inner View: a styled
        // Pressable does not paint its background as a child cell here.
        <View style={[styles.card, pressed && styles.pressed]}>
          <View style={styles.top}>
            {!manualCoverUrl && mosaicUris.length > 0 ? (
              <CircleLivingMosaic
                uris={mosaicUris}
                size={CIRCLE_DIR.cover}
                radius={CIRCLE_DIR.coverRadius}
              />
            ) : (
              <CircleCover
                name={title}
                coverUrl={manualCoverUrl}
                tone="gold"
                size={CIRCLE_DIR.cover}
                radius={CIRCLE_DIR.coverRadius}
                monogramSize={CIRCLE_DIR.monogram}
              />
            )}
            <View style={styles.textCol}>
              <Text style={styles.name} numberOfLines={1}>
                {title}
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                {COPY.circleMembers(circle.member_count)} · {activity}
              </Text>
            </View>
          </View>

          <View style={styles.avatars}>
            <CircleMemberStack members={members} memberCount={circle.member_count} />
          </View>
        </View>
      )}
    </Pressable>
  );
}

/** A failed manual thumbnail keeps the circle's own identity; the shared cover
 * component and the manual-cover > album mosaic > monogram source order stay intact. */
function DirectoryCover({ title, url, appearance }: { title: string; url: string | null; appearance: { fonts: AfterglowFontFamilies } }) {
  const [failed, setFailed] = useState(false);
  return url && !failed ? <Image source={{ uri: url }} style={{ width: 50, height: 50, borderRadius: 14 }} contentFit="cover" accessibilityIgnoresInvertColors onError={() => setFailed(true)}/> :
    <CircleCover name={title} size={50} radius={14} monogramSize={AfterglowType.identity.fontSize} appearance={appearance}/>;
}

function afterglow(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  hit: { marginHorizontal: 20, minHeight: 44 },
  surface: { backgroundColor: AfterglowColors.white, borderLeftWidth: 1, borderRightWidth: 1, borderColor: AfterglowColors.subtleLine, overflow: 'hidden' },
  first: { borderTopLeftRadius: 18, borderTopRightRadius: 18, borderTopWidth: 1 },
  last: { borderBottomLeftRadius: 18, borderBottomRightRadius: 18, borderBottomWidth: 1 },
  row: { minHeight: 92, paddingVertical: 12, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 14 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: AfterglowColors.subtleLine, marginLeft: 77, marginRight: 13 },
  pressed: { backgroundColor: AfterglowColors.unread },
  body: { flex: 1, minWidth: 0, gap: 4 },
  name: { ...AfterglowType.title, fontFamily: fonts.medium, color: AfterglowColors.ink },
  metadata: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 10, rowGap: 2 },
  meta: { ...AfterglowType.caption, fontFamily: fonts.regular, color: AfterglowColors.muted },
  activity: { ...AfterglowType.section, fontFamily: fonts.regular, color: AfterglowColors.muted },
}); }

const styles = StyleSheet.create({
  hit: {
    marginHorizontal: CIRCLE_DIR.cardMarginH,
    marginTop: CIRCLE_DIR.cardGap,
  },
  card: {
    paddingVertical: CIRCLE_DIR.cardPadV,
    paddingHorizontal: CIRCLE_DIR.cardPadH,
    borderRadius: CIRCLE_DIR.cardRadius,
    backgroundColor: Colors.cardBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.dividerWarm,
    shadowColor: Colors.terracotta,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 3,
  },
  pressed: { opacity: 0.9 },
  top: { flexDirection: 'row', alignItems: 'center' },
  textCol: { flex: 1, marginLeft: CIRCLE_DIR.coverToText },
  name: {
    ...TYPE.heroDisplay,
    color: Colors.darkWarm,
  },
  meta: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    marginTop: CIRCLE_DIR.nameToMeta,
  },
  avatars: { marginTop: CIRCLE_DIR.topToAvatars },
});
