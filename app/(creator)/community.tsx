/**
 * Page configuration and account tools. Everyday member/chat/update actions
 * remain on the selected community's management home.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ScaledText as Text } from '../../components/ScaledText';
import {
  View,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { ChevronRight, CircleDollarSign, HelpCircle } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { type AfterglowFontFamilies, FontSizes, LineHeights } from '../../constants/Typography';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { hapticSuccess, hapticWarning } from '../../lib/haptics';
import { isAdminTierRole, type LedCommunity, buildCommunityPublicLink } from '../../lib/creatorMode';
import { useCreatorAccessRead } from '../../hooks/useCreatorAccessRead';
import { PUBLIC_PAGE_CONTROL_ENABLED } from '../../constants/FeatureFlags';
import { useLedCommunity } from '../../lib/selectedCommunity';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { CreatorActionFill } from '../../components/creator/CreatorActionFill';
import { useCommunityPublication } from '../../hooks/useCommunityPublication';
import { CommunityPublicationFeedback } from '../../components/creator/CommunityPublicationFeedback';

export default function CreatorCommunityScreen() {
  const { fonts } = useAfterglowFonts(true, 'creator');
  const styles = useMemo(() => createStyles(fonts), [fonts]);
  const focused = useIsFocused();
  const access = useCreatorAccessRead();
  const community = useLedCommunity(access.data);
  if (access.isLoading) return <View style={styles.centered}><ActivityIndicator accessibilityLabel="Loading community settings" color={Colors.terracotta} /></View>;
  if (access.isError) return <View style={styles.centered}>
    <Text accessibilityRole="alert" style={styles.hint}>Couldn’t load community settings.</Text>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry community settings" disabled={access.isFetching}
      style={styles.inlineAction} onPress={() => void access.refetch()}><Text style={styles.liveBannerLink}>{access.isFetching ? 'Checking…' : 'Try again'}</Text></TouchableOpacity>
  </View>;
  if (!community || !isAdminTierRole(community.role)) return focused ? <Redirect href="/(tabs)/friends/manage" /> : null;
  return <CommunitySettings key={community.id} community={community} refreshing={access.isFetching} refresh={() => void access.refetch()} />;
}

function CommunitySettings({ community, refreshing, refresh }: { community: LedCommunity; refreshing: boolean; refresh: () => void }) {
  const { fonts } = useAfterglowFonts(true, 'creator');
  const styles = useMemo(() => createStyles(fonts), [fonts]);
  const router = useRouter();
  const publication = useCommunityPublication(community.id);
  const status = publication.state?.status ?? community.status;
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);

  useEffect(() => { setAlertInfo(null); }, [publication.scope]);
  const publishing = publication.activeAction === 'publish';
  const archiving = publication.activeAction === 'archive';
  const canArchive = ['leader', 'co_leader'].includes(community.role);
  const handlePublish = () => {
    if (!publication.ready || status !== 'draft') return;
    setAlertInfo({
      title: 'Publish this page?',
      message: publication.state?.discoverable
        ? 'Your community will appear in discovery. Your joining and eligibility settings still apply.'
        : 'Your community will be available through its link and hidden from discovery. Your joining and eligibility settings still apply.',
      buttons: [
        { text: 'Not yet', style: 'cancel' },
        { text: 'Publish page', onPress: async () => { if (await publication.run('publish')) hapticSuccess(); } },
      ],
    });
  };
  const handleArchive = () => {
    if (!publication.ready || !canArchive || status === 'archived') return;
    setAlertInfo({
      title: 'Archive this community?',
      message: 'This hides your page from discovery and closes it to new members. Existing members keep their chat and access. You can’t undo this from here.',
      buttons: [
        { text: 'Not yet', style: 'cancel' },
        { text: 'Archive community', style: 'destructive', onPress: async () => { if (await publication.run('archive')) hapticWarning(); } },
      ],
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={[]}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.terracotta} />}
        >
          <Text accessibilityRole="header" style={styles.title}>Community settings</Text>
          <Text style={styles.intro}>Edit your page and choose how people join.</Text>

          <CommunityPublicationFeedback publication={publication} />
          <View style={styles.hubStack}>
            <TouchableOpacity
              style={styles.editPageCard}
              onPress={() => router.push('/creator/edit-page')}
              accessibilityRole="button"
              accessibilityLabel="Edit community"
              accessibilityHint="Change your name, cover photo, description and page sections."
            >
              <View style={styles.editPageTextWrap}>
                <Text numberOfLines={1} adjustsFontSizeToFit style={styles.editPageTitle}>Edit community</Text>
                <Text style={styles.editPageHint}>
                  Change your name, cover photo, description and page sections.
                </Text>
              </View>
              <ChevronRight size={20} color={Colors.terracotta} strokeWidth={2.5} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.editPageCard}
              onPress={() => router.push('/creator/join-gate')}
              accessibilityRole="button"
              accessibilityLabel="Joining settings"
              accessibilityHint="Set joining options, welcome text, introduction questions and guidelines."
            >
              <View style={styles.editPageTextWrap}>
                <Text numberOfLines={1} adjustsFontSizeToFit style={styles.editPageTitle}>Joining settings</Text>
                <Text style={styles.editPageHint}>
                  Set joining options, welcome text, introduction questions and guidelines.
                </Text>
              </View>
              <ChevronRight size={20} color={Colors.terracotta} strokeWidth={2.5} />
            </TouchableOpacity>
            {PUBLIC_PAGE_CONTROL_ENABLED && <TouchableOpacity style={styles.editPageCard}
              onPress={() => router.push('/creator/public-page' as never)} accessibilityRole="button"
              accessibilityLabel="Visibility and link" accessibilityHint="Choose where people can find your community and manage its page status.">
              <View style={styles.editPageTextWrap}>
                <Text numberOfLines={1} adjustsFontSizeToFit style={styles.editPageTitle}>Visibility &amp; link</Text>
                <Text style={styles.editPageHint}>Choose where people can find your community and manage its page status.</Text>
              </View><ChevronRight size={20} color={Colors.terracotta} strokeWidth={2.5} />
            </TouchableOpacity>}
          </View>

          {status === 'draft' && (
            <View style={styles.draftBanner}>
              {/* LIZ COPY */}
              <Text style={styles.draftBannerTitle}>Draft community</Text>
              <Text style={styles.draftBannerBody}>
                This page hasn’t been published. Review its details and joining settings before publishing.
              </Text>
              <TouchableOpacity
                style={[styles.publishBtn, publishing && { opacity: 0.6 }]}
                onPress={handlePublish}
                disabled={!publication.ready}
                accessibilityRole="button"
                accessibilityLabel="Publish your page"
                accessibilityState={{ disabled: !publication.ready, busy: publishing }}
              >
                <CreatorActionFill />
                <View style={styles.actionContent}>
                {publishing ? (
                  <ActivityIndicator size="small" color={Colors.white} />
                ) : (
                  <Text style={styles.publishBtnText} numberOfLines={1}>Publish page</Text>
                )}
                </View>
              </TouchableOpacity>
            </View>
          )}

          {/* Liz decision #5, 2026-09-03: Community becomes the real home
              base for the public page, so the draft banner above needs a
              persistent published counterpart instead of just disappearing
              once a page goes live -- otherwise this tab goes quiet exactly
              when a creator most needs to find their link. */}
          {status === 'active' && (
            <View style={styles.liveBanner}>
              {/* LIZ COPY */}
              <Text style={styles.liveBannerTitle}>Published community</Text>
              <Text style={styles.liveBannerBody}>
                {buildCommunityPublicLink(community.handle).replace('https://', '')}.{' '}
                Your visibility and joining settings still apply.
              </Text>

            </View>
          )}

          <Text accessibilityRole="header" style={styles.sectionLabel}>Payments &amp; support</Text>
          <View style={styles.supportGroup}>
            <TouchableOpacity
              style={styles.supportRow}
              onPress={() => router.push('/creator/payouts' as never)}
              accessibilityRole="button"
              accessibilityLabel="Money and payouts"
            >
              <CircleDollarSign size={19} color={Colors.terracotta} strokeWidth={2} />
              <View style={styles.editPageTextWrap}>
                <Text style={styles.editPageTitle}>Money &amp; payouts</Text>
                <Text style={styles.editPageHint}>Set up payouts and review payments.</Text>
              </View>
              <ChevronRight size={20} color={Colors.terracotta} strokeWidth={2.5} />
            </TouchableOpacity>
            <View style={styles.supportDivider} />
            <TouchableOpacity
              style={styles.supportRow}
              onPress={() => router.push('/creator/help')}
              accessibilityRole="button"
              accessibilityLabel="Help and permissions"
            >
              <HelpCircle size={19} color={Colors.terracotta} strokeWidth={2} />
              <View style={styles.editPageTextWrap}>
                <Text style={styles.editPageTitle}>Help &amp; permissions</Text>
                <Text style={styles.editPageHint}>Check your access or contact support.</Text>
              </View>
              <ChevronRight size={20} color={Colors.terracotta} strokeWidth={2.5} />
            </TouchableOpacity>
          </View>

          {canArchive && (
            <View style={styles.archiveSection}>
              {status === 'archived' ? (
                <View style={styles.archivedBanner}>
                  {/* LIZ COPY */}
                  <Text style={styles.archivedBannerTitle}>Archived community</Text>
                  <Text style={styles.archivedBannerBody}>
                    Hidden from discovery and closed to new members. Existing members keep their chat and access.
                  </Text>
                </View>
              ) : (
                <>
                  <Text style={styles.hint}>
                    Close this community to new members. Existing members keep their chat and access.
                  </Text>
                  <TouchableOpacity
                    style={[styles.archiveBtn, archiving && styles.archiveBtnBusy]}
                    onPress={handleArchive}
                    disabled={!publication.ready}
                    accessibilityRole="button"
                    accessibilityLabel="Archive this community"
                    accessibilityState={{ disabled: !publication.ready, busy: archiving }}
                  >
                    {archiving ? (
                      <ActivityIndicator size="small" color={Colors.errorRed} />
                    ) : (
                      <Text style={styles.archiveBtnText} numberOfLines={1}>Archive community</Text>
                    )}
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}
        </ScrollView>

      <BrandedAlert
        visible={!!alertInfo}
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message}
        buttons={alertInfo?.buttons}
        onClose={() => setAlertInfo(null)}
      />
    </SafeAreaView>
  );
}

