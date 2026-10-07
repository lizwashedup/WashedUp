/**
 * CategoryChips - the real plan category set as a wrapping chip row (design
 * study v3 chip styling). Selected = warm tint + terracotta border/text.
 * Shared by both composer surfaces. Values are canonical (TitleCase); display
 * is lowercased to match the editorial chip aesthetic. Callers store the
 * canonical value and lowercase on submit (events.primary_vibe).
 */
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import Colors, { AfterglowColors } from '../../constants/Colors';
import { Fonts, AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';
import { PLAN_CATEGORIES, type PlanCategory } from '../../constants/Categories';
import { hapticSelection } from '../../lib/haptics';

interface CategoryChipsProps {
  selected: PlanCategory | null;
  onSelect: (category: PlanCategory) => void;
  label?: string;
  appearance?: { fonts: AfterglowFontFamilies };
  expanded?: boolean;
}

export default function CategoryChips({ selected, onSelect, label, appearance, expanded = false }: CategoryChipsProps) {
  const s = useMemo(() => appearance ? { ...styles, ...categoryAppearance(appearance.fonts) } : styles, [appearance?.fonts]);
  const choices = PLAN_CATEGORIES.map((cat) => {
    const active = selected === cat;
    return <TouchableOpacity key={cat} activeOpacity={0.7}
      onPress={() => { hapticSelection(); onSelect(cat); }}
      style={[s.chip, active && s.chipActive]} accessibilityRole="button"
      accessibilityLabel={appearance ? cat : cat.toLowerCase()} accessibilityState={{ selected: active }}>
      <Text style={[s.chipText, active && s.chipTextActive]} numberOfLines={1}>{appearance ? cat : cat.toLowerCase()}</Text>
    </TouchableOpacity>;
  });
  return (
    <View style={s.container}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      {appearance && !expanded ? <ScrollView horizontal showsHorizontalScrollIndicator
        keyboardShouldPersistTaps="handled" contentContainerStyle={s.row}
        style={{ flexGrow: 0 }} accessibilityLabel="Plan categories">
        {choices}
      </ScrollView> : <View style={[s.row, expanded && { flexWrap: 'wrap' }]}>{choices}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
  },
  label: {
    fontFamily: Fonts.sansBold,
    fontSize: 9,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: Colors.tertiary,
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  chipActive: {
    backgroundColor: Colors.accentSubtle,
    borderColor: Colors.terracotta,
  },
  chipText: {
    fontFamily: Fonts.sansSemibold,
    fontSize: 13,
    color: Colors.secondary,
  },
  chipTextActive: {
    color: Colors.terracotta,
  },
});

function categoryAppearance(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  label: { ...AfterglowType.section, fontFamily: fonts.semibold, color: AfterglowColors.muted, marginBottom: 10 },
  row: { flexDirection: 'row', flexWrap: 'nowrap', gap: 8, paddingBottom: 4 },
  chip: { minHeight: 44, paddingHorizontal: 13, paddingVertical: 11, justifyContent: 'center', borderRadius: 4,
    borderWidth: 1, borderColor: AfterglowColors.line, backgroundColor: AfterglowColors.white },
  chipActive: { backgroundColor: AfterglowColors.paper, borderColor: AfterglowColors.clay },
  chipText: { ...AfterglowType.body, fontFamily: fonts.medium, color: AfterglowColors.muted },
  chipTextActive: { fontFamily: fonts.semibold, color: AfterglowColors.clay },
}); }
