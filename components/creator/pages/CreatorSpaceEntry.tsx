import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { View, Pressable, ActivityIndicator, StyleSheet, useWindowDimensions } from 'react-native';
import { ScaledText as Text } from '../../ScaledText';
import { Building2, ChevronDown, ChevronRight, Users } from 'lucide-react-native';
import { router } from 'expo-router';
import Colors, { AfterglowColors as C, CreatorSurfaceColors as G } from '../../../constants/Colors';
import { AfterglowType as T } from '../../../constants/Typography';
import { CREATOR_PAGES_ENABLED } from '../../../constants/FeatureFlags';
import { useAfterglowFonts } from '../../../hooks/useAfterglowFonts';
import { useCreatorPageScope } from '../../../hooks/useCreatorPageScope';
import { useCreatorPageRead } from '../../../hooks/useCreatorPageRead';
import type { CreatorPageScope } from '../../../lib/creatorPageReview';
import { loadManagedSpaces, loadManagedApplications, managedSpaceStatus, prepareCreatorSpace } from '../../../lib/creatorManagement';
import { managementRoute } from '../../../lib/managementNavigation';
import type { CreatorSpaceLink } from '../../../lib/creatorSpaceEntry';

type Entry = { key: string; title: string; subtitle: string; action: string; open: () => Promise<void>;
  kind?: 'community' | 'organization'; archived?: boolean; shortcuts?: Entry[] };

