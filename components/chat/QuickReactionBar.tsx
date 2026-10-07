import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Plus } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { FontSizes } from '../../constants/Typography';

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
/** Same quick choices in every message menu; More stays on the same row. */
export function QuickReactionBar({ onSelect, onMore, selected }: { onSelect: (emoji: string) => void; onMore: () => void; selected?: string }) {
  const { width } = useWindowDimensions();
  const compact = width < 360;
  const choices = compact ? REACTIONS.filter(emoji => emoji !== '😢') : REACTIONS;
  return <View style={s.row}>
    {choices.map(emoji => <TouchableOpacity key={emoji} style={[s.button, selected === emoji && s.selected]}
      accessibilityRole="button" accessibilityLabel={`React with ${emoji}`} accessibilityState={{ selected: selected === emoji }}
      accessibilityHint={selected === emoji ? 'Remove your reaction' : undefined} onPress={() => onSelect(emoji)}>
      <Text allowFontScaling={false} style={s.emoji}>{emoji}</Text>
    </TouchableOpacity>)}
    <TouchableOpacity style={s.button} accessibilityRole="button" accessibilityLabel="More reactions" onPress={onMore}>
      <Plus size={23} color={Colors.asphalt} />
    </TouchableOpacity>
  </View>;
}
const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 6, borderRadius: 30, backgroundColor: Colors.cardBg, borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.border },
  button: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  selected: { backgroundColor: Colors.accentSubtle },
  emoji: { fontSize: FontSizes.displayLG },
});
