import { ScaledText as Text } from '../../ScaledText';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCreatorPageScope } from '../../../hooks/useCreatorPageScope';
import { useCreatorPageRead } from '../../../hooks/useCreatorPageRead';
import { useAfterglowFonts } from '../../../hooks/useAfterglowFonts';
import { type CreatorPageScope } from '../../../lib/creatorPageReview';
import { loadPageEditing, persistPageEditor, savePageEditing, submitPageEditing, pageValue, pageDraftProblems,
  pageCreatorProblems, pageAudienceOptions, attachPageCover, type PageEditorRecord } from '../../../lib/creatorPageEditor';
import { pickPageCover, uploadPageCover, checkPageCover, clearPageCoverAttempt, resetUnreadablePageCoverAttempt } from '../../../lib/creatorPageMedia';
import { PageCover } from './PageCover';
import { Field } from '../ApplyFormKit';
import { useApplicationFormGuidance } from '../useApplicationFormGuidance';
import { CommunityClassificationFields, CommunityClassificationSummary } from './CommunityClassificationFields';
import { PageFrame, PageAction, pageStyles as s } from './PageFrame';
import Colors, { AfterglowColors as C, CreatorSurfaceColors } from '../../../constants/Colors';

import { AfterglowType as T } from '../../../constants/Typography';
import { Check, Users, CalendarDays, ImagePlus } from 'lucide-react-native';
import { requestWithDeadline, RequestDeadlineError } from '../../../lib/requestWithDeadline';

type EditorAction = { scope: CreatorPageScope; active: boolean; settled: boolean; kind: 'save' | 'submission' | 'photo' | 'load'; };
type EditingData = Awaited<ReturnType<typeof loadPageEditing>>;

