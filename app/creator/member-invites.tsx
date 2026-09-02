/**
 * Build 35 Screen 56: member invites. Any active leader or co_leader of the
 * community finds an existing profile and invites them to join as a plain
 * member -- a DIFFERENT feature from co-creators.tsx (co_leader/admin access
 * grants), reached from its own "invite members" entry on members.tsx, never
 * the co-creators button or its wiring (scope doc's explicit warning).
 *
 * Behind MEMBER_INVITES_ENABLED (constants/FeatureFlags.ts), off by default.
 * V1 scope: existing-profile invites only, via the same searchProfilesForInvite()
 * lib/coCreatorInvites.ts already exports -- reused directly, not duplicated.
 * Phone-contact invites are an explicit open product decision, not built here.
 * Styled on the same 2026-08-17 locked brand implementation template tokens
 * co-creators.tsx uses, since these two screens are near-identical shapes.
 */

import React, { useMemo, useState } from 'react';
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
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter, Stack, Redirect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Search, X } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { MEMBER_INVITES_ENABLED } from '../../constants/FeatureFlags';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../../components/keyboard/KeyboardDoneBar';
import { friendlyError } from '../../lib/friendlyError';
import { hapticSuccess, hapticLight } from '../../lib/haptics';
import { getCreatorAccess, isLeaderAccess, canManageMembers } from '../../lib/creatorMode';
import { useLedCommunity } from '../../lib/selectedCommunity';
import { supabase } from '../../lib/supabase';
import { searchProfilesForInvite, type ProfileSearchResult } from '../../lib/coCreatorInvites';
import {
  createMemberInvite,
  listCommunityMemberInvites,
  revokeMemberInvite,
  buildMemberInviteLink,
  memberInviteBucket,
  type MemberInviteRow,
} from '../../lib/memberInvites';

function initial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

function Avatar({ name, photo, size }: { name: string; photo: string | null; size: number }) {
  if (photo) {
    return <Image source={{ uri: photo }} style={{ width: size, height: size, borderRadius: size / 2 }} contentFit="cover" />;
  }
  return (
    <View style={[styles.avatarFallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarInitial, { fontSize: size * 0.4 }]}>{initial(name)}</Text>
    </View>
  );
}

function statusLabel(status: MemberInviteRow['status']): string {
  switch (status) {
    case 'pending': return 'Waiting to accept';
    case 'viewed': return 'Opened, not accepted yet';
    case 'accepted': return 'Joined';
    case 'revoked': return 'Canceled';
    case 'expired': return 'Expired';
    default: return status;
  }
}

/** "3 days left" / "2 hours left" / "Expires soon" -- countdown for the 72h window. */
function expiryLabel(expiresAt: string): string {
  const msLeft = new Date(expiresAt).getTime() - Date.now();
  if (msLeft <= 0) return 'Expires soon';
  const hoursLeft = Math.round(msLeft / (60 * 60 * 1000));
  if (hoursLeft < 1) return 'Expires soon';
  if (hoursLeft < 24) return `${hoursLeft} hour${hoursLeft === 1 ? '' : 's'} left`;
  const daysLeft = Math.round(hoursLeft / 24);
  return `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`;
}

function inviteTargetLabel(row: MemberInviteRow): string {
  return row.targetName ?? 'Someone';
}

