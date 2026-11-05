import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { ScaledText as Text } from '../ScaledText';
import { PageAction } from './pages/PageFrame';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../keyboard/KeyboardDoneBar';
import Colors from '../../constants/Colors';
import { FontSizes, LineHeights, type AfterglowFontFamilies } from '../../constants/Typography';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { useCreatorAccessRead } from '../../hooks/useCreatorAccessRead';
import { useCreatorPageScope } from '../../hooks/useCreatorPageScope';
import { useCreatorPageRead } from '../../hooks/useCreatorPageRead';
import { useCommunicationDraft } from '../../hooks/useCommunicationDraft';
import { useCommunicationDraftExit } from '../../hooks/useCommunicationDraftExit';
import { useLedCommunity } from '../../lib/selectedCommunity';
import { getBroadcasts, getBroadcastAudienceCount, isAdminTierRole, sendBroadcast, checkBroadcast } from '../../lib/creatorMode';
import type { CreatorPageScope } from '../../lib/creatorPageReview';
import { EMPTY_COMMUNITY_UPDATE, validCommunityUpdateDraft, type CommunityUpdateAttempt } from '../../lib/communityUpdateDraft';
import { requestWithDeadline } from '../../lib/requestWithDeadline';
import { formatTimestampLA } from '../../lib/laDate';

export default function CommunityUpdatesScreen() {
  const access = useCreatorAccessRead();
  const community = useLedCommunity(access.data);
  const { scope, account } = useCreatorPageScope(`community-updates:${community?.id ?? ''}`);
  const { fonts } = useAfterglowFonts(true, 'creator');
  const s = useMemo(() => styles(fonts), [fonts]);
  if (account.isLoading || access.isLoading) return <View style={s.state}><ActivityIndicator accessibilityLabel="Loading community updates" color={Colors.terracotta} /></View>;
  if (account.error || access.isError) return <View style={s.state}><Text style={s.body}>Couldn’t check your community access.</Text>
    <PageAction quiet title="Try again" onPress={() => void (account.error ? account.retry() : access.refetch())} /></View>;
  if (!scope || !community || !isAdminTierRole(community.role)) return <View style={s.state}><Text style={s.body}>Updates are available to this community’s creators.</Text></View>;
  // A community/account change remounts the editor; blur retires callbacks without losing its owned draft.
  return <CommunityUpdateComposer key={`${account.epoch}:${community.id}`} communityId={community.id} scope={scope} />;
}

