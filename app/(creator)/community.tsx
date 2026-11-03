/**
 * Community settings keeps page editing and joining configuration first.
 * Daily updates live in their own management screen.
 */

import React, { useMemo, useState } from 'react';
import { ScaledText as Text } from '../../components/ScaledText';
import {
  View,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, CircleDollarSign, HelpCircle, UserPlus, UserRound, Users } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { type AfterglowFontFamilies, FontSizes, LineHeights } from '../../constants/Typography';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { friendlyError } from '../../lib/friendlyError';
import { hapticSuccess, hapticWarning } from '../../lib/haptics';
import { getCreatorAccess, isLeaderAccess, isAdminTierRole, creatorLandingRoute, publishCommunity, archiveCommunity, buildCommunityPublicLink } from '../../lib/creatorMode';
import { getCommunityRooms } from '../../lib/communityChat';
import { useLedCommunity } from '../../lib/selectedCommunity';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { CreatorActionFill } from '../../components/creator/CreatorActionFill';

export default function CreatorCommunityScreen() {
  const { fonts } = useAfterglowFonts(true, 'creator');
  const styles = useMemo(() => createStyles(fonts), [fonts]);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);

  const { data: access } = useQuery({ queryKey: ['creator-access'], queryFn: getCreatorAccess });
  const community = useLedCommunity(access);

  const roomsQuery = useQuery({
    queryKey: ['creator-rooms', community?.id],
    queryFn: () => getCommunityRooms(community!.id),
    enabled: !!community,
  });

  const { data: rooms = [], refetch, isRefetching } = roomsQuery;

  const [publishing, setPublishing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const handlePublish = () => {
    if (!community || publishing) return;
    // LIZ COPY
    setAlertInfo({
      title: 'Publish this page?',
      message: 'Your page will be published with its current visibility and joining settings. Review those settings before continuing.',
      buttons: [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Publish page',
          onPress: async () => {
            setPublishing(true);
            try {
              await publishCommunity(community.id);
              hapticSuccess();
              queryClient.invalidateQueries({ queryKey: ['creator-access'] });
            } catch (e) {
              setAlertInfo({ title: 'That did not save', message: friendlyError(e, 'Try again in a moment.') });
            } finally {
              setPublishing(false);
            }
          },
        },
      ],
    });
  };

  // leader/admin tier only (isAdminTierRole), scoped to THIS led community's
  // own role, not "admin-tier of any led community" -- a person who is only
  // events/member_care/finance here must never see this, even if they lead
  // a different community elsewhere as admin.
  const canArchive = !!community && isAdminTierRole(community.role);

  const handleArchive = () => {
    if (!community || archiving) return;
    // LIZ COPY
    setAlertInfo({
      title: 'archive this community?',
      message: 'no one new can find it or join. your current members keep their chat and everything they already have.',
      buttons: [
        { text: 'not yet', style: 'cancel' },
        {
          text: 'archive it',
          style: 'destructive',
          onPress: async () => {
            setArchiving(true);
            try {
              await archiveCommunity(community.id);
              hapticWarning();
              queryClient.invalidateQueries({ queryKey: ['creator-access'] });
            } catch (e) {
              setAlertInfo({ title: 'That did not save', message: friendlyError(e, 'Try again in a moment.') });
            } finally {
              setArchiving(false);
            }
          },
        },
      ],
    });
  };

  // community is a leader screen: an event-host-only grant never sees it
  // (doc 34 §1.3). The layout hides the tab; this covers stale pushes and
  // deep links.
  if (access && !isLeaderAccess(access)) return <Redirect href={creatorLandingRoute(access)} />;

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.terracotta} />}
        >
          <Text style={styles.title}>Community settings</Text>

          <Text style={styles.sectionLabel}>Page &amp; joining</Text>
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
          </View>

          {/* Build 35 final navigation removes global Members and Menu tabs.
              Their real destinations live here so nothing becomes harder to
              reach when the Community shell contracts to three tabs. */}
          <Text style={styles.sectionLabel}>Members</Text>
          <View style={styles.hubStack}>
            <TouchableOpacity
              style={styles.hubRow}
              onPress={() => router.push('/(tabs)/friends/manage/(tools)/members')}
              accessibilityRole="button"
              accessibilityLabel="Members and join requests"
            >
              <Users size={19} color={Colors.terracotta} strokeWidth={2} />
              <View style={styles.editPageTextWrap}>
                <Text style={styles.editPageTitle}>Members &amp; requests</Text>
                <Text style={styles.editPageHint}>Review requests and manage membership.</Text>
              </View>
              <ChevronRight size={20} color={Colors.terracotta} strokeWidth={2.5} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.hubRow}
              onPress={() => router.push('/creator/member-invites' as never)}
              accessibilityRole="button"
              accessibilityLabel="Invite members"
            >
              <UserPlus size={19} color={Colors.terracotta} strokeWidth={2} />
              <View style={styles.editPageTextWrap}>
                <Text style={styles.editPageTitle}>Invite members</Text>
                <Text style={styles.editPageHint}>Bring your people into this community.</Text>
              </View>
              <ChevronRight size={20} color={Colors.terracotta} strokeWidth={2.5} />
            </TouchableOpacity>
          </View>

          {community?.status === 'draft' && (
            <View style={styles.draftBanner}>
              {/* LIZ COPY */}
              <Text style={styles.draftBannerTitle}>Draft community</Text>
              <Text style={styles.draftBannerBody}>
                This page hasn’t been published. Review its details and joining settings before publishing.
              </Text>
              <TouchableOpacity
                style={[styles.publishBtn, publishing && { opacity: 0.6 }]}
                onPress={handlePublish}
                disabled={publishing}
                accessibilityRole="button"
                accessibilityLabel="Publish your page"
                accessibilityState={{ disabled: publishing, busy: publishing }}
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
          {community?.status === 'active' && (
            <View style={styles.liveBanner}>
              {/* LIZ COPY */}
              <Text style={styles.liveBannerTitle}>Published community</Text>
              <Text style={styles.liveBannerBody}>
                {buildCommunityPublicLink(community.handle).replace('https://', '')}.{' '}
                Your visibility and joining settings still apply.
              </Text>
              <TouchableOpacity
                style={styles.inlineAction}
                onPress={() => router.push('/creator/public-page' as never)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Manage your page"
              >
                {/* LIZ COPY */}
                <Text style={styles.liveBannerLink}>manage your page &rarr;</Text>
              </TouchableOpacity>
            </View>
          )}

          <Text style={[styles.sectionLabel, { marginTop: 24 }]}>chat spaces</Text>
          <Text style={styles.hint}>
            the chat spaces members can join, found on your page.
          </Text>
          <View style={styles.lastCard}>
            {(roomsQuery.isLoading || roomsQuery.isError) ? <CommunityReadState label="Chat spaces" query={roomsQuery} /> : rooms.length === 0 ? <Text style={styles.hint}>No chat spaces yet.</Text> : null}
            {rooms.map((r) => (
              <TouchableOpacity
                key={r.id}
                style={styles.roomRow}
                onPress={() => router.push(`/community-topic/${r.id}` as never)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={`Open chat space: ${r.name}`}
              >
                <Text style={styles.roomRowName}>{r.name}</Text>
                <Text style={styles.roomRowOpen}>open</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.sectionLabel}>account</Text>
          <View style={styles.hubStack}>
            <TouchableOpacity
              style={styles.hubRow}
              onPress={() => router.push('/creator/payouts' as never)}
              accessibilityRole="button"
              accessibilityLabel="Money and payouts"
            >
              <CircleDollarSign size={19} color={Colors.terracotta} strokeWidth={2} />
              <View style={styles.editPageTextWrap}>
                <Text style={styles.editPageTitle}>money and payouts</Text>
                <Text style={styles.editPageHint}>set up payouts and see what has been paid.</Text>
              </View>
              <ChevronRight size={20} color={Colors.terracotta} strokeWidth={2.5} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.hubRow}
              onPress={() => router.push('/creator/help')}
              accessibilityRole="button"
              accessibilityLabel="Help and permissions"
            >
              <HelpCircle size={19} color={Colors.terracotta} strokeWidth={2} />
              <View style={styles.editPageTextWrap}>
                <Text style={styles.editPageTitle}>help and permissions</Text>
                <Text style={styles.editPageHint}>see what you can do or ask a real person for help.</Text>
              </View>
              <ChevronRight size={20} color={Colors.terracotta} strokeWidth={2.5} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.hubRow}
              onPress={() => router.replace('/(tabs)/friends')}
              accessibilityRole="button"
              accessibilityLabel="Back to Yours"
            >
              <UserRound size={19} color={Colors.terracotta} strokeWidth={2} />
              <View style={styles.editPageTextWrap}>
                <Text style={styles.editPageTitle}>Back to Yours</Text>
                <Text style={styles.editPageHint}>your plans, chats, and people stay exactly where you left them.</Text>
              </View>
              <ChevronRight size={20} color={Colors.terracotta} strokeWidth={2.5} />
            </TouchableOpacity>
          </View>

          {canArchive && (
            <View style={styles.archiveSection}>
              <Text style={styles.sectionLabel}>archive</Text>
              {community?.status === 'archived' ? (
                <View style={styles.archivedBanner}>
                  {/* LIZ COPY */}
                  <Text style={styles.archivedBannerTitle}>this community is archived</Text>
                  <Text style={styles.archivedBannerBody}>
                    it&apos;s hidden from discovery and closed to new members. your
                    current members keep their chat and everything they already have.
                  </Text>
                </View>
              ) : (
                <>
                  <Text style={styles.hint}>
                    hides your page from discovery and closes the door to new
                    members. your current members keep their chat and
                    everything they already have. this can&apos;t be undone
                    from here.
                  </Text>
                  <TouchableOpacity
                    style={[styles.archiveBtn, archiving && styles.archiveBtnBusy]}
                    onPress={handleArchive}
                    disabled={archiving}
                    accessibilityRole="button"
                    accessibilityLabel="Archive this community"
                    accessibilityState={{ disabled: archiving, busy: archiving }}
                  >
                    {archiving ? (
                      <ActivityIndicator size="small" color={Colors.errorRed} />
                    ) : (
                      <Text style={styles.archiveBtnText}>archive this community</Text>
                    )}
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

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

function CommunityReadState({ label, query }: {
  label: string;
  query: { isError: boolean; isFetching: boolean; refetch: () => Promise<unknown> };
}) {
  const { fonts } = useAfterglowFonts(true, 'creator');
  const styles = useMemo(() => createStyles(fonts), [fonts]);
  return <View style={styles.readState} accessibilityLiveRegion="polite">
    <Text style={styles.editPageTitle}>{query.isError ? `${label} unavailable` : `Loading ${label.toLowerCase()}…`}</Text>
    {query.isError && <TouchableOpacity style={styles.inlineAction} accessibilityRole="button" accessibilityLabel={`Retry ${label.toLowerCase()}`} disabled={query.isFetching} onPress={() => void query.refetch()}>
      <Text style={styles.liveBannerLink}>{query.isFetching ? 'Checking…' : 'Retry'}</Text>
    </TouchableOpacity>}
  </View>;
}

function createStyles(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  inlineAction: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  readState: { marginTop: 12, paddingVertical: 12, gap: 4 },
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
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    marginBottom: 4,
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
  hubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    gap: 10,
  },
  lastCard: { marginBottom: 40 },
  roomRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    gap: 10,
  },
  roomRowName: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: FontSizes.bodyMD,
    color: Colors.darkWarm,
  },
  roomRowOpen: { fontFamily: fonts.semibold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  editPageTextWrap: { flex: 1, minWidth: 0, gap: 4 },
  editPageTitle: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  editPageHint: { fontFamily: fonts.regular, fontSize: FontSizes.bodySM, lineHeight: LineHeights.bodySM, color: Colors.secondary },
  archiveSection: { marginTop: 24, marginBottom: 40 },
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
