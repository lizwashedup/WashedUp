/**
 * CirclesSummaryHeader - actual count and the existing create entry point.
 * The refined appearance introduces the conversation list with concise copy;
 * the legacy presentation remains available to existing callers.
 */
import React from 'react';
import { PageAction } from '../../creator/pages/PageFrame';
import { View, Pressable, StyleSheet } from 'react-native';
import { ScaledText as Text } from '../../ScaledText';
import { Plus } from 'lucide-react-native';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../../constants/Typography';
import { CIRCLE_DIR, TYPE, RADII } from '../../../constants/YoursDesign';
import { COPY } from '../state/constants';
import { hapticSelection } from '../../../lib/haptics';

export default function CirclesSummaryHeader({
  count,
  onCreate,
  appearance,
}: {
  count: number;
  onCreate: () => void;
  appearance?: { fonts: AfterglowFontFamilies };
}) {
  if (appearance) {
    const styled = afterglow(appearance.fonts);
    return <View style={styled.wrap}>
      <View style={styled.top}>
        <Text accessibilityRole="header" style={styled.count}>{COPY.circleDirCount(count)}</Text>
        <PageAction primary compact singleLine title={COPY.circleDirNewCta} leadingIcon={<Plus size={18} color={Colors.white}/>} onPress={() => { hapticSelection(); onCreate(); }} />
      </View>
      <Text style={styled.description}>Chats and plans with your people.</Text>
    </View>;
  }
  return (
    <View style={styles.card}>
      <View style={styles.copyCol}>
        <Text style={styles.label}>{COPY.circleDirCount(count)}</Text>
        <Text style={styles.tagline}>{COPY.circleDirTagline}</Text>
      </View>
      <Pressable
        onPress={() => {
          hapticSelection();
          onCreate();
        }}
        style={styles.ctaHit}
        accessibilityRole="button"
        accessibilityLabel={COPY.circleDirNewCta}
      >
        {({ pressed }) => (
          <View style={[styles.cta, pressed && styles.ctaPressed]}>
            <Plus size={CIRCLE_DIR.ctaIcon} color={Colors.white} strokeWidth={2.5} />
            <Text numberOfLines={1} style={styles.ctaLabel}>{COPY.circleDirNewCta}</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

function afterglow(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  wrap: { marginHorizontal: 20, paddingTop: 12, paddingBottom: 12 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 },
  count: { ...AfterglowType.contextTitle, fontFamily: fonts.semibold, color: AfterglowColors.ink },
  description: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted, marginTop: 10 },
  button: { minHeight: 44, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: AfterglowColors.clay, borderRadius: 4, flexDirection: 'row', alignItems: 'center', gap: 6 },
  buttonText: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.white },
}); }

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: CIRCLE_DIR.headerMarginH,
    marginTop: CIRCLE_DIR.headerMarginTop,
    paddingVertical: CIRCLE_DIR.headerPadV,
    paddingHorizontal: CIRCLE_DIR.headerPadH,
    borderRadius: CIRCLE_DIR.headerRadius,
    backgroundColor: Colors.cardBg,
    shadowColor: Colors.terracotta,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  // minWidth:0 lets the text column shrink (and the tagline wrap) instead of
  // forcing its single-line content width and starving the button beside it.
  copyCol: { flex: 1, minWidth: 0, marginRight: 12 },
  label: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: CIRCLE_DIR.headerLabelGap,
  },
  tagline: {
    ...TYPE.heroDisplay,
    color: Colors.darkWarm,
  },
  // Bare Pressable: it only owns the touch target. A styled pill here collapses
  // as a flex child and paints nothing, so the fill lives on the inner View.
  ctaHit: { flexShrink: 0 },
  cta: {
    width: CIRCLE_DIR.ctaWidth,
    height: CIRCLE_DIR.ctaHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.terracotta,
    borderRadius: RADII.button,
    shadowColor: Colors.terracotta,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 3,
  },
  ctaPressed: { opacity: 0.85 },
  ctaLabel: {
    marginLeft: CIRCLE_DIR.ctaGap,
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.white,
  },
});
