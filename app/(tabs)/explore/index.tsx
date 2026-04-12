import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Dimensions,
  Keyboard,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { supabase } from '../../../lib/supabase';
import { hapticLight, hapticSuccess } from '../../../lib/haptics';
import ProfileButton from '../../../components/ProfileButton';
import Colors from '../../../constants/Colors';
import { FontSizes } from '../../../constants/Typography';

const { width: SCREEN_WIDTH } = Dimensions.get('window');


const PLACEHOLDERS = [
  'Rooftop movie nights...',
  'Sunrise hikes in Griffith...',
  'Jazz bars in West Hollywood...',
  'Taco crawls through East LA...',
  'Beach bonfires at sunset...',
];

// ─── Main Component ──────────────────────────────────────────────────────────

export default function ScenePage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState('');
  const [submitState, setSubmitState] = useState<'idle' | 'success'>('idle');
  const [onWaitlist, setOnWaitlist] = useState(false);
  const [waitlistCount, setWaitlistCount] = useState(0);
  const [userCount, setUserCount] = useState(0);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [inputFocused, setInputFocused] = useState(false);

  const shakeAnim = useRef(new Animated.Value(0)).current;
  const notifyScale = useRef(new Animated.Value(1)).current;
  const placeholderOpacity = useRef(new Animated.Value(1)).current;


  // Auth
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUserId(data.user.id);
    });
  }, []);

  // Check waitlist status + counts
  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        const [{ data: wl }, { count: wlCount }, { count: profileCount }] = await Promise.all([
          supabase.from('scene_waitlist').select('id').eq('user_id', userId).maybeSingle(),
          supabase.from('scene_waitlist').select('id', { count: 'exact', head: true }),
          supabase.from('profiles').select('id', { count: 'exact', head: true }),
        ]);
        if (wl) setOnWaitlist(true);
        setWaitlistCount(wlCount ?? 0);
        setUserCount(profileCount ?? 0);
      } catch {}
    })();
  }, [userId]);

  // Rotating placeholder
  useEffect(() => {
    if (inputFocused) return;
    const interval = setInterval(() => {
      Animated.timing(placeholderOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(() => {
        setPlaceholderIndex((prev) => (prev + 1) % PLACEHOLDERS.length);
        Animated.timing(placeholderOpacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }).start();
      });
    }, 3000);
    return () => clearInterval(interval);
  }, [inputFocused]);

  const handleNotify = useCallback(async () => {
    if (!userId || onWaitlist) return;
    hapticSuccess();
    setOnWaitlist(true);
    setWaitlistCount((c) => c + 1);
    Animated.sequence([
      Animated.spring(notifyScale, { toValue: 1.05, useNativeDriver: true, speed: 50 }),
      Animated.spring(notifyScale, { toValue: 1, useNativeDriver: true, speed: 50 }),
    ]).start();
    try {
      await supabase.from('scene_waitlist').upsert({ user_id: userId });
    } catch {}
  }, [userId, onWaitlist]);

  const handleSubmit = useCallback(async () => {
    if (!userId) return;
    const text = suggestion.trim();
    if (!text) {
      Animated.sequence([
        Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
      ]).start();
      return;
    }
    hapticSuccess();
    Keyboard.dismiss();
    setSuggestion('');
    setSubmitState('success');
    try {
      await supabase.from('scene_suggestions').insert({ user_id: userId, suggestion: text });
    } catch {}
    setTimeout(() => setSubmitState('idle'), 2000);
  }, [userId, suggestion]);

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
        keyboardShouldPersistTaps="handled"
      >
        {/* Hero: photo with gradient fade */}
        <View style={styles.hero}>
          {/* Background photo */}
          <Image
            source={require('../../../assets/images/scene-hero.jpg')}
            style={styles.heroPhoto}
            contentFit="cover"
          />
          {/* Gradient fade to cream at bottom — stacked opacity bands */}
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

        {/* Headline + subtext */}
        <Text style={styles.headline}>Your LA</Text>
        <Text style={styles.subtext}>
          We're brand new, and hand-picking the best of LA for the washedup community. We would love your help to make the Scene of Los Angeles.
        </Text>

        {/* Suggestion card */}
        <View style={styles.card}>
          <Text style={styles.cardHeadline}>What do you want to do?</Text>
          <Text style={styles.cardSubtext}>in LA that would be nicer with people to go with</Text>

          <View style={styles.inputWrapper}>
            <Animated.View style={{ transform: [{ translateX: shakeAnim }] }}>
              <TextInput
                style={styles.input}
                value={suggestion}
                onChangeText={setSuggestion}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                maxLength={200}
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
              />
            </Animated.View>
            {!suggestion && !inputFocused && (
              <Animated.Text
                style={[styles.placeholderOverlay, { opacity: placeholderOpacity }]}
                pointerEvents="none"
              >
                {PLACEHOLDERS[placeholderIndex]}
              </Animated.Text>
            )}
          </View>

          <TouchableOpacity
            style={styles.submitBtn}
            onPress={handleSubmit}
            activeOpacity={0.85}
          >
            <Text style={styles.submitBtnText}>
              {submitState === 'success' ? 'Thanks! \u2713' : 'Submit'}
            </Text>
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
            <Text style={styles.nudgeLink}>{'Browse Plans \u2192'}</Text>
          </TouchableOpacity>
        </View>

        {/* Social proof footer */}
        {userCount > 0 && (
          <Text style={styles.footerText}>
            {userCount.toLocaleString()} people getting offline together
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
              {onWaitlist ? "You're on the list \u2713" : 'Notify me when Scene drops'}
            </Text>
          </TouchableOpacity>
          {onWaitlist && waitlistCount > 1 && (
            <Text style={styles.waitlistCount}>
              {waitlistCount.toLocaleString()} others waiting
            </Text>
          )}
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
  headline: {
    fontFamily: 'Cochin',
    fontSize: 30,
    fontWeight: '700',
    color: Colors.darkWarm,
    textAlign: 'center',
    marginTop: 20,
  },
  subtext: {
    fontSize: 15,
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
  waitlistCount: {
    fontSize: 12,
    color: Colors.secondary,
    opacity: 0.7,
    marginTop: 4,
  },

  // ── Card ──
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 0,
    borderTopWidth: 2,
    borderTopColor: '#B5522E',
    padding: 24,
    marginTop: 24,
    marginHorizontal: 24,
    alignSelf: 'stretch',
    shadowColor: '#2C1810',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 12,
    elevation: 3,
  },
  cardHeadline: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.darkWarm,
    textAlign: 'center',
  },
  cardSubtext: {
    fontSize: 13,
    color: Colors.secondary,
    textAlign: 'center',
    marginTop: 4,
  },
  inputWrapper: {
    marginTop: 16,
    position: 'relative',
  },
  input: {
    backgroundColor: '#FAF5EC',
    borderRadius: 10,
    padding: 14,
    fontSize: 14,
    color: Colors.darkWarm,
    height: 44,
    borderWidth: 1,
    borderColor: '#E8DDD0',
  },
  placeholderOverlay: {
    position: 'absolute',
    left: 14,
    top: 13,
    fontSize: 14,
    color: Colors.secondary,
    opacity: 0.5,
  },
  submitBtn: {
    backgroundColor: '#B5522E',
    borderRadius: 10,
    height: 40,
    width: '50%',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginTop: 14,
  },
  submitBtnText: {
    color: Colors.white,
    fontSize: 14,
    fontWeight: '600',
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
