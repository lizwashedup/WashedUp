import React, { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withDelay,
  runOnJS,
} from 'react-native-reanimated';
import Colors from '../../../constants/Colors';
import { Fonts } from '../../../constants/Typography';
import { hapticMedium } from '../../../lib/haptics';
import ActivityRing from './ActivityRing';
import { RING_FRACTION, ANIM } from '../state/constants';
import { useReduceMotion } from '../a11y/useReduceMotion';
import type { RingBucket } from '../../../lib/yours/types';

interface YoursAvatarProps {
  name: string | null;
  photoUrl: string | null;
  size: number;
  bucket: RingBucket;
  ghost?: boolean;
  /** Play the one-time ghost -> real "light up" sequence. */
  lightUp?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
}

function initials(name: string | null): string {
  return (name?.trim()?.[0] ?? '?').toUpperCase();
}

function YoursAvatar({
  name,
  photoUrl,
  size,
  bucket,
  ghost,
  lightUp,
  onPress,
  onLongPress,
}: YoursAvatarProps) {
  const reduceMotion = useReduceMotion();
  const scale = useSharedValue(1);
  const photoOpacity = useSharedValue(ghost && !lightUp ? 0 : ghost ? 0 : 1);
  const ghostOpacity = useSharedValue(ghost ? 1 : 0);
  const ringProgress = useSharedValue(
    ghost ? 0 : RING_FRACTION[bucket],
  );

  useEffect(() => {
    if (!lightUp) return;
    if (reduceMotion) {
      ghostOpacity.value = 0;
      photoOpacity.value = 1;
      ringProgress.value = RING_FRACTION[bucket];
      return;
    }
    // Dashed ghost dissolves, photo cross-fades in, ring draws, gentle pop.
    ghostOpacity.value = withTiming(0, { duration: 200 });
    photoOpacity.value = withDelay(
      150,
      withTiming(1, { duration: ANIM.ghostCrossfadeMs }),
    );
    ringProgress.value = withDelay(
      400,
      withTiming(RING_FRACTION[bucket], { duration: ANIM.ghostRingDrawMs }),
    );
    scale.value = withDelay(
      400,
      withSequence(
        withTiming(1.08, { duration: 150 }),
        withTiming(1, { duration: 150 }, (finished) => {
          if (finished) runOnJS(hapticMedium)();
        }),
      ),
    );
  }, [lightUp, reduceMotion, bucket]);

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  const photoStyle = useAnimatedStyle(() => ({ opacity: photoOpacity.value }));
  const ghostStyle = useAnimatedStyle(() => ({ opacity: ghostOpacity.value }));

  const showGhostBase = ghost && !lightUp;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={name ?? 'Person'}
      hitSlop={6}
    >
      <Animated.View
        style={[
          { width: size, height: size, alignItems: 'center', justifyContent: 'center' },
          containerStyle,
        ]}
      >
        <ActivityRing
          avatarSize={size}
          bucket={bucket}
          ghost={showGhostBase}
          animatedProgress={ghost || lightUp ? ringProgress : undefined}
        />
        <View
          style={[
            styles.circle,
            { width: size, height: size, borderRadius: size / 2 },
          ]}
        >
          {/* Ghost / initials base layer */}
          <Animated.View style={[styles.fill, ghostStyle]}>
            <View
              style={[
                styles.fill,
                styles.center,
                { backgroundColor: Colors.yoursGhostBg },
              ]}
            >
              <Text style={[styles.initials, { fontSize: size * 0.4 }]}>
                {initials(name)}
              </Text>
            </View>
          </Animated.View>

          {/* Photo / initials top layer */}
          <Animated.View style={[styles.fill, photoStyle]}>
            {photoUrl ? (
              <Image
                source={{ uri: photoUrl }}
                style={styles.fill}
                contentFit="cover"
              />
            ) : (
              <View
                style={[
                  styles.fill,
                  styles.center,
                  { backgroundColor: Colors.inputBg },
                ]}
              >
                <Text style={[styles.initials, { fontSize: size * 0.4 }]}>
                  {initials(name)}
                </Text>
              </View>
            )}
          </Animated.View>
        </View>
      </Animated.View>
    </Pressable>
  );
}

export default React.memo(YoursAvatar);

const styles = StyleSheet.create({
  circle: { overflow: 'hidden', backgroundColor: Colors.inputBg },
  fill: { ...StyleSheet.absoluteFillObject },
  center: { alignItems: 'center', justifyContent: 'center' },
  initials: { fontFamily: Fonts.sansBold, color: Colors.tertiary },
});
