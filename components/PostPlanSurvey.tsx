import React, { useCallback, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  FlatList,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../constants/Typography';
import { hapticLight, hapticMedium } from '../lib/haptics';
import { supabase } from '../lib/supabase';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SurveyPlan {
  id: string;
  title: string;
  image_url: string | null;
}

export interface SurveyMember {
  id: string;
  first_name_display: string | null;
  profile_photo_url: string | null;
}

interface Props {
  visible: boolean;
  plan: SurveyPlan;
  members: SurveyMember[];
  userId: string;
  onComplete: () => void;
}

// ─── Step types ─────────────────────────────────────────────────────────────

type Step =
  | 'attended'
  | 'no_message'
  | 'everyone_there'
  | 'no_show_picker'
  | 'rating'
  | 'thumbs_up_comment';

// ─── Component ──────────────────────────────────────────────────────────────

export default function PostPlanSurvey({ visible, plan, members, userId, onComplete }: Props) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>('attended');
  const [selectedNoShows, setSelectedNoShows] = useState<Set<string>>(new Set());
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reset = useCallback(() => {
    setStep('attended');
    setSelectedNoShows(new Set());
    setComment('');
    setSubmitting(false);
  }, []);

  // ── DB helpers ──────────────────────────────────────────────────────────

  const insertFeedback = useCallback(async (attended: boolean, rating: string | null, feedbackComment: string | null) => {
    const { error } = await supabase.from('plan_feedback').insert({
      event_id: plan.id,
      user_id: userId,
      attended,
      rating,
      comment: feedbackComment || null,
    });
    if (error) console.warn('[WashedUp] Failed to insert feedback:', error);
  }, [plan.id, userId]);

  const insertNoShowReports = useCallback(async (noShowUserIds: string[]) => {
    const rows = noShowUserIds.map((uid) => ({
      event_id: plan.id,
      reporter_user_id: userId,
      no_show_user_id: uid,
    }));
    const { error } = await supabase.from('no_show_reports').insert(rows);
    if (error) console.warn('[WashedUp] Failed to insert no-show reports:', error);
  }, [plan.id, userId]);

  const finish = useCallback(() => {
    reset();
    onComplete();
  }, [reset, onComplete]);

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleNo = useCallback(async () => {
    hapticLight();
    setStep('no_message');
  }, []);

  const handleGotIt = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    hapticLight();
    await insertFeedback(false, null, null);
    finish();
  }, [submitting, insertFeedback, finish]);

  const handleYes = useCallback(() => {
    hapticLight();
    setStep('everyone_there');
  }, []);

  const handleEveryoneMadeIt = useCallback(() => {
    hapticLight();
    setStep('rating');
  }, []);

  const handleSomeoneDidntShow = useCallback(() => {
    hapticLight();
    setStep('no_show_picker');
  }, []);

  const toggleNoShow = useCallback((memberId: string) => {
    hapticLight();
    setSelectedNoShows((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }, []);

  const handleNoShowContinue = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    hapticMedium();
    await insertNoShowReports(Array.from(selectedNoShows));
    setSubmitting(false);
    setStep('rating');
  }, [submitting, selectedNoShows, insertNoShowReports]);

  const handleThumbsDown = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    hapticLight();
    await insertFeedback(true, 'thumbs_down', null);
    finish();
  }, [submitting, insertFeedback, finish]);

  const handleThumbsUp = useCallback(() => {
    hapticLight();
    setStep('thumbs_up_comment');
  }, []);

  const handleDone = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    hapticLight();
    await insertFeedback(true, 'thumbs_up', comment.trim() || null);
    finish();
  }, [submitting, comment, insertFeedback, finish]);

  const handleDismiss = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    hapticLight();
    await insertFeedback(true, null, null);
    finish();
  }, [submitting, insertFeedback, finish]);

  // ── Render helpers ──────────────────────────────────────────────────────

  const otherMembers = members.filter((m) => m.id !== userId);

  const renderHeader = () => (
    <View style={styles.headerImage}>
      {plan.image_url ? (
        <Image
          source={{ uri: plan.image_url }}
          style={styles.heroImage}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      ) : (
        <View style={styles.heroGradient}>
          <Ionicons name="sparkles" size={40} color={Colors.white} />
        </View>
      )}
    </View>
  );

  // ── Step content renderers ───────────────────────────────────────────────

  const isFullScreen = step === 'attended' || step === 'no_message';

  const renderModalContent = () => {
    switch (step) {
      case 'attended':
        return (
          <Animated.View key="attended" entering={FadeIn.duration(250)} exiting={FadeOut.duration(150)} style={styles.stepContainer}>
            {renderHeader()}
            <View style={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
              <Text style={styles.planTitle}>{plan.title}</Text>
              <Text style={styles.heading}>Did you make it?</Text>
              <View style={styles.buttonGroup}>
                <TouchableOpacity style={styles.primaryButton} onPress={handleYes} activeOpacity={0.85}>
                  <Text style={styles.primaryButtonText}>Yes, I went!</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.outlineButton} onPress={handleNo} activeOpacity={0.85}>
                  <Text style={styles.outlineButtonText}>No, I didn't</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Animated.View>
        );

      case 'no_message':
        return (
          <Animated.View key="no_message" entering={FadeIn.duration(250)} exiting={FadeOut.duration(150)} style={styles.stepContainer}>
            {renderHeader()}
            <View style={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
              <Text style={styles.planTitle}>{plan.title}</Text>
              <Text style={styles.bodyText}>
                No worries, but please remember washedup is different and people were expecting you. If you can't go, next time please leave the plan. We are new and trying to create accountability for no shows.
              </Text>
              <View style={styles.buttonGroup}>
                <TouchableOpacity style={styles.primaryButton} onPress={handleGotIt} activeOpacity={0.85} disabled={submitting}>
                  <Text style={styles.primaryButtonText}>Got it</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Animated.View>
        );

      case 'everyone_there':
        return (
          <Animated.View key="everyone" entering={FadeIn.duration(250)} exiting={FadeOut.duration(150)} style={styles.cardContent}>
            <Text style={styles.heading}>Was everyone there?</Text>
            <View style={styles.buttonGroup}>
              <TouchableOpacity style={styles.primaryButton} onPress={handleEveryoneMadeIt} activeOpacity={0.85}>
                <Text style={styles.primaryButtonText}>Everyone made it</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.outlineButton} onPress={handleSomeoneDidntShow} activeOpacity={0.85}>
                <Text style={styles.outlineButtonText}>Someone didn't show</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        );

      case 'no_show_picker':
        return (
          <Animated.View key="picker" entering={FadeIn.duration(250)} exiting={FadeOut.duration(150)} style={styles.cardContent}>
            <Text style={styles.heading}>Who didn't show up?</Text>
            <Text style={styles.subheading}>Tap to select</Text>
            <FlatList
              data={otherMembers}
              keyExtractor={(item) => item.id}
              style={styles.memberList}
              contentContainerStyle={styles.memberListContent}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const selected = selectedNoShows.has(item.id);
                return (
                  <TouchableOpacity
                    style={[styles.memberRow, selected && styles.memberRowSelected]}
                    onPress={() => toggleNoShow(item.id)}
                    activeOpacity={0.8}
                  >
                    {item.profile_photo_url ? (
                      <Image source={{ uri: item.profile_photo_url }} style={styles.memberAvatar} contentFit="cover" />
                    ) : (
                      <View style={styles.memberAvatarPlaceholder}>
                        <Ionicons name="person-outline" size={18} color={Colors.tertiary} />
                      </View>
                    )}
                    <Text style={styles.memberName} numberOfLines={1}>
                      {item.first_name_display ?? 'Member'}
                    </Text>
                    {selected && (
                      <Ionicons name="checkmark-circle" size={22} color={Colors.terracotta} />
                    )}
                  </TouchableOpacity>
                );
              }}
            />
            <TouchableOpacity
              style={[styles.primaryButton, selectedNoShows.size === 0 && styles.buttonDisabled]}
              onPress={handleNoShowContinue}
              activeOpacity={0.85}
              disabled={selectedNoShows.size === 0 || submitting}
            >
              <Text style={styles.primaryButtonText}>Continue</Text>
            </TouchableOpacity>
          </Animated.View>
        );

      case 'rating':
        return (
          <Animated.View key="rating" entering={FadeIn.duration(250)} exiting={FadeOut.duration(150)} style={styles.cardContent}>
            <Text style={styles.heading}>How was it?</Text>
            <View style={styles.thumbRow}>
              <TouchableOpacity style={styles.thumbButton} onPress={handleThumbsUp} activeOpacity={0.8}>
                <Text style={styles.thumbEmoji}>{'\uD83D\uDC4D'}</Text>
                <Text style={styles.thumbLabel}>Great</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.thumbButton} onPress={handleThumbsDown} activeOpacity={0.8} disabled={submitting}>
                <Text style={styles.thumbEmoji}>{'\uD83D\uDC4E'}</Text>
                <Text style={styles.thumbLabel}>Not great</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        );

      case 'thumbs_up_comment':
        return (
          <Animated.View key="comment" entering={FadeIn.duration(250)} exiting={FadeOut.duration(150)} style={styles.cardContent}>
            <Text style={styles.heading}>Glad you had fun!</Text>
            <TextInput
              style={styles.commentInput}
              placeholder="Want to share what made it great?"
              placeholderTextColor={Colors.tertiary}
              value={comment}
              onChangeText={setComment}
              multiline
              maxLength={500}
              textAlignVertical="top"
            />
            <TouchableOpacity style={styles.primaryButton} onPress={handleDone} activeOpacity={0.85} disabled={submitting}>
              <Text style={styles.primaryButtonText}>Done</Text>
            </TouchableOpacity>
          </Animated.View>
        );
    }
  };

  // ── Full-screen modal for steps 1 & no_message ──────────────────────────
  if (isFullScreen) {
    return (
      <Modal visible={visible} animationType="none" transparent={false}>
        <View style={styles.container}>
          {renderModalContent()}
        </View>
      </Modal>
    );
  }

  // ── Centered card modal for steps 2+ ────────────────────────────────────
  return (
    <Modal visible={visible} animationType="fade" transparent statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={[styles.card, { maxHeight: '70%' }]}>
          <TouchableOpacity
            style={styles.dismissButton}
            onPress={handleDismiss}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.7}
            disabled={submitting}
          >
            <Ionicons name="close" size={18} color={Colors.secondary} />
          </TouchableOpacity>
          {renderModalContent()}
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.parchment,
  },
  stepContainer: {
    flex: 1,
  },

  // ── Header / Hero ──
  headerImage: {
    width: SCREEN_WIDTH,
    height: 220,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroGradient: {
    width: '100%',
    height: '100%',
    backgroundColor: Colors.terracotta,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ── Backdrop / Card ──
  backdrop: {
    flex: 1,
    backgroundColor: Colors.overlayDark,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: 24,
    width: '100%',
    overflow: 'hidden',
  },
  cardContent: {
    paddingHorizontal: 28,
    paddingTop: 48,
    paddingBottom: 32,
    justifyContent: 'center',
  },
  dismissButton: {
    position: 'absolute',
    top: 14,
    right: 14,
    zIndex: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.accentSubtle,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ── Content ──
  content: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 28,
  },

  // ── Text ──
  planTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displayLG,
    lineHeight: LineHeights.displayLG,
    color: Colors.darkWarm,
    marginBottom: 16,
  },
  heading: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displayMD,
    lineHeight: LineHeights.displayMD,
    color: Colors.darkWarm,
    textAlign: 'center',
    marginBottom: 24,
  },
  subheading: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.secondary,
    textAlign: 'center',
    marginBottom: 16,
  },
  bodyText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyLG,
    lineHeight: 26,
    color: Colors.secondary,
    marginBottom: 32,
  },

  // ── Buttons ──
  buttonGroup: {
    gap: 14,
    marginTop: 8,
  },
  primaryButton: {
    backgroundColor: Colors.terracotta,
    paddingVertical: 16,
    borderRadius: 999,
    alignItems: 'center',
    shadowColor: Colors.terracotta,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryButtonText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.white,
  },
  outlineButton: {
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    paddingVertical: 16,
    borderRadius: 999,
    alignItems: 'center',
    backgroundColor: Colors.white,
  },
  outlineButtonText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.terracotta,
  },
  buttonDisabled: {
    opacity: 0.4,
  },

  // ── Thumbs ──
  thumbRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 32,
  },
  thumbButton: {
    alignItems: 'center',
    padding: 20,
    borderRadius: 20,
    backgroundColor: Colors.white,
    width: 120,
    shadowColor: Colors.terracotta,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  thumbEmoji: {
    fontSize: 48,
    marginBottom: 8,
  },
  thumbLabel: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
  },

  // ── Member picker ──
  memberList: {
    maxHeight: 320,
    marginBottom: 24,
  },
  memberListContent: {
    gap: 8,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    backgroundColor: Colors.white,
    gap: 12,
  },
  memberRowSelected: {
    borderWidth: 2,
    borderColor: Colors.terracotta,
    padding: 10,
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  memberAvatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.accentSubtle,
    justifyContent: 'center',
    alignItems: 'center',
  },
  memberName: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.darkWarm,
    flex: 1,
  },

  // ── Comment ──
  commentInput: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.darkWarm,
    backgroundColor: Colors.inputBg,
    borderRadius: 14,
    padding: 16,
    minHeight: 100,
    marginBottom: 24,
  },
});
