/**
 * CategoryChips - the real plan category set as a wrapping chip row (design
 * study v3 chip styling). Selected = warm tint + terracotta border/text.
 * Shared by both composer surfaces. Values are canonical (TitleCase); display
 * is lowercased to match the editorial chip aesthetic. Callers store the
 * canonical value and lowercase on submit (events.primary_vibe).
 */
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import Colors from '../../constants/Colors';
import { Fonts } from '../../constants/Typography';
import { PLAN_CATEGORIES, type PlanCategory } from '../../constants/Categories';
import { hapticSelection } from '../../lib/haptics';

interface CategoryChipsProps {
  selected: PlanCategory | null;
  onSelect: (category: PlanCategory) => void;
  label?: string;
}

export default function CategoryChips({ selected, onSelect, label }: CategoryChipsProps) {
  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.row}>
        {PLAN_CATEGORIES.map((cat) => {
          const active = selected === cat;
          return (
            <TouchableOpacity
              key={cat}
              activeOpacity={0.7}
              onPress={() => {
                hapticSelection();
                onSelect(cat);
              }}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {cat.toLowerCase()}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
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
    fontSize: 11,
    color: Colors.secondary,
  },
  chipTextActive: {
    color: Colors.terracotta,
  },
});
