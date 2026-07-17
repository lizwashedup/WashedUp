import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Dimensions,
  Share,
  Linking,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { hapticLight, hapticSuccess } from '../../../lib/haptics';
import ProfileButton from '../../../components/ProfileButton';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../../constants/Typography';
import { COMMUNITIES_ENABLED } from '../../../constants/FeatureFlags';
import { SceneDiscovery } from '../../../components/scene/SceneDiscovery';
import { markSceneStageSeen, SCENE_BADGE_KEY } from '../../../lib/sceneStage';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const APPLY_URL = 'https://washedup.app/creator/apply';

// LIZ COPY: the pre-written share sentence (the apply link rides along)
const SHARE_MESSAGE = `washedup is looking for founding partners, the people who already bring LA together. thought of you: ${APPLY_URL}`;

// ─── Main Component ──────────────────────────────────────────────────────────

// COMMUNITIES_ENABLED is a compile-time constant, so this branch is stable
// for the app's lifetime: flag off ships the coming-soon page; flag on ships
// discovery (doc 10 phase 5).
export default function ScenePage() {
  const queryClient = useQueryClient();

  // Stamp the current coming-soon stage as seen on every Scene open so the
  // tab dot clears (lib/sceneStage.ts). Runs for both branches: a flag-on
  // build simply has no dot left to clear.
  useFocusEffect(
    useCallback(() => {
      markSceneStageSeen().finally(() => {
        queryClient.invalidateQueries({ queryKey: SCENE_BADGE_KEY });
      });
    }, [queryClient]),
  );

  if (COMMUNITIES_ENABLED) return <SceneDiscovery />;
  return <SceneComingSoon />;
}