function createStyles(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  inlineAction: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  centered: { flex: 1, padding: 24, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.parchment },
  intro: { fontFamily: fonts.regular, fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD, color: Colors.secondary, marginBottom: 20 },
  actionContent: { zIndex: 1, alignItems: 'center' },
  container: { flex: 1, backgroundColor: Colors.parchment },
  content: { padding: 20 },
  draftBanner: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    borderLeftWidth: 3,
    borderLeftColor: Colors.gold,
    padding: 14,
    marginBottom: 20,
  },
  draftBannerTitle: {
    fontFamily: fonts.semibold,
    fontSize: FontSizes.bodyMD,
    color: Colors.darkWarm,
    marginBottom: 4,
  },
  draftBannerBody: {
    fontFamily: fonts.regular,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    lineHeight: LineHeights.bodySM,
    marginBottom: 10,
  },
  publishBtn: {
    overflow: 'hidden', minHeight: 44, justifyContent: 'center',
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: 'center',
  },
  publishBtnText: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyMD, color: Colors.white },
  liveBanner: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    borderLeftWidth: 3,
    borderLeftColor: Colors.gold,
    padding: 14,
    marginBottom: 20,
  },
  liveBannerTitle: {
    fontFamily: fonts.semibold,
    fontSize: FontSizes.bodyMD,
    color: Colors.darkWarm,
    marginBottom: 4,
  },
  liveBannerBody: {
    fontFamily: fonts.regular,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    lineHeight: LineHeights.bodySM,
    marginBottom: 10,
  },
  liveBannerLink: { fontFamily: fonts.semibold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  title: {
    fontFamily: fonts.display,
    fontSize: FontSizes.displayLG,
    lineHeight: LineHeights.displayLG,
    color: Colors.darkWarm,
    marginBottom: 12,
  },
  sectionLabel: {
    fontFamily: fonts.semibold,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
    marginBottom: 10,
  },
  hint: { fontFamily: fonts.regular, fontSize: FontSizes.bodySM, color: Colors.secondary, lineHeight: LineHeights.bodySM, marginBottom: 10 },
  editPageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    gap: 10,
  },
  hubStack: { gap: 8, marginBottom: 24 },
  supportGroup: { borderWidth: 1, borderColor: Colors.border, borderRadius: 16, backgroundColor: Colors.cardBg, overflow: 'hidden' },
  supportDivider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.border, marginHorizontal: 14 },
  supportRow: { flexDirection: 'row', alignItems: 'center', minHeight: 64, padding: 14, gap: 10 },
  editPageTextWrap: { flex: 1, minWidth: 0, gap: 4 },
  editPageTitle: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  editPageHint: { fontFamily: fonts.regular, fontSize: FontSizes.bodySM, lineHeight: LineHeights.bodySM, color: Colors.secondary },
  archiveSection: { marginTop: 28, marginBottom: 28, paddingTop: 20, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  archiveBtn: {
    minHeight: 44, justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: Colors.errorRed,
    paddingVertical: 12,
    alignItems: 'center',
  },
  archiveBtnBusy: { opacity: 0.6 },
  archiveBtnText: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyMD, color: Colors.errorRed },
  archivedBanner: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    borderLeftWidth: 3,
    borderLeftColor: Colors.errorBrand,
    padding: 14,
  },
  archivedBannerTitle: {
    fontFamily: fonts.semibold,
    fontSize: FontSizes.bodyMD,
    color: Colors.darkWarm,
    marginBottom: 4,
  },
  archivedBannerBody: {
    fontFamily: fonts.regular,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    lineHeight: LineHeights.bodySM,
  },
});

}
