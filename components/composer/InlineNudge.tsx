/**
 * InlineNudge - a single warm gold informational line (gold dot + tint + warm
 * text), the shared composer pattern for saying a true, actionable thing
 * without red and without blocking. Used for the place-skip nudge family and
 * the tonight expectation nudge.
 */
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import Colors, { AfterglowColors } from '../../constants/Colors';
import { Fonts, AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';

export default function InlineNudge({
  text,
  onPress,
  actionLabel,
  appearance,
}: {
  text: string;
  /** When set, the whole nudge becomes a one-tap action (e.g. "move this link"). */
  onPress?: () => void;
  /** Terracotta affordance text shown at the end when the nudge is tappable. */
  actionLabel?: string;
  appearance?: { fonts: AfterglowFontFamilies };
}) {
  const s = useMemo(() => appearance ? { ...styles, ...nudgeAppearance(appearance.fonts) } : styles, [appearance?.fonts]);
  const body = (
    <View style={s.nudge}>
      <View style={s.dot} accessible={false} />
      <Text style={s.text}>{text}</Text>
      {actionLabel ? <Text style={s.action}>{actionLabel}</Text> : null}
    </View>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={actionLabel ? `${actionLabel}. ${text}` : text}>
        {body}
      </Pressable>
    );
  }
  return body;
}

const styles = StyleSheet.create({
  nudge: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10,
    backgroundColor: Colors.goldBadgeSoft, borderWidth: 1, borderColor: Colors.goldAccent,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.gold },
  text: { flex: 1, fontFamily: Fonts.sans, fontSize: 13, lineHeight: 18, color: Colors.quoteText },
  action: { fontFamily: Fonts.sansBold, fontSize: 13, color: Colors.terracotta },
});

function nudgeAppearance(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  nudge: { ...styles.nudge, minHeight: 44, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: AfterglowColors.white, borderColor: AfterglowColors.subtleLine },
  dot: { ...styles.dot, backgroundColor: AfterglowColors.clay },
  text: { flex: 1, minWidth: 0, ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted },
  action: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.clay, flexShrink: 1 },
}); }
