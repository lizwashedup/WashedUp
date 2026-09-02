/**
 * Creator mode: community. This slice is the broadcast composer plus the
 * broadcast history (both live against community_broadcasts through RLS).
 * The page block editor lands with the block-editor beat; the placeholder
 * says so honestly. Functionally minimal per decision 15a.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
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
import { ChevronRight } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../../components/keyboard/KeyboardDoneBar';
import { friendlyError } from '../../lib/friendlyError';
import { hapticSuccess, hapticWarning } from '../../lib/haptics';
import { getCreatorAccess, getBroadcasts, isLeaderAccess, isAdminTierRole, creatorLandingRoute, publishCommunity, archiveCommunity, sendBroadcast } from '../../lib/creatorMode';
import { getCommunityRooms } from '../../lib/communityChat';
import { formatTimestampLA } from '../../lib/laDate';
import { useLedCommunity } from '../../lib/selectedCommunity';
import { CommunitySwitcher } from '../../components/creator/CommunitySwitcher';

export default function CreatorCommunityScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);

  const { data: access } = useQuery({ queryKey: ['creator-access'], queryFn: getCreatorAccess });
  const community = useLedCommunity(access);

  const { data: broadcasts = [], refetch, isRefetching } = useQuery({
    queryKey: ['creator-broadcasts', community?.id],
    queryFn: () => getBroadcasts(community!.id),
    enabled: !!community,
  });
  const { data: rooms = [] } = useQuery({
    queryKey: ['creator-rooms', community?.id],
    queryFn: () => getCommunityRooms(community!.id),
    enabled: !!community,
  });

  const [publishing, setPublishing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const handlePublish = () => {
    if (!community || publishing) return;
    // LIZ COPY
    setAlertInfo({
      title: 'open your page?',
      message: 'right now only you see it. publishing makes it real: people can find it, read it, and join.',
      buttons: [
        { text: 'not yet', style: 'cancel' },
        {
          text: 'publish it',
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

  const handleSend = async () => {
    if (!community || !draft.trim()) return;
    setSending(true);
    try {
      await sendBroadcast(community.id, draft);
      hapticSuccess();
      setDraft('');
      queryClient.invalidateQueries({ queryKey: ['creator-broadcasts', community.id] });
    } catch (e) {
      setAlertInfo({ title: 'That did not send', message: friendlyError(e, 'Try again in a moment.') });
    } finally {
      setSending(false);
    }
  };

  // community is a leader screen: an event-host-only grant never sees it
  // (doc 34 §1.3). The layout hides the tab; this covers stale pushes and
  // deep links.
  if (access && !isLeaderAccess(access)) return <Redirect href={creatorLandingRoute(access)} />;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.terracotta} />}
        >
          <Text style={styles.title}>community</Text>
          <CommunitySwitcher access={access} />

          {community?.status === 'draft' && (
            <View style={styles.draftBanner}>
              {/* LIZ COPY */}
              <Text style={styles.draftBannerTitle}>your page is a draft</Text>
              <Text style={styles.draftBannerBody}>
                only you see it. shape it in your page below, then open the doors.
              </Text>
              <TouchableOpacity
                style={[styles.publishBtn, publishing && { opacity: 0.6 }]}
                onPress={handlePublish}
                disabled={publishing}
                accessibilityRole="button"
                accessibilityLabel="Publish your page"
                accessibilityState={{ disabled: publishing, busy: publishing }}
              >
                {publishing ? (
                  <ActivityIndicator size="small" color={Colors.white} />
                ) : (
                  <Text style={styles.publishBtnText}>publish your page</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          <Text style={styles.sectionLabel}>broadcast</Text>
          <Text style={styles.hint}>
            lands pinned at the top of every member&apos;s chats. about one a week
            is the sweet spot.
          </Text>
          <View style={styles.composer}>
            <TextInput
              style={styles.composerInput}
              value={draft}
              onChangeText={setDraft}
              placeholder="what should your people know?"
              placeholderTextColor={Colors.inkSoft}
              multiline
              maxLength={4000}
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
              accessibilityLabel="Broadcast message to your members"
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!draft.trim() || sending) && { opacity: 0.4 }]}
              onPress={handleSend}
              disabled={!draft.trim() || sending}
              accessibilityRole="button"
              accessibilityLabel="Send to members"
              accessibilityState={{ disabled: !draft.trim() || sending, busy: sending }}
            >
              {sending ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <Text style={styles.sendBtnText}>send to members</Text>
              )}
            </TouchableOpacity>
          </View>

          {broadcasts.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, { marginTop: 24 }]}>sent</Text>
              {broadcasts.map((b) => (
                <View key={b.id} style={styles.broadcastCard}>
                  <Text style={styles.broadcastBody}>{b.body}</Text>
                  <Text style={styles.broadcastMeta}>{formatTimestampLA(b.created_at)}</Text>
                </View>
              ))}
            </>
          )}

          <Text style={[styles.sectionLabel, { marginTop: 24 }]}>your page</Text>
          <TouchableOpacity
            style={styles.editPageCard}
            onPress={() => router.push('/creator/edit-page')}
            accessibilityRole="button"
            accessibilityLabel="Edit your page"
            accessibilityHint="Your cover, your about, your blocks. What members and visitors see."
          >
            <View style={styles.editPageTextWrap}>
              <Text style={styles.editPageTitle}>edit your page</Text>
              <Text style={styles.editPageHint}>
                your cover, your about, your blocks. what members and visitors see.
              </Text>
            </View>
            <ChevronRight size={20} color={Colors.terracotta} strokeWidth={2.5} />
          </TouchableOpacity>

          <Text style={[styles.sectionLabel, { marginTop: 24 }]}>your join gate</Text>
          <TouchableOpacity
            style={styles.editPageCard}
            onPress={() => router.push('/creator/join-gate')}
            accessibilityRole="button"
            accessibilityLabel="Set up the door"
            accessibilityHint="Your welcome message, your intro question, your guidelines link."
          >
            <View style={styles.editPageTextWrap}>
              <Text style={styles.editPageTitle}>set up the door</Text>
              <Text style={styles.editPageHint}>
                your welcome message, your intro question, your guidelines link.
              </Text>
            </View>
            <ChevronRight size={20} color={Colors.terracotta} strokeWidth={2.5} />
          </TouchableOpacity>

          <Text style={[styles.sectionLabel, { marginTop: 24 }]}>chat spaces</Text>
          <Text style={styles.hint}>
            the chat spaces members can join, found on your page.
          </Text>
          <View style={styles.lastCard}>
            {rooms.map((r) => (
              <TouchableOpacity
                key={r.id}
                style={styles.roomRow}
                onPress={() => router.push(`/community-topic/${r.id}` as never)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={`Open chat space: ${r.name}`}
              >
                <Text style={styles.roomRowName} numberOfLines={1}>{r.name}</Text>
                <Text style={styles.roomRowOpen}>open</Text>
              </TouchableOpacity>
            ))}
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

const styles = StyleSheet.create({
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
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.darkWarm,
    marginBottom: 4,
  },
  draftBannerBody: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    lineHeight: LineHeights.bodySM,
    marginBottom: 10,
  },
  publishBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: 'center',
  },
  publishBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayLG,
    lineHeight: LineHeights.displayLG,
    color: Colors.darkWarm,
    marginBottom: 12,
  },
  sectionLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  hint: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary, marginBottom: 10 },
  composer: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    gap: 10,
  },
  composerInput: {
    minHeight: 70,
    textAlignVertical: 'top',
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.darkWarm,
  },
  sendBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
  },
  sendBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  broadcastCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    marginBottom: 10,
  },
  broadcastBody: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  broadcastMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.tertiary, marginTop: 6 },
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
  lastCard: { marginBottom: 40 },
  roomRow: {
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
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.darkWarm,
  },
  roomRowOpen: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  editPageTextWrap: { flex: 1, gap: 2 },
  editPageTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  editPageHint: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.secondary },
  archiveSection: { marginTop: 24, marginBottom: 40 },
  archiveBtn: {
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: Colors.errorRed,
    paddingVertical: 12,
    alignItems: 'center',
  },
  archiveBtnBusy: { opacity: 0.6 },
  archiveBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.errorRed },
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
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.darkWarm,
    marginBottom: 4,
  },
  archivedBannerBody: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    lineHeight: LineHeights.bodySM,
  },
});
