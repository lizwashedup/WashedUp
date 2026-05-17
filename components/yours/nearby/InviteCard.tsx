import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { COPY } from '../state/constants';

/** "Know someone who should be here? Send them a link." */
export default function InviteCard({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      style={styles.card}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={COPY.inviteCardTitle}
    >
      <Text style={styles.title}>{COPY.inviteCardTitle}</Text>
      <Text style={styles.sub}>{COPY.inviteCardSub}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.cream,
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 12,
  },
  title: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  sub: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    marginTop: 2,
  },
});
