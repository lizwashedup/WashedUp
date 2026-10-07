import { ScaledText as Text } from '../../ScaledText';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { ImagePlus } from 'lucide-react-native';
import { useCreatorPageScope } from '../../../hooks/useCreatorPageScope';
import { useAfterglowFonts } from '../../../hooks/useAfterglowFonts';
import { type CreatorPageScope } from '../../../lib/creatorPageReview';
import {
  loadCreatorPageContentEditor, persistCreatorPageContentDraft, readCreatorPageContentDraft,
  dispatchCreatorPageContent, checkCreatorPageContentAttempt, reconcileCreatorPageContent,
  creatorPageContentBusy, creatorPageContentProblems, 
  type CreatorPageContentDraft, type CreatorPageContentState, type CreatorPageContent,
} from '../../../lib/creatorPageContent';
import {
  pickPageCover, uploadPageCover, checkPageCover, readPageCoverAttempt,
  clearPageCoverAttempt, resetUnreadablePageCoverAttempt, type PageCoverAttempt,
} from '../../../lib/creatorPageMedia';
import { requestWithDeadline, RequestDeadlineError } from '../../../lib/requestWithDeadline';
import { Field } from '../ApplyFormKit';
import { useApplicationFormGuidance } from '../useApplicationFormGuidance';
import { CommunityClassificationFields, CommunityClassificationSummary } from './CommunityClassificationFields';
import { communityClassificationProblems } from '../../../lib/communityClassification';
import { PageCover } from './PageCover';
import { PageFrame, PageAction, pageStyles as s } from './PageFrame';
import Colors, { AfterglowColors as C, CreatorSurfaceColors as G } from '../../../constants/Colors';
import { AfterglowType as T } from '../../../constants/Typography';

