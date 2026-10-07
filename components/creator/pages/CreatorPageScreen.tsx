import { ScaledText as Text } from '../../ScaledText';
import { eventCategories, validEventCategories } from '../../../lib/eventCategories';
import { PageCover } from './PageCover';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Users, ExternalLink, ClipboardList, FileText, Megaphone, Pencil, Plus } from 'lucide-react-native';
import { CreatorEventRow } from './CreatorEventRow';
import { createCreatorPageEventDraft, CreatorPageScopeExpired, type CreatorPageScope } from '../../../lib/creatorPageReview';
import { requestWithDeadline } from '../../../lib/requestWithDeadline';
import { loadCreatorPageWorkspace, creatorPagePhase } from '../../../lib/creatorPageWorkspace';
import { readCreatorPageEventAttempt, prepareCreatorPageEventAttempt, clearCreatorPageEventAttempt,
  type CreatorPageEventAttempt } from '../../../lib/creatorPageEventAttempt';
import { CreatorEventDraftFields } from './CreatorEventDraftFields';
import { GoldSurfaceFill } from '../GoldSurfaceFill';
import { useCreatorPageScope } from '../../../hooks/useCreatorPageScope';
import { useCreatorPageRead } from '../../../hooks/useCreatorPageRead';
import { useAfterglowFonts } from '../../../hooks/useAfterglowFonts';
import { PageFrame, PageAction, pageStyles as s } from './PageFrame';
import Colors, { AfterglowColors as C, CreatorSurfaceColors, SceneDetailColors } from '../../../constants/Colors';
import { AfterglowType } from '../../../constants/Typography';

/** A timed-out operation cannot continue into a later read, write or receipt. */
async function withinPageVisit<T>(base: CreatorPageScope, work: (owned: CreatorPageScope) => Promise<T>, milliseconds: number) {
  let active = true;
  const owned = { userId: base.userId, isCurrent: () => active && base.isCurrent() };
  try { return await requestWithDeadline(work(owned), milliseconds); }
  finally { active = false; }
}