// The founding-partner recruiting page (stage 1 of the coming-soon run-up).
// Replaced the wish box at the 2026-07-15 directive: scene_suggestions
// stops receiving (existing rows untouched); the photo, header, and the
// plans nudge stay exactly as they were.
function SceneComingSoon() {
  const [userId, setUserId] = useState<string | null>(null);
  const [onWaitlist, setOnWaitlist] = useState(false);
  const [userCount, setUserCount] = useState(0);

  const notifyScale = useRef(new Animated.Value(1)).current;

  // Auth
  useEffect(() => {
    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (data.user) setUserId(data.user.id);
      })
      .catch(() => {});
  }, []);

  // Check waitlist status + user count
  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        const [{ data: wl }, { count: profileCount }] = await Promise.all([
          supabase.from('scene_waitlist').select('id').eq('user_id', userId).maybeSingle(),
          supabase.from('profiles').select('id', { count: 'exact', head: true }),
        ]);
        if (wl) setOnWaitlist(true);
        setUserCount(profileCount ?? 0);
      } catch {}
    })();
  }, [userId]);

  const handleNotify = useCallback(async () => {
    if (!userId || onWaitlist) return;
    hapticSuccess();
    setOnWaitlist(true);
    Animated.sequence([
      Animated.spring(notifyScale, { toValue: 1.05, useNativeDriver: true, speed: 50 }),
      Animated.spring(notifyScale, { toValue: 1, useNativeDriver: true, speed: 50 }),
    ]).start();
    try {
      await supabase.from('scene_waitlist').upsert({ user_id: userId });
    } catch {}
  }, [userId, onWaitlist]);

  const handleApply = useCallback(() => {
    hapticLight();
    // The application lives on the web (washedup.app/creator/apply); the
    // system browser owns it so this OTA carries no new in-app surface.
    Linking.openURL(APPLY_URL).catch(() => {});
  }, []);

  const handleShare = useCallback(() => {
    hapticLight();
    Share.share({ message: SHARE_MESSAGE }).catch(() => {});
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          The <Text style={styles.headerTitleItalic}>Scene</Text>
        </Text>
        <ProfileButton />
      </View>

      <ScrollView
        decelerationRate="normal"
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero: photo with gradient fade */}
        <View style={styles.hero}>
          {/* Background photo */}
          <Image
            source={require('../../../assets/images/scene-hero.jpg')}
            style={styles.heroPhoto}
            contentFit="cover"
          />
          {/* Gradient fade to cream at bottom: stacked opacity bands */}
          <View style={[styles.heroFadeBand, { bottom: 80, opacity: 0.15 }]} />
          <View style={[styles.heroFadeBand, { bottom: 60, opacity: 0.3 }]} />
          <View style={[styles.heroFadeBand, { bottom: 40, opacity: 0.5 }]} />
          <View style={[styles.heroFadeBand, { bottom: 20, opacity: 0.75 }]} />
          <View style={[styles.heroFadeBand, { bottom: 0, opacity: 1 }]} />
          {/* Logo watermark on top */}
          <Image
            source={require('../../../assets/images/w-logo-waves.png')}
            style={styles.watermark}
            contentFit="contain"
          />
        </View>

        {/* LIZ COPY: the founding-partner lead (exact copy from the directive) */}
        <Text style={styles.kicker}>the people behind LA</Text>
        <Text style={styles.headline}>Make something worth showing up for.</Text>
        <Text style={styles.subtext}>
          We're building the city's most human social calendar, starting with the people who already bring others together.
        </Text>

        {/* Founding-partner card */}
        <View style={styles.card}>
          {/* LIZ COPY */}
          <Text style={styles.cardKicker}>founding partner applications</Text>
          <Text style={styles.cardTitle}>Run a community? Put on events?</Text>
          <Text style={styles.cardSubtext}>
            Bring your people to washedup. We'll help the right Angelenos discover what you're building.
          </Text>

          <TouchableOpacity style={styles.applyBtn} onPress={handleApply} activeOpacity={0.85}>
            {/* LIZ COPY */}
            <Text style={styles.applyBtnText}>{'Apply as a founding partner →'}</Text>
          </TouchableOpacity>
          {/* LIZ COPY */}
          <Text style={styles.quietLine}>2 minutes · no commitment</Text>

          <TouchableOpacity onPress={handleShare} activeOpacity={0.7} style={styles.shareLinkWrap}>
            {/* LIZ COPY */}
            <Text style={styles.shareLink}>{'Know someone who should see this? Send it to them →'}</Text>
          </TouchableOpacity>
        </View>

        {/* Plans nudge */}
        <View style={styles.nudge}>
          <Text style={styles.nudgeText}>
            In the meantime, make some plans or join people on theirs
          </Text>
          <TouchableOpacity
            onPress={() => { hapticLight(); router.push('/(tabs)/plans'); }}
            activeOpacity={0.7}
            style={styles.nudgeLinkWrap}
          >
            <Text style={styles.nudgeLink}>{'Browse Plans →'}</Text>
          </TouchableOpacity>
        </View>

        {/* Social proof footer */}
        {userCount > 0 && (
          <Text style={styles.footerText}>
            {userCount.toLocaleString()} {userCount === 1 ? 'person' : 'people'} getting offline together
          </Text>
        )}

        {/* Notify me */}
        <Animated.View style={[styles.notifyRow, { transform: [{ scale: notifyScale }] }]}>
          <TouchableOpacity
            style={styles.notifyTouchable}
            onPress={handleNotify}
            activeOpacity={0.7}
            disabled={onWaitlist}
          >
            <Ionicons
              name={onWaitlist ? 'checkmark-circle' : 'notifications-outline'}
              size={16}
              color={Colors.terracotta}
            />
            <Text style={styles.notifyText}>
              {onWaitlist ? "You're on the list ✓" : 'Notify me when Scene drops'}
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.parchment,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: FontSizes.displayLG,
    fontWeight: '700',
    color: Colors.darkWarm,
  },
  headerTitleItalic: {
    fontWeight: '700',
  },
  scrollContent: {
    alignItems: 'center',
    paddingBottom: 100,
  },

  // ── Hero: photo with fade ──
  hero: {
    width: SCREEN_WIDTH,
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  heroPhoto: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.75,
  },
  heroFadeBand: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 30,
    backgroundColor: Colors.parchment,
  },
  watermark: {
    width: 110,
    height: 110,
    opacity: 0.1,
  },

  // ── Copy ──
  kicker: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    textAlign: 'center',
    marginTop: 20,
  },
  headline: {
    fontFamily: Fonts.displayBold, // weight lives in the face; a fontWeight override would faux-bold on Android
    fontSize: FontSizes.displayLG,
    lineHeight: LineHeights.displayLG,
    color: Colors.darkWarm,
    textAlign: 'center',
    maxWidth: 320,
    marginTop: 8,
  },
  subtext: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.secondary,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 300,
    marginTop: 8,
  },

  // ── Notify ──
  notifyRow: {
    alignItems: 'center',
    marginTop: 20,
  },
  notifyTouchable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  notifyText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.terracotta,
  },

  // ── Founding-partner card ──
  card: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 0,
    borderTopWidth: 2,
    borderTopColor: Colors.terracotta,
    padding: 24,
    marginTop: 24,
    marginHorizontal: 24,
    alignSelf: 'stretch',
    shadowColor: Colors.darkWarm,
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 12,
    elevation: 3,
  },
  cardKicker: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    textAlign: 'center',
  },
  cardTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displayMD,
    lineHeight: LineHeights.displayMD,
    color: Colors.darkWarm,
    textAlign: 'center',
    marginTop: 6,
  },
  cardSubtext: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    textAlign: 'center',
    lineHeight: 19,
    marginTop: 6,
  },
  applyBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    marginTop: 16,
    shadowColor: Colors.terracotta,
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 3,
  },
  applyBtnText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.white,
  },
  quietLine: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
    textAlign: 'center',
    marginTop: 8,
  },
  shareLinkWrap: {
    marginTop: 14,
    paddingVertical: 4,
  },
  shareLink: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
    textAlign: 'center',
  },

  // ── Nudge ──
  nudge: {
    alignItems: 'center',
    marginTop: 24,
    paddingHorizontal: 20,
  },
  nudgeText: {
    fontSize: 13,
    color: Colors.secondary,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  nudgeLinkWrap: {
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  nudgeLink: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.terracotta,
  },

  // ── Footer ──
  footerText: {
    fontSize: 12,
    color: Colors.secondary,
    opacity: 0.7,
    textAlign: 'center',
    letterSpacing: 0.5,
    marginTop: 20,
  },
});