type Loaded = { scope: CreatorPageScope; state: CreatorPageContentState; draft: CreatorPageContentDraft };
type Work = { scope: CreatorPageScope; kind: 'save' | 'publish' | 'photo' | 'check' | 'load'; settled: boolean; active: boolean; picker: (open: boolean) => void };
export default function ApprovedPageEditorScreen({ pageId, returnToTeam = false }: { pageId: string; returnToTeam?: boolean }) {
  const returnPath = `/creator/${returnToTeam ? 'page-team' : 'page'}?id=${pageId}`;
  const { scope, account, focused } = useCreatorPageScope(`approved-edit:${pageId}`);
  const { fonts } = useAfterglowFonts(true, 'creator');
  const mounted = useRef(true), latest = useRef(scope), work = useRef<Work | null>(null), sequence = useRef(0);
  useLayoutEffect(() => { latest.current = scope; }, [scope]);
  const backVisit = useMemo(() => ({}), [pageId, returnToTeam, scope, focused, account.epoch, account.error, account.isLoading]);
  const committedBackVisit = useRef(backVisit);
  useLayoutEffect(() => { committedBackVisit.current = backVisit; }, [backVisit]);
  const current = (owned: CreatorPageScope | null = scope) => !!owned && mounted.current && latest.current === owned && owned.isCurrent();
  const [loaded, setLoaded] = useState<Loaded>();
  const [stage, setStage] = useState<'edit' | 'preview'>('edit');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [pickerOpen, setPickerOpen] = useState(false);
  const [message, setMessage] = useState<string>(), [readError, setReadError] = useState<string>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [coverAttempt, setCoverAttempt] = useState<PageCoverAttempt | null>(null), [coverError, setCoverError] = useState<string>();
  const [coverReady, setCoverReady] = useState(false), [photoUncertain, setPhotoUncertain] = useState(false);
  const data = useMemo(() => {
    if (loaded?.scope !== scope) return undefined;
    if (loaded?.state.page_kind === 'community' && !loaded.draft.pending && !loaded.draft.content.city.trim()) {
      // LA is the launch city, not an inferred discovery area. Retain exact unresolved attempts.
      return { ...loaded, draft: { ...loaded.draft, content: { ...loaded.draft.content, city: 'Los Angeles' } } };
    }
    return loaded;
  }, [loaded, scope]);
  const draft = data?.draft, state = data?.state;
  const local = useRef(data);
  useLayoutEffect(() => { local.current = data; }, [data]);
  const contentProblems = draft ? creatorPageContentProblems(draft.content) : {};
  if (draft && state?.page_kind === 'community') {
    Object.assign(contentProblems, communityClassificationProblems(draft.content));
  }
  // Keep first-error guidance in the same order as the fields on the page.
  const formProblems = Object.fromEntries(['name', 'purpose', 'discovery_area', 'categories', 'city', 'description']
    .filter(key => contentProblems[key]).map(key => [key, contentProblems[key]]));
  const revealProblems = Object.keys(errors).length ? errors : formProblems;
  const guidance = useApplicationFormGuidance(Object.keys(revealProblems), revealProblems);
  const [revealPending, setRevealPending] = useState(false);
  const fieldGuidance = (name: string) => ({ ...guidance.field(name), error: undefined });
  useEffect(() => { if (revealPending) { guidance.revealFirstInvalid(); setRevealPending(false); } }, [revealPending, stage]);
  useEffect(() => { guidance.cancelReveal(); setRevealPending(false); }, [scope]);
  const conflict = !!data && data.draft.baseVersion !== data.state.version;
  const photoPending = coverAttempt?.mediaId !== draft?.content.cover_media_id ? coverAttempt : null;
  const pending = draft?.pending;
  const editable = !!data && current() && !busy && !loading && !readError && !pending && !conflict && !photoUncertain;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function readPhoto(owned: CreatorPageScope) {
    try { const p = await requestWithDeadline(readPageCoverAttempt(pageId, owned), 12_000); if (current(owned)) { setCoverAttempt(p); setCoverError(undefined); } }
    catch { if (current(owned)) setCoverError('Your selected photo could not be read. Check again or reset the selection. Your saved cover is unchanged.'); }
  }
  async function load(owned: CreatorPageScope) {
    setLoading(true); setReadError(undefined);
    try {
      const result = await requestWithDeadline(loadCreatorPageContentEditor(pageId, owned), 15_000);
      if (!current(owned)) return;
      const kept = local.current?.scope === owned && !local.current.draft.pending ? local.current.draft : result.draft;
      setLoaded({ scope: owned, state: result.state, draft: kept });
      await readPhoto(owned);
    } catch { if (current(owned)) setReadError('Couldn’t open the page editor. Your saved changes are still here.'); }
    finally { if (current(owned)) setLoading(false); }
  }
  useEffect(() => {
    work.current = null; sequence.current++; setLoaded(undefined); setStage('edit'); setBusy(false); setPickerOpen(false);
    setMessage(undefined); setErrors({}); setCoverAttempt(null); setCoverError(undefined); setCoverReady(false); setPhotoUncertain(false);
    if (scope) void load(scope); else setLoading(false);
  }, [scope, pageId]);
  useEffect(() => { setCoverReady(false); }, [draft?.content.cover_media_id, draft?.content.photo_url, stage, scope]);
  function change(field: keyof CreatorPageContent, value: string | string[] | null) {
    if (!editable || !scope || !data || !current(scope) || local.current !== data || work.current) return;
    const next = { ...data.draft, content: { ...data.draft.content, [field]: value } };
    if (data.state.page_kind === 'community' && !next.content.city.trim()) next.content.city = 'Los Angeles';
    if (field === 'cover_media_id' && value === null) next.content.photo_url = null;
    const revision = ++sequence.current;
    setLoaded({ ...data, draft: next }); setErrors({}); setMessage(undefined);
    void persistCreatorPageContentDraft(next, scope).catch(() => {
      if (current(scope) && sequence.current === revision) setMessage('Your latest changes haven’t been saved on this device. Keep this page open and try saving again.');
    });
  }
  async function run(kind: Work['kind'], action: (owned: CreatorPageScope, task: Work) => Promise<void>) {
    if (!scope || !current(scope) || busy || work.current || loading) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectDeadline: (reason: Error) => void = () => undefined;
    const deadline = new Promise<never>((_, reject) => { rejectDeadline = reject; });
    const task: Work = { scope, kind, settled: false, active: true, picker: (open) => {
      if (!current(task.scope) || work.current !== task || !task.active) return;
      setPickerOpen(open);
      if (timer) clearTimeout(timer);
      if (!open) timer = setTimeout(() => rejectDeadline(new RequestDeadlineError()), 25_000);
    } };
    work.current = task; setBusy(true); setMessage(undefined); sequence.current++;
    const owned = { userId: scope.userId, isCurrent: () => task.active && current(task.scope) && work.current === task };
    try {
      task.picker(false);
      await Promise.race([action(owned, task), deadline]);
    }
    catch (failure) {
      task.active = false;
      if (!current(task.scope) || work.current !== task) return;
      const original = await requestWithDeadline(readCreatorPageContentDraft(pageId, task.scope), 12_000).catch(() => null);
      if (!current(task.scope) || work.current !== task) return;
      if (original && local.current) setLoaded({ ...local.current, draft: original.pending ? original : local.current.draft });
      if (kind === 'photo') setPhotoUncertain(true);
      setMessage(failure instanceof RequestDeadlineError ? 'This is taking longer than expected. Check the original result before continuing.'
        : original?.pending?.refused || (kind === 'photo' ? 'The photo has not been confirmed. Check its saved status before continuing.' : 'Couldn’t confirm that action. Your changes are still here.'));
    } finally {
      task.settled = true; task.active = false; if (timer) clearTimeout(timer);
      if (current(task.scope) && work.current === task) { work.current = null; setBusy(false); setPickerOpen(false); }
    }
  }
  const validate = (classification = true) => {
    if (!draft) return false;
    const problems = classification ? formProblems : creatorPageContentProblems(draft.content);
    setErrors(problems);
    if (Object.keys(problems).length) { setStage('edit'); setRevealPending(true); return false; }
    return true;
  };
  function save(preview: boolean) {
    if (!editable || !draft || !state || photoPending || coverError || !validate(preview)) return;
    void run('save', async owned => {
      const result = await dispatchCreatorPageContent(draft, 'save', owned);
      if (!owned.isCurrent()) return;
      setLoaded({ scope: scope!, state: { ...state, content: result.draft.content, version: result.receipt.version, published_version: result.receipt.published_version }, draft: result.draft });
      setMessage(preview ? undefined : 'Draft saved. Your changes stay private until you publish.');
      if (preview) setStage('preview');
    });
  }
  function publish() {
    if (!editable || !draft || !state || photoPending || coverError || ((draft.content.cover_media_id || draft.content.photo_url) && !coverReady) || !validate()) return;
    void run('publish', async owned => {
      await dispatchCreatorPageContent(draft, 'publish', owned);
      if (owned.isCurrent()) router.dismissTo(returnPath as never);
    });
  }
  function check() {
    void run('check', async owned => {
      const result = await checkCreatorPageContentAttempt(pageId, owned);
      if (!owned.isCurrent()) return;
      const fresh = await loadCreatorPageContentEditor(pageId, owned);
      if (!owned.isCurrent()) return;
      setLoaded({ scope: scope!, state: fresh.state, draft: result.draft ?? fresh.draft });
      if (result.receipt?.action === 'publish') { router.dismissTo(returnPath as never); return; }
      setMessage(result.receipt ? 'Your draft is saved. Preview it when you’re ready.' : result.active ? 'The original action is still finishing. Check again shortly.' : 'The original action is not confirmed. Retry uses the same saved attempt.');
      await readPhoto(owned);
    });
  }
  function retry() {
    if (!draft?.pending || draft.pending.refused || !scope || creatorPageContentBusy(pageId, scope)) return;
    void run(draft.pending.action, async owned => {
      const result = await dispatchCreatorPageContent(draft, draft.pending!.action, owned);
      if (!owned.isCurrent()) return;
      if (result.receipt.action === 'publish') router.dismissTo(returnPath as never);
      else {
        const fresh = await loadCreatorPageContentEditor(pageId, owned);
        if (owned.isCurrent()) { setLoaded({ scope: scope!, ...fresh }); setStage('preview'); }
      }
    });
  }
  function reconcile(keep: boolean) {
    if (!draft) return;
    void run('load', async owned => {
      const fresh = await reconcileCreatorPageContent(draft, keep, owned);
      if (owned.isCurrent()) { setLoaded({ scope: scope!, ...fresh }); setStage('edit'); setMessage(keep ? 'Your changes are ready to review against the latest saved version.' : 'The latest saved version is loaded.'); }
    });
  }
  function photo(mode: 'pick' | 'resume' | 'check' | 'discard' | 'reset') {
    if (!data || !scope || pending || conflict || readError || (photoUncertain && mode === 'pick')) return;
    void run('photo', async (owned, task) => {
      if (mode === 'reset') { await resetUnreadablePageCoverAttempt(pageId, owned); if (owned.isCurrent()) { setPhotoUncertain(false); await readPhoto(owned); } return; }
      let attempt = await readPageCoverAttempt(pageId, owned);
      if (mode === 'discard') {
        if (attempt) await clearPageCoverAttempt(attempt, owned);
        if (owned.isCurrent()) { setPhotoUncertain(false); await readPhoto(owned); } return;
      }
      if (mode === 'pick') {
        if (attempt) await clearPageCoverAttempt(attempt, owned);
        // Picker time is deliberate. Its existing account and media mutex owns cancellation.
        attempt = await pickPageCover(pageId, owned, task.picker);
      }
      if (!attempt || !owned.isCurrent()) { if (owned.isCurrent()) setPhotoUncertain(false); return; }
      const media = await (mode === 'check' ? checkPageCover(attempt, owned) : uploadPageCover(attempt, owned));
      if (!owned.isCurrent()) return;
      if (!media) { setPhotoUncertain(false); await readPhoto(owned); setMessage('Your selected photo is ready to resume.'); return; }
      const next = { ...data.draft, content: { ...data.draft.content, cover_media_id: media.id, photo_url: null } };
      await persistCreatorPageContentDraft(next, owned);
      if (!owned.isCurrent()) return;
      setLoaded({ ...data, draft: next });
      await clearPageCoverAttempt(attempt, owned);
      if (owned.isCurrent()) { setPhotoUncertain(false); await readPhoto(owned); }
    });
  }
  const back = () => {
    if (busy || !mounted.current || !focused || committedBackVisit.current !== backVisit) return;
    if (!scope) { if (!account.isCurrent()) return; router.dismissTo(returnPath as never); return; }
    if (!current()) return;
    if (stage === 'preview') setStage('edit');
    else router.dismissTo(returnPath as never);
  };
  const problem = (field: string) => errors[field] && <Text accessibilityRole="alert" style={[s.small, look.error, { fontFamily: fonts.regular }]}>{errors[field]}</Text>;
  const photoRequired = !!(draft?.content.cover_media_id || draft?.content.photo_url);
  return <PageFrame scrollRef={guidance.scrollRef} onContentSizeChange={guidance.onContentSizeChange} onViewportLayout={guidance.onViewportLayout} title={stage === 'preview' ? 'Page preview' : 'Edit your page'} onBack={back} busy={busy}
    contentKey={`${scope?.userId}:${stage}`} footer={data && !pending && !conflict && !readError ? <PageAction singleLine primary
      title={busy ? pickerOpen ? 'Choosing photo…' : 'Working…' : stage === 'edit' ? 'Preview changes' : state?.state === 'published' ? 'Publish changes' : 'Publish page'}
      disabled={!editable || !!photoPending || !!coverError || (stage === 'preview' && photoRequired && !coverReady)} onPress={() => stage === 'edit' ? save(true) : publish()} /> : undefined}>
    {(loading || account.isLoading) && !data && <ActivityIndicator accessibilityLabel="Loading page editor" color={C.clay} />}
    {(readError || account.error) && <View style={s.notice}><Text accessibilityRole="alert" style={[s.small, { fontFamily: fonts.regular }]}>{readError || 'Couldn’t check your account.'}</Text>
      <PageAction singleLine title="Try again" disabled={busy} onPress={() => { if (account.error) void account.retry(); else if (scope) void load(scope); }} /></View>}
    {message && <Text accessibilityRole="alert" style={[s.body, { fontFamily: fonts.regular }]}>{message}</Text>}
    {pending && <View style={look.notice}><Text accessibilityRole="header" style={[s.rowTitle, { fontFamily: fonts.semibold }]}>{pending.refused ? 'Changes kept' : pending.action === 'publish' ? 'Check your publication' : 'Check your save'}</Text>
      <Text style={[s.small, { fontFamily: fonts.regular }]}>{pending.refused || 'Your original attempt is saved. Checking won’t publish or send it again.'}</Text>
      {!pending.refused && <><PageAction singleLine title="Check status" disabled={busy} onPress={check} /><PageAction quiet singleLine title="Retry original" disabled={busy || !!scope && creatorPageContentBusy(pageId, scope)} onPress={retry} /></>}
      {pending.refused && <PageAction singleLine title="Review changes" disabled={busy} onPress={() => reconcile(true)} />}
    </View>}
    {conflict && !pending && <View style={look.notice}><Text accessibilityRole="header" style={[s.rowTitle, { fontFamily: fonts.semibold }]}>A newer version is saved</Text>
      <Text style={[s.small, { fontFamily: fonts.regular }]}>Keep your changes to review them against the latest version, or load the saved page. Loading it replaces your local edits.</Text>
      <PageAction singleLine title="Keep my changes" disabled={busy} onPress={() => reconcile(true)} /><PageAction singleLine quiet title="Load saved page" disabled={busy} onPress={() => reconcile(false)} />
    </View>}
    {data && draft && <>
      {stage === 'edit' ? <>
        <LinearGradient colors={[G.sunsetGoldLight, G.sunsetGoldMiddle, G.sunsetGoldWarm]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={look.intro}>
          <Text style={[s.eyebrow, { fontFamily: fonts.semibold, color: C.ink }]}>{state?.state === 'published' ? 'YOUR LIVE PAGE' : 'READY WHEN YOU ARE'}</Text>
          <Text accessibilityRole="header" style={[look.heading, { fontFamily: fonts.display }]}>Make it yours</Text>
          <Text style={[s.small, { fontFamily: fonts.regular, color: C.ink }]}>{state?.state === 'published' ? 'Your page stays live as it is. Preview your changes, then publish when you’re ready.' : 'Your page is approved. Add your finishing touches, then publish when you’re ready.'}</Text>
        </LinearGradient>
        <Field guidance={fieldGuidance('name')} label="Name" value={draft.content.name} onChange={v => change('name', v)} maxLength={60} editable={editable} appearance={{ fonts, remeasureText: true }} />{problem('name')}
        <Field guidance={fieldGuidance('purpose')} label="What brings people together?" value={draft.content.purpose} onChange={v => change('purpose', v)} maxLength={140} multiline editable={editable} appearance={{ fonts, remeasureText: true }} />{problem('purpose')}
        <View style={look.photoRow}>
          {draft.content.cover_media_id ? <PageCover pageId={pageId} mediaId={draft.content.cover_media_id} scope={scope} thumbnail /> : draft.content.photo_url ? <Image source={{ uri: draft.content.photo_url }} style={look.thumbnail} contentFit="cover" accessibilityLabel="Page cover" /> : <View style={look.placeholder}><ImagePlus size={24} color={Colors.terracotta} /></View>}
          <View style={look.photoText}><Text style={[s.rowTitle, { fontFamily: fonts.semibold }]}>Page photo</Text><Text style={[s.small, { fontFamily: fonts.regular }]}>Give people a feel for your page.</Text></View>
        </View>
        {!photoPending && !coverError && !photoUncertain && <View style={look.photoActions}><PageAction quiet singleLine title={photoRequired ? 'Change photo' : 'Choose photo'} disabled={!editable} onPress={() => photo('pick')} />
          {photoRequired && <PageAction quiet singleLine title="Remove photo" disabled={!editable} onPress={() => change('cover_media_id', null)} />}</View>}
        {(photoPending || coverError || photoUncertain) && <View style={look.notice}><Text accessibilityRole="alert" style={[s.small, { fontFamily: fonts.regular }]}>{coverError || 'Your selected photo stays on this device. Check or resume it before previewing.'}</Text>
          <PageAction singleLine title="Check photo" disabled={busy} onPress={() => coverError ? void readPhoto(scope!) : photo('check')} />
          {!coverError && <><PageAction singleLine title="Resume upload" disabled={busy} onPress={() => photo('resume')} /><PageAction singleLine quiet title="Discard selection" disabled={busy} onPress={() => photo('discard')} /></>}
          {coverError && <PageAction singleLine quiet title="Reset selection" disabled={busy} onPress={() => photo('reset')} />}
        </View>}
        {state?.page_kind === 'community' ? <CommunityClassificationFields key={`${scope?.userId}:${pageId}`} area={draft.content.discovery_area} categories={draft.content.categories}
          editable={editable} errors={errors} onAreaChange={value => change('discovery_area', value)} onCategoriesChange={value => change('categories', value)}
          areaGuidance={guidance.field('discovery_area')} categoryGuidance={guidance.field('categories')} />
          : <><Field guidance={fieldGuidance('city')} label="City" value={draft.content.city} onChange={v => change('city', v)} maxLength={60} editable={editable} appearance={{ fonts, remeasureText: true }} />{problem('city')}</>}
        <Field guidance={fieldGuidance('description')} label="About" value={draft.content.description ?? ''} onChange={v => change('description', v)} maxLength={5000} multiline editable={editable} appearance={{ fonts, remeasureText: true }} />{problem('description')}
        <PageAction quiet singleLine title="Save draft" disabled={!editable || !!photoPending || !!coverError} onPress={() => save(false)} />
      </> : <>
        <Text style={[s.eyebrow, { fontFamily: fonts.semibold }]}>PRIVATE PREVIEW</Text>
        <Text style={[s.body, { fontFamily: fonts.regular }]}>{state?.state === 'published' ? 'This is how your changes will look. Your current page stays live until you publish.' : 'Your page is ready to go live whenever you are.'}</Text>
        <View style={look.preview}>
          {draft.content.cover_media_id ? <PageCover pageId={pageId} mediaId={draft.content.cover_media_id} scope={scope} onReady={setCoverReady} /> : draft.content.photo_url ? <Image source={{ uri: draft.content.photo_url }} style={look.cover} contentFit="cover" accessibilityLabel="Page cover" onLoad={() => setCoverReady(true)} onError={() => { setCoverReady(false); setMessage('Your page photo couldn’t load. Go back to change or remove it.'); }} /> : <LinearGradient colors={[G.sunsetGoldLight, G.sunsetGoldMiddle, G.sunsetGoldWarm]} style={look.cover}><Text style={[look.monogram, { fontFamily: fonts.display }]}>{draft.content.name.trim().slice(0, 1).toUpperCase()}</Text></LinearGradient>}
          <View style={look.previewBody}><Text style={[s.eyebrow, { fontFamily: fonts.semibold }]}>{state?.page_kind === 'community' ? 'COMMUNITY' : 'ORGANIZATION'}</Text>
            <Text accessibilityRole="header" style={[look.heading, { fontFamily: fonts.display }]}>{draft.content.name}</Text>
            <Text style={[s.body, { fontFamily: fonts.regular }]}>{draft.content.purpose}</Text>{state?.page_kind === 'community' ? <CommunityClassificationSummary area={draft.content.discovery_area} categories={draft.content.categories} /> : <Text style={[s.small, { fontFamily: fonts.medium }]}>{draft.content.city}</Text>}
            {!!draft.content.description && <><Text style={[s.section, { fontFamily: fonts.semibold }]}>About</Text><Text style={[s.small, { fontFamily: fonts.regular }]}>{draft.content.description}</Text></>}
          </View>
        </View>
        <PageAction singleLine quiet title="Keep editing" disabled={busy} onPress={() => setStage('edit')} />
      </>}
    </>}
  </PageFrame>;
}
const look = StyleSheet.create({
  intro: { padding: 20, borderRadius: 22, marginBottom: 28, gap: 4 },
  heading: { ...T.pageTitle, color: C.ink, marginBottom: 12 },
  notice: { borderWidth: 1, borderColor: C.line, backgroundColor: C.white, borderRadius: 18, padding: 16, marginBottom: 20, gap: 12 },
  error: { color: C.clay, marginTop: -12, marginBottom: 20 },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  photoText: { flex: 1, minWidth: 0, gap: 4 },
  thumbnail: { width: 74, height: 84, borderRadius: 16 },
  placeholder: { width: 74, height: 84, borderRadius: 16, backgroundColor: G.sunsetGoldLight, alignItems: 'center', justifyContent: 'center' },
  photoActions: { marginBottom: 12, gap: 4 },
  preview: { borderRadius: 22, overflow: 'hidden', backgroundColor: C.white, borderWidth: 1, borderColor: C.line },
  previewBody: { padding: 20 },
  cover: { width: '100%', height: 176, justifyContent: 'center', alignItems: 'center' },
  monogram: { ...T.pageTitle, color: C.ink },
});