export default function MemberInvitesScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);

  const { data: access } = useQuery({ queryKey: ['creator-access'], queryFn: getCreatorAccess });
  const community = useLedCommunity(access);
  const canInvite = !!access && (isLeaderAccess(access) || canManageMembers(access));

  const [userId, setUserId] = useState<string | null>(null);
  useMemo(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const invitesKey = ['member-invites', community?.id];
  const { data: invites = [], isLoading } = useQuery({
    queryKey: invitesKey,
    queryFn: () => listCommunityMemberInvites(community!.id),
    enabled: !!community && MEMBER_INVITES_ENABLED,
  });
  const invitedInvites = invites.filter((i) => memberInviteBucket(i.status) === 'invited');
  const pastInvites = invites.filter((i) => memberInviteBucket(i.status) !== 'invited');

  const [composerOpen, setComposerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ProfileSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState('');
  const [inviting, setInviting] = useState<string | null>(null);
  const [resending, setResending] = useState<string | null>(null);

  const closeComposer = () => {
    setComposerOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    setMessage('');
  };

  const runSearch = async (q: string) => {
    setSearchQuery(q);
    if (!userId || q.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      setSearchResults(await searchProfilesForInvite(q, userId));
    } finally {
      setSearching(false);
    }
  };

  const afterInviteCreated = (link: string) => {
    hapticSuccess();
    closeComposer();
    queryClient.invalidateQueries({ queryKey: invitesKey });
    setAlertInfo({
      title: 'Invite ready',
      message: 'Share this link with them. It only works for the person it was sent to.',
      buttons: [
        { text: 'Done', style: 'cancel' },
        { text: 'Share link', onPress: () => { Share.share({ message: link }).catch(() => {}); } },
      ],
    });
  };

  const inviteProfile = async (profile: ProfileSearchResult) => {
    if (!community || inviting) return;
    setInviting(profile.id);
    try {
      const result = await createMemberInvite(community.id, profile.id, message);
      afterInviteCreated(buildMemberInviteLink(result.rawToken));
    } catch (e) {
      setAlertInfo({ title: 'That did not send', message: friendlyError(e, 'Try again in a moment.') });
    } finally {
      setInviting(null);
    }
  };

  const handleResend = async (row: MemberInviteRow) => {
    if (!community || resending) return;
    setResending(row.id);
    try {
      const result = await createMemberInvite(community.id, row.targetUserId, row.inviteMessage ?? undefined);
      afterInviteCreated(buildMemberInviteLink(result.rawToken));
    } catch (e) {
      setAlertInfo({ title: 'That did not send', message: friendlyError(e, 'Try again in a moment.') });
    } finally {
      setResending(null);
    }
  };

  const confirmRevoke = (row: MemberInviteRow) => {
    hapticLight();
    setAlertInfo({
      title: 'Cancel this invite?',
      message: `${inviteTargetLabel(row)} will no longer be able to accept it.`,
      buttons: [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Cancel invite',
          style: 'destructive',
          onPress: async () => {
            try {
              await revokeMemberInvite(row.id);
              hapticSuccess();
              queryClient.invalidateQueries({ queryKey: invitesKey });
            } catch (e) {
              setAlertInfo({ title: 'That did not work', message: friendlyError(e, 'Try again in a moment.') });
            }
          },
        },
      ],
    });
  };

  if (!MEMBER_INVITES_ENABLED) return <Redirect href="/(creator)/members" />;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12}>
            <ArrowLeft size={22} color={Colors.text1} strokeWidth={2.5} />
          </TouchableOpacity>
        </View>

        {!community ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={Colors.terracotta} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>Invite members</Text>
            <Text style={styles.hint}>Invite someone to join {community.name} as a member.</Text>

            {!canInvite ? (
              <View style={styles.notice}>
                <Text style={styles.noticeText}>
                  Only a leader or co-leader of this community can invite members.
                </Text>
              </View>
            ) : !composerOpen ? (
              <TouchableOpacity style={styles.inviteBtn} onPress={() => setComposerOpen(true)} activeOpacity={0.85}>
                <Text style={styles.inviteBtnText}>+ Invite a member</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.composer}>
                <View style={styles.composerHeaderRow}>
                  <Text style={styles.composerTitle}>Find a profile</Text>
                  <TouchableOpacity onPress={closeComposer} hitSlop={10} style={styles.closeComposerBtn}>
                    <X size={18} color={Colors.text3} strokeWidth={2.5} />
                  </TouchableOpacity>
                </View>

                <View style={styles.searchRow}>
                  <Search size={16} color={Colors.text3} strokeWidth={2.25} />
                  <TextInput
                    style={styles.searchInput}
                    value={searchQuery}
                    onChangeText={runSearch}
                    placeholder="Search by @handle"
                    placeholderTextColor={Colors.text3}
                    autoCapitalize="none"
                    autoCorrect={false}
                    inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
                  />
                  {searching && <ActivityIndicator size="small" color={Colors.terracotta} />}
                </View>

                <TextInput
                  style={styles.messageInput}
                  value={message}
                  onChangeText={setMessage}
                  placeholder="Add a note (optional)"
                  placeholderTextColor={Colors.text3}
                  multiline
                  maxLength={300}
                  inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
                />

                {searchResults.map((r) => (
                  <TouchableOpacity
                    key={r.id}
                    style={styles.resultRow}
                    onPress={() => inviteProfile(r)}
                    disabled={inviting === r.id}
                    activeOpacity={0.8}
                  >
                    <Avatar name={r.name} photo={r.photo} size={36} />
                    <Text style={styles.resultName}>{r.name}</Text>
                    {inviting === r.id ? (
                      <ActivityIndicator size="small" color={Colors.terracotta} />
                    ) : (
                      <Text style={styles.resultInvite}>Invite</Text>
                    )}
                  </TouchableOpacity>
                ))}
                {searchQuery.trim().length >= 2 && !searching && searchResults.length === 0 && (
                  <Text style={styles.noResults}>No one found. Try their exact handle.</Text>
                )}
              </View>
            )}

            {isLoading ? (
              <ActivityIndicator size="small" color={Colors.terracotta} style={{ marginTop: 24 }} />
            ) : (
              <>
                {invitedInvites.length > 0 && (
                  <>
                    <Text style={styles.sectionLabel}>Invited</Text>
                    {invitedInvites.map((row) => (
                      <View key={row.id} style={styles.inviteCard}>
                        <Avatar name={inviteTargetLabel(row)} photo={row.targetPhoto} size={40} />
                        <View style={styles.inviteCardText}>
                          <Text style={styles.inviteCardName}>{inviteTargetLabel(row)}</Text>
                          <Text style={styles.inviteCardStatus}>
                            {statusLabel(row.status)} · {expiryLabel(row.expiresAt)}
                          </Text>
                        </View>
                        {canInvite && (
                          <View style={styles.inviteCardActions}>
                            <TouchableOpacity
                              onPress={() => handleResend(row)}
                              disabled={resending === row.id}
                              hitSlop={10}
                              style={styles.resendBtn}
                            >
                              {resending === row.id ? (
                                <ActivityIndicator size="small" color={Colors.terracotta} />
                              ) : (
                                <Text style={styles.resendBtnText}>Resend</Text>
                              )}
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => confirmRevoke(row)} hitSlop={10} style={styles.revokeBtn}>
                              <Text style={styles.revokeBtnText}>Cancel</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    ))}
                  </>
                )}

                {pastInvites.length > 0 && (
                  <>
                    <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Joined / past</Text>
                    {pastInvites.map((row) => (
                      <View key={row.id} style={[styles.inviteCard, styles.inviteCardPast]}>
                        <Avatar name={inviteTargetLabel(row)} photo={row.targetPhoto} size={40} />
                        <View style={styles.inviteCardText}>
                          <Text style={styles.inviteCardName}>{inviteTargetLabel(row)}</Text>
                          <Text style={styles.inviteCardStatus}>{statusLabel(row.status)}</Text>
                        </View>
                      </View>
                    ))}
                  </>
                )}

                {invites.length === 0 && (
                  <Text style={styles.hint}>No member invites yet.</Text>
                )}
              </>
            )}
          </ScrollView>
        )}
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

