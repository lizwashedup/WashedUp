import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { AfterglowType as T, FontSizes, LineHeights } from '../../../constants/Typography';
import { useCreatorPageScope } from '../../../hooks/useCreatorPageScope';
import { useCreatorPageRead } from '../../../hooks/useCreatorPageRead';
import { useAfterglowFonts } from '../../../hooks/useAfterglowFonts';
import { loadCreatorPageWorkspace } from '../../../lib/creatorPageWorkspace';
import type { CreatorPageScope } from '../../../lib/creatorPageReview';
import { checkPageUpdate, editPreparedPageUpdate, preparePageUpdate, readPendingPageUpdate,
  readRecentPageUpdates, resolvePageUpdate, sendPageUpdate, type PageUpdateReceipt } from '../../../lib/creatorPageUpdates';
import { PageAction as SharedPageAction, PageFrame, pageStyles as s } from './PageFrame';
import { requestWithDeadline } from '../../../lib/requestWithDeadline';
import { AfterglowColors as C, CreatorSurfaceColors } from '../../../constants/Colors';

const queuedCopy = (count: number) => count === 0 ? 'Saved. No eligible followers were queued for this update.'
  : `Queued for ${count} ${count === 1 ? 'follower' : 'followers'}. This does not confirm delivery.`;
const PageAction = (props: React.ComponentProps<typeof SharedPageAction>) => <SharedPageAction {...props} singleLine />;

