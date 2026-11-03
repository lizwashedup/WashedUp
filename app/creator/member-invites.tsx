/** Existing-profile invitation links. Creating a link does not send a message. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Share, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Redirect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { ScaledText as Text } from '../../components/ScaledText';
import { PageAction, PageFrame } from '../../components/creator/pages/PageFrame';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../../components/keyboard/KeyboardDoneBar';
import Colors from '../../constants/Colors';
import { FontSizes, LineHeights, type AfterglowFontFamilies } from '../../constants/Typography';
import { MEMBER_INVITES_ENABLED } from '../../constants/FeatureFlags';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { useCreatorAccessRead } from '../../hooks/useCreatorAccessRead';
import { useCreatorPageScope } from '../../hooks/useCreatorPageScope';
import { useCreatorPageRead } from '../../hooks/useCreatorPageRead';
import { useMemberInviteSearch } from '../../hooks/useMemberInviteSearch';
import { useLedCommunity } from '../../lib/selectedCommunity';
import type { CreatorPageScope } from '../../lib/creatorPageReview';
import type { LedCommunity } from '../../lib/creatorMode';
import type { ProfileSearchResult } from '../../lib/coCreatorInvites';
import { friendlyError } from '../../lib/friendlyError';
import { requestWithDeadline } from '../../lib/requestWithDeadline';
import { hapticSuccess } from '../../lib/haptics';
import { createMemberInvite, listCommunityMemberInvites, revokeMemberInvite, buildMemberInviteLink,
  memberInviteBucket, MemberInviteOutcomeUnknown, type MemberInviteRow } from '../../lib/memberInvites';
import { effectiveMemberInviteStatus, memberInviteExpiryLabel } from '../../lib/memberInvitePresentation';

export default function MemberInvitesScreen() {
  const access = useCreatorAccessRead();
  const community = useLedCommunity(access.data);
  const { scope, account, focused } = useCreatorPageScope(`member-invites:${community?.id ?? ''}`);
  const { fonts } = useAfterglowFonts(true, 'creator');
  const s = useMemo(() => styles(fonts), [fonts]);
  if (!MEMBER_INVITES_ENABLED) return focused ? <Redirect href="/(tabs)/friends/manage/(tools)/members" /> : null;
  return <PageFrame title={community?.name ?? 'Invite members'} stackedProfile>
    {account.isLoading || access.isLoading ? <ActivityIndicator accessibilityLabel="Loading invitation access" color={Colors.terracotta} />
      : account.error || access.isError ? <View style={s.section}>
        <Text accessibilityRole="alert" style={s.body}>Couldn’t check your community access.</Text>
        <PageAction quiet title="Try again" onPress={() => void (account.error ? account.retry() : access.refetch())} />
      </View>
      : !scope || !community ? <Text style={s.body}>Choose a community you manage to view its invitations.</Text>
      : focused ? <MemberInvites key={`${account.epoch}:${community.id}`} community={community} scope={scope} /> : null}
  </PageFrame>;
}

function MemberInvites({ community, scope }: { community: LedCommunity; scope: CreatorPageScope }) {
  const { fonts } = useAfterglowFonts(true, 'creator');
  const s = useMemo(() => styles(fonts), [fonts]);
  const { fontScale } = useWindowDimensions();
  // Fabric can retain the previous native input font after Dynamic Type changes.
  // Match the chat fix: scale iOS metrics explicitly without remounting the field.
  const inputType = Platform.OS === 'ios' ? {
    fontSize: FontSizes.bodyMD * fontScale, lineHeight: LineHeights.bodyMD * fontScale,
  } : undefined;
  const queryClient = useQueryClient();
  // Match the deployed create_member_invite/is_community_leader boundary for THIS community.
  const canInvite = ['leader', 'co_leader'].includes(community.role) && community.status !== 'archived';
  const readHistory = useCallback(() => requestWithDeadline(listCommunityMemberInvites(community.id), 12_000), [community.id]);
  const history = useCreatorPageRead(scope, readHistory);
  const [query, setQuery] = useState('');
  const [composer, setComposer] = useState(false);
  const [selected, setSelected] = useState<ProfileSearchResult | null>(null);
  const [message, setMessage] = useState('');
  const search = useMemberInviteSearch(query, scope, composer && !selected && canInvite);
  const [readyLink, setReadyLink] = useState<{ profile: ProfileSearchResult; link: string; expiresAt: string } | null>(null);
  const [notice, setNotice] = useState<string>();
  const [uncertain, setUncertain] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [alert, setAlert] = useState<{ title: string; message: string; buttons: BrandedAlertButton[] } | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const rows = history.data?.map(row => ({ ...row, status: effectiveMemberInviteStatus(row.status, row.expiresAt, now) }));
  const pending = rows?.filter(row => memberInviteBucket(row.status) === 'invited') ?? [];
  const past = rows?.filter(row => memberInviteBucket(row.status) !== 'invited') ?? [];
  const ready = canInvite && !busy && !uncertain && !!history.data && !history.error && !history.loading && scope.isCurrent();
  const latest = useRef({ ready, selected, message });
  latest.current = { ready, selected, message };
  const refresh = async () => {
    if (!scope.isCurrent()) return;
    try { const result = await history.refresh(); if (result && scope.isCurrent()) { setUncertain(false); setNow(Date.now()); } } catch { /* The read hook displays the failure. */ }
  };
  const clearComposer = () => { setComposer(false); setQuery(''); setSelected(null); setMessage(''); };
  const createLink = async (profile: ProfileSearchResult, note: string) => {
    if (!latest.current.ready || !scope.isCurrent() || lock.current) return;
    lock.current = true; setBusy(true); setNotice(undefined); setReadyLink(null);
    try {
      const result = await createMemberInvite(community.id, profile.id, note, scope);
      if (!scope.isCurrent()) return;
      setReadyLink({ profile, link: buildMemberInviteLink(result.rawToken), expiresAt: result.expiresAt });
      clearComposer(); hapticSuccess();
      void queryClient.invalidateQueries({ queryKey: ['member-invites'] });
      void history.refresh().catch(() => undefined);
    } catch (error) {
      if (!scope.isCurrent()) return;
      if (error instanceof MemberInviteOutcomeUnknown) setUncertain(true);
      setNotice(error instanceof MemberInviteOutcomeUnknown ? error.message : friendlyError(error, 'Couldn’t create the invitation link. Try again.'));
    } finally { lock.current = false; if (scope.isCurrent()) setBusy(false); }
  };
  const confirmLink = (profile: ProfileSearchResult, note: string) => {
    if (!latest.current.ready || !scope.isCurrent() || lock.current) return;
    setAlert({ title: 'Create invite link?', message: `This link is for ${profile.name} only. You’ll need to share it with them. Any earlier invitation link for them will stop working.`,
      buttons: [{ text: 'Not now', style: 'cancel' }, { text: 'Create link', onPress: () => void createLink(profile, note) }] });
  };
  const confirmCancel = (row: MemberInviteRow) => {
    if (!latest.current.ready || !scope.isCurrent() || lock.current) return;
    setAlert({ title: 'Cancel this invite?', message: `${row.targetName ?? 'This person'} will no longer be able to accept it.`,
      buttons: [{ text: 'Keep invite', style: 'cancel' }, { text: 'Cancel invite', style: 'destructive', onPress: async () => {
        if (!latest.current.ready || !scope.isCurrent() || lock.current) return;
        lock.current = true; setBusy(true); setNotice(undefined);
        try {
          await revokeMemberInvite(row.id, scope);
          if (!scope.isCurrent()) return;
          if (readyLink?.profile.id === row.targetUserId) setReadyLink(null);
          setNotice('Invitation canceled.');
          void queryClient.invalidateQueries({ queryKey: ['member-invites'] });
          void history.refresh().catch(() => undefined);
        } catch { if (scope.isCurrent()) { setUncertain(true); setNotice('Couldn’t confirm the cancellation. Refresh invite history to check its status.'); } }
        finally { lock.current = false; if (scope.isCurrent()) setBusy(false); }
      } }] });
  };
  const shareLink = async () => {
    if (!readyLink || !scope.isCurrent() || lock.current) return;
    lock.current = true; setBusy(true); setNotice(undefined);
    try { await Share.share({ message: readyLink.link }); }
    catch { if (scope.isCurrent()) setNotice('Couldn’t open sharing. Your link is still here—try again.'); }
    finally { lock.current = false; if (scope.isCurrent()) setBusy(false); }
  };
  const renderRow = (row: MemberInviteRow) => <View key={row.id} style={s.historyRow}>
    <View style={s.person}><Avatar name={row.targetName ?? 'Someone'} photo={row.targetPhoto} />
      <View style={s.personText}><Text style={s.label}>{row.targetName ?? 'Someone'}</Text>
        <Text style={s.meta}>{statusLabel(row.status)}{memberInviteBucket(row.status) === 'invited' ? ` · ${memberInviteExpiryLabel(row.expiresAt, now)}` : ''}</Text>
      </View>
    </View>
    {canInvite && memberInviteBucket(row.status) === 'invited' && <View style={s.actions}>
      <PageAction quiet compact singleLine title="New link" disabled={!ready} accessibilityLabel={`Create a new link for ${row.targetName ?? 'this person'}`}
        onPress={() => confirmLink({ id: row.targetUserId, name: row.targetName ?? 'Someone', photo: row.targetPhoto }, row.inviteMessage ?? '')} />
      <PageAction quiet compact singleLine title="Cancel invite" disabled={!ready} accessibilityLabel={`Cancel invitation for ${row.targetName ?? 'this person'}`} onPress={() => confirmCancel(row)} />
    </View>}
  </View>;
  return <View style={s.section}>
    <Text accessibilityRole="header" style={s.title}>Invite members</Text>
    <Text style={s.body}>Find someone already on WashedUp, then create a personal link to share with them.</Text>
    {!canInvite && <Text style={s.meta}>{community.status === 'archived' ? 'This community is archived and closed to new members.' : 'Only this community’s leader or co-leader can create invitation links.'}</Text>}
    {notice && <Text accessibilityRole="alert" style={s.body}>{notice}</Text>}
    {readyLink && <View style={s.panel}>
      <Text accessibilityRole="header" style={s.label}>Link ready for {readyLink.profile.name}</Text>
      <Text style={s.meta}>Share it with them to complete the invitation. Creating a link doesn’t send a message.</Text>
      <Text style={s.meta}>{memberInviteExpiryLabel(readyLink.expiresAt, now)}. It opens in the WashedUp app.</Text>
      <PageAction primary singleLine title="Share link" disabled={busy || Date.parse(readyLink.expiresAt) <= now} onPress={() => void shareLink()} />
      <PageAction quiet compact title="Done" disabled={busy} onPress={() => setReadyLink(null)} />
    </View>}
    {canInvite && !readyLink && (!composer ? <PageAction primary singleLine title="Invite someone" disabled={!ready} onPress={() => { if (ready) setComposer(true); }} /> : <View style={s.panel}>
      {!selected ? <>
        <Text style={s.label}>Who would you like to invite?</Text>
        <TextInput value={query} onChangeText={setQuery} editable={!busy} placeholder="Enter their handle" accessibilityLabel="Search by handle"
          autoCapitalize="none" autoCorrect={false} style={[s.input, inputType]} allowFontScaling={Platform.OS === 'ios' ? false : undefined}
          placeholderTextColor={Colors.inkSoft} inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID} />
        <Text style={s.meta}>Use a handle they’ve shared with you.</Text>
        {search.loading && <ActivityIndicator accessibilityLabel="Searching profiles" color={Colors.terracotta} />}
        {search.error && <><Text accessibilityRole="alert" style={s.meta}>Couldn’t search right now.</Text><PageAction quiet compact title="Try again" onPress={search.retry} /></>}
        {search.results.map(profile => <Pressable key={profile.id} accessibilityRole="button" accessibilityLabel={`Select ${profile.name}`} style={s.person}
          onPress={() => { if (scope.isCurrent() && !lock.current) setSelected(profile); }}>
          <Avatar name={profile.name} photo={profile.photo} /><Text style={[s.label, s.personText]}>{profile.name}</Text><Text style={s.link}>Select</Text>
        </Pressable>)}
        {query.trim().length >= 2 && !search.loading && !search.error && !search.results.length && <Text style={s.meta}>No match. Check their handle and try again.</Text>}
      </> : <>
        <View style={s.person}><Avatar name={selected.name} photo={selected.photo} /><Text style={[s.label, s.personText]}>{selected.name}</Text></View>
        <TextInput value={message} onChangeText={setMessage} editable={!busy} multiline maxLength={300} style={[s.input, s.note, inputType]} allowFontScaling={Platform.OS === 'ios' ? false : undefined} placeholder="Add a note (optional)"
          placeholderTextColor={Colors.inkSoft} accessibilityLabel="Invitation note" inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID} />
        <PageAction primary singleLine title={busy ? 'Creating…' : 'Create link'} disabled={!ready} onPress={() => { if (latest.current.selected) confirmLink(latest.current.selected, latest.current.message); }} />
        <PageAction quiet compact title="Change person" disabled={busy} onPress={() => setSelected(null)} />
      </>}
      <PageAction quiet compact title="Cancel" disabled={busy} onPress={clearComposer} />
    </View>)}
    <View style={s.historyHeader}><Text accessibilityRole="header" style={s.label}>Invite history</Text><PageAction quiet compact title="Refresh" accessibilityLabel="Refresh invite history" disabled={busy || history.loading} onPress={() => void refresh()} /></View>
    {history.loading && !history.data && <ActivityIndicator accessibilityLabel="Loading invitations" color={Colors.terracotta} />}
    {history.error && <Text accessibilityRole="alert" style={s.body}>Couldn’t load the latest invitations. Refresh to try again.</Text>}
    {!history.error && rows?.length === 0 && <Text style={s.meta}>Your invitation links and their status will appear here.</Text>}
    {!!pending.length && <><Text style={s.meta}>Waiting to join</Text>{pending.map(renderRow)}</>}
    {!!past.length && <><Text style={s.meta}>Joined & past</Text>{past.map(renderRow)}</>}
    <BrandedAlert visible={!!alert} title={alert?.title ?? ''} message={alert?.message} buttons={alert?.buttons}
      scrollMessage appearance={{ fonts, variant: 'creator' }} onClose={() => setAlert(null)} />
  </View>;
}

