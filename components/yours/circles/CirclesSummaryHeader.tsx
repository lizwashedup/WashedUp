/**
 * CirclesSummaryHeader - the card pinned above the Yours > Circles list.
 *
 * An uppercase count label, a serif-italic tagline, and a real branded
 * "New circle" button (filled terracotta, warm shadow) - the first-class create
 * entry point that replaces the old dashed placeholder row. The "plans this week"
 * half of the count label fills in next chunk, once circle-plans data exists.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Plus } from 'lucide-react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { CIRCLE_DIR, TYPE, RADII } from '../../../constants/YoursDesign';
import { COPY } from '../state/constants';
import { hapticSelection } from '../../../lib/haptics';

export default function CirclesSummaryHeader({
  count,
  onCreate,
}: {
  count: number;
  onCreate: () => void;
}) {
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
            <Text style={styles.ctaLabel}>{COPY.circleDirNewCta}</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

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
