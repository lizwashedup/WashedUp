import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { Share2, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors, { AfterglowColors } from '../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';

export interface SharePlanModalProps {
  appearance?: { fonts: AfterglowFontFamilies };
  visible: boolean;
  onClose: () => void;
  planTitle: string;
  planId: string;
  slug?: string | null;
  genderLabel?: string;
  variant: 'posted' | 'joined';
  /** Non-blocking heads-up when an on-post invitation request was not confirmed. */
  inviteWarning?: boolean;
}

export function SharePlanModal({
  visible,
  onClose,
  planTitle,
  planId,
  slug,
  genderLabel,
  variant,
  inviteWarning,
  appearance,
}: SharePlanModalProps) {
  const styles = useMemo(() => appearance ? { ...baseStyles, ...shareAppearance(appearance.fonts) } : baseStyles, [appearance]);
  const insets = useSafeAreaInsets();
  const shareUrl = slug ? `https://washedup.app/plans/${slug}` : planId ? `https://washedup.app/e/${planId}` : 'https://washedup.app';

  const shareText = `${planTitle}\n${shareUrl}`;

  const visit = useMemo(() => ({ closed: false, sharing: false }), [visible, shareText, variant]);
  const latest = useRef({ visit, visible }); latest.current = { visit, visible };
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [busyVisit, setBusyVisit] = useState<object | null>(null);
  const [failedVisit, setFailedVisit] = useState<object | null>(null);
  const isCurrent = () => mounted.current && latest.current.visible && latest.current.visit === visit && !visit.closed;
  const close = () => { if (!isCurrent()) return; visit.closed = true; onClose(); };
  const sharing = busyVisit === visit;
  const handleShare = async () => {
    if (!isCurrent() || visit.sharing) return;
    visit.sharing = true; setBusyVisit(visit); setFailedVisit(null);
    hapticMedium();
    try {
      // message alone, no separate `url` field: passing url as its own key
      // relies on the receiving app to insert a separator, which WhatsApp's
      // share extension does not do -- it glues the URL directly onto the
      // preceding text with no space or line break, so it never linkifies
      // (confirmed live, Liz 2026-08-27; same rule as lib/sharePlan.ts).
      await Share.share({ message: shareText });
    } catch { if (isCurrent()) setFailedVisit(visit); }
    finally { visit.sharing = false; if (isCurrent()) setBusyVisit(null); }
  };

  const title = appearance ? 'Share plan' : variant === 'posted' ? 'Plan posted!' : "You're in!";
  const subtitle = appearance ? 'Send the link to someone who might want to come.' : variant === 'posted' ? "Now let's fill it up!" : 'Help fill up the plan!';
  const bottomLabel = appearance ? (variant === 'posted' ? 'View plan' : 'Open chat') : variant === 'posted' ? 'View My Plan' : 'Open Chat';

  return (
    <Modal
      visible={visible}
      animationType="slide" onRequestClose={close} statusBarTranslucent
      presentationStyle="pageSheet"
    >
      <View style={styles.container}>
        <ScrollView
          decelerationRate="normal"
          contentContainerStyle={[
            styles.scrollContent,
            Platform.OS === 'android' && { paddingTop: insets.top + 16 },
            appearance && { paddingBottom: insets.bottom + 24 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity
            onPress={close}
            style={styles.closeBtn}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Close share screen"
          >
            <X size={22} color={appearance ? AfterglowColors.muted : Colors.warmGray} strokeWidth={2} />
          </TouchableOpacity>
          <View style={styles.iconCircle}>
            <Share2 size={28} color={appearance ? AfterglowColors.clay : Colors.terracotta} strokeWidth={2} />
          </View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>

          {inviteWarning && (
            <Text style={styles.inviteWarning}>
              {appearance ? 'We couldn’t confirm the invitation request. You can still share the plan link.' : "We couldn't reach everyone you invited. They'll still see this plan in the feed."}
            </Text>
          )}

          <View style={styles.previewCard}>
            <Text style={styles.previewText} selectable={!!appearance}>{shareText}</Text>
          </View>

          <TouchableOpacity style={[styles.shareBtn, sharing && styles.disabled]} onPress={handleShare} disabled={sharing} accessibilityRole="button" accessibilityLabel="Share link" accessibilityState={{ disabled: sharing, busy: sharing }} activeOpacity={0.85}>
            <Share2 size={18} color={appearance ? AfterglowColors.white : Colors.white} strokeWidth={2} />
            <Text style={styles.shareBtnText} numberOfLines={1}>{appearance ? (sharing ? 'Opening…' : 'Share link') : 'Share Link'}</Text>
          </TouchableOpacity>
          <Text style={styles.copyHint}>Use Copy from the share menu to copy the link</Text>
          {appearance && failedVisit === visit && <Text style={styles.shareError} accessibilityRole="alert">Couldn’t open sharing. Try again.</Text>}

          {!appearance && <View style={styles.growthCard}>
            <Text style={styles.growthText}>
              We're brand new and growing! The best way to fill your plan is sharing it where people are looking for things to do: Facebook groups, Reddit, Instagram stories, group chats. It really helps!
            </Text>
          </View>}

          <TouchableOpacity style={styles.bottomBtn} onPress={close} accessibilityRole="button" accessibilityLabel={bottomLabel} activeOpacity={0.85}>
            <Text style={styles.bottomBtnText} numberOfLines={1}>{bottomLabel}</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

const baseStyles = StyleSheet.create({
  disabled: { opacity: 0.6 },
  shareError: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.errorBrand, marginTop: 12, textAlign: 'center' },
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
  closeBtn: {
    alignSelf: 'flex-start',
    marginBottom: 8,
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
  inviteWarning: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.warmGray,
    textAlign: 'center',
    marginTop: 12,
    paddingHorizontal: 8,
    lineHeight: 19,
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

function shareAppearance(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  container: { ...baseStyles.container, backgroundColor: AfterglowColors.paper },
  scrollContent: { ...baseStyles.scrollContent, paddingTop: 16 },
  closeBtn: { ...baseStyles.closeBtn, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -12, marginBottom: 12 },
  iconCircle: { ...baseStyles.iconCircle, backgroundColor: AfterglowColors.avatar },
  title: { ...baseStyles.title, ...AfterglowType.identity, fontFamily: fonts.display, color: AfterglowColors.ink },
  subtitle: { ...baseStyles.subtitle, ...AfterglowType.message, fontFamily: fonts.regular, color: AfterglowColors.muted, marginTop: 8 },
  inviteWarning: { ...baseStyles.inviteWarning, ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted },
  previewCard: { ...baseStyles.previewCard, backgroundColor: AfterglowColors.white, borderWidth: 1, borderColor: AfterglowColors.subtleLine, borderRadius: 4 },
  previewText: { ...AfterglowType.message, fontFamily: fonts.regular, color: AfterglowColors.ink },
  shareBtn: { ...baseStyles.shareBtn, backgroundColor: AfterglowColors.clay, minHeight: 48, height: undefined, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 4 },
  shareBtnText: { ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.white },
  copyHint: { ...baseStyles.copyHint, ...AfterglowType.caption, fontFamily: fonts.regular, color: AfterglowColors.muted },
  shareError: { ...baseStyles.shareError, ...AfterglowType.body, fontFamily: fonts.regular },
  bottomBtn: { ...baseStyles.bottomBtn, minHeight: 48, height: undefined, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 4, borderWidth: 1, borderColor: AfterglowColors.line },
  bottomBtnText: { ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.ink },
}); }