function statusLabel(status: MemberInviteRow['status']) {
  return ({ pending: 'Link created', viewed: 'Link opened', accepted: 'Joined', revoked: 'Canceled', expired: 'Expired' })[status];
}
function Avatar({ name, photo }: { name: string; photo: string | null }) {
  const { fonts } = useAfterglowFonts(true, 'creator');
  const s = useMemo(() => styles(fonts), [fonts]);
  return photo ? <Image source={{ uri: photo }} style={s.avatar} contentFit="cover" /> : <View style={[s.avatar, s.fallback]}><Text style={s.label}>{name.trim()[0]?.toUpperCase() ?? '?'}</Text></View>;
}
const styles = (fonts: AfterglowFontFamilies) => StyleSheet.create({
  section: { gap: 16 },
  title: { fontFamily: fonts.display, fontSize: FontSizes.displayLG, lineHeight: LineHeights.displayLG, color: Colors.darkWarm },
  body: { fontFamily: fonts.regular, fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD, color: Colors.darkWarm },
  meta: { fontFamily: fonts.regular, fontSize: FontSizes.bodySM, lineHeight: LineHeights.bodySM, color: Colors.secondary },
  label: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD, color: Colors.darkWarm },
  link: { fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  panel: { backgroundColor: Colors.cardBg, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, padding: 16, gap: 12 },
  input: { backgroundColor: Colors.inputBg, borderRadius: 8, minHeight: 48, padding: 12, fontFamily: fonts.regular, fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD, color: Colors.darkWarm },
  note: { minHeight: 80, textAlignVertical: 'top' },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  personText: { flex: 1, minWidth: 0 },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  fallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.brandSoft },
  historyHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 8 },
  historyRow: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border, paddingBottom: 12, gap: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, paddingLeft: 48 },
});
