/**
 * PostConfirmation - the Tier-1 post moment (design study v3). One per event.
 * Shows optimistically the instant a plan is posted: a terracotta ring with the
 * brand-drawn ConfirmationMark, the emotional copy, the plan card, and two
 * actions. "share it" is the visually primary action (the growth loop, at peak
 * emotion) and opens the existing share content on intent only; "see your
 * plans" is the quiet secondary. A user's first plan elevates the copy - the
 * separate FirstPlanCelebration is folded into this screen for V2.
 */
import { useEffect } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import ConfirmationMark from './ConfirmationMark';

interface PostConfirmationProps {
  visible: boolean;
  isFirstPlan: boolean;
  planTitle: string;
  metaLine: string;
  invitedSomeone: boolean;
  onShare: () => void;
  onSeePlans: () => void;
}

export default function PostConfirmation({
  visible,
  isFirstPlan,
  planTitle,
  metaLine,
  invitedSomeone,
  onShare,
  onSeePlans,
}: PostConfirmationProps) {
  const headline = isFirstPlan ? 'your first plan is out there.' : "it's out there.";
  // "now someone has to say yes." appears exactly once: in the headline pair
  // for repeat plans, in the subtitle for a first plan (C15, the doubled
  // sentence)
  const sub = invitedSomeone
    ? 'your plan is live. the people you invited have been notified.'
    : isFirstPlan
      ? 'your plan is live. now someone has to say yes.'
      : 'your plan is live.';

  // The ring scales 0.6 -> 1 with the study's post-confirmation spring.
  const ringScale = useSharedValue(0.6);
  useEffect(() => {
    if (visible) {
      ringScale.value = 0.6;
      ringScale.value = withSpring(1, { mass: 0.8, stiffness: 400, damping: 22 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const ringStyle = useAnimatedStyle(() => ({ transform: [{ scale: ringScale.value }] }));

  return (
    <Modal visible={visible} animationType="fade" transparent={false}>
      <View style={styles.screen}>
        <Animated.View entering={FadeIn.duration(220)} style={styles.center}>
          <Animated.View style={[styles.ring, ringStyle]}>
            <ConfirmationMark size={30} />
          </Animated.View>

          <Text style={styles.headline}>{headline}</Text>
          {!isFirstPlan ? <Text style={styles.headlineSecond}>now someone has to say yes.</Text> : null}
          <Text style={styles.sub}>{sub}</Text>

          <Animated.View entering={FadeInUp.duration(280).delay(120)} style={styles.planCard}>
            <Text style={styles.planTitle} numberOfLines={2}>{planTitle}</Text>
            <Text style={styles.planMeta} numberOfLines={2}>{metaLine}</Text>
          </Animated.View>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.shareBtn} onPress={onShare} activeOpacity={0.85}>
              <Text style={styles.shareBtnText}>share it</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.seeBtn} onPress={onSeePlans} activeOpacity={0.7}>
              <Text style={styles.seeBtnText}>see your plans</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.cream, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  center: { alignItems: 'center', width: '100%' },
  ring: {
    width: 72, height: 72, borderRadius: 36, borderWidth: 2, borderColor: Colors.terracotta,
    alignItems: 'center', justifyContent: 'center', marginBottom: 22,
  },
  headline: { fontFamily: Fonts.displayItalic, fontSize: 30, color: Colors.darkWarm, textAlign: 'center', lineHeight: 34 },
  headlineSecond: { fontFamily: Fonts.displayItalic, fontSize: 30, color: Colors.darkWarm, textAlign: 'center', lineHeight: 34, marginTop: -2 },
  sub: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.secondary, textAlign: 'center', lineHeight: 22, marginTop: 12, maxWidth: 280 },
  planCard: {
    width: '100%', backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 16, paddingHorizontal: 16, paddingVertical: 16, marginTop: 22,
  },
  planTitle: { fontFamily: Fonts.displayItalic, fontSize: 19, color: Colors.darkWarm },
  planMeta: { fontFamily: Fonts.sans, fontSize: 13, color: Colors.secondary, marginTop: 4, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 10, width: '100%', marginTop: 20 },
  shareBtn: {
    flex: 1, backgroundColor: Colors.terracotta, borderRadius: 14, paddingVertical: 15, alignItems: 'center',
    shadowColor: Colors.terracotta, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
  },
  shareBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  seeBtn: {
    flex: 1, borderRadius: 14, paddingVertical: 15, alignItems: 'center',
    borderWidth: 1.5, borderColor: Colors.borderWarm,
  },
  seeBtnText: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
});
