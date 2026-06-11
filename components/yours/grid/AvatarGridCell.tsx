import React from 'react';
import { View, Text, Pressable, StyleSheet, Dimensions } from 'react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import YoursAvatar from '../primitives/YoursAvatar';
import type { AnchorRect } from '../../menu/MenuCard';
import type { YoursGridPerson } from '../../../lib/yours/types';

const AVATAR = 72;
const CELL_W = (Dimensions.get('window').width - 32 - 24) / 3;

function shortDay(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { weekday: 'short' });
  } catch {
    return '';
  }
}

function AvatarGridCell({
  person,
  lightUp,
  onPress,
  onLongPress,
  onPressPill,
}: {
  person: YoursGridPerson;
  lightUp?: boolean;
  onPress: () => void;
  onLongPress: (rect: AnchorRect) => void;
  onPressPill: () => void;
}) {
  const hasPill = !!person.upcoming_title && !!person.upcoming_start;
  return (
    <View style={styles.cell}>
      <YoursAvatar
        name={person.first_name_display}
        photoUrl={person.profile_photo_url}
        size={AVATAR}
        bucket={person.ring_bucket}
        lightUp={lightUp}
        onPress={onPress}
        onLongPress={onLongPress}
      />
      <Text style={styles.name} numberOfLines={1}>
        {person.first_name_display ?? ''}
      </Text>
      {hasPill ? (
        <Pressable
          onPress={onPressPill}
          style={styles.pill}
          accessibilityRole="button"
          accessibilityLabel={`${person.upcoming_title}`}
        >
          <Text style={styles.pillText} numberOfLines={1}>
            {person.upcoming_title}, {shortDay(person.upcoming_start!)}
          </Text>
        </Pressable>
      ) : person.milestone ? (
        <Text style={styles.milestone} numberOfLines={1}>
          {person.milestone}
        </Text>
      ) : null}
    </View>
  );
}

export default React.memo(AvatarGridCell);

const styles = StyleSheet.create({
  cell: { width: CELL_W, alignItems: 'center', paddingVertical: 12 },
  name: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.asphalt,
    marginTop: 8,
    maxWidth: 100,
  },
  pill: {
    backgroundColor: Colors.goldenAmberTint15,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 4,
    maxWidth: 110,
  },
  pillText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.micro,
    color: Colors.asphalt,
  },
  milestone: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.secondary,
    marginTop: 4,
    maxWidth: 110,
  },
});
