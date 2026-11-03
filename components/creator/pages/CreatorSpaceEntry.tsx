import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { View, Pressable, ActivityIndicator, StyleSheet, useWindowDimensions } from 'react-native';
import { ScaledText as Text } from '../../ScaledText';
import { ChevronRight } from 'lucide-react-native';
import { router } from 'expo-router';
import Colors, { AfterglowColors as C, CreatorSurfaceColors as G } from '../../../constants/Colors';
import { AfterglowType as T } from '../../../constants/Typography';
import { CREATOR_PAGES_ENABLED } from '../../../constants/FeatureFlags';
import { useAfterglowFonts } from '../../../hooks/useAfterglowFonts';
import { useCreatorPageScope } from '../../../hooks/useCreatorPageScope';
import { useCreatorPageRead } from '../../../hooks/useCreatorPageRead';
import type { CreatorPageScope } from '../../../lib/creatorPageReview';
import { loadManagedSpaces, loadManagedApplications, managedSpaceStatus, prepareCreatorSpace } from '../../../lib/creatorManagement';

type Entry = { key: string; title: string; subtitle: string; action: string; open: () => Promise<void> };

/** Named destinations in Yours; the same list is available from Profile. */
export function CreatorSpaceEntry({ userId, expanded = false }: { userId: string; expanded?: boolean }) {
  const { scope, account } = useCreatorPageScope('yours-creator-entry');
  const { height, fontScale } = useWindowDimensions();
  const owned = scope?.userId === userId ? scope : null;
  const latestOwned = useRef(owned);
  useLayoutEffect(() => { latestOwned.current = owned; }, [owned]);
  const read = useCallback((value: CreatorPageScope) => loadManagedSpaces(value, CREATOR_PAGES_ENABLED), []);
  const spaces = useCreatorPageRead(owned, read);
  const applications = useCreatorPageRead(owned, loadManagedApplications);
  const { fonts } = useAfterglowFonts(true, 'creator');
  const lock = useRef<CreatorPageScope | null>(null);
  const [opening, setOpening] = useState<{ scope: CreatorPageScope; key: string }>();
  const [notice, setNotice] = useState<{ scope: CreatorPageScope; text: string }>();
  const current = () => latestOwned.current === owned && !!owned?.isCurrent() && !account.isLoading && !account.error;
  const go = (route: string) => { if (current()) router.push(route as never); };
  const run = async (entry: Entry) => {
    if (!owned || !current() || lock.current === owned) return;
    const initiating = owned;
    lock.current = initiating; setOpening({ scope: initiating, key: entry.key }); setNotice(undefined);
    try { await entry.open(); }
    catch { if (initiating.isCurrent()) setNotice({ scope: initiating, text: 'Couldn’t open these tools. Try again.' }); }
    finally { if (lock.current === initiating) lock.current = null; if (initiating.isCurrent()) setOpening(undefined); }
  };
  const changed = () => { if (owned?.isCurrent()) setNotice({ scope: owned, text: 'Your access has changed. Choose an available item below.' }); };
  const entries: Entry[] = [];
  if (!spaces.error) {
    for (const space of spaces.data?.spaces ?? []) entries.push({
      key: 'space:' + space.id, title: space.name, subtitle: managedSpaceStatus(space), action: 'Manage ' + space.name,
      open: async () => {
        const fresh = await spaces.refresh();
        if (!current()) return;
        const actual = fresh?.spaces.find(item => item.id === space.id && item.kind === space.kind);
        if (!actual) { changed(); return; }
        prepareCreatorSpace(actual, owned!); go(actual.route);
      },
    });
    for (const invitation of spaces.data?.invitations ?? []) entries.push({
      key: 'invitation:' + invitation.invitationId, title: invitation.pageName, subtitle: 'Team invitation · Review invitation',
      action: 'Review invitation to ' + invitation.pageName,
      open: async () => {
        const fresh = await spaces.refresh();
        if (!current()) return;
        const actual = fresh?.invitations.find(item => item.invitationId === invitation.invitationId);
        if (!actual) { changed(); return; }
        go('/creator/page-team?id=' + actual.pageId + '&invitationId=' + actual.invitationId);
      },
    });
  }
  if (!applications.error) for (const grant of applications.data ?? []) entries.push({
    key: 'application:' + grant.id, title: grant.track === 'community_leader' ? 'Community application' : 'Event creator application',
    subtitle: grant.status === 'needs_more_info' ? 'Needs more information' : grant.status === 'declined' ? 'Not approved · View details' : grant.status === 'revoked' ? 'Access closed · View details' : 'In review · View status',
    action: grant.track === 'community_leader' ? 'View community application' : 'View event creator application',
    open: async () => {
      const fresh = await applications.refresh();
      if (!current()) return;
      if (!fresh?.some(item => item.id === grant.id)) { changed(); return; }
      go('/creator/apply');
    },
  });
  if (!userId || !owned || account.viewerId === null) return null;
  const busy = opening?.scope === owned;
  const loading = spaces.loading || applications.loading || account.isLoading;
  const failed = !!(account.error || spaces.error || applications.error);
  if (!expanded && !entries.length && !loading && !failed) return null;
  const visible = expanded ? entries : entries.slice(0, height < 700 || fontScale > 1.2 ? 1 : 2);
  return <View style={[s.wrap, expanded && s.expanded]}>
    {!expanded && <Text accessibilityRole="header" style={[s.heading, { fontFamily: fonts.semibold }]}>You manage</Text>}
    {expanded && <Text style={[s.intro, { fontFamily: fonts.regular }]}>Your communities, organizations and unfinished setup.</Text>}
    {visible.map(entry => <Pressable key={entry.key} accessibilityRole="button" accessibilityLabel={entry.action} accessibilityHint={entry.subtitle}
      disabled={busy || loading || !current()} accessibilityState={{ disabled: busy || loading || !current() }}
      onPress={() => { void run(entry); }} style={({ pressed }) => [s.entry, pressed && s.pressed]}>
      <View style={s.copy}><Text style={[s.title, { fontFamily: fonts.medium }]}>{entry.title}</Text>
        <Text style={[s.subtitle, { fontFamily: fonts.regular }]}>{entry.subtitle}</Text></View>
      {busy && opening.key === entry.key ? <ActivityIndicator accessibilityLabel="Opening management" color={Colors.terracotta} /> : <ChevronRight size={18} color={C.muted} />}
    </Pressable>)}
    {loading && !entries.length && <ActivityIndicator accessibilityLabel="Loading your management tools" color={Colors.terracotta} />}
    {failed && <View><Text style={[s.subtitle, { fontFamily: fonts.regular }]}>Some management details couldn’t load.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Retry management details" style={s.linkTarget} disabled={loading || busy}
        onPress={() => { if (account.error) void account.retry().catch(() => undefined); else { void spaces.refresh().catch(() => undefined); void applications.refresh().catch(() => undefined); } }}>
        <Text style={[s.link, { fontFamily: fonts.medium }]}>Try again</Text>
      </Pressable></View>}
    {notice?.scope === owned && <Text accessibilityRole="alert" style={[s.subtitle, { fontFamily: fonts.regular }]}>{notice.text}</Text>}
    {!expanded && entries.length > visible.length && <Pressable accessibilityRole="button" accessibilityLabel="See everything you manage" style={s.linkTarget} onPress={() => go('/creator/manage')}>
      <Text style={[s.link, { fontFamily: fonts.medium }]}>See all ({entries.length})</Text></Pressable>}
    {expanded && !loading && !failed && !entries.length && <Text style={[s.intro, { fontFamily: fonts.regular }]}>Start a community or create an event. Your setup and management tools will stay here.</Text>}
    {expanded && <View style={s.create}>
      {(['community', 'event'] as const).map(kind => <Pressable key={kind} accessibilityRole="button" style={s.linkTarget} onPress={() => go('/creator/start?kind=' + kind)}>
        <Text style={[s.link, { fontFamily: fonts.medium }]}>{kind === 'community' ? 'Start a community' : 'Create an event'}</Text>
      </Pressable>)}
    </View>}
  </View>;
}
const s = StyleSheet.create({
  wrap: { paddingHorizontal: 20, paddingBottom: 12, gap: 8 }, expanded: { paddingHorizontal: 0 },
  heading: { ...T.caption, color: C.ink }, intro: { ...T.body, color: C.muted, marginBottom: 8 },
  entry: { padding: 14, borderRadius: 16, backgroundColor: Colors.cardBg, borderWidth: 1, borderColor: G.goldEdge, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64 },
  copy: { flex: 1, minWidth: 0, gap: 4 }, title: { ...T.title, color: C.ink }, subtitle: { ...T.caption, color: C.muted },
  pressed: { opacity: 0.8 }, linkTarget: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  link: { ...T.caption, color: Colors.terracotta }, create: { marginTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line, paddingTop: 8 },
});
