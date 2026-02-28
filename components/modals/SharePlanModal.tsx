import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  Share,
  Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Share2 } from 'lucide-react-native';

export interface SharePlanModalProps {
  visible: boolean;
  onClose: () => void;
  planTitle: string;
  planId: string;
  spotsLeft?: number;
  genderLabel?: string;
  variant: 'posted' | 'joined';
}

export function SharePlanModal({
  visible,
  onClose,
  planTitle,
  planId,
  spotsLeft,
  genderLabel,
  variant,
}: SharePlanModalProps) {
  const shareUrl = planId ? `https://washedup.app/e/${planId}` : 'https://washedup.app';

  const shareText =
    variant === 'posted'
      ? `Join me on WashedUp!: ${planTitle}${spotsLeft !== undefined ? ` ${spotsLeft} spots left` : ''}\n${shareUrl}`
      : `I just joined ${planTitle} on WashedUp! Come with us!\n${shareUrl}`;

  const handleShare = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await Share.share({ message: shareText });
    } catch {}
  };

  const title = variant === 'posted' ? 'Plan posted!' : "You're in!";
  const subtitle = variant === 'posted' ? "Now let's fill it up!" : 'Help fill up the plan!';
  const bottomLabel = variant === 'posted' ? 'View My Plan' : 'Open Chat';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
    >
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.iconCircle}>
            <Text style={styles.partyEmoji}>🎉</Text>
          </View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>

          <View style={styles.previewCard}>
            <Text style={styles.previewText}>{shareText}</Text>
          </View>

          <TouchableOpacity style={styles.shareBtn} onPress={handleShare} activeOpacity={0.85}>
            <Share2 size={18} color="#FFFFFF" strokeWidth={2} />
            <Text style={styles.shareBtnText}>Share Link</Text>
          </TouchableOpacity>
          <Text style={styles.copyHint}>Use Copy from the share menu to copy the link</Text>

          <View style={styles.growthCard}>
            <Text style={styles.growthText}>
              We're brand new and growing! The best way to fill your plan is sharing it where people are looking for things to do — Facebook groups, Reddit, Instagram stories, group chats. It really helps 🙏
            </Text>
          </View>

          <TouchableOpacity style={styles.bottomBtn} onPress={onClose} activeOpacity={0.85}>
            <Text style={styles.bottomBtnText}>{bottomLabel}</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFF8F0',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFF0E8',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  partyEmoji: {
    fontSize: 28,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1A1A1A',
    marginTop: 16,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: '#9B8B7A',
    marginTop: 4,
    textAlign: 'center',
  },
  previewCard: {
    backgroundColor: '#F9F5F0',
    borderRadius: 12,
    padding: 16,
    marginTop: 24,
  },
  previewText: {
    fontSize: 14,
    color: '#1A1A1A',
    lineHeight: 20,
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#C4652A',
    borderRadius: 14,
    height: 54,
    marginTop: 20,
  },
  shareBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  copyHint: {
    fontSize: 12,
    color: '#9B8B7A',
    marginTop: 10,
    textAlign: 'center',
  },
  growthCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F0E6D3',
    padding: 16,
    marginTop: 20,
  },
  growthText: {
    fontSize: 13,
    color: '#9B8B7A',
    lineHeight: 19,
    textAlign: 'center',
  },
  bottomBtn: {
    height: 50,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#C4652A',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  bottomBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#C4652A',
  },
});
