import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Bell } from 'lucide-react-native';
import { router } from 'expo-router';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import ProfileButton from '../../ProfileButton';
import { COPY } from '../state/constants';

/**
 * Sticky header: italic "yours" wordmark, bell (passive notifications),
 * profile avatar.
 *
 * The add-people entry point is intentionally NOT here. Per spec it lives
 * in-page as the first cell of the people grid (see AddGridCell), so the
 * header stays clean: wordmark, bell, profile only.
 */
export default function YoursHeader() {
  return (
    <View style={styles.row}>
      <Text style={styles.wordmark}>{COPY.wordmark}</Text>
      <View style={styles.actions}>
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
  bell: { padding: 2 },
});
