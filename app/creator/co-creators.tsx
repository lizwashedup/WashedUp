/**
 * Creator mode: co-creators (R21). The primary leader invites a co-creator --
 * finds an existing profile, or invites by email/phone -- and manages
 * outstanding invites. Acceptance grants the existing community_members
 * `co_leader` role (lib/creatorMode's isLeaderAccess already treats
 * leader/co_leader as peers everywhere).
 *
 * Behind CO_CREATOR_INVITES_ENABLED (constants/FeatureFlags.ts), off by
 * default. New UI on this screen uses the 2026-08-17 locked brand
 * implementation template tokens directly (radius 10 buttons / 12 cards /
 * the {4,8,12,16,20,24,32,40,48,64} spacing scale, sentence case copy) rather
 * than the older pill-button/lowercase conventions elsewhere in creator
 * mode -- see the report for why.
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
import { ArrowLeft, Search, Mail, Phone, X } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { CO_CREATOR_INVITES_ENABLED } from '../../constants/FeatureFlags';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../../components/keyboard/KeyboardDoneBar';
import { friendlyError } from '../../lib/friendlyError';
import { hapticSuccess, hapticLight } from '../../lib/haptics';
import { getCreatorAccess, isLeaderAccess } from '../../lib/creatorMode';
import { useLedCommunity } from '../../lib/selectedCommunity';
import { supabase } from '../../lib/supabase';
import {
  createCoCreatorInvite,
  listCommunityCoCreatorInvites,
  revokeCoCreatorInvite,
  searchProfilesForInvite,
  buildCoCreatorInviteLink,
  looksLikeEmail,
  looksLikePhone,
  type CoCreatorInviteRow,
  type ProfileSearchResult,
} from '../../lib/coCreatorInvites';

type ComposerMode = 'closed' | 'search' | 'contact';
type ContactKind = 'email' | 'phone';

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

function statusLabel(status: CoCreatorInviteRow['status']): string {
  switch (status) {
    case 'pending': return 'Waiting to accept';
    case 'accepted': return 'Accepted';
    case 'revoked': return 'Canceled';
    case 'expired': return 'Expired';
    default: return status;
  }
}

function inviteTargetLabel(row: CoCreatorInviteRow): string {
  if (row.targetName) return row.targetName;
  if (row.targetEmail) return row.targetEmail;
  if (row.targetPhone) return row.targetPhone;
  return 'Someone';
}

export default function CoCreatorsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);

  const { data: access } = useQuery({ queryKey: ['creator-access'], queryFn: getCreatorAccess });
  const community = useLedCommunity(access);

  const [userId, setUserId] = useState<string | null>(null);
  useMemo(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const isPrimaryLeader = !!community && community.role === 'leader';

  const invitesKey = ['co-creator-invites', community?.id];
  const { data: invites = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: invitesKey,
    queryFn: () => listCommunityCoCreatorInvites(community!.id),
    enabled: !!community && CO_CREATOR_INVITES_ENABLED,
  });
  const pendingInvites = invites.filter((i) => i.status === 'pending');
  const pastInvites = invites.filter((i) => i.status !== 'pending');

  const [composer, setComposer] = useState<ComposerMode>('closed');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ProfileSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [contactKind, setContactKind] = useState<ContactKind>('email');
  const [contactValue, setContactValue] = useState('');
  const [inviting, setInviting] = useState<string | null>(null);

  const closeComposer = () => {
    setComposer('closed');
    setSearchQuery('');
    setSearchResults([]);
    setContactValue('');
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
      const result = await createCoCreatorInvite(community.id, { kind: 'profile', userId: profile.id });
      afterInviteCreated(buildCoCreatorInviteLink(result.rawToken));
    } catch (e) {
      setAlertInfo({ title: 'That did not send', message: friendlyError(e, 'Try again in a moment.') });
    } finally {
      setInviting(null);
    }
  };

  const inviteContact = async () => {
    if (!community || inviting) return;
    const value = contactValue.trim();
    const valid = contactKind === 'email' ? looksLikeEmail(value) : looksLikePhone(value);
    if (!valid) {
      setAlertInfo({
        title: contactKind === 'email' ? 'Check the email' : 'Check the phone number',
        message: contactKind === 'email' ? 'That does not look like a full email address.' : 'That does not look like a full phone number.',
      });
      return;
    }
    setInviting('contact');
    try {
      const target = contactKind === 'email' ? ({ kind: 'email', email: value } as const) : ({ kind: 'phone', phone: value } as const);
      const result = await createCoCreatorInvite(community.id, target);
      afterInviteCreated(buildCoCreatorInviteLink(result.rawToken));
    } catch (e) {
      setAlertInfo({ title: 'That did not send', message: friendlyError(e, 'Try again in a moment.') });
    } finally {
      setInviting(null);
    }
  };

  const confirmRevoke = (row: CoCreatorInviteRow) => {
    hapticLight();
    setAlertInfo({
      title: `Cancel this invite?`,
      message: `${inviteTargetLabel(row)} will no longer be able to accept it.`,
      buttons: [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Cancel invite',
          style: 'destructive',
          onPress: async () => {
            try {
              await revokeCoCreatorInvite(row.id);
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

  if (!CO_CREATOR_INVITES_ENABLED) return <Redirect href="/(creator)/members" />;
  if (access && !isLeaderAccess(access)) return <Redirect href="/(creator)/events" />;

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
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            refreshControl={undefined}
          >
            <Text style={styles.title}>Co-creators</Text>
            <Text style={styles.hint}>
              Invite someone to help run {community.name}. They get full co-creator
              access, just like you.
            </Text>

            {!isPrimaryLeader ? (
              <View style={styles.notice}>
                <Text style={styles.noticeText}>
                  Only the primary creator of this community can send co-creator invites.
                </Text>
              </View>
            ) : composer === 'closed' ? (
              <TouchableOpacity style={styles.inviteBtn} onPress={() => setComposer('search')} activeOpacity={0.85}>
                <Text style={styles.inviteBtnText}>+ Invite a co-creator</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.composer}>
                <View style={styles.composerHeaderRow}>
                  <View style={styles.modeTabs}>
                    <TouchableOpacity
                      style={[styles.modeTab, composer === 'search' && styles.modeTabActive]}
                      onPress={() => setComposer('search')}
                    >
                      <Text style={[styles.modeTabText, composer === 'search' && styles.modeTabTextActive]}>Find a profile</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.modeTab, composer === 'contact' && styles.modeTabActive]}
                      onPress={() => setComposer('contact')}
                    >
                      <Text style={[styles.modeTabText, composer === 'contact' && styles.modeTabTextActive]}>Email or phone</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity onPress={closeComposer} hitSlop={10} style={styles.closeComposerBtn}>
                    <X size={18} color={Colors.text3} strokeWidth={2.5} />
                  </TouchableOpacity>
                </View>

                {composer === 'search' ? (
                  <>
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
                      <Text style={styles.noResults}>No one found. Try their exact handle, or invite by email or phone instead.</Text>
                    )}
                  </>
                ) : (
                  <>
                    <View style={styles.modeTabs}>
                      <TouchableOpacity
                        style={[styles.contactKindTab, contactKind === 'email' && styles.modeTabActive]}
                        onPress={() => setContactKind('email')}
                      >
                        <Mail size={14} color={contactKind === 'email' ? Colors.white : Colors.text2} strokeWidth={2.25} />
                        <Text style={[styles.modeTabText, contactKind === 'email' && styles.modeTabTextActive]}>Email</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.contactKindTab, contactKind === 'phone' && styles.modeTabActive]}
                        onPress={() => setContactKind('phone')}
                      >
                        <Phone size={14} color={contactKind === 'phone' ? Colors.white : Colors.text2} strokeWidth={2.25} />
                        <Text style={[styles.modeTabText, contactKind === 'phone' && styles.modeTabTextActive]}>Phone</Text>
                      </TouchableOpacity>
                    </View>
                    <TextInput
                      style={styles.contactInput}
                      value={contactValue}
                      onChangeText={setContactValue}
                      placeholder={contactKind === 'email' ? 'name@example.com' : '(555) 123-4567'}
                      placeholderTextColor={Colors.text3}
                      keyboardType={contactKind === 'email' ? 'email-address' : 'phone-pad'}
                      autoCapitalize="none"
                      autoCorrect={false}
                      inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
                    />
                    <Text style={styles.contactHint}>
                      If they don&apos;t have an account yet, they&apos;ll make one first. The invite only
                      activates once they verify this exact {contactKind === 'email' ? 'email' : 'number'}.
                    </Text>
                    <TouchableOpacity
                      style={[styles.sendBtn, (!contactValue.trim() || inviting === 'contact') && styles.sendBtnDisabled]}
                      onPress={inviteContact}
                      disabled={!contactValue.trim() || inviting === 'contact'}
                    >
                      {inviting === 'contact' ? (
                        <ActivityIndicator size="small" color={Colors.white} />
                      ) : (
                        <Text style={styles.sendBtnText}>Send invite</Text>
                      )}
                    </TouchableOpacity>
                  </>
                )}
              </View>
            )}

            {isLoading ? (
              <ActivityIndicator size="small" color={Colors.terracotta} style={{ marginTop: 24 }} />
            ) : (
              <>
                {pendingInvites.length > 0 && (
                  <>
                    <Text style={styles.sectionLabel}>Pending</Text>
                    {pendingInvites.map((row) => (
                      <View key={row.id} style={styles.inviteCard}>
                        <Avatar name={inviteTargetLabel(row)} photo={row.targetPhoto} size={40} />
                        <View style={styles.inviteCardText}>
                          <Text style={styles.inviteCardName}>{inviteTargetLabel(row)}</Text>
                          <Text style={styles.inviteCardStatus}>{statusLabel(row.status)}</Text>
                        </View>
                        {isPrimaryLeader && (
                          <TouchableOpacity onPress={() => confirmRevoke(row)} hitSlop={10} style={styles.revokeBtn}>
                            <Text style={styles.revokeBtnText}>Cancel</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    ))}
                  </>
                )}

                {pastInvites.length > 0 && (
                  <>
                    <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Past invites</Text>
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
                  <Text style={styles.hint}>No co-creator invites yet.</Text>
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

// Tokens per the 2026-08-17 locked brand implementation template: radius 10
// for buttons, 12 for cards, spacing scale {4,8,12,16,20,24,32,40,48,64}.
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
  notice: {
    backgroundColor: Colors.brandSoft,
    borderRadius: 12,
    padding: 16,
  },
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
  closeComposerBtn: { padding: 4 },
  modeTabs: { flexDirection: 'row', gap: 8 },
  modeTab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: Colors.inputBg },
  contactKindTab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: Colors.inputBg },
  modeTabActive: { backgroundColor: Colors.brand },
  modeTabText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.text2 },
  modeTabTextActive: { color: Colors.white },
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
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  resultName: { flex: 1, fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.text1 },
  resultInvite: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodySM, color: Colors.brand },
  noResults: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.text3, paddingVertical: 8 },
  contactInput: {
    backgroundColor: Colors.inputBg,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.text1,
  },
  contactHint: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.text3, lineHeight: LineHeights.caption },
  sendBtn: { backgroundColor: Colors.brand, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyMD, color: Colors.white },
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
  revokeBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  revokeBtnText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.errorBrand },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.brandSoft },
  avatarInitial: { fontFamily: Fonts.sansBold, color: Colors.brand },
});
