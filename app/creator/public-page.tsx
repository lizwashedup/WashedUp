/**
 * Creator mode: public page control center (Build 35 Screen 14). Scoped in
 * clients/washed-up/specs/washedup-BUILD35-SCREEN14-PUBLIC-PAGE-CONTROL-CENTER-20260901.md.
 *
 * Deliberately narrow -- exactly the four pieces named for this pass: status
 * (published/draft), the shareable washedup.app/c/<handle> link, a discovery
 * toggle, and unpublish. Previews (see it as a visitor/member) and the page
 * builder already exist live elsewhere (app/(creator)/menu.tsx,
 * app/creator/edit-page.tsx) and are NOT duplicated here -- this screen must
 * never become a second editor.
 *
 * Styled on join-gate.tsx's exact tokens and shape: header + back arrow,
 * sectionLabel/fieldHint typography, card treatments, BrandedAlert
 * confirmations, optimistic-set-with-revert pill toggle. Behind
 * PUBLIC_PAGE_CONTROL_ENABLED (constants/FeatureFlags.ts), off by default.
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack, Redirect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { PUBLIC_PAGE_CONTROL_ENABLED } from '../../constants/FeatureFlags';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { friendlyError } from '../../lib/friendlyError';
import { hapticSuccess, hapticLight } from '../../lib/haptics';
import {
  getCreatorAccess,
  isLeaderAccess,
  creatorLandingRoute,
  unpublishCommunity,
  buildCommunityPublicLink,
  getCommunityDiscoverable,
  setCommunityDiscoverable,
} from '../../lib/creatorMode';
import { useLedCommunity } from '../../lib/selectedCommunity';

export default function PublicPageControlScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [unpublishing, setUnpublishing] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);

  const { data: access, isLoading: accessLoading } = useQuery({
    queryKey: ['creator-access'],
    queryFn: getCreatorAccess,
  });
  const community = useLedCommunity(access);

  // SELF-FLIPPING (same mechanism as join-gate's join-policy toggle): null
  // until supabase/migrations/20260901030000 (DRAFT) actually applies, so
  // the pills below stay hidden rather than rendering a dead control.
  const discoverableKey = ['community-discoverable', community?.id];
  const { data: fetchedDiscoverable = null } = useQuery({
    queryKey: discoverableKey,
    queryFn: () => getCommunityDiscoverable(community!.id),
    enabled: !!community,
  });
  const [discoverable, setDiscoverableState] = useState<boolean | null>(null);
  useEffect(() => { setDiscoverableState(fetchedDiscoverable); }, [fetchedDiscoverable]);

  const commitDiscoverable = async (next: boolean) => {
    if (!community) return;
    const prev = discoverable;
    setDiscoverableState(next); // optimistic
    hapticLight();
    const ok = await setCommunityDiscoverable(community.id, next);
    if (!ok) {
      setDiscoverableState(prev); // revert on a no-op/denied write
      setAlertInfo({ title: 'That did not save', message: 'give it another try.' });
    }
  };

  const handleUnpublish = () => {
    if (!community || unpublishing) return;
    // LIZ COPY
    setAlertInfo({
      title: 'take your page down?',
      message: 'only you’ll see it after this, same as before you published. members already in keep their spot and their chats. you can publish it again anytime.',
      buttons: [
        { text: 'not now', style: 'cancel' },
        {
          text: 'take it down',
          style: 'destructive',
          onPress: async () => {
            setUnpublishing(true);
            try {
              await unpublishCommunity(community.id);
              hapticSuccess();
              queryClient.invalidateQueries({ queryKey: ['creator-access'] });
            } catch (e) {
              setAlertInfo({ title: 'That did not save', message: friendlyError(e, 'Try again in a moment.') });
            } finally {
              setUnpublishing(false);
            }
          },
        },
      ],
    });
  };

  const handleShare = () => {
    if (!community) return;
    hapticLight();
    Share.share({ message: buildCommunityPublicLink(community.handle) }).catch(() => {});
  };

  if (access && !isLeaderAccess(access)) return <Redirect href={creatorLandingRoute(access)} />;
  if (!PUBLIC_PAGE_CONTROL_ENABLED) return <Redirect href="/(creator)/menu" />;

  const isPublished = community?.status === 'active';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12}>
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2.5} />
        </TouchableOpacity>
      </View>

      {accessLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.terracotta} />
        </View>
      ) : !community ? (
        <View style={styles.centered}>
          <Text style={styles.hint}>no community on this account yet.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {/* LIZ COPY */}
          <Text style={styles.title}>your public page</Text>
          <Text style={styles.hint}>
            status, your link, and whether people can find {community.name} on their own.
          </Text>

          <Text style={styles.fieldLabel}>status</Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusPill, isPublished && styles.statusPillOn]}>
              <Text style={[styles.statusPillText, isPublished && styles.statusPillTextOn]}>
                {isPublished ? 'published' : 'draft'}
              </Text>
            </View>
            {/* LIZ COPY */}
            <Text style={styles.statusHint}>
              {isPublished
                ? 'live. anyone with the link can open it.'
                : 'only you see it right now.'}
            </Text>
          </View>

          <Text style={[styles.fieldLabel, styles.sectionSpacing]}>your link</Text>
          {/* LIZ COPY */}
          <Text style={styles.fieldHint}>share it anywhere. anyone who taps it lands on your page.</Text>
          <View style={styles.linkCard}>
            <Text style={styles.linkText} numberOfLines={1}>
              {buildCommunityPublicLink(community.handle).replace('https://', '')}
            </Text>
            <TouchableOpacity
              style={styles.shareBtn}
              onPress={handleShare}
              accessibilityRole="button"
              accessibilityLabel="Share your public page link"
            >
              <Text style={styles.shareBtnText}>share link</Text>
            </TouchableOpacity>
          </View>

          {discoverable !== null && (
            <>
              <Text style={[styles.fieldLabel, styles.sectionSpacing]}>in browse &amp; search</Text>
              {/* LIZ COPY */}
              <Text style={styles.fieldHint}>
                whether your page shows up when people browse or search on washedup. turning this
                off does not take your page down -- anyone with the link can still open it.
              </Text>
              <View style={styles.policyRow}>
                <TouchableOpacity
                  style={[styles.policyPill, discoverable && styles.policyPillOn]}
                  onPress={() => commitDiscoverable(true)}
                  activeOpacity={0.85}
                >
                  {/* LIZ COPY */}
                  <Text style={[styles.policyText, discoverable && styles.policyTextOn]}>show me</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.policyPill, !discoverable && styles.policyPillOn]}
                  onPress={() => commitDiscoverable(false)}
                  activeOpacity={0.85}
                >
                  {/* LIZ COPY */}
                  <Text style={[styles.policyText, !discoverable && styles.policyTextOn]}>link only</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {isPublished && (
            <TouchableOpacity
              style={[styles.unpublishBtn, unpublishing && styles.unpublishBtnBusy]}
              onPress={handleUnpublish}
              disabled={unpublishing}
              accessibilityRole="button"
              accessibilityLabel="Take your page down"
              accessibilityState={{ disabled: unpublishing, busy: unpublishing }}
            >
              {unpublishing ? (
                <ActivityIndicator size="small" color={Colors.errorBrand} />
              ) : (
                // LIZ COPY
                <Text style={styles.unpublishBtnText}>take your page down</Text>
              )}
            </TouchableOpacity>
          )}
        </ScrollView>
      )}

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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8 },
  headerBtn: { padding: 4 },
  content: { padding: 20, paddingBottom: 60 },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayLG,
    lineHeight: LineHeights.displayLG,
    color: Colors.darkWarm,
    marginBottom: 8,
  },
  hint: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    lineHeight: LineHeights.bodySM,
    marginBottom: 18,
  },
  sectionSpacing: { marginTop: 20 },
  fieldLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  fieldHint: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.tertiary, marginBottom: 10 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  statusPill: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  statusPillOn: { borderColor: Colors.terracotta, backgroundColor: Colors.brandSoft },
  statusPillText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.tertiary },
  statusPillTextOn: { fontFamily: Fonts.sansBold, color: Colors.terracotta },
  statusHint: { flex: 1, fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary },
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    gap: 10,
  },
  linkText: { flex: 1, fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  shareBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  shareBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.white },
  policyRow: { flexDirection: 'row', gap: 8 },
  policyPill: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  policyPillOn: { borderColor: Colors.terracotta, backgroundColor: Colors.brandSoft },
  policyText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.darkWarm },
  policyTextOn: { fontFamily: Fonts.sansBold, color: Colors.terracotta },
  unpublishBtn: {
    borderWidth: 1.5,
    borderColor: Colors.errorBrand,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 28,
  },
  unpublishBtnBusy: { opacity: 0.6 },
  unpublishBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.errorBrand },
});
