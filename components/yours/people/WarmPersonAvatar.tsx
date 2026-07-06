import React, { useRef } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { RADII, AVATAR_INITIAL_RATIO } from '../../../constants/YoursDesign';
import { COPY } from '../state/constants';
import type { AnchorRect } from '../../menu/MenuCard';
import type { YoursGridPerson } from '../../../lib/yours/types';
import {
  personInfoType,
  upcomingLabel,
  initialOf,
} from '../../../lib/yours/personDisplay';

const AVATAR = 64;

/**
 * One face in the "recently with you" hero row. Faces before utility (the row
 * sits above search). 64px: recognisable but list-scaled. Tap → person;
 * long-press → the shared MenuCard.
 */
function WarmPersonAvatar({
  person,
  onPress,
  onLongPress,
}: {
  person: YoursGridPerson;
  // Person-passing callbacks so the parent can hand every face the SAME
  // function reference; fresh per-cell closures would defeat React.memo.
  onPress: (p: YoursGridPerson) => void;
  onLongPress: (p: YoursGridPerson, rect: AnchorRect) => void;
}) {
  const faceRef = useRef<View>(null);
  const info = personInfoType(person);
  const name = person.first_name_display ?? '';

  const handlePress = () => onPress(person);
  const handleLongPress = () => {
    faceRef.current?.measureInWindow((x, y, w, h) =>
      onLongPress(person, { x, y, width: w, height: h }),
    );
  };

  return (
    <Pressable
      onPress={handlePress}
      onLongPress={handleLongPress}
      delayLongPress={300}
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={name}
    >
      <View ref={faceRef} style={styles.avatar}>
        {person.profile_photo_url ? (
          <Image source={{ uri: person.profile_photo_url }} style={styles.avatarImg} contentFit="cover" />
        ) : (
          <Text style={styles.initial}>{initialOf(name)}</Text>
        )}
      </View>

      <Text style={styles.name} numberOfLines={1}>
        {name}
      </Text>

      {info === 'upcoming' ? (
        <View style={styles.upPill}>
          <Text style={styles.upText} numberOfLines={1}>
            {upcomingLabel(person)}
          </Text>
        </View>
      ) : info === 'quiet' ? (
        <Text style={[styles.sub, styles.quiet]}>{COPY.peopleQuietLately}</Text>
      ) : info === 'milestone' ? (
        <Text style={[styles.sub, styles.milestone]}>
          {COPY.ppStatPlans(person.shared_count)}
        </Text>
      ) : person.shared_count > 0 ? (
        <Text style={[styles.sub, styles.count]}>
          {COPY.ppStatPlans(person.shared_count)}
        </Text>
      ) : null}
    </Pressable>
  );
}

export default React.memo(WarmPersonAvatar);

const styles = StyleSheet.create({
  container: { width: 72, alignItems: 'center' },
  pressed: { opacity: 0.7 },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    backgroundColor: Colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: AVATAR, height: AVATAR },
  initial: {
    fontFamily: Fonts.displayBold,
    fontSize: AVATAR * AVATAR_INITIAL_RATIO,
    color: Colors.terracotta,
  },
  // bodySM matches the grid cells' name size; same element, same scale.
  name: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.bodySM,
    color: Colors.asphalt,
    marginTop: 8,
    maxWidth: 72,
    textAlign: 'center',
  },
  sub: { fontSize: FontSizes.micro, marginTop: 5, textAlign: 'center' },
  quiet: { color: Colors.tertiary, fontStyle: 'italic', fontFamily: Fonts.sans },
  milestone: { color: Colors.asphalt, fontFamily: Fonts.sansBold },
  count: { color: Colors.tertiary, fontFamily: Fonts.sans },
  upPill: {
    backgroundColor: Colors.circleBadgeGoldTint,
    borderRadius: RADII.pill,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 5,
    maxWidth: 72,
  },
  upText: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.micro,
    color: Colors.secondary,
  },
});