export default function CreatorPageScreen({ pageId }: { pageId: string }) {
  const { scope, account } = useCreatorPageScope(pageId);
  const { fonts } = useAfterglowFonts(true, 'creator');
  const [brokenPhoto, setBrokenPhoto] = useState<string | null>(null);
  const read = useCallback((base: CreatorPageScope) => withinPageVisit(base, async owned => {
    const page = await loadCreatorPageWorkspace(pageId, owned);
    if (!owned.isCurrent()) throw new CreatorPageScopeExpired();
    const attempt = await readCreatorPageEventAttempt(pageId, owned);
    if (!owned.isCurrent()) throw new CreatorPageScopeExpired();
    return { page, attempt };
  }, 12_000), [pageId]);
  const { data, error, loading, refresh } = useCreatorPageRead(scope, read);
  const [activity, setActivity] = useState<{ scope: CreatorPageScope; message?: string; busy?: boolean; uncertain?: boolean }>();
  const lock = useRef<CreatorPageScope | null>(null);
  const uncertainScope = useRef<CreatorPageScope | null>(null);
  const [prepare, setPrepare] = useState(false);
  const [preview, setPreview] = useState<'draft' | 'submitted' | null>(null);
  const [title, setTitle] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  useEffect(() => { setPrepare(false); setPreview(null); setTitle(''); }, [scope]);
  const ownedActivity = activity?.scope === scope ? activity : undefined;
  const busy = !!ownedActivity?.busy;
  const page = error || account.error ? undefined : data?.page;
  const phase = page && creatorPagePhase(page);
  const latest = page?.submissions[0];
  const ready = !!scope?.isCurrent() && !account.error && !busy && !loading && !error && !ownedActivity?.uncertain;
  const openEvent = (eventId: string) => {
    if (scope?.isCurrent() && ready) router.push(`/creator/event-form?id=${eventId}&pageId=${pageId}` as never);
  };
  const viewEvent = (eventId: string) => {
    if (scope?.isCurrent() && ready && page?.events.some(event => event.id === eventId && event.status === 'Live')) {
      router.push(`/event/${eventId}` as never);
    }
  };
  const run = async (action: (owned: CreatorPageScope) => Promise<void>, finishConfirmed?: () => boolean) => {
    if (!scope?.isCurrent() || lock.current === scope || uncertainScope.current === scope || !ready) return;
    const owned = scope;
    lock.current = owned;
    setActivity({ scope: owned, busy: true });
    let failed = false;
    try { await withinPageVisit(owned, action, 25_000); }
    catch { failed = true; }
    finally {
      if (lock.current === owned) lock.current = null;
      if (owned.isCurrent()) {
        if (finishConfirmed?.()) setActivity({ scope: owned });
        else if (failed) {
          uncertainScope.current = owned;
          setActivity({ scope: owned, uncertain: true,
            message: 'We could not confirm the result. Check the saved status before continuing.' });
        } else setActivity(old => old?.scope === owned ? { ...old, busy: false } : old);
      }
    }
  };
  const checkSaved = () => {
    if (!scope?.isCurrent() || busy) return;
    const owned = scope;
    void refresh().then(result => {
      if (result && owned.isCurrent()) {
        uncertainScope.current = null;
        setActivity({ scope: owned });
      }
    }).catch(() => undefined);
  };
  const prepareEvent = (pending?: CreatorPageEventAttempt) => {
    let confirmedEventId: string | undefined;
    return run(async owned => {
      const attempt = pending ?? await prepareCreatorPageEventAttempt(pageId, title, eventCategories({categories},page?.draft.page_kind==='community')[0], owned, eventCategories({categories},page?.draft.page_kind==='community'));
      if (!owned.isCurrent()) return;
      const eventId = pending && page?.events.some(event => event.id === pending.eventId)
        ? pending.eventId : await createCreatorPageEventDraft(attempt, owned);
      if (!owned.isCurrent()) return;
      confirmedEventId = eventId;
      // Optional bookkeeping must never hide a confirmed creation receipt.
      try { await withinPageVisit(owned, cleanup => clearCreatorPageEventAttempt(attempt, cleanup), 3_000); }
      catch { /* The original marker can be resolved from the saved event on return. */ }
    }, () => {
      if (!confirmedEventId) return false;
      openEvent(confirmedEventId);
      return true;
    });
  };
  const heading = ({ published: 'Your page is live.', approved: 'Ready to publish.', submitted: 'In review.',
    needs_more_info: 'A little more from you.', declined: 'Your review is back.', changed: 'Your working copy has changed.', draft: 'Make it yours.' } as const)[phase ?? 'draft'];
  const status = ({ published: 'Published', approved: 'Approved · not published', submitted: 'Submitted · private',
    needs_more_info: 'Changes requested · private', declined: 'Not approved · private', changed: 'Updated private draft', draft: 'Private draft' } as const)[phase ?? 'draft'];
  const identityData = page?.publication ? { ...page.publication, cover_media_id: page.publishedCoverMediaId } : page?.draft.page_data;
  const previewData = preview === 'submitted' ? latest?.page_snapshot : identityData;
  const editApproved = () => { if (scope?.isCurrent() && ready) router.push(`/creator/page-edit?id=${pageId}&mode=approved` as never); };
  const needsSetup = phase === 'draft' || phase === 'changed' || phase === 'needs_more_info' || phase === 'declined';
  const continueSetup = () => { if (scope?.isCurrent() && ready && needsSetup) router.push(`/creator/page-edit?id=${pageId}` as never); };
  return <PageFrame busy={busy} onBack={preview ? () => setPreview(null) : prepare ? () => setPrepare(false) : () => router.dismissTo('/creator/pages' as never)}
    contentKey={`${preview ?? (prepare ? 'event' : 'page')}:${ownedActivity?.uncertain || error || account.error ? 'recovery' : 'content'}`}
    title={preview ? 'Page preview' : prepare ? 'New event' : page ? page.draft.page_kind === 'community' ? 'Your community' : 'Your organization' : 'Creator space'} footer={page && prepare ?
      <PageAction primary title="Continue" disabled={!ready || (!data?.attempt && !title.trim())} onPress={() => void prepareEvent(data?.attempt ?? undefined)} /> : page && !preview && phase === 'approved' ?
      <PageAction primary title="Preview & publish" disabled={!ready} onPress={editApproved} /> : page && !prepare && needsSetup && preview !== 'submitted' ?
      <PageAction primary singleLine title="Continue setup" disabled={!ready} onPress={continueSetup} /> : undefined}>
    {(account.isLoading || loading) && !page && <ActivityIndicator color={C.clay} accessibilityLabel="Loading page" />}
    {(error || account.error) && <View style={[s.notice, look.recoveryNotice]}>
      <GoldSurfaceFill />
      <Text accessibilityRole="alert" style={[s.small, { fontFamily: fonts.regular, color: C.ink }]}>{error || 'Could not check your account.'}</Text>
      <PageAction primary compact singleLine title="Try again" onPress={() => { if (account.error) void account.retry(); else checkSaved(); }} />
    </View>}
    {!loading && !account.isLoading && !error && !account.error && (!scope || data?.page === null) &&
      <Text style={[s.body, { fontFamily: fonts.regular }]}>This page is unavailable for this account.</Text>}
    {ownedActivity?.message && <View style={[s.notice, look.recoveryNotice]}>
      <GoldSurfaceFill />
      <Text accessibilityRole="alert" style={[s.small, { fontFamily: fonts.regular, color: C.ink }]}>{ownedActivity.message}</Text>
      {ownedActivity.uncertain && <PageAction primary compact singleLine title="Check saved status" disabled={busy || loading} onPress={checkSaved} />}
    </View>}
    {page && preview && previewData ? <>
      <Text style={[s.eyebrow, { fontFamily: fonts.semibold }]}>{preview === 'submitted' ? `SUBMITTED VERSION ${latest?.revision}` : page.publication ? 'PUBLISHED PAGE' : 'PRIVATE WORKING COPY'}</Text>
      <Text accessibilityRole="header" style={[look.name, { fontFamily: fonts.display }]}>{String(previewData.name || 'Untitled page')}</Text>
      <Text style={[s.body, { fontFamily: fonts.regular }]}>{String(previewData.purpose || '')}</Text>
      {typeof previewData.cover_media_id === 'string' && previewData.cover_media_id ? <PageCover pageId={pageId} mediaId={previewData.cover_media_id} scope={scope} /> : typeof previewData.photo_url === 'string' && !!previewData.photo_url && <Image source={{ uri: previewData.photo_url }}
        accessibilityLabel="Page cover" style={{ width: '100%', aspectRatio: 1 }} contentFit="contain" />}
      <Text style={[s.small, { fontFamily: fonts.regular }]}>{String(previewData.city || '')}</Text>
      <Text style={[s.small, { fontFamily: fonts.regular }]}>{page.draft.page_kind === 'organization' ? 'Organization · Events and followers' :
        ({ everyone: 'Community · Everyone', women_only: 'Community · Women only', men_only: 'Community · Men only', nonbinary_only: 'Community · Non-binary only' }[String(previewData.audience || 'everyone')] || 'Community')}</Text>
    </> : page && prepare ? <>
      <Text accessibilityRole="header" style={[look.formHeading, { fontFamily: fonts.display }]}>Bring people together.</Text>
      <Text style={[s.body, { fontFamily: fonts.regular }]}>Give your event a name.{'\n'}Next, add the details and choose when to publish.</Text>
      <CreatorEventDraftFields title={title} categories={categories} community={page?.draft.page_kind==='community'} ready={ready && !data?.attempt} onTitle={setTitle} onCategories={setCategories} />
    </> : page ? <>
      <View style={look.pageIdentity}>
      {(typeof identityData!.cover_media_id === 'string' && identityData!.cover_media_id) ||
        (typeof identityData!.photo_url === 'string' && identityData!.photo_url && brokenPhoto !== identityData!.photo_url) ? <View style={look.cover}>
        {typeof identityData!.cover_media_id === 'string' && identityData!.cover_media_id
          ? <PageCover pageId={pageId} mediaId={identityData!.cover_media_id} scope={scope} height={144} contentFit="cover" compactFallback />
          : <Image source={{ uri: String(identityData!.photo_url) }} style={look.photo} contentFit="cover" accessibilityLabel="Page cover"
              onError={() => setBrokenPhoto(String(identityData!.photo_url))} />}
      </View> : null}
      <LinearGradient colors={[SceneDetailColors.middle, SceneDetailColors.lower]} start={{x:0,y:0}} end={{x:1,y:1}} style={look.identity}>
        <Text style={[look.kind, { fontFamily: fonts.medium }]}>{page.draft.page_kind === 'organization' ? 'ORGANIZATION' : 'COMMUNITY'}</Text>
        <Text accessibilityRole="header" style={[look.name, look.identityName, { fontFamily: fonts.display }]}>{String(identityData!.name || 'Your page')}</Text>
        {!!identityData!.city && <Text style={[look.identityMeta, { fontFamily: fonts.regular }]}>{String(identityData!.city)}</Text>}
      </LinearGradient>
      </View>
      <View style={phase === 'published' ? look.publishedStatus : look.publication}>
      <Text style={[look.status, phase === 'published' && look.publishedLabel, { fontFamily: fonts.medium }]}>{status}{latest && phase !== 'published' ? ` · Version ${latest.revision}` : ''}</Text>
      {phase !== 'published' && <Text accessibilityRole="header" style={[look.statusHeading, { fontFamily: fonts.semibold }]}>{heading}</Text>}
      {phase !== 'published' && <Text style={[look.description, { fontFamily: fonts.regular }]}>{phase === 'approved'
        ? 'Your page is approved. Take one last look, then publish it for people to discover.'
        : phase === 'submitted' ? 'Your page is with the review team. It stays private until it’s approved and you choose to publish.'
        : phase === 'changed' ? 'The saved review belongs to an earlier version. This working copy needs its own review before publication.'
        : 'Your page is private. Continue setup to check your page details, preview it and submit it for review. After approval, you choose when to publish.'}</Text>}
      {latest?.applicant_message && <View style={s.notice}><Text style={[s.small, { fontFamily: fonts.regular }]}>{latest.applicant_message}</Text></View>}
      <PageAction quiet compact title="Preview page" onPress={() => setPreview('draft')} />
      </View>
      {phase === 'published' ? <View style={{marginTop:24,marginBottom:8}}>
        <PageAction quiet disclosure title="Events" disabled={!ready} onPress={() => {
          if(scope?.isCurrent() && ready) router.push(`/creator/page-events?id=${pageId}` as never);
        }} />
        <Text style={[look.description,{fontFamily:fonts.regular}]}>Create an event or manage your drafts and live events.</Text>
      </View> : <>
      <View style={look.eventsHeading}>
      <Text accessibilityRole="header" style={[look.sectionTitle, { fontFamily: fonts.semibold }]}>Your events</Text>
      <PageAction compact primary={!needsSetup} quiet={needsSetup} leadingIcon={<Plus size={18} color={needsSetup ? Colors.terracotta : Colors.white} strokeWidth={1.8}/>} title="New event" disabled={!ready || !!data?.attempt} onPress={() => setPrepare(true)} />
      </View>
      {!page.events.length && <Text style={[look.description, { fontFamily: fonts.regular }]}>Bring people together. Start your first event here.</Text>}
      {data?.attempt && <View style={s.notice}>
        <Text style={[s.small, { fontFamily: fonts.regular }]}>Continue your saved event attempt: {data.attempt.title}</Text>
        <PageAction title={page.events.some(e => e.id === data.attempt!.eventId) ? 'Open saved event' : 'Continue event draft'} disabled={!ready}
          onPress={() => void prepareEvent(data.attempt!)} />
      </View>}
      {page.events.map(event => <CreatorEventRow key={event.id} event={event} ready={ready} isCurrent={() => !!scope?.isCurrent()}
        editLabel={`Edit ${event.title}, ${event.status === 'Draft' ? 'private draft' : event.status}`}
        onEdit={() => openEvent(event.id)}
        onManage={() => { if (scope?.isCurrent() && ready) router.push(`/creator/event-summary?id=${event.id}&pageId=${pageId}` as never); }}
        onDuplicate={() => { if (scope?.isCurrent() && ready) router.push(`/creator/page-event-reuse?pageId=${pageId}&sourceEventId=${event.id}` as never); }}
        onView={event.status === 'Live' ? () => viewEvent(event.id) : undefined} />)}
      </>}
      <Text accessibilityRole="header" style={[look.section, { fontFamily: fonts.semibold }]}>Manage page</Text>
      <View style={look.management}>
      {(phase === 'approved' || phase === 'published') && <ManagementLink icon={Pencil} title="Edit page" disabled={!ready} onPress={editApproved} />}
      {phase === 'submitted' && <ManagementLink icon={Pencil} title="Edit private draft" disabled={!ready}
        onPress={() => { if (scope?.isCurrent() && ready) router.push(`/creator/page-edit?id=${pageId}` as never); }} />}
      {phase === 'published' && <ManagementLink icon={Users} title="Page & team" disabled={!ready} onPress={() => router.push(`/creator/page-team?id=${pageId}` as never)} />}
      {phase === 'published' && <ManagementLink icon={ExternalLink} title="View public page" disabled={!ready} onPress={() => {
        if (scope?.isCurrent() && ready) router.push((page.draft.page_kind === 'organization' ? `/organization/${pageId}?identity=page` : `/community/${pageId}`) as never);
      }} />}
      {phase === 'published' && page.draft.page_kind === 'organization' && <ManagementLink icon={Megaphone} title="Page updates" singleLine disabled={!ready}
        onPress={() => router.push(`/creator/page-updates?id=${pageId}` as never)} />}
      {phase === 'published' && page.draft.page_kind === 'community' && <ManagementLink icon={Users} title="Join requests" singleLine disabled={!ready}
        onPress={() => { if (scope?.isCurrent() && ready) router.push(`/creator/page-requests?id=${pageId}` as never); }} />}
      {page.draft.page_kind === 'community' && <ManagementLink icon={ClipboardList} title="Joining questions" singleLine disabled={!ready}
        onPress={() => router.push(`/creator/page-joining?id=${pageId}` as never)} />}
      {latest && <ManagementLink icon={FileText} title="Submitted version" accessibilityLabel={`View submitted version ${latest.revision}`} onPress={() => setPreview('submitted')} />}
      </View>
      {phase !== 'published' && <PageAction quiet compact title="Check review status" disabled={busy || loading} onPress={checkSaved} />}
    </> : null}
  </PageFrame>;
}


