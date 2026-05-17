import React from 'react';
import { View, Text, Pressable, StyleSheet, Dimensions } from 'react-native';
import { Plus } from 'lucide-react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { hapticSelection } from '../../../lib/haptics';

const AVATAR = 72;
const CELL_W = (Dimensions.get('window').width - 32 - 24) / 3;

/**
 * In-grid "add people" affordance. Lives as a natural first cell of the
 * people grid (spec: NOT a header button, NOT a floating action button,
 * NOT the last cell). Soft outlined circle in the same 72pt avatar
 * footprint as a person, with a quiet "add" label, so it reads as part
 * of the page. Tapping opens the PathsSheet.
 */
function AddGridCell({ onPress }: { onPress: () => void }) {
  return (
    <View style={styles.cell}>
      <Pressable
        onPress={() => {
          hapticSelection();
          onPress();
        }}
        accessibilityRole="button"
        accessibilityLabel="Add people"
        style={styles.circle}
        hitSlop={8}
      >
        <Plus size={26} color={Colors.terracotta} strokeWidth={2.5} />
      </Pressable>
      <Text style={styles.label} numberOfLines={1}>
        add
      </Text>
    </View>
  );
}

export default React.memo(AddGridCell);

const styles = StyleSheet.create({
  cell: { width: CELL_W, alignItems: 'center', paddingVertical: 12 },
  circle: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    backgroundColor: Colors.parchment,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
    marginTop: 8,
    maxWidth: 100,
  },
});