export default function CreatorPageUpdatesScreen({ pageId }: { pageId: string }) {
  const { scope: accountScope, account } = useCreatorPageScope(pageId);
  const visit = useMemo(() => ({ accountScope, pageId, mounted: true }), [accountScope, pageId]);
  const currentVisit = useRef(visit);
  currentVisit.current = visit;
  const scope = useMemo(() => accountScope ? { userId: accountScope.userId,
    isCurrent: () => visit.mounted && currentVisit.current === visit && accountScope.isCurrent() } : null,
  [accountScope, visit]);
  useEffect(() => { visit.mounted = true; return () => { visit.mounted = false; }; }, [visit]);
  const { fonts } = useAfterglowFonts(true, 'creator');
  const { fontScale } = useWindowDimensions();
  const read = useCallback(async (owned: CreatorPageScope) => {
    const pending = await readPendingPageUpdate(pageId, owned);
    const page = await loadCreatorPageWorkspace(pageId, owned);
    const receipt = pending ? await checkPageUpdate(pending, owned) : null;
    return { pending, page, receipt };
  }, [pageId]);
  const saved = useCreatorPageRead(scope, read);
  const historyRead = useCallback((owned: CreatorPageScope) => readRecentPageUpdates(pageId, owned), [pageId]);
  const history = useCreatorPageRead(scope, historyRead);
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ scope: CreatorPageScope; body: string }>();
  const [activity, setActivity] = useState<{ scope: CreatorPageScope; busy?: boolean; uncertain?: boolean;
    message?: string; receipt?: PageUpdateReceipt }>();
  type Snapshot = Awaited<ReturnType<typeof read>>;
  const [snapshot, setSnapshot] = useState<{ scope: CreatorPageScope; data: Snapshot }>();
  type Operation = { scope: CreatorPageScope; live: boolean; settled: boolean };
  const lock = useRef<Operation | null>(null);
  // A deadline retires continuations, never the service's serialized physical write.
  const outstanding = useRef<Operation | null>(null);
  const own = activity?.scope === scope ? activity : undefined;
  const body = draft?.scope === scope ? draft.body : '';
  const data = snapshot?.scope === scope ? snapshot.data : saved.data;
  const readError = snapshot?.scope === scope ? undefined : saved.error;
  const readLoading = snapshot?.scope === scope ? false : saved.loading;
  const pending = data?.pending;
  const confirmed = own?.receipt ?? data?.receipt;
  const page = data?.page;
  const published = page?.publication;
  const canCreate = !!published && published.page_kind === 'organization' && published.owner_id === scope?.userId;
  const busy = !!own?.busy;
  const ready = !!scope && !busy && !readLoading && !readError && !account.isLoading && !account.error && !own?.uncertain;
  const latest = useRef({ ready, body, pending, confirmed, data, canCreate });
  latest.current = { ready, body, pending, confirmed, data, canCreate };
  const canAct = () => !!scope?.isCurrent() && latest.current.ready && lock.current?.scope !== scope &&
    !(outstanding.current?.scope === scope && !outstanding.current.settled);
  const run = async (action: (owned: CreatorPageScope) => Promise<void>, mutation = true) => {
    if (!scope?.isCurrent() || lock.current?.scope === scope ||
      (mutation && outstanding.current?.scope === scope && !outstanding.current.settled)) return;
    const operation: Operation = { scope, live: true, settled: false };
    const owned = { userId: scope.userId, isCurrent: () => operation.live && scope.isCurrent() };
    lock.current = operation;
    if (mutation) outstanding.current = operation;
    setActivity(old => ({ ...(old?.scope === scope ? old : {}), scope, busy: true, ...(mutation ? { message: undefined } : {}) }));
    const task = Promise.resolve().then(() => { if (owned.isCurrent()) return action(owned); });
    void task.then(() => { operation.settled = true; }, () => { operation.settled = true; });
    try { await requestWithDeadline(task, mutation ? 25000 : 12000); }
    catch {
      if (owned.isCurrent()) setActivity(old => ({ ...(old?.scope === scope ? old : {}), scope, busy: true,
        uncertain: true, message: latest.current.confirmed
          ? 'Your update is saved. Check its local record before starting another.'
          : 'The result is not confirmed. Check this update before continuing; nothing will be sent again automatically.' }));
    } finally {
      operation.live = false;
      if (lock.current === operation) lock.current = null;
      if (scope.isCurrent()) setActivity(old => old?.scope === scope ? { ...old, busy: false } : old);
    }
  };
  const check = () => void run(async owned => {
    const result = await read(owned);
    if (!owned.isCurrent()) return;
    const unfinished = outstanding.current?.scope === scope && !outstanding.current.settled;
    // An empty read cannot prove an outstanding storage write never happened.
    if (!unfinished || result.pending || result.receipt) setSnapshot({ scope: scope!, data: result });
    setActivity({ scope: scope!, receipt: result.receipt ?? latest.current.confirmed ?? undefined, uncertain: unfinished,
      message: unfinished ? 'The original update is still finishing on this device. Check again before editing or sending.'
        : result.pending && !result.receipt && result.pending.stage === 'dispatched'
          ? 'No saved result was found. You can check again or retry this exact update.' : 'Saved update checked.' });
  }, false);
  const send = () => {
    if (!canAct() || !latest.current.pending || (latest.current.pending.stage === 'prepared' && !latest.current.canCreate)) return;
    const original = latest.current.pending;
    void run(async owned => {
      const receipt = await sendPageUpdate(original, owned);
      if (!owned.isCurrent()) return;
      setActivity({ scope: scope!, receipt });
      void history.refresh().catch(() => undefined);
    });
  };
  const recovery = own?.message ? <View style={look.recovery}>
    <Text accessibilityRole="alert" style={[s.small, { fontFamily: fonts.regular }]}>{own.message}</Text>
    <PageAction quiet compact title={busy ? 'Checking…' : 'Check update'} disabled={busy || readLoading} onPress={check} />
  </View> : null;
  return <PageFrame title="Page updates" busy={busy}>
    <View style={look.identity}>
      {published && <View style={look.artwork}>{published.photo_url && failedPhoto !== published.photo_url
        ? <Image source={{ uri: published.photo_url }} accessibilityLabel="Page photo" contentFit="cover" style={look.photo}
            onError={() => setFailedPhoto(published.photo_url)} />
        : <Text accessible={false} style={[look.monogram, { fontFamily: fonts.display }]}>{published.name.slice(0, 1).toUpperCase()}</Text>}</View>}
      <View style={look.identityText}>
        <Text accessibilityRole="header" accessibilityLabel={published?.name ?? 'Page updates'} numberOfLines={fontScale > 1.3 ? undefined : 2} style={[look.name, { fontFamily: fonts.display }]}>{published?.name ?? 'Page updates'}</Text>
        <Text style={[look.meta, { fontFamily: fonts.regular }]}>For your organization’s followers</Text>
      </View>
    </View>
    <Text style={[look.intro, { fontFamily: fonts.regular }]}>Share news, an invitation or something to look forward to.</Text>
    {(account.isLoading || readLoading) && !data && <ActivityIndicator color={C.clay} accessibilityLabel="Loading saved update" />}
    {(readError || account.error) && <View style={look.panel}>
      <Text accessibilityRole="alert" style={[s.small, { fontFamily: fonts.regular }]}>{account.error ? 'Could not check your account.' : readError}</Text>
      <PageAction quiet compact title={account.error ? 'Check account' : 'Check update'} disabled={busy || readLoading}
        onPress={account.error ? () => { if (visit.mounted && currentVisit.current === visit) void account.retry(); } : check} />
    </View>}
    {confirmed ? <View style={look.panel}>
      <Text accessibilityRole="header" style={[s.rowTitle, { fontFamily: fonts.semibold }]}>Update saved</Text>
      <Text style={[look.updateBody, { fontFamily: fonts.regular }]}>{confirmed.body}</Text>
      <Text accessibilityRole="alert" style={[s.small, { fontFamily: fonts.regular }]}>{queuedCopy(confirmed.queued_recipient_count)}</Text>
      <PageAction quiet compact title="New update" disabled={!ready || !canCreate} onPress={() => {
        if (!canAct() || !latest.current.confirmed || !latest.current.canCreate) return;
        if (!latest.current.pending) {
          setDraft({ scope: scope!, body: '' });
          setSnapshot({ scope: scope!, data: { ...latest.current.data!, pending: null, receipt: null } });
          setActivity({ scope: scope! });
          return;
        }
        void run(async owned => {
          const result = await resolvePageUpdate(latest.current.pending!, owned);
          if (!owned.isCurrent()) return;
          if (!result.cleared) { setActivity({ scope: scope!, receipt: result.receipt, uncertain: true, message: 'Your update is saved. Check again to finish clearing its local recovery record.' }); return; }
          setDraft({ scope: scope!, body: '' });
          setSnapshot({ scope: scope!, data: { ...latest.current.data!, pending: null, receipt: null } });
          setActivity({ scope: scope! });
        });
      }} />
      {recovery}
    </View> : pending ? <View style={look.panel}>
      <Text accessibilityRole="header" style={[s.rowTitle, { fontFamily: fonts.semibold }]}>{pending.stage === 'prepared' ? 'Review your update' : 'Check your update'}</Text>
      <Text style={[look.updateBody, { fontFamily: fonts.regular }]}>{pending.body}</Text>
      <Text style={[s.small, { fontFamily: fonts.regular }]}>{pending.stage === 'prepared'
        ? 'Send this update to people following this page. Review the text before sending.'
        : 'The result is unconfirmed. Retrying uses the same saved update so it cannot create a second copy.'}</Text>
      <View style={look.actions}><PageAction primary compact title={busy ? 'Working…' : pending.stage === 'prepared' ? 'Send update' : 'Retry update'}
        disabled={!ready || (pending.stage === 'prepared' && !canCreate)} onPress={send} />
      {(pending.stage === 'dispatched' && !readError && !account.error && !own?.message) && <PageAction quiet compact title="Check update" disabled={busy || readLoading} onPress={check} />}
      {pending.stage === 'prepared' && <PageAction quiet compact title="Edit update" disabled={!ready} onPress={() => {
        if (!canAct() || !latest.current.pending || latest.current.pending.stage !== 'prepared') return;
        setDraft({ scope: scope!, body: latest.current.pending.body });
        void run(async owned => {
          const original = await editPreparedPageUpdate(latest.current.pending!, owned);
          if (!owned.isCurrent()) return;
          setDraft({ scope: scope!, body: original });
          setSnapshot({ scope: scope!, data: { ...latest.current.data!, pending: null, receipt: null } });
        });
      }} />}</View>
      {recovery}
    </View> : canCreate ? <View style={look.panel}>
      <Text style={[s.rowTitle, { fontFamily: fonts.semibold }]}>Write an update</Text>
      <TextInput accessibilityLabel="Update for this page’s followers" value={body}
        onChangeText={value => { if (canAct()) setDraft({ scope: scope!, body: value }); }}
        editable={ready} placeholder="What would you like your followers to know?" placeholderTextColor={C.muted}
        multiline maxLength={2000} style={[look.input, { fontFamily: fonts.regular }]} />
      <Text style={[look.count, { fontFamily: fonts.regular }]}>{body.length}/2000</Text>
      <PageAction compact primary title="Review update" disabled={!ready || !body.trim()} onPress={() => {
        if (!canAct() || !latest.current.canCreate || !latest.current.body.trim()) return;
        const originalBody = latest.current.body;
        void run(async owned => {
          const prepared = await preparePageUpdate(pageId, originalBody, owned);
          if (owned.isCurrent()) setSnapshot({ scope: scope!, data: { ...latest.current.data!, pending: prepared, receipt: null } });
        });
      }} />
      {recovery}
    </View> : !account.isLoading && !readLoading && !readError && !account.error &&
      <Text style={[s.body, { fontFamily: fonts.regular }]}>Updates are available to the owner of a published organization page.</Text>}
    {canCreate && <Text style={[look.delivery, { fontFamily: fonts.regular }]}>Updates appear in WashedUp. Push alerts follow each person’s notification settings.</Text>}
    <View style={look.historyHeading}>
      <Text accessibilityRole="header" style={[s.rowTitle, { fontFamily: fonts.semibold }]}>Recent updates</Text>
      <PageAction quiet compact title="Refresh" accessibilityLabel="Refresh recent updates" disabled={history.loading}
        onPress={() => { if (scope?.isCurrent()) void history.refresh().catch(() => undefined); }} />
    </View>
    {history.loading && !history.data && <ActivityIndicator color={C.clay} accessibilityLabel="Loading recent updates" />}
    {history.error && <Text accessibilityRole="alert" style={[s.small, { fontFamily: fonts.regular }]}>Recent updates could not be refreshed. Your saved update is separate.</Text>}
    {history.data?.length === 0 && <Text style={[look.intro, { fontFamily: fonts.regular }]}>Your sent updates will appear here.</Text>}
    {history.data?.map(update => <View key={update.id} style={look.historyRow}>
      <Text style={[look.meta, { fontFamily: fonts.regular }]}>{new Date(update.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</Text>
      <Text style={[look.historyBody, { fontFamily: fonts.regular }]}>{update.body}</Text>
      <Text style={[look.meta, { fontFamily: fonts.regular }]}>{update.queued_recipient_count === 0 ? 'No eligible followers queued' : `${update.queued_recipient_count} ${update.queued_recipient_count === 1 ? 'follower' : 'followers'} queued`}</Text>
    </View>)}
    {!!history.data?.length && <Text style={[look.delivery, { fontFamily: fonts.regular }]}>Showing up to 25 recent updates. Counts show queued followers, not confirmed delivery.</Text>}
  </PageFrame>;
}

const look = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  artwork: { width: 56, height: 56, borderRadius: 12, overflow: 'hidden', backgroundColor: C.avatar, alignItems: 'center', justifyContent: 'center' },
  photo: { width: 56, height: 56 },
  monogram: { ...T.identity, color: C.clay },
  identityText: { flex: 1, minWidth: 0, gap: 3 },
  name: { fontSize: FontSizes.displayMD, lineHeight: LineHeights.displayMD, color: C.ink },
  meta: { ...T.caption, color: C.muted },
  intro: { ...T.body, color: C.muted, marginBottom: 16 },
  panel: { backgroundColor: C.white, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line, padding: 16, gap: 12, marginBottom: 12 },
  recovery: { backgroundColor: CreatorSurfaceColors.sunsetGoldLight, borderColor: CreatorSurfaceColors.goldEdge, borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  updateBody: { ...T.message, color: C.ink },
  input: { ...T.message, color: C.ink, minHeight: 136, padding: 0, textAlignVertical: 'top' },
  count: { ...T.caption, color: C.muted, textAlign: 'right' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  delivery: { ...T.caption, color: C.muted, marginBottom: 8 },
  historyHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 16 },
  historyRow: { paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line, gap: 7 },
  historyBody: { ...T.body, color: C.ink },
});
