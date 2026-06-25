/**
 * InlineNudge - a single warm gold informational line (gold dot + tint + warm
 * text), the shared composer pattern for saying a true, actionable thing
 * without red and without blocking. Used for the place-skip nudge family and
 * the tonight expectation nudge.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import Colors from '../../constants/Colors';
import { Fonts } from '../../constants/Typography';

export default function InlineNudge({
  text,
  onPress,
  actionLabel,
}: {
  text: string;
  /** When set, the whole nudge becomes a one-tap action (e.g. "move this link"). */
  onPress?: () => void;
  /** Terracotta affordance text shown at the end when the nudge is tappable. */
  actionLabel?: string;
}) {
  const body = (
    <View style={styles.nudge}>
      <View style={styles.dot} />
      <Text style={styles.text}>{text}</Text>
      {actionLabel ? <Text style={styles.action}>{actionLabel}</Text> : null}
    </View>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} accessibilityRole="button">
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
