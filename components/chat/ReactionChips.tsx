import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { SmilePlus } from 'lucide-react-native';
import Colors, { AfterglowColors } from '../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';
import { aggregateReactionChips, type ReactionCount } from '../../lib/communityReactionChips';

interface Props {
  reactions: readonly ReactionCount[];
  onReact: (storageKey: string) => void;
  onViewReactions?: () => void;
  onAddReaction?: () => void;
  disabled?: boolean;
  /** Conversation badge: no persistent add button; long press opens reactions. */
  attached?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  appearance?: { fonts: AfterglowFontFamilies };
}

/** Shared appearance only. Each caller keeps its existing reaction policy. */
export function ReactionChips({ reactions, onReact, onViewReactions, onAddReaction, disabled = false, attached = false, style, children, appearance }: Props) {
  return (
    <View style={[styles.row, style, attached && reactions.some(reaction => reaction.count > 0) && styles.attachedRow]}>
      {aggregateReactionChips(reactions).map(chip => (
        <TouchableOpacity
          key={chip.emoji}
          style={styles.touchTarget}
          activeOpacity={attached ? 1 : 0.7}
          onPress={() => onViewReactions ? onViewReactions() : onReact(chip.storageKey)}
          disabled={disabled && !onViewReactions}
          accessibilityRole="button"
          accessibilityLabel={`${chip.emoji}, ${chip.count} ${chip.count === 1 ? 'reaction' : 'reactions'}${chip.mine ? ', your reaction' : ''}`}
          accessibilityHint={onViewReactions ? 'See who reacted' : disabled ? undefined : chip.mine ? 'Remove your reaction' : `React with ${chip.emoji}`}
          accessibilityState={{ selected: chip.mine, disabled: disabled && !onViewReactions }}
        >
          <View style={[styles.chip, chip.mine && styles.selected, appearance && styles.stagedChip, appearance && chip.mine && styles.stagedSelected, attached && styles.attachedChip, attached && chip.mine && styles.attachedSelected]}>
            <Text style={[styles.emoji, appearance && { ...AfterglowType.message, fontFamily: appearance.fonts.regular }]}>{chip.emoji}</Text>
            {(!attached || chip.count > 1) && <Text style={[styles.count, chip.mine && styles.selectedCount, appearance && {
              ...AfterglowType.caption,
              fontFamily: chip.mine ? appearance.fonts.semibold : appearance.fonts.medium,
              color: AfterglowColors.ink,
            }]}>{chip.count}</Text>}
          </View>
        </TouchableOpacity>
      ))}
      {!attached && !!onAddReaction && !disabled && (
        <TouchableOpacity
          style={styles.add}
          onPress={onAddReaction}
          accessibilityRole="button"
          accessibilityLabel="Add reaction"
          accessibilityHint="Choose from all emoji"
        >
          {appearance ? <View style={styles.stagedAddSurface}>
            <SmilePlus size={20} color={AfterglowColors.muted} accessibilityElementsHidden importantForAccessibility="no" />
          </View> : <SmilePlus size={20} color={Colors.secondary} accessibilityElementsHidden importantForAccessibility="no" />}
        </TouchableOpacity>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
  attachedRow: { marginTop: -18, marginBottom: 0, paddingHorizontal: 4 },
  attachedChip: { borderRadius: 14, backgroundColor: Colors.cardBg, borderColor: Colors.border, paddingHorizontal: 7, minHeight: 26 },
  attachedSelected: { backgroundColor: Colors.cardBg, borderColor: Colors.terracotta },
  touchTarget: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  chip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    minHeight: 28, paddingHorizontal: 9, paddingVertical: 3,
    borderRadius: 10, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.cardBg,
  },
  selected: { borderColor: Colors.terracotta, backgroundColor: Colors.accentSubtle },
  stagedChip: { borderRadius: 14, paddingHorizontal: 8, borderColor: AfterglowColors.line, backgroundColor: AfterglowColors.white },
  stagedSelected: { borderColor: AfterglowColors.clay, backgroundColor: AfterglowColors.paper },
  emoji: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyLG },
  count: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.secondary },
  selectedCount: { fontFamily: Fonts.sansBold, color: Colors.terracotta },
  add: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  stagedAddSurface: {
    width: 28, height: 28, alignItems: 'center', justifyContent: 'center',
    borderRadius: 14,
  },
});
