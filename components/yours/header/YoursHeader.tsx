import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../../constants/Typography';
import ProfileButton from '../../ProfileButton';
import { COPY } from '../state/constants';

/**
 * Sticky header: Yours wordmark with the existing inbox and profile controls.
 *
 * There is intentionally NO separate Yours bell here. The existing app inbox
 * (rendered by ProfileButton -> InboxModal) is the one inbox; people-request,
 * people-accepted, referral-joined notifications route to this page from
 * there. Keeping a second bell would split the inbox into a dual-bell system.
 *
 * The add-people entry point is also NOT here. Per spec it lives in-page:
 * PeopleScreen's "add people" CTA (populated) or the Add people action below the tabs.
 */
export default function YoursHeader({ appearance }: { appearance?: { fonts: AfterglowFontFamilies } }) {
  return (
    <View style={[styles.row, appearance && styles.reviewRow]}>
      <Text accessibilityRole="header" numberOfLines={1} style={[styles.wordmark, appearance && { ...AfterglowType.screenTitle, fontFamily: appearance.fonts.display, color: AfterglowColors.ink }]}>{COPY.wordmark}</Text>
      <View style={styles.actions}>
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
    gap: 16,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  wordmark: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayLG,
    color: Colors.asphalt,
  },
  reviewRow: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 },
  actions: { flexDirection: 'row', alignItems: 'center', flexShrink: 0, gap: 14 },
});
