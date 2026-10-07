/**
 * PostConfirmation - the Tier-1 post moment (design study v3). One per event.
 * Shows optimistically the instant a plan is posted: a terracotta ring with the
 * brand-drawn ConfirmationMark, the emotional copy, the plan card, and two
 * actions. "share it" is the visually primary action (the growth loop, at peak
 * emotion) and opens the existing share content on intent only; "see your
 * plans" is the quiet secondary. A user's first plan elevates the copy - the
 * separate FirstPlanCelebration is folded into this screen for V2.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  FadeIn,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import Colors, { AfterglowColors } from '../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';
import ConfirmationMark from './ConfirmationMark';
import type { PostPlanInvitationStatus } from '../post/usePostPlanInvitations';

interface PostConfirmationProps {
  appearance?: { fonts: AfterglowFontFamilies };
  visible: boolean;
  isFirstPlan: boolean;
  planTitle: string;
  metaLine: string;
  planReady: boolean;
  invitationStatus: PostPlanInvitationStatus;
  canRetryInvites: boolean;
  onRetryInvites: () => void;
  canContinue: () => boolean;
  onShare: () => void;
  onSeePlans: () => void;
}

export default function PostConfirmation({
  appearance,
  visible,
  isFirstPlan,
  planTitle,
  metaLine,
  planReady,
  invitationStatus,
  canRetryInvites,
  onRetryInvites,
  canContinue,
  onShare,
  onSeePlans,
}: PostConfirmationProps) {
  const styles = useMemo(() => appearance ? { ...legacyStyles, ...confirmationAppearance(appearance.fonts) } : legacyStyles, [appearance]);
  const headline = !planReady ? 'Posting your plan…' : appearance
    ? (isFirstPlan ? 'Your first plan is live.' : 'Your plan is live.')
    : isFirstPlan ? 'your first plan is out there.' : "it's out there.";
  // "now someone has to say yes." appears exactly once: in the headline pair
  // for repeat plans, in the subtitle for a first plan (C15, the doubled
  // sentence)
  const sub = !planReady ? 'Your details stay here while the plan saves.' : appearance
    ? 'A little something to look forward to.' : isFirstPlan
      ? 'your plan is live. now someone has to say yes.'
      : 'your plan is live.';
  // One exit per visible confirmation. Hiding the modal schedules a render;
  // a second tap must not open sharing and navigate to the plan meanwhile.
  const visit = useMemo(() => ({ claimed: false }), [visible]);
  const currentVisit = useRef(visit);
  currentVisit.current = visit;
  const mounted = useRef(false);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const continueWith = (action: () => void) => {
    if (!mounted.current || !visible || currentVisit.current !== visit || visit.claimed || !planReady || !canContinue()) return;
    visit.claimed = true;
    action();
  };
  const invitesBusy = invitationStatus === 'waiting' || invitationStatus === 'sending';
  const actionsPending = !planReady || invitesBusy;
  const invitationMessage = invitationStatus === 'waiting' ? 'Your invitations will be requested once the plan is saved.'
    : invitationStatus === 'sending' ? 'Sending your invitation request…'
      : invitationStatus === 'confirmed' ? 'Invitation request confirmed.'
        : invitationStatus === 'unconfirmed' ? 'Couldn’t confirm the invitation request. You can continue to your plan.' : null;

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

  const content = (
        <Animated.View entering={FadeIn.duration(220)} style={styles.center}>
          <Animated.View style={[styles.ring, ringStyle]}>
            <ConfirmationMark size={30} color={appearance ? AfterglowColors.clay : undefined} />
          </Animated.View>

          <Text style={styles.headline}>{headline}</Text>
          {planReady && !isFirstPlan && !appearance ? <Text style={styles.headlineSecond}>now someone has to say yes.</Text> : null}
          <Text style={styles.sub}>{sub}</Text>

          <Animated.View entering={FadeInUp.duration(280).delay(120)} style={styles.planCard}>
            <Text style={styles.planTitle} numberOfLines={appearance ? undefined : 2}>{planTitle}</Text>
            <Text style={styles.planMeta} numberOfLines={appearance ? undefined : 2}>{metaLine}</Text>
          </Animated.View>

          {!!invitationMessage && <Text style={styles.invitationStatus} accessibilityLiveRegion="polite" role="status">{invitationMessage}</Text>}
          {canRetryInvites && (
            <TouchableOpacity style={styles.inviteRetry} onPress={onRetryInvites} accessibilityRole="button" accessibilityLabel="Retry invitations">
              <Text style={styles.inviteRetryText}>{appearance ? 'Retry invitations' : 'Retry invites'}</Text>
            </TouchableOpacity>
          )}

          <View style={styles.actions}>
            <TouchableOpacity style={[styles.shareBtn, actionsPending && styles.disabled]} onPress={() => continueWith(onShare)} disabled={actionsPending}
              accessibilityRole="button" accessibilityLabel={appearance ? 'Share plan' : undefined} accessibilityState={{ disabled: actionsPending, busy: actionsPending }} activeOpacity={0.85}>
              <Text style={styles.shareBtnText} numberOfLines={appearance ? 1 : undefined}>{appearance ? 'Share plan' : 'share it'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.seeBtn, actionsPending && styles.disabled]} onPress={() => continueWith(onSeePlans)} disabled={actionsPending}
              accessibilityRole="button" accessibilityLabel={appearance ? 'View plan' : undefined} accessibilityState={{ disabled: actionsPending, busy: actionsPending }} activeOpacity={0.7}>
              <Text style={styles.seeBtnText} numberOfLines={appearance ? 1 : undefined}>{appearance ? 'View plan' : 'see your plans'}</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
  );
  return (
    <Modal visible={visible} animationType="fade" transparent={false} onRequestClose={() => continueWith(onSeePlans)}>
      {appearance ? (
        <SafeAreaView style={styles.screen}>
          <ScrollView contentContainerStyle={afterglowLayout.scroll} style={afterglowLayout.scrollFrame}>{content}</ScrollView>
        </SafeAreaView>
      ) : <View style={styles.screen}>{content}</View>}
    </Modal>
  );
}

const legacyStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.cream, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  center: { alignItems: 'center', width: '100%' },
  ring: {
    width: 72, height: 72, borderRadius: 36, borderWidth: 2, borderColor: Colors.terracotta,
    alignItems: 'center', justifyContent: 'center', marginBottom: 22,
  },
  headline: { fontFamily: Fonts.display, fontSize: 30, color: Colors.darkWarm, textAlign: 'center', lineHeight: 34 },
  headlineSecond: { fontFamily: Fonts.display, fontSize: 30, color: Colors.darkWarm, textAlign: 'center', lineHeight: 34, marginTop: -2 },
  sub: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.secondary, textAlign: 'center', lineHeight: 22, marginTop: 12, maxWidth: 280 },
  planCard: {
    width: '100%', backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 16, paddingHorizontal: 16, paddingVertical: 16, marginTop: 22,
  },
  planTitle: { fontFamily: Fonts.display, fontSize: 19, color: Colors.darkWarm },
  planMeta: { fontFamily: Fonts.sans, fontSize: 13, color: Colors.secondary, marginTop: 4, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 10, width: '100%', marginTop: 20 },
  invitationStatus: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.secondary, textAlign: 'center', marginTop: 16 },
  inviteRetry: { minHeight: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16 },
  inviteRetryText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  disabled: { opacity: 0.4 },
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


const afterglowLayout = StyleSheet.create({
  scrollFrame: { width: '100%', flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: 32 },
});
function confirmationAppearance(fonts: AfterglowFontFamilies) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: AfterglowColors.paper, paddingHorizontal: 24 },
    center: { alignItems: 'center', width: '100%', maxWidth: 430, alignSelf: 'center' },
    ring: { ...legacyStyles.ring, borderColor: AfterglowColors.clay, marginBottom: 24 },
    headline: { ...AfterglowType.screenTitle, fontFamily: fonts.display, color: AfterglowColors.ink, textAlign: 'center' },
    sub: { ...AfterglowType.message, fontFamily: fonts.regular, color: AfterglowColors.muted, textAlign: 'center', marginTop: 12 },
    planCard: { width: '100%', backgroundColor: AfterglowColors.white, borderWidth: 1, borderColor: AfterglowColors.subtleLine, borderRadius: 8, padding: 16, marginTop: 24 },
    planTitle: { ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.ink },
    planMeta: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted, marginTop: 6 },
    invitationStatus: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted, textAlign: 'center', marginTop: 16 },
    inviteRetryText: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.clay },
    actions: { width: '100%', gap: 10, marginTop: 24 },
    shareBtn: { backgroundColor: AfterglowColors.clay, borderRadius: 6, minHeight: 52, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
    shareBtnText: { ...AfterglowType.message, fontFamily: fonts.semibold, color: AfterglowColors.white },
    seeBtn: { borderWidth: 1, borderColor: AfterglowColors.line, borderRadius: 6, minHeight: 52, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
    seeBtnText: { ...AfterglowType.message, fontFamily: fonts.semibold, color: AfterglowColors.ink },
  });
}