function CommunityUpdateComposer({ communityId, scope }: { communityId: string; scope: CreatorPageScope }) {
  const { fonts } = useAfterglowFonts(true, 'creator');
  const s = useMemo(() => styles(fonts), [fonts]);
  const queryClient = useQueryClient();
  const draft = useCommunicationDraft(communityId, 'community-update', scope, EMPTY_COMMUNITY_UPDATE, validCommunityUpdateDraft);
  useCommunicationDraftExit(scope, draft);
  const readHistory = useCallback((owned: CreatorPageScope) => requestWithDeadline(getBroadcasts(communityId), 12_000).then(rows => {
    if (!owned.isCurrent()) throw Error('This community changed.');
    return rows;
  }), [communityId]);
  const readAudience = useCallback((owned: CreatorPageScope) => requestWithDeadline(getBroadcastAudienceCount(communityId), 12_000).then(count => {
    if (!owned.isCurrent()) throw Error('This community changed.');
    return count;
  }), [communityId]);
  const history = useCreatorPageRead(scope, readHistory);
  const audience = useCreatorPageRead(scope, readAudience);
  const lock = useRef(false);
  const mounted = useRef(false);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ scope: CreatorPageScope; text: string }>();
  const [confirmed, setConfirmed] = useState<CommunityUpdateAttempt | null>(null);
  const attempt = draft.value.attempt;
  const originalRef = useRef(attempt);
  originalRef.current = attempt;
  const confirmedRef = useRef<CommunityUpdateAttempt | null>(null);
  const ready = draft.ready && !draft.error && !busy && scope.isCurrent();
  const latest = useRef({ ready, draft });
  latest.current = { ready, draft };
  const run = async (checkOnly = false) => {
    const currentDraft = latest.current.draft;
    if (!latest.current.ready || !scope.isCurrent() || lock.current || confirmedRef.current || (!originalRef.current && !currentDraft.value.body.trim())) return;
    const owned = scope;
    lock.current = true; setBusy(true); setNotice(undefined);
    try {
      // Save the identity before dispatch. Retry can only use this exact text and ID.
      const previous = originalRef.current;
      const original = previous ?? { id: randomUUID(), body: currentDraft.value.body.trim() };
      originalRef.current = original;
      if (!previous && !await currentDraft.replace({ body: currentDraft.value.body, attempt: original })) return;
      if (!owned.isCurrent()) return;
      const found = previous ? await checkBroadcast(communityId, original.body, owned, original.id) : false;
      if (!owned.isCurrent()) return;
      if (!found && checkOnly) {
        setNotice({ scope: owned, text: 'This update isn’t confirmed yet. You can check again or retry the original update.' }); return;
      }
      if (!found) await sendBroadcast(communityId, original.body, owned, original.id);
      if (!owned.isCurrent()) return;
      confirmedRef.current = original; setConfirmed(original);
      void queryClient.invalidateQueries({ queryKey: ['creator-broadcasts', communityId] });
      void queryClient.invalidateQueries({ queryKey: ['community-broadcasts', communityId] });
      void history.refresh().catch(() => undefined);
    } catch {
      if (owned.isCurrent()) setNotice({ scope: owned, text: 'Your update is kept. Check its status before trying again; it may already have been posted.' });
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  return <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets={false}>
      <Text accessibilityRole="header" style={s.title}>Send update</Text>
      <Text style={s.intro}>Share news or a reminder in your community’s Main chat.</Text>
      <View style={s.panel}>
        <Text style={s.label}>Update notifications</Text>
        <Text style={s.meta}>{audience.error ? 'Couldn’t check who receives notifications.' : audience.data == null ? 'Checking notification settings…' : audience.data === 0
          ? 'No other members currently receive update notifications.'
          : `${audience.data} ${audience.data === 1 ? 'member receives' : 'members receive'} update notifications.`}</Text>
        <Text style={s.meta}>Members can read the update in Main chat. Notifications follow their settings.</Text>
        {audience.error && <PageAction quiet compact title="Check audience" disabled={audience.loading} onPress={() => void audience.refresh().catch(() => undefined)} />}
      </View>
      {!draft.loaded && !draft.error && <ActivityIndicator accessibilityLabel="Loading saved update" color={Colors.terracotta} />}
      {draft.error && <View style={s.panel}><Text accessibilityRole="alert" style={s.body}>{draft.error}</Text>
        <PageAction quiet compact title="Try again" disabled={busy || draft.saving} onPress={() => void draft.retry()} /></View>}
      {confirmed ? <View style={s.panel}>
        <Text accessibilityRole="header" style={s.label}>Update posted</Text>
        <Text style={s.body}>{confirmed.body}</Text>
        <Text style={s.meta}>Saved in Main chat. Notification delivery is separate.</Text>
        <PageAction primary singleLine title="New update" disabled={!ready} onPress={() => {
          if (!latest.current.ready || !confirmedRef.current || lock.current || !scope.isCurrent()) return;
          lock.current = true; setBusy(true);
          void draft.replace(EMPTY_COMMUNITY_UPDATE).then(saved => { if (saved && scope.isCurrent()) { confirmedRef.current = null; originalRef.current = null; setConfirmed(null); setNotice(undefined); } })
            .finally(() => { lock.current = false; if (mounted.current) setBusy(false); });
        }} />
      </View> : draft.loaded && <View style={s.panel}>
        <Text style={s.label}>{attempt ? 'Your saved update' : 'What’s new?'}</Text>
        {attempt ? <Text style={s.body}>{attempt.body}</Text> : <TextInput style={s.input} value={draft.value.body}
          onChangeText={body => { if (ready && !lock.current) draft.change({ body, attempt: null }); }} editable={ready}
          multiline maxLength={4000} placeholder="What would you like members to know?" placeholderTextColor={Colors.inkSoft}
          accessibilityLabel="Community update" inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID} />}
        {attempt && <Text style={s.meta}>Check whether it posted. Retrying uses this same update, so it won’t add a second copy.</Text>}
        {attempt && <PageAction quiet compact title={busy ? 'Checking…' : 'Check update'} disabled={!ready} onPress={() => void run(true)} />}
        <PageAction primary singleLine title={busy ? 'Working…' : attempt ? 'Retry update' : 'Send update'}
          disabled={!ready || !draft.value.body.trim()} onPress={() => void run()} />
        {!attempt && <Text style={s.meta}>{draft.saving ? 'Saving draft…' : draft.saved ? 'Draft saved on this device.' : 'Up to 4,000 characters.'}</Text>}
      </View>}
      {notice?.scope === scope && <Text accessibilityRole="alert" style={s.body}>{notice.text}</Text>}
      <View style={s.historyHeader}><Text accessibilityRole="header" style={s.section}>Sent updates</Text>
        <PageAction quiet compact title="Refresh" accessibilityLabel="Refresh sent updates" disabled={history.loading} onPress={() => void history.refresh().catch(() => undefined)} /></View>
      {history.loading && !history.data && <ActivityIndicator accessibilityLabel="Loading sent updates" color={Colors.terracotta} />}
      {history.error && <Text accessibilityRole="alert" style={s.meta}>Sent updates couldn’t be refreshed. Your draft is kept.</Text>}
      {history.data?.length === 0 && <Text style={s.meta}>Your sent updates will appear here.</Text>}
      {history.data?.map(update => <View key={update.id} style={s.historyRow}><Text style={s.body}>{update.body}</Text><Text style={s.meta}>{formatTimestampLA(update.created_at)}</Text></View>)}
      {!!history.data?.length && <Text style={s.meta}>Showing up to 20 recent updates.</Text>}
    </ScrollView>
  </KeyboardAvoidingView>;
}

const styles = (fonts: AfterglowFontFamilies) => StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.parchment }, state: { flex: 1, padding: 20, backgroundColor: Colors.parchment },
  content: { padding: 20, paddingBottom: 32, gap: 16 },
  title: { fontFamily: fonts.display, fontSize: FontSizes.displayLG, lineHeight: LineHeights.displayLG, color: Colors.darkWarm },
  intro: { fontFamily: fonts.regular, fontSize: FontSizes.bodyLG, lineHeight: LineHeights.bodyLG, color: Colors.secondary },
  body: { fontFamily: fonts.regular, fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD, color: Colors.darkWarm },
  meta: { fontFamily: fonts.regular, fontSize: FontSizes.bodySM, lineHeight: LineHeights.bodySM, color: Colors.secondary },
  label: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  section: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyLG, color: Colors.darkWarm },
  panel: { backgroundColor: Colors.cardBg, borderRadius: 16, borderWidth: 1, borderColor: Colors.border, padding: 16, gap: 12 },
  input: { minHeight: 120, fontFamily: fonts.regular, fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD, color: Colors.darkWarm, textAlignVertical: 'top', padding: 0 },
  historyHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  historyRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border, paddingVertical: 12, gap: 8 },
});
