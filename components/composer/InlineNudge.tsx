/**
 * InlineNudge - a single warm gold informational line (gold dot + tint + warm
 * text), the shared composer pattern for saying a true, actionable thing
 * without red and without blocking. Used for the place-skip nudge family and
 * the tonight expectation nudge.
 */
import { StyleSheet, Text, View } from 'react-native';

import Colors from '../../constants/Colors';
import { Fonts } from '../../constants/Typography';

export default function InlineNudge({ text }: { text: string }) {
  return (
    <View style={styles.nudge}>
      <View style={styles.dot} />
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  nudge: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10,
    backgroundColor: Colors.goldBadgeSoft, borderWidth: 1, borderColor: Colors.goldAccent,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.gold },
  text: { flex: 1, fontFamily: Fonts.sans, fontSize: 13, lineHeight: 18, color: Colors.quoteText },
});