// Tokens per the 2026-08-17 locked brand implementation template, same as
// co-creators.tsx: radius 10 for buttons, 12 for cards, spacing scale
// {4,8,12,16,20,24,32,40,48,64}.
const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: Colors.cream },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  headerBtn: { padding: 4 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 20, paddingBottom: 48 },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayLG,
    lineHeight: LineHeights.displayLG,
    color: Colors.text1,
    marginBottom: 8,
  },
  hint: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.text2, lineHeight: LineHeights.bodySM, marginBottom: 20 },
  notice: { backgroundColor: Colors.brandSoft, borderRadius: 12, padding: 16 },
  noticeText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.brandDeep, lineHeight: LineHeights.bodySM },
  inviteBtn: {
    backgroundColor: Colors.brand,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    shadowColor: Colors.brand,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 2,
  },
  inviteBtnText: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyMD, color: Colors.white },
  composer: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.borderWarm,
    padding: 16,
    gap: 12,
  },
  composerHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  composerTitle: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyMD, color: Colors.text1 },
  closeComposerBtn: { padding: 4 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.inputBg,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchInput: { flex: 1, fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.text1 },
  messageInput: {
    backgroundColor: Colors.inputBg,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.text1,
    minHeight: 44,
    textAlignVertical: 'top',
  },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  resultName: { flex: 1, fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.text1 },
  resultInvite: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodySM, color: Colors.brand },
  noResults: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.text3, paddingVertical: 8 },
  sectionLabel: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.caption,
    color: Colors.brand,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 24,
  },
  inviteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.borderWarm,
    padding: 14,
    marginBottom: 8,
  },
  inviteCardPast: { opacity: 0.6 },
  inviteCardText: { flex: 1 },
  inviteCardName: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyMD, color: Colors.text1 },
  inviteCardStatus: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.text3, marginTop: 2 },
  inviteCardActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  resendBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  resendBtnText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  revokeBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  revokeBtnText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.errorBrand },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.brandSoft },
  avatarInitial: { fontFamily: Fonts.sansBold, color: Colors.brand },
});
