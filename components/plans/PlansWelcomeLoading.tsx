import React from 'react';
import { Animated, Easing, View } from 'react-native';
import { Image } from 'expo-image';
import Colors from '../../constants/Colors';
import { baseStyles } from './plansDiscoveryStyles';

const wLogo = require('../../assets/images/w-logo-waves.png');

/**
 * First-visit loading cover. Acts as a true overlay above the plans feed:
 * once data is ready (and a minimum display time has elapsed so it never
 * blinks) the whole layer cross-fades out, revealing the feed already
 * mounted underneath. The W lifts slightly as it leaves — like the screen
 * is delivering the content, not just stepping aside.
 *
 * Props:
 *   - done: parent flips this true when plans data is ready.
 *   - onExit: called once the exit fade finishes so the parent can unmount.
 *
 * Composition:
 *   - whole-screen fades in over 280ms (no hard cut from the photo screen)
 *   - W logo (132px, terracotta) gently breathes — slow scale + opacity
 *     loop, easing both ways so it reads alive instead of mechanical
 *   - label fades in shortly after
 *   - three brand-colored dots pulse in stagger
 *   - exit: brief scale-up on the W (1.0 → 1.10) while the screen fades
 *     to 0 over 420ms; the cumulative effect is the W "lifting away"
 */
const MIN_WELCOME_DISPLAY_MS = 1500;
const EXIT_DURATION_MS = 420;

export function WelcomeLoading({
  done,
  onExit,
}: {
  done: boolean;
  onExit: () => void;
}) {
  const screenOpacity = React.useRef(new Animated.Value(0)).current;
  const exitScale = React.useRef(new Animated.Value(0)).current;
  const breath = React.useRef(new Animated.Value(0)).current;
  const textOpacity = React.useRef(new Animated.Value(0)).current;
  const dot1 = React.useRef(new Animated.Value(0.3)).current;
  const dot2 = React.useRef(new Animated.Value(0.3)).current;
  const dot3 = React.useRef(new Animated.Value(0.3)).current;
  const mountedAt = React.useRef(Date.now()).current;
  const exitingRef = React.useRef(false);

  // Mount-time animations: fade-in screen, fade-in label, start loops.
  React.useEffect(() => {
    Animated.timing(screenOpacity, {
      toValue: 1,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    Animated.timing(textOpacity, {
      toValue: 1,
      duration: 460,
      delay: 140,
      useNativeDriver: true,
    }).start();

    const breathLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1,
          duration: 1300,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 0,
          duration: 1300,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    breathLoop.start();

    const pulseDot = (v: Animated.Value) =>
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 420, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0.3, duration: 420, useNativeDriver: true }),
      ]);
    const dotsLoop = Animated.loop(
      Animated.stagger(200, [pulseDot(dot1), pulseDot(dot2), pulseDot(dot3)]),
    );
    dotsLoop.start();

    return () => {
      breathLoop.stop();
      dotsLoop.stop();
    };
  }, [screenOpacity, breath, textOpacity, dot1, dot2, dot3]);

  // Exit animation, gated on `done` AND a minimum display time so the
  // overlay never blinks for a sub-second cached load.
  React.useEffect(() => {
    if (!done || exitingRef.current) return;
    const elapsed = Date.now() - mountedAt;
    const wait = Math.max(0, MIN_WELCOME_DISPLAY_MS - elapsed);
    const t = setTimeout(() => {
      exitingRef.current = true;
      Animated.parallel([
        Animated.timing(exitScale, {
          toValue: 1,
          duration: EXIT_DURATION_MS,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(screenOpacity, {
          toValue: 0,
          duration: EXIT_DURATION_MS,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(() => {
        // Call onExit unconditionally. Animated.timing's callback receives
        // finished:false when the animation is interrupted (competing
        // animation, layout recalc, focus event, JS-thread pressure on
        // slower silicon). The old `if (finished)` guard meant any
        // interruption left the overlay permanently mounted, which on
        // iPhone SE 3rd gen / A15 traps the user behind a full-screen
        // absoluteFillObject View that absorbs every touch to the feed
        // below. We don't care WHY the animation ended — the overlay
        // needs to come down either way.
        onExit();
      });
    }, wait);
    return () => clearTimeout(t);
  }, [done, onExit, mountedAt, screenOpacity, exitScale]);

  const breathScale = breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] });
  const wOpacity = breath.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] });
  const exitScaleOut = exitScale.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] });

  return (
    <Animated.View
      style={[baseStyles.welcomeLoading, { opacity: screenOpacity }]}
      pointerEvents={exitingRef.current ? 'none' : 'auto'}
    >
      <Animated.View
        style={{
          opacity: wOpacity,
          transform: [{ scale: breathScale }, { scale: exitScaleOut }],
        }}
      >
        <Image
          source={wLogo}
          style={baseStyles.welcomeLoadingLogo}
          contentFit="contain"
          tintColor={Colors.brand}
        />
      </Animated.View>
      <Animated.Text
        style={[baseStyles.welcomeLoadingText, { opacity: textOpacity }]}
      >
        finding plans for you
      </Animated.Text>
      <View style={baseStyles.welcomeLoadingDots}>
        <Animated.View style={[baseStyles.welcomeLoadingDot, { opacity: dot1 }]} />
        <Animated.View style={[baseStyles.welcomeLoadingDot, { opacity: dot2 }]} />
        <Animated.View style={[baseStyles.welcomeLoadingDot, { opacity: dot3 }]} />
      </View>
    </Animated.View>
  );
}

