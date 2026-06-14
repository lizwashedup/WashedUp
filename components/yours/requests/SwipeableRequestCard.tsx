import React, { useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  PanResponder,
  Dimensions,
  Pressable,
} from 'react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { hapticSuccess, hapticSelection } from '../../../lib/haptics';
import YoursAvatar from '../primitives/YoursAvatar';
import { COPY, SWIPE } from '../state/constants';
import { useReduceMotion } from '../a11y/useReduceMotion';
import type { IncomingRequest } from '../../../lib/yours/types';

const W = Dimensions.get('window').width;
const CARD_W = W * 0.8;

/**
 * One swipeable request card. PanResponder + Animated (no gesture-handler).
 * Swipe right = add, left = not now; explicit buttons hit the same path
 * for a11y / non-gesture users.
 */
export default function SwipeableRequestCard({
  req,
  onAdd,
  onNotNow,
}: {
  req: IncomingRequest;
  onAdd: () => void;
  onNotNow: () => void;
}) {
  const reduceMotion = useReduceMotion();
  const pan = useRef(new Animated.ValueXY()).current;
  const threshold = CARD_W * SWIPE.thresholdRatio;

  const fly = (dir: 1 | -1, done: () => void) => {
    if (reduceMotion) {
      done();
      return;
    }
    Animated.timing(pan, {
      toValue: { x: dir * W, y: 0 },
      duration: 300,
      useNativeDriver: true,
    }).start(done);
  };

  const resolveAdd = () => {
    hapticSuccess();
    fly(1, onAdd);
  };
  const resolveNotNow = () => {
    hapticSelection();
    fly(-1, onNotNow);
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: Animated.event([null, { dx: pan.x }], {
        useNativeDriver: false,
      }),
      onPanResponderRelease: (_, g) => {
        if (g.dx > threshold) resolveAdd();
        else if (g.dx < -threshold) resolveNotNow();
        else
          Animated.spring(pan, {
            toValue: { x: 0, y: 0 },
            useNativeDriver: true,
            bounciness: 8,
          }).start();
      },
    }),
  ).current;

  const rotate = pan.x.interpolate({
    inputRange: [-W, 0, W],
    outputRange: [
      `-${SWIPE.maxRotateDeg}deg`,
      '0deg',
      `${SWIPE.maxRotateDeg}deg`,
    ],
  });

  return (
    <Animated.View
      {...panResponder.panHandlers}
      style={[
        styles.card,
        { transform: [{ translateX: pan.x }, { rotate }] },
      ]}
      accessibilityActions={[
        { name: 'activate', label: COPY.requestAdd },
        { name: 'magicTap', label: COPY.requestNotNow },
      ]}
    >
      <View style={styles.avatarRing}>
        <YoursAvatar
          name={req.first_name_display}
          photoUrl={req.profile_photo_url}
          size={96}
          bucket="none"
        />
      </View>
      <Text style={styles.name}>{req.first_name_display ?? 'Someone'}</Text>
      <View style={styles.contextChip}>
        <Text style={styles.context}>{req.context_line}</Text>
      </View>
      <Pressable
        style={styles.addBtn}
        onPress={resolveAdd}
        accessibilityRole="button"
        accessibilityLabel={`${COPY.requestAdd} ${req.first_name_display ?? ''}`}
      >
        <Text style={styles.addText}>{COPY.requestAdd}</Text>
      </Pressable>
      <Pressable
        style={styles.notNow}
        onPress={resolveNotNow}
        accessibilityRole="button"
        accessibilityLabel={COPY.requestNotNow}
      >
        <Text style={styles.notNowText}>{COPY.requestNotNow}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: CARD_W,
    alignSelf: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
    gap: 12,
    // Soft terracotta lift so the white card doesn't read flat on parchment.
    shadowColor: Colors.terracotta,
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  // Warm gold ring so the request feels like an invitation, not a profile row.
  avatarRing: {
    padding: 4,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: Colors.goldenAmber,
  },
  name: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.displaySM,
    color: Colors.asphalt,
  },
  // "how you know them" reads as a soft gold chip, not loose body text.
  contextChip: {
    backgroundColor: Colors.goldenAmberTint15,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  context: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.asphalt,
    textAlign: 'center',
  },
  addBtn: {
    width: '100%',
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  addText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.white,
  },
  notNow: { paddingVertical: 8 },
  notNowText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.tertiary,
  },
});
