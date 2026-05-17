import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Bell, Plus } from 'lucide-react-native';
import { router } from 'expo-router';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import ProfileButton from '../../ProfileButton';
import { COPY, YOURS_HEADER_ACTION } from '../state/constants';
import { hapticSelection } from '../../../lib/haptics';

/**
 * Sticky header: italic "yours" wordmark, "+" (opens the paths sheet),
 * bell (passive notifications), profile avatar.
 *
 * SIM-EYEBALL #4b: the "+" sits left of the bell. Style is governed by
 * YOURS_HEADER_ACTION ('outline' leans away from the solid 48pt
 * bottom-nav "+"). Resolve on device.
 */
export default function YoursHeader({ onAdd }: { onAdd: () => void }) {
  const outline = YOURS_HEADER_ACTION === 'outline';
  return (
    <View style={styles.row}>
      <Text style={styles.wordmark}>{COPY.wordmark}</Text>
      <View style={styles.actions}>
        <Pressable
          onPress={() => {
            hapticSelection();
            onAdd();
          }}
          accessibilityRole="button"
          accessibilityLabel="Add people"
          hitSlop={10}
          style={[
            styles.plus,
            outline ? styles.plusOutline : styles.plusFill,
          ]}
        >
          <Plus
            size={18}
            color={outline ? Colors.terracotta : Colors.white}
            strokeWidth={2.5}
          />
        </Pressable>
        <Pressable
          onPress={() => router.push('/(tabs)/profile' as never)}
          accessibilityRole="button"
          accessibilityLabel="Notifications"
          hitSlop={10}
          style={styles.bell}
        >
          <Bell size={22} color={Colors.tertiary} strokeWidth={2} />
        </Pressable>
        <ProfileButton />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  wordmark: {
    fontFamily: Fonts.displayItalic,
    fontSize: FontSizes.displayLG,
    color: Colors.asphalt,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  plus: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusFill: { backgroundColor: Colors.terracotta },
  plusOutline: { borderWidth: 1.5, borderColor: Colors.terracotta },
  bell: { padding: 2 },
});