function ManagementLink({ icon: Icon, ...props }: React.ComponentProps<typeof PageAction> & { icon: typeof Users }) {
  return <View style={look.managementRow}>
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={look.managementIcon}>
      <Icon size={18} strokeWidth={1.5} color={C.muted} />
    </View>
    <View style={look.managementAction}><PageAction {...props} quiet disclosure /></View>
  </View>;
}

const look = StyleSheet.create({
  recoveryNotice: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: CreatorSurfaceColors.goldEdge, overflow: 'hidden' },
  pageIdentity: { borderRadius: 8, overflow: 'hidden' },
  cover: { height: 144, backgroundColor: Colors.inputBg },
  identity: { padding: 18, gap: 5 },
  identityName: { color: SceneDetailColors.text },
  identityMeta: { ...AfterglowType.caption, color: SceneDetailColors.supporting },
  kind: { ...AfterglowType.timestamp, color: SceneDetailColors.supporting, letterSpacing: 1.2 },
  photo: { width: '100%', height: 144 },
  name: { ...AfterglowType.pageTitle, color: C.ink },
  formHeading: { ...AfterglowType.identity, color: C.ink, marginBottom: 16 },
  publication: { paddingVertical: 16 },
  status: { ...AfterglowType.caption, color: C.muted, marginBottom: 10 },
  statusHeading: { ...AfterglowType.pageSection, color: C.ink, marginBottom: 8 },
  description: { ...AfterglowType.body, color: C.muted, marginBottom: 12 },
  section: { ...AfterglowType.contextTitle, color: C.ink, marginTop: 24, marginBottom: 8 },
  sectionTitle: { ...AfterglowType.contextTitle, color: C.ink, flexShrink: 1, maxWidth: '100%' },
  eventsHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginVertical: 12 },
  publishedStatus: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.subtleLine, paddingVertical: 2 },
  publishedLabel: { marginBottom: 0 },
  management: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.subtleLine, marginBottom: 8 },
  managementRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.subtleLine },
  managementIcon: { width: 22, height: 28, justifyContent: 'center', alignItems: 'center' },
  managementAction: { flex: 1, minWidth: 0 },
});