export default function CreatorPageEditorScreen({ pageId }: { pageId: string }) {
  const { scope, account, focused } = useCreatorPageScope(`edit:${pageId}`);
  const { fonts } = useAfterglowFonts(true, 'creator');
  const appearance = { fonts, remeasureText: true };
  const mounted = useRef(true), latestScope = useRef(scope);
  useLayoutEffect(() => { latestScope.current = scope; }, [scope]);
  const backVisit = useMemo(() => ({}), [pageId, scope, focused, account.epoch, account.error, account.isLoading]);
  const committedBackVisit = useRef(backVisit);
  useLayoutEffect(() => { committedBackVisit.current = backVisit; }, [backVisit]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = (owned: CreatorPageScope | null = scope) => !!owned && mounted.current && latestScope.current === owned && owned.isCurrent();
  const read = useCallback(async (owned: CreatorPageScope) => {
    let reading = true;
    const readScope = { userId: owned.userId, isCurrent: () => reading && mounted.current && latestScope.current === owned && owned.isCurrent() };
    try { return await requestWithDeadline(loadPageEditing(pageId, readScope), 12_000); }
    finally { reading = false; }
  }, [pageId]);
  const { data, loading, error, refresh } = useCreatorPageRead(scope, read);
  const [working, setWorking] = useState<{ scope: CreatorPageScope; record: PageEditorRecord }>();
  const [stage, setStage] = useState<'page' | 'preview' | 'creator'>('page');
  const [message, setMessage] = useState<string>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pickerWaiting, setPickerWaiting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [coverReady, setCoverReady] = useState(false);
  const [recovery, setRecovery] = useState<EditorAction>();
  const lock = useRef<EditorAction | null>(null);
  const checkingRef = useRef(false);
  const editSequence = useRef(0);
  const record = working?.scope === scope ? working.record : undefined;
  const recordRef = useRef(record);
  useLayoutEffect(() => { recordRef.current = record; }, [record]);
  const pageProblems = record ? pageDraftProblems(record, data?.gender ?? null) : {};
  const formProblems = stage === 'creator' && !Object.keys(pageProblems).length && record ? pageCreatorProblems(record.creator) : pageProblems;
  const scrollContentRef = useRef<View>(null!);
  const guidance = useApplicationFormGuidance(Object.keys(formProblems), formProblems, { scope, stage });
  const [revealPending, setRevealPending] = useState(false);
  const fieldGuidance = (name: string) => ({ ...guidance.field(name), error: undefined });
  useEffect(() => { if (revealPending) { guidance.revealFirstInvalid(); setRevealPending(false); } }, [revealPending, stage]);
  useEffect(() => { guidance.cancelReveal(); setRevealPending(false); }, [scope]);
  const unresolved = recovery?.scope === scope ? recovery : undefined;
  useEffect(() => {
    if (lock.current) lock.current.active = false;
    lock.current = null; checkingRef.current = false; editSequence.current++;
    setWorking(undefined); setStage('page'); setMessage(undefined); setErrors({}); setBusy(false); setRecovery(undefined); setChecking(false); setPickerWaiting(false);
  }, [scope]);
  useEffect(() => {
    // Background metadata refreshes must never replace text typed in this visit.
    if (!current() || recordRef.current || !data?.record || !scope) return;
    const restored = data.record.kind === 'community' && !data.record.pending && !pageValue(data.record.pageData, 'city').trim()
      ? { ...data.record, pageData: { ...data.record.pageData, city: 'Los Angeles' } } : data.record;
    setWorking({ scope, record: restored });
    if (data.confirmedSubmission) router.dismissTo(`/creator/page?id=${pageId}` as never);
  }, [scope, data, pageId]);
  const coverId = record ? pageValue(record.pageData, 'cover_media_id') : '';
  const pendingPhoto = data?.coverAttempt && data.coverAttempt.mediaId !== coverId ? data.coverAttempt : null;
  useEffect(() => { setCoverReady(false); }, [scope, coverId]);
  const approvedContent = !!data?.published || data?.submissions[0]?.status === 'approved';
  const forwardApproved = approvedContent && !!record && !record.pending && !busy && !checking && !unresolved && !loading && !error && !account.error;
  useEffect(() => { if (forwardApproved && scope?.isCurrent()) router.replace(`/creator/page-edit?id=${pageId}&mode=approved` as never); }, [forwardApproved, scope, pageId]);
  const canEdit = !!record && !!scope && !busy && !checking && !unresolved && !loading && !error && !approvedContent && !data?.conflict && !record.pending;
  const change = (next: PageEditorRecord) => {
    if (!current() || !scope || !canEdit || lock.current || checkingRef.current || recordRef.current !== record) return;
    if (next.kind === 'community' && !pageValue(next.pageData, 'city').trim()) next = { ...next, pageData: { ...next.pageData, city: 'Los Angeles' } };
    const sequence = ++editSequence.current;
    setWorking({ scope, record: next }); setErrors({}); setMessage(undefined);
    void persistPageEditor(next, scope).catch(() => {
      if (current(scope) && editSequence.current === sequence) setMessage('Your latest edits have not been saved on this device. Keep this page open and try saving again.');
    });
  };
  const field = (name: string, value: string | string[] | null) => record && change({ ...record, pageData: { ...record.pageData, [name]: value }, creator: { ...record.creator, guidelines: false } });
  const run = async (kind: EditorAction['kind'], action: (owned: CreatorPageScope, pickerOpen: (open: boolean) => void) => Promise<void>) => {
    if (!current() || !scope || lock.current || unresolved || checkingRef.current || !record || loading || error) return;
    const attempt: EditorAction = { scope, active: true, settled: false, kind };
    lock.current = attempt; editSequence.current++; setBusy(true); setMessage(undefined);
    const owned = { userId: scope.userId, isCurrent: () => attempt.active && current(attempt.scope) && lock.current === attempt };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectDeadline: (reason: Error) => void = () => undefined;
    const deadline = new Promise<never>((_, reject) => { rejectDeadline = reject; });
    const pickerOpen = (open: boolean) => {
      if (owned.isCurrent()) setPickerWaiting(open);
      if (timer) clearTimeout(timer);
      // Choosing a photo is deliberate user time, not a stalled network action.
      if (!open && owned.isCurrent()) timer = setTimeout(() => rejectDeadline(new RequestDeadlineError()), 25_000);
    };
    pickerOpen(false);
    const pending = action(owned, pickerOpen).finally(() => { attempt.settled = true; });
    try {
      // This only bounds the UI wait. Storage writes and media queues retain
      // their original lifetime; Check cannot dispatch another mutation.
      await Promise.race([pending, deadline]);
      if (owned.isCurrent()) { lock.current = null; setBusy(false); }
    } catch (failure) {
      if (current(attempt.scope) && lock.current === attempt) {
        setRecovery(attempt); setBusy(false);
        setMessage(failure instanceof RequestDeadlineError
          ? 'This is taking longer than expected. Check the saved result before continuing.'
          : 'The result hasn’t been confirmed. Check the saved page before trying again.');
      }
    } finally { attempt.active = false; if (timer) clearTimeout(timer); if (current(attempt.scope)) setPickerWaiting(false); }
  };
  const applyRead = (fresh: EditingData | undefined, owned: CreatorPageScope) => {
    if (!owned.isCurrent() || !fresh?.record || !scope) return false;
    setWorking({ scope, record: fresh.record });
    return true;
  };
  const checkSaved = async () => {
    if (!current() || !scope || busy || checkingRef.current) return;
    const owned = scope, sequence = editSequence.current, original = lock.current;
    checkingRef.current = true; setChecking(true); setMessage(undefined);
    try {
      const fresh = await refresh();
      if (!current(owned) || sequence !== editSequence.current || lock.current !== original) return;
      if (original && !original.settled) {
        setMessage('The original action is still finishing. Check again shortly; another attempt hasn’t been started.');
        return;
      }
      if (!fresh?.record) { setMessage('Your saved page could not be confirmed yet. Check again before continuing.'); return; }
      const local = recordRef.current;
      // A failed local write can leave an older copy at the same version.
      // Checking status must not discard the text still visible in this form.
      const checked = local && !fresh.record.pending && fresh.record.version === local.version && original?.kind !== 'load'
        ? { ...local, pending: undefined } : fresh.record;
      lock.current = null; setRecovery(undefined); setWorking({ scope: owned, record: checked });
      if (fresh.confirmedSubmission) router.dismissTo(`/creator/page?id=${pageId}` as never);
    } catch {
      if (current(owned)) setMessage('Couldn’t check the saved page. Your details are still here. Try again.');
    } finally {
      if (current(owned)) { checkingRef.current = false; setChecking(false); }
    }
  };
  const photo = (mode: 'pick' | 'resume' | 'check' | 'discard' | 'reset') => {
    if (!canEdit || !record || !data) return;
    void run('photo', async (owned, pickerOpen) => {
      if (mode === 'reset') { await resetUnreadablePageCoverAttempt(pageId, owned); if (owned.isCurrent()) applyRead(await refresh(), owned); return; }
      if (mode === 'discard') {
        if (data.coverAttempt) await clearPageCoverAttempt(data.coverAttempt, owned);
        if (owned.isCurrent()) applyRead(await refresh(), owned); return;
      }
      let attempt = pendingPhoto;
      if (mode === 'pick') {
        if (data.coverAttempt) await clearPageCoverAttempt(data.coverAttempt, owned);
        if (!owned.isCurrent()) return;
        attempt = await pickPageCover(pageId, owned, pickerOpen);
      }
      if (!attempt || !owned.isCurrent()) return;
      let saved = record;
      if (mode !== 'check') saved = await savePageEditing(record, data.saved, owned);
      if (!owned.isCurrent()) return;
      const media = mode === 'check' ? await checkPageCover(attempt, owned) : await uploadPageCover(attempt, owned);
      if (!owned.isCurrent()) return;
      if (media) {
        const attached = await attachPageCover(saved, attempt, media, owned);
        if (!owned.isCurrent()) return;
        await refresh(); if (owned.isCurrent()) setWorking({ scope: scope!, record: attached });
      } else setMessage('The photo has not been confirmed. Resume the upload when you’re ready.');
    });
  };
  const save = (next: 'preview' | 'stay') => {
    if (!record || !data || (next === 'preview' && (pendingPhoto || data.coverAttemptError) && !record.pending)) return;
    if (next === 'preview' && !record.pending) { setMessage(undefined); const problems = pageDraftProblems(record, data.gender); setErrors(problems); if (Object.keys(problems).length) { setRevealPending(true); return; } }
    void run('save', async owned => {
      const saved = await savePageEditing(record, data.saved, owned);
      if (!owned.isCurrent()) return;
      await refresh();
      if (owned.isCurrent()) {
        setWorking({ scope: scope!, record: saved });
        if (next === 'stay') setMessage('Draft saved. Keep editing or continue to preview when you’re ready.');
        else setStage(pendingPhoto || data.coverAttemptError || Object.keys(pageDraftProblems(saved, data.gender)).length ? 'page' : 'preview');
      }
    });
  };
  const submit = () => {
    if (!record || !data || pendingPhoto || data.coverAttemptError || (coverId && !coverReady)) return;
    setMessage(undefined);
    const pageErrors = record.pending?.kind === 'submit' ? {} : pageDraftProblems(record, data.gender);
    const problems = Object.keys(pageErrors).length ? pageErrors : pageCreatorProblems(record.creator);
    setErrors(problems); if (Object.keys(problems).length) { if (Object.keys(pageErrors).length) setStage('page'); setRevealPending(true); return; }
    void run('submission', async owned => { await submitPageEditing(record, owned); if (owned.isCurrent()) router.dismissTo(`/creator/page?id=${pageId}` as never); });
  };
  const back = () => {
    if (busy || checking || !mounted.current || !focused || committedBackVisit.current !== backVisit) return;
    if (!scope) { if (!account.isCurrent()) return; router.dismissTo('/creator/pages' as never); return; }
    if (!current()) return;
    if (stage === 'creator') setStage('preview'); else if (stage === 'preview') setStage('page');
    else { if (lock.current) lock.current.active = false; router.dismissTo((data?.saved ? `/creator/page?id=${pageId}` : '/creator/pages') as never); }
  };
  const pendingReview = data?.submissions.some(s => s.status === 'submitted');
  const failure = (name: string) => errors[name] && <Text accessibilityRole="alert" style={[s.small, { fontFamily: fonts.regular, color: C.clay, marginBottom: 16 }]}>{errors[name]}</Text>;
  if (forwardApproved) return <PageFrame title="Edit your page"><ActivityIndicator accessibilityLabel="Opening page editor" color={C.clay} /></PageFrame>;
  return <PageFrame innerViewRef={scrollContentRef} scrollRef={guidance.scrollRef} onScrollBeginDrag={guidance.onScrollBeginDrag} onContentSizeChange={guidance.onContentSizeChange} onViewportLayout={guidance.onViewportLayout} contentKey={stage} title={stage === 'creator' ? 'Introduce yourself' : stage === 'preview' ? 'Page preview' : data?.saved ? 'Edit your page' : 'Create your page'} busy={busy || checking} onBack={back}
    footer={record && !data?.published && !data?.conflict && !record.pending ? <>
      {(stage === 'page' || (stage === 'preview' && !pendingReview)) && <Text style={[look.next, { fontFamily: fonts.regular }]}>{stage === 'page' ? 'Next: preview your page' : 'Next: creator details'}</Text>}
      <PageAction primary singleLine disabled={!canEdit || !!pendingPhoto || !!data?.coverAttemptError || (stage !== 'page' && !!coverId && !coverReady) || (stage === 'creator' && !!pendingReview)}
      title={busy ? pickerWaiting ? 'Choosing photo…' : lock.current?.kind === 'submission' ? 'Submitting…' : lock.current?.kind === 'photo' ? 'Updating photo…' : 'Saving…' : stage === 'page' ? 'Save and continue' : stage === 'preview' ? pendingReview ? 'Back to page' : 'Continue' : 'Submit for review'}
      onPress={() => { if (!current() || !canEdit || lock.current || checkingRef.current) return; stage === 'page' ? save('preview') : stage === 'preview' ? pendingReview ? router.dismissTo(`/creator/page?id=${pageId}` as never) : setStage('creator') : submit(); }} />
    </> : undefined}>
    {(account.isLoading || loading) && !record && <ActivityIndicator accessibilityLabel="Loading saved page" color={C.clay} />}
    {(error || account.error) && <View style={s.notice}><Text accessibilityRole="alert" style={[s.small, { fontFamily: fonts.regular }]}>{error || 'Could not check your account.'}</Text>
      <PageAction title="Try loading again" disabled={busy || checking} onPress={() => { if (account.error) void account.retry().catch(() => undefined); else void checkSaved(); }} /></View>}
    {unresolved && <View style={look.recovery}><Text accessibilityRole="header" style={[s.rowTitle, { fontFamily: fonts.semibold }]}>Check your {unresolved.kind === 'photo' ? 'photo' : unresolved.kind === 'submission' ? 'submission' : 'page save'}</Text>
      <Text style={[s.small, { fontFamily: fonts.regular }]}>{message || 'Your details stay here while the original action is checked.'}</Text>
      <PageAction compact title={checking ? 'Checking…' : 'Check saved status'} disabled={checking} onPress={() => void checkSaved()} />
    </View>}
    {message && !unresolved && <Text accessibilityRole="alert" style={[look.body, { fontFamily: fonts.regular }]}>{message}</Text>}
    {!loading && !account.isLoading && !error && !record && <Text style={[look.body, { fontFamily: fonts.regular }]}>This draft is unavailable for this account.</Text>}
    {data?.published && <View style={s.notice}><Text style={[look.body, { fontFamily: fonts.regular }]}>This page is already published. Its saved review remains private.</Text>
      <PageAction title="Return to page" onPress={() => router.dismissTo(`/creator/page?id=${pageId}` as never)} /></View>}
    {data?.conflict && <View style={s.notice}><Text accessibilityRole="alert" style={[look.body, { fontFamily: fonts.regular }]}>A newer page version was saved. Your working copy is still here; loading the saved version replaces these local edits.</Text>
      <PageAction title="Load saved version" disabled={busy || checking || !!unresolved} onPress={() => void run('load', async owned => {
        if (data.fromServer) { await persistPageEditor(data.fromServer, owned); if (owned.isCurrent()) applyRead(await refresh(), owned); }
      })} /></View>}
    {record?.pending && !unresolved && <View style={s.notice}><Text accessibilityRole="alert" style={[look.body, { fontFamily: fonts.regular }]}>This {record.pending.kind === 'save' ? 'page save' : 'submission'} has not been confirmed. Your original attempt is saved.</Text>
      <PageAction title={checking ? 'Checking…' : 'Check saved status'} disabled={busy || checking || loading} onPress={() => { void checkSaved(); }} />
      {!data?.conflict && <PageAction title={`Retry ${record.pending.kind === 'save' ? 'save' : 'submission'}`} disabled={busy || checking || loading || !!error || !!unresolved}
        onPress={() => record.pending?.kind === 'save' ? save('preview') : submit()} />}
    </View>}
    {record && !data?.published && <>
      <Text style={[s.eyebrow, { fontFamily: fonts.semibold }]}>{pendingReview ? stage === 'preview' ? 'Private preview' : 'Private draft' : stage === 'page' ? 'Step 1 of 3 · Page details' : stage === 'preview' ? 'Step 2 of 3 · Preview' : 'Step 3 of 3 · Creator details'}</Text>
      {stage !== 'preview' && <Text accessibilityRole="header" style={[look.heading, { fontFamily: fonts.display }]}>{stage === 'page' ? 'Make it yours' : 'Behind the page'}</Text>}
      {stage === 'page' ? <>
        <Text style={[look.body, { fontFamily: fonts.regular }]}>{pendingReview ? 'Edit your private draft. Your submitted version stays unchanged while it is reviewed.' : 'Add page details, check the preview, then add your creator details and submit for review.'}</Text>
        <View style={look.kindChoices}>
          {(['community', 'organization'] as const).map(kind => <Pressable key={kind} accessibilityRole="radio" aria-checked={record.kind === kind}
            accessibilityLabel={kind === 'community' ? 'Community: people, membership and regular meetups' : 'Organization: events and followers'} accessibilityState={{ checked: record.kind === kind, disabled: !canEdit || record.version > 0 }}
            disabled={!canEdit || record.version > 0} style={[look.kindChoice, record.kind === kind && look.selectedChoice]} onPress={() => change({ ...record, kind, pageData: { ...record.pageData, audience: 'everyone' } })}>
            <View style={look.choiceIcon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{kind === 'community' ? <Users size={20} color={Colors.terracotta} /> : <CalendarDays size={20} color={Colors.terracotta} />}</View>
            <View style={look.choiceText}>
              <Text style={[s.rowTitle, { fontFamily: fonts.semibold }]}>{kind === 'community' ? 'Community' : 'Organization'}</Text>
              <Text style={[s.small, { fontFamily: fonts.regular }]}>{kind === 'community' ? 'Members and meetups.' : 'Events and followers.'}</Text>
            </View>
            <View style={look.choiceCheck} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{record.kind === kind && <Check size={16} color={Colors.terracotta} />}</View>
          </Pressable>)}
        </View>
        <Field guidance={fieldGuidance('name')} label="Name" value={pageValue(record.pageData, 'name')} onChange={v => field('name', v)} maxLength={60} editable={canEdit} appearance={appearance} />{failure('name')}
        <Field guidance={fieldGuidance('purpose')} label="What brings people together?" value={pageValue(record.pageData, 'purpose')} onChange={v => field('purpose', v)} maxLength={140} multiline editable={canEdit} appearance={appearance} />{failure('purpose')}
        <View style={look.photoRow}>
          {coverId ? <PageCover pageId={pageId} mediaId={coverId} scope={scope} thumbnail /> : pageValue(record.pageData, 'photo_url') ? <Image source={{uri:pageValue(record.pageData, 'photo_url')}} style={look.thumbnail} contentFit="cover" accessibilityLabel="Page cover" /> : <View style={look.photoPlaceholder}><ImagePlus size={24} color={Colors.terracotta} /></View>}
          <View style={{ flex: 1 }}><Text style={[s.rowTitle, { fontFamily: fonts.semibold }]}>Page photo</Text>
            <Text style={[s.small, { fontFamily: fonts.regular }]}>Pick a photo that feels like your page.</Text>
            {!pendingPhoto && !data?.coverAttemptError && <PageAction quiet title={coverId || pageValue(record.pageData, 'photo_url') ? 'Change photo' : 'Pick photo'} disabled={!canEdit} onPress={() => photo('pick')} />}
          </View>
        </View>
        {!!data?.coverAttemptError && <View style={s.notice}><Text accessibilityRole="alert" style={[look.body, { fontFamily: fonts.regular }]}>{data.coverAttemptError}</Text>
          <PageAction title="Retry selection" disabled={!canEdit} onPress={() => { void checkSaved(); }} />
          <PageAction quiet title="Reset selection" disabled={!canEdit} onPress={() => photo('reset')} />
        </View>}
        {!!pendingPhoto && <View style={s.notice}><Text accessibilityRole="alert" style={[look.body, { fontFamily: fonts.regular }]}>Your selected photo is saved on this device. Check or resume it before previewing this page.</Text>
          <PageAction title="Check photo" disabled={!canEdit} onPress={() => photo('check')} />
          <PageAction title="Resume upload" disabled={!canEdit} onPress={() => photo('resume')} />
          <PageAction quiet title="Discard selection" disabled={!canEdit} onPress={() => photo('discard')} />
        </View>}
        {record.kind === 'community' ? <CommunityClassificationFields key={`${scope?.userId}:${pageId}`} area={record.pageData.discovery_area} categories={record.pageData.categories}
          editable={canEdit} errors={errors} onAreaChange={value => field('discovery_area', value)} onCategoriesChange={value => field('categories', value)}
          searchContentRef={scrollContentRef} areaSearchGuidance={guidance.field('discovery_area_search')} areaGuidance={guidance.field('discovery_area')} categoryGuidance={guidance.field('categories')} />
          : <><Field guidance={fieldGuidance('city')} label="City" value={pageValue(record.pageData, 'city')} onChange={v => field('city', v)} maxLength={60} editable={canEdit} appearance={appearance} />{failure('city')}</>}
        {record.kind === 'community' ? <View onLayout={guidance.field('audience').onLayout}>
          <Text accessibilityRole="header" style={[look.section, { fontFamily: fonts.semibold }]}>Who is it for?</Text>
          <Text style={[look.body, { fontFamily: fonts.regular }]}>Welcome everyone or people who share your gender. You can set joining questions separately.</Text>
          {pageAudienceOptions(data?.gender).map(option => <Pressable key={option.key} accessibilityRole="radio" aria-checked={record.pageData.audience === option.key}
            accessibilityState={{ checked: record.pageData.audience === option.key, disabled: !canEdit }} disabled={!canEdit}
            accessibilityLabel={option.label} onPress={() => field('audience', option.key)} style={look.audienceRow}>
            <Text style={[s.rowTitle, { fontFamily: fonts.medium }]}>{record.pageData.audience === option.key ? '● ' : '○ '}{option.label}</Text>
          </Pressable>)}{failure('audience')}
        </View> : <Text style={[look.body, { fontFamily: fonts.regular }]}>Your organization has events and followers. It does not include community membership or admission questions.</Text>}
        <PageAction quiet title="Save draft" disabled={!canEdit} onPress={() => save('stay')} />
      </> : stage === 'preview' ? <>
        <View style={look.preview}>
        {!!coverId ? <PageCover pageId={pageId} mediaId={coverId} scope={scope} onReady={setCoverReady} /> : !!pageValue(record.pageData, 'photo_url') && <Image source={{ uri: pageValue(record.pageData, 'photo_url') }} contentFit="contain" accessibilityLabel="Page cover" style={{ width: '100%', aspectRatio: 1 }} />}
        <View style={look.previewText}>
          <Text accessibilityRole="header" style={[look.heading,{fontFamily:fonts.display}]}>{pageValue(record.pageData,'name')}</Text>
        <Text style={[s.small, { fontFamily: fonts.regular }]}>{record.kind === 'community' ? `Community · ${pageAudienceOptions(data?.gender).find(option => option.key === record.pageData.audience)?.label || 'Audience unavailable'}` : `Organization · ${pageValue(record.pageData, 'city')}`}</Text>
          {record.kind === 'community' && <CommunityClassificationSummary area={record.pageData.discovery_area} categories={record.pageData.categories} />}
          <Text style={[look.previewPurpose,{fontFamily:fonts.regular}]}>{pageValue(record.pageData,'purpose')}</Text>
        </View>
        </View>
        <Text style={[look.body, { fontFamily: fonts.regular }]}>{pendingReview ? 'This draft is private. The submitted version stays unchanged while it is reviewed.' : 'Check how your page looks. Next, add your private creator details before submitting.'}</Text>
        <PageAction quiet title="Edit page details" disabled={busy || checking} onPress={() => { if (current() && !busy && !checking) setStage('page'); }} />
      </> : <>
        <Text style={[look.body, { fontFamily: fonts.regular }]}>Each page is reviewed separately. Your creator details stay private.</Text>
        <Field guidance={fieldGuidance('name')} label="Your name" value={record.creator.name} onChange={name => change({ ...record, creator: { ...record.creator, name } })} maxLength={80} editable={canEdit} appearance={appearance} />{failure('name')}
        <Field guidance={fieldGuidance('email')} label="Contact email" value={record.creator.email} onChange={email => change({ ...record, creator: { ...record.creator, email } })} autoCapitalize="none" keyboardType="email-address" maxLength={254} editable={canEdit} appearance={appearance} />{failure('email')}
        <Field guidance={fieldGuidance('motivation')} label="Tell us what you have in mind" hint="How will you run and look after this space?" value={record.creator.motivation} onChange={motivation => change({ ...record, creator: { ...record.creator, motivation } })} multiline maxLength={300} editable={canEdit} appearance={appearance} />{failure('motivation')}
        <Pressable onLayout={guidance.field('guidelines').onLayout} accessibilityRole="checkbox" accessibilityLabel="I’ll follow the creator and community guidelines" aria-checked={record.creator.guidelines} accessibilityState={{ checked: record.creator.guidelines, disabled: !canEdit }}
          disabled={!canEdit} style={[look.guidelines,record.creator.guidelines&&look.selectedChoice]} onPress={() => change({ ...record, creator: { ...record.creator, guidelines: !record.creator.guidelines } })}>
          <Text style={[s.small,look.guidelinesCopy,{fontFamily:fonts.regular,color:C.ink}]}>I’ll follow the creator and community guidelines.</Text>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[look.checkbox,record.creator.guidelines&&look.checked]}>{record.creator.guidelines&&<Check size={15} color={Colors.white}/>}</View>
        </Pressable>{failure('guidelines')}
        <PageAction quiet title="Read creator terms" onPress={() => { void Linking.openURL('https://washedup.app/creator-terms').catch(() => setMessage('Could not open the creator terms. Please try again.')); }} />
        <Text style={[look.body, { fontFamily: fonts.regular }]}>Submitting sends this saved version for review. Approval won’t publish it automatically.</Text>
      </>}
    </>}
  </PageFrame>;
}

const look=StyleSheet.create({
 recovery:{backgroundColor:CreatorSurfaceColors.sunsetGoldLight,borderWidth:1,borderColor:CreatorSurfaceColors.goldEdge,borderRadius:16,padding:16,gap:10,marginBottom:16},
 heading:{...T.identity,color:C.ink,marginBottom:10},
 body:{...T.body,color:C.muted,marginBottom:16},
 next:{...T.caption,color:C.muted,marginBottom:8,textAlign:'center'},
 kindChoices:{gap:10,marginBottom:20},
 kindChoice:{width:'100%',minHeight:88,flexDirection:'row',alignItems:'center',padding:14,borderRadius:12,borderWidth:1,borderColor:C.line,backgroundColor:Colors.white,gap:12},
 choiceIcon:{width:20,flexShrink:0,alignItems:'center'},
 choiceText:{flex:1,minWidth:0,gap:4},
 choiceCheck:{width:16,flexShrink:0,alignItems:'center'},
 selectedChoice:{borderColor:Colors.terracotta},
 guidelines:{flexDirection:'row',alignItems:'center',gap:16,minHeight:64,padding:14,backgroundColor:Colors.white,borderWidth:1,borderColor:C.line,borderRadius:10,marginVertical:12},
 guidelinesCopy:{flex:1},
 checkbox:{width:22,height:22,borderRadius:6,borderWidth:1,borderColor:C.line,justifyContent:'center',alignItems:'center'},
 checked:{backgroundColor:Colors.terracotta,borderColor:Colors.terracotta},
 photoRow:{flexDirection:'row',gap:14,alignItems:'center',marginBottom:20,padding:14,backgroundColor:Colors.white,borderRadius:12},
 thumbnail:{width:64,height:72,borderRadius:8},
 photoPlaceholder:{width:54,height:64,borderRadius:8,backgroundColor:Colors.inputBg,alignItems:'center',justifyContent:'center'},
 section:{...T.contextTitle,color:C.ink,marginBottom:8},
 audienceRow:{minHeight:44,justifyContent:'center',paddingVertical:10,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:C.line},
 preview:{backgroundColor:Colors.white,borderRadius:16,overflow:'hidden',marginBottom:18},
 previewText:{padding:18},
 previewPurpose:{...T.message,color:C.ink,marginTop:14},
});
