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
import { hapticLight, hapticMedium, hapticHeavy, hapticSelection, hapticSuccess, hapticWarning, hapticError } from '../../lib/haptics';
import { Share2 } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';

export interface SharePlanModalProps {
  visible: boolean;
  onClose: () => void;
  planTitle: string;
  planId: string;
  slug?: string | null;
  spotsLeft?: number;
  genderLabel?: string;
  variant: 'posted' | 'joined';
}

export function SharePlanModal({
  visible,
  onClose,
  planTitle,
  planId,
  slug,
  spotsLeft,
  genderLabel,
  variant,
}: SharePlanModalProps) {
  const shareUrl = slug ? `https://washedup.app/plans/${slug}` : planId ? `https://washedup.app/e/${planId}` : 'https://washedup.app';

  const spotsText = spotsLeft !== undefined && spotsLeft > 0 ? `${spotsLeft} spot${spotsLeft === 1 ? '' : 's'} left` : 'Waitlist open';
  const shareText = `${planTitle}\n${spotsText} \u00B7 ${shareUrl}`;

  const handleShare = async () => {
    hapticMedium();
    try {
      await Share.share({ message: shareText.replace(shareUrl, '').trim(), url: shareUrl });
    } catch {}
  };

  const title = variant === 'posted' ? 'Plan posted!' : "You're in!";
  const subtitle = variant === 'posted' ? "Now let's fill it up!" : 'Help fill up the plan!';
  const bottomLabel = variant === 'posted' ? 'View My Plan' : 'Open Chat';

  return (
    <Modal
      visible={visible}
      animationType="slide" onRequestClose={onClose} statusBarTranslucent
      presentationStyle="pageSheet"
    >
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.iconCircle}>
            <Share2 size={28} color={Colors.terracotta} strokeWidth={2} />
          </View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>

          <View style={styles.previewCard}>
            <Text style={styles.previewText}>{shareText}</Text>
          </View>

          <TouchableOpacity style={styles.shareBtn} onPress={handleShare} activeOpacity={0.85}>
            <Share2 size={18} color={Colors.white} strokeWidth={2} />
            <Text style={styles.shareBtnText}>Share Link</Text>
          </TouchableOpacity>
          <Text style={styles.copyHint}>Use Copy from the share menu to copy the link</Text>

          <View style={styles.growthCard}>
            <Text style={styles.growthText}>
              We're brand new and growing! The best way to fill your plan is sharing it where people are looking for things to do — Facebook groups, Reddit, Instagram stories, group chats. It really helps!
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
    backgroundColor: Colors.parchment,
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
    backgroundColor: Colors.emptyIconBg,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  title: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.displayMD,
    color: Colors.asphalt,
    marginTop: 16,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.warmGray,
    marginTop: 4,
    textAlign: 'center',
  },
  previewCard: {
    backgroundColor: Colors.parchment,
    borderRadius: 12,
    padding: 16,
    marginTop: 24,
  },
  previewText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
    lineHeight: 20,
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.terracotta,
    borderRadius: 14,
    height: 54,
    marginTop: 20,
  },
  shareBtnText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.white,
  },
  copyHint: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.warmGray,
    marginTop: 10,
    textAlign: 'center',
  },
  growthCard: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.inputBg,
    padding: 16,
    marginTop: 20,
  },
  growthText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.warmGray,
    lineHeight: 19,
    textAlign: 'center',
  },
  bottomBtn: {
    height: 50,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  bottomBtnText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.terracotta,
  },
});
