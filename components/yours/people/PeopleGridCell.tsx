import React, { useRef } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { Image } from 'expo-image';
import { Sparkles } from 'lucide-react-native';
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

const AVATAR = 52;
const CARD_PAD_H = 8; // card paddingHorizontal; sub-info clamps to width minus both sides

/**
 * One card in the 3-column people grid. Variable-reward sub-info (upcoming /
 * milestone / quiet / count) derived from our own data; gold is decorative only
 * (top accent + pill background), never on text. Tap → person; long-press →
 * the shared MenuCard (anchored to the face).
 */
function PeopleGridCell({
  person,
  width,
  onPress,
  onLongPress,
}: {
  person: YoursGridPerson;
  width: number;
  // Person-passing callbacks so the parent can hand every cell the SAME
  // function reference; fresh per-cell closures would defeat React.memo.
  onPress: (p: YoursGridPerson) => void;
  onLongPress: (p: YoursGridPerson, rect: AnchorRect) => void;
}) {
  const faceRef = useRef<View>(null);
  const info = personInfoType(person);
  const isQuiet = info === 'quiet';
  const isUpcoming = info === 'upcoming';
  const isMilestone = info === 'milestone';
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
      style={({ pressed }) => (pressed ? styles.pressed : undefined)}
      accessibilityRole="button"
      accessibilityLabel={name}
    >
      {/* Inner View paints + sizes the card with an EXPLICIT width (a styled
          Pressable won't paint, and width:'100%' is unreliable in flex context;
          both bit us; explicit point width on an inner View is the fix). */}
      <View style={[styles.card, { width }, isQuiet ? styles.cardQuiet : styles.cardActive]}>
        {(isUpcoming || isMilestone) && <View style={styles.topAccent} />}

        <View ref={faceRef} style={[styles.avatar, isQuiet && styles.avatarQuiet]}>
          {person.profile_photo_url ? (
            <Image source={{ uri: person.profile_photo_url }} style={styles.avatarImg} contentFit="cover" />
          ) : (
            <Text style={styles.initial}>{initialOf(name)}</Text>
          )}
        </View>

        <Text style={[styles.name, isQuiet && styles.nameQuiet]} numberOfLines={1}>
          {name}
        </Text>

        <View style={[styles.sub, { maxWidth: width - CARD_PAD_H * 2 }]}>
          {isUpcoming ? (
            <View style={[styles.upPill, { maxWidth: width - CARD_PAD_H * 2 }]}>
              <Text style={styles.upText} numberOfLines={1}>
                {upcomingLabel(person)}
              </Text>
            </View>
          ) : isQuiet ? (
            <Text style={styles.quiet}>{COPY.peopleQuietLately}</Text>
          ) : isMilestone ? (
            <View style={styles.milestoneRow}>
              <Text style={styles.milestone}>{COPY.ppStatPlans(person.shared_count)}</Text>
              <Sparkles size={11} color={Colors.goldAccent} strokeWidth={2} />
            </View>
          ) : person.shared_count > 0 ? (
            <Text style={styles.count}>{COPY.ppStatPlans(person.shared_count)}</Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export default React.memo(PeopleGridCell);

const styles = StyleSheet.create({
  // No overflow:'hidden' here: it clips the cardActive shadow (masksToBounds on
  // iOS, elevation on Android). The only absolutely-positioned child, topAccent,
  // carries its own top radii instead.
  card: {
    borderRadius: RADII.cardTight,
    paddingTop: 18,
    paddingBottom: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.borderWarm,
  },
  cardActive: {
    backgroundColor: Colors.cardBg,
    shadowColor: Colors.warmShadow,
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    ...Platform.select({ android: { elevation: 2 } }),
  },
  // Quiet = drifted (30+d). Muted warm surface, faded face. Loss-aversion cue
  // without nagging.
  cardQuiet: {
    backgroundColor: Colors.creamWarm,
    borderColor: Colors.borderWarm,
  },
  pressed: { transform: [{ scale: 0.97 }] },
  // Decorative gold top edge for upcoming / milestone (gold as accent, not text).
  topAccent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: Colors.goldAccent,
    borderTopLeftRadius: RADII.cardTight,
    borderTopRightRadius: RADII.cardTight,
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    backgroundColor: Colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: 10,
  },
  avatarQuiet: { opacity: 0.5 },
  avatarImg: { width: AVATAR, height: AVATAR },
  initial: {
    fontFamily: Fonts.displayBold,
    fontSize: AVATAR * AVATAR_INITIAL_RATIO,
    color: Colors.terracotta,
  },
  name: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.bodySM,
    color: Colors.asphalt,
    maxWidth: '100%',
    textAlign: 'center',
    lineHeight: 17,
  },
  nameQuiet: { color: Colors.tertiary },
  // Fixed (not min) height so EVERY card is identical regardless of whether the
  // sub-info is an upcoming pill, a count, "quiet lately", or nothing; keeps the
  // grid a clean uniform matrix, no ragged row edges.
  sub: {
    marginTop: 7,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  upPill: {
    backgroundColor: Colors.circleBadgeGoldTint,
    borderRadius: RADII.pill,
    paddingHorizontal: 7,
    paddingVertical: 3,
    maxWidth: '100%',
  },
  upText: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.micro,
    color: Colors.secondary,
    letterSpacing: 0.3,
  },
  quiet: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
    fontStyle: 'italic',
  },
  // Milestone celebration: bold count + a small gold Sparkles mark (gold as a
  // decorative icon, never gold text) + the card's gold top-accent.
  milestoneRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  milestone: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.asphalt,
  },
  count: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
  },
});
