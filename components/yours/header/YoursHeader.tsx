import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import ProfileButton from '../../ProfileButton';
import { COPY } from '../state/constants';

/**
 * Sticky header: italic "yours" wordmark + profile avatar (which is also the
 * single app bell / inbox trigger).
 *
 * There is intentionally NO separate Yours bell here. The single app inbox
 * (rendered by ProfileButton -> InboxModal) is the one inbox; people-request,
 * people-accepted, referral-joined notifications route to this page from
 * there. Keeping a second bell would split the inbox into a dual-bell system.
 *
 * The add-people entry point is also NOT here. Per spec it lives in-page as
 * the first cell of the people grid (see AddGridCell).
 */
export default function YoursHeader() {
  return (
    <View style={styles.row}>
      <Text style={styles.wordmark}>{COPY.wordmark}</Text>
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
});