/** Named destinations in Yours; the same list is available from Profile. */
export function CreatorSpaceEntry({ userId, expanded = false }: { userId: string; expanded?: boolean }) {
  const { scope, account } = useCreatorPageScope('yours-creator-entry');
  const { height, fontScale } = useWindowDimensions();
  const reflow = expanded && fontScale >= 1.5;
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
  const [archiveScope, setArchiveScope] = useState<CreatorPageScope | null>(null);
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
  const openSpace = async (space: CreatorSpaceLink, screen?: 'events' | 'menu') => {
    const fresh = await spaces.refresh();
    if (!current()) return;
    const actual = fresh?.spaces.find(item => item.id === space.id && item.kind === space.kind);
    // Organization shortcuts belong to this verified identity, never a community
    // left selected by an earlier visit or a new page with different permissions.
    if (!actual || (screen && actual.legacy?.workspace !== 'organization')) { changed(); return; }
    prepareCreatorSpace(actual, owned!);
    go(screen ? managementRoute(screen) + '?fromManagementDirectory=1' : actual.route);
  };
  const entries: Entry[] = [];
  if (!spaces.error) {
    for (const space of spaces.data?.spaces ?? []) entries.push({
      key: 'space:' + space.id, title: space.name, subtitle: managedSpaceStatus(space), action: 'Manage ' + space.name,
      kind: space.kind, archived: space.legacy?.status === 'archived', open: () => openSpace(space),
      shortcuts: space.legacy?.workspace === 'organization' ? [
        { key: 'events:' + space.id, title: 'Events', subtitle: 'Create an event or manage an existing one', action: 'Events for ' + space.name, open: () => openSpace(space, 'events') },
        { key: 'settings:' + space.id, title: 'Settings', subtitle: 'Edit your organization and manage payouts', action: 'Organization settings for ' + space.name, open: () => openSpace(space, 'menu') },
      ] : undefined,
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
  const active = entries.filter(entry => !entry.archived);
  const archived = entries.filter(entry => entry.archived);
  const hasCommunity = (spaces.data?.spaces ?? []).some(space => space.kind === 'community' && (!space.legacy || !!space.legacy.communityId));
  const visible = active.slice(0, height < 700 || fontScale > 1.2 ? 1 : 2);
  const disabled = busy || loading || !current();
  const renderEntry = (entry: Entry) => <View key={entry.key} style={s.card}>
    <Pressable cssInterop={false} accessibilityRole="button" accessibilityLabel={entry.action} accessibilityHint={entry.subtitle}
      disabled={disabled} accessibilityState={{ disabled }} onPress={() => { void run(entry); }}
      style={({ pressed }) => [s.entry, pressed && s.pressed]}>
      {expanded && !reflow && entry.kind && <View style={s.identity} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {entry.kind === 'community' ? <Users size={22} color={Colors.terracotta} /> : <Building2 size={22} color={Colors.terracotta} />}
      </View>}
      <View style={s.copy}><Text style={[s.title, { fontFamily: fonts.medium }]}>{entry.title}</Text>
        <Text style={[s.subtitle, { fontFamily: fonts.regular }]}>{expanded && entry.kind ? entry.subtitle.replace(/^(Community|Organization) · /, '') : entry.subtitle}</Text></View>
      {busy && opening.key === entry.key ? <ActivityIndicator accessibilityLabel="Opening management" color={Colors.terracotta} /> : !reflow && <ChevronRight size={18} color={C.muted} />}
    </Pressable>
    {expanded && entry.shortcuts && <View style={[s.shortcuts, reflow && s.shortcutsStacked]}>
      {entry.shortcuts.map(shortcut => <Pressable cssInterop={false} key={shortcut.key} accessibilityRole="button" accessibilityLabel={shortcut.action}
        accessibilityHint={shortcut.subtitle} disabled={disabled} accessibilityState={{ disabled }}
        onPress={() => { void run(shortcut); }} style={({ pressed }) => [s.shortcut, reflow && s.shortcutStacked, pressed && s.pressed]}>
        <Text numberOfLines={1} style={[s.link, { fontFamily: fonts.medium }]}>{shortcut.title}</Text>
        {busy && opening.key === shortcut.key && <ActivityIndicator accessibilityLabel="Opening management" color={Colors.terracotta} />}
      </Pressable>)}
    </View>}
  </View>;
  const createLink = (kind: 'community' | 'event', title: string) => <Pressable cssInterop={false} accessibilityRole="button"
    accessibilityLabel={title} disabled={disabled} accessibilityState={{ disabled }} style={({ pressed }) => [s.linkTarget, pressed && s.pressed]}
    onPress={() => go('/creator/start?kind=' + kind)}><Text style={[s.link, { fontFamily: fonts.medium }]}>{title}</Text></Pressable>;
  return <View style={[s.wrap, expanded && s.expanded]}>
    {!expanded && <Text accessibilityRole="header" style={[s.heading, { fontFamily: fonts.semibold }]}>You manage</Text>}
    {expanded && <Text style={[s.intro, { fontFamily: fonts.regular }]}>Choose what you want to manage.</Text>}
    {!expanded && visible.map(renderEntry)}
    {expanded && (['community', 'organization'] as const).map(kind => {
      const group = active.filter(entry => entry.kind === kind);
      if (!group.length) return null;
      return <View key={kind} style={s.section}>
        <Text accessibilityRole="header" style={[s.sectionTitle, reflow && s.sectionTitleReflow, { fontFamily: reflow ? fonts.medium : fonts.display }]}>{kind === 'community' ? 'Communities' : 'Organizations'}</Text>
        <Text style={[s.sectionHint, { fontFamily: fonts.regular }]}>{kind === 'community' ? 'Your groups, members and conversations.' : 'Your organization’s events and settings.'}</Text>
        {group.map(renderEntry)}
        {kind === 'community' && createLink('community', hasCommunity ? 'Start another community' : 'Start a community')}
      </View>;
    })}
    {expanded && archived.length > 0 && <View style={s.secondary}>
      <Pressable cssInterop={false} accessibilityRole="button" accessibilityLabel="Archived communities" accessibilityState={{ expanded: archiveScope === owned }}
        onPress={() => setArchiveScope(archiveScope === owned ? null : owned)} style={s.archiveToggle}>
        <Text style={[s.subtitle, { fontFamily: fonts.medium }]}>Archived ({archived.length})</Text>
        {archiveScope === owned ? <ChevronDown size={18} color={C.muted} /> : <ChevronRight size={18} color={C.muted} />}
      </Pressable>
      {archiveScope === owned && <><Text style={[s.subtitle, { fontFamily: fonts.regular }]}>These communities are archived. Open one to view its management tools.</Text>{archived.map(renderEntry)}
        {!active.some(entry => entry.kind === 'community') && createLink('community', 'Start another community')}</>}
    </View>}
    {expanded && active.some(entry => !entry.kind) && <View style={s.secondary}>
      <Text accessibilityRole="header" style={[s.heading, { fontFamily: fonts.semibold }]}>Invitations & applications</Text>
      {active.filter(entry => !entry.kind).map(renderEntry)}
    </View>}
    {loading && !entries.length && <ActivityIndicator accessibilityLabel="Loading your management tools" color={Colors.terracotta} />}
    {failed && <View><Text style={[s.subtitle, { fontFamily: fonts.regular }]}>Some management details couldn’t load.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Retry management details" style={s.linkTarget} disabled={loading || busy}
        onPress={() => { if (account.error) void account.retry().catch(() => undefined); else { void spaces.refresh().catch(() => undefined); void applications.refresh().catch(() => undefined); } }}>
        <Text style={[s.link, { fontFamily: fonts.medium }]}>Try again</Text>
      </Pressable></View>}
    {notice?.scope === owned && <Text accessibilityRole="alert" style={[s.subtitle, { fontFamily: fonts.regular }]}>{notice.text}</Text>}
    {!expanded && entries.length > visible.length && <Pressable accessibilityRole="button" accessibilityLabel="See everything you manage" style={s.linkTarget} onPress={() => go('/(tabs)/friends/manage')}>
      <Text style={[s.link, { fontFamily: fonts.medium }]}>See all ({entries.length})</Text></Pressable>}
    {expanded && !loading && !failed && !entries.length && <Text style={[s.intro, { fontFamily: fonts.regular }]}>Start a community or create an event. Your setup and management tools will stay here.</Text>}
    {expanded && !loading && !failed && !entries.length && <View style={s.secondary}>
      {createLink('community', 'Start a community')}{createLink('event', 'Create an event')}
    </View>}
  </View>;
}
const s = StyleSheet.create({
  wrap: { paddingHorizontal: 20, paddingBottom: 12, gap: 8 }, expanded: { paddingHorizontal: 0 },
  heading: { ...T.caption, color: C.ink }, intro: { ...T.body, color: C.muted, marginBottom: 8 },
  card: { borderRadius: 16, backgroundColor: Colors.cardBg, borderWidth: 1, borderColor: G.goldEdge, overflow: 'hidden' },
  entry: { padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 72 },
  identity: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.inputBg },
  section: { gap: 10, marginTop: 8, marginBottom: 8 }, sectionTitle: { ...T.pageSection, color: C.ink }, sectionHint: { ...T.caption, color: C.muted, marginBottom: 2 },
  sectionTitleReflow: { ...T.body },
  secondary: { marginTop: 12, gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line, paddingTop: 8 },
  shortcuts: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  shortcutsStacked: { flexDirection: 'column' },
  shortcut: { flex: 1, minHeight: 48, paddingHorizontal: 12, paddingVertical: 12, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 8 },
  shortcutStacked: { flex: 0, justifyContent: 'flex-start' },
  archiveToggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  copy: { flex: 1, minWidth: 0, gap: 4 }, title: { ...T.title, color: C.ink }, subtitle: { ...T.caption, color: C.muted },
  pressed: { opacity: 0.8 }, linkTarget: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  link: { ...T.caption, color: Colors.terracotta },
});
