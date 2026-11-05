import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { ScaledText as Text } from '../../components/ScaledText';
import { PageAction, PageFrame, pageStyles as s } from '../../components/creator/pages/PageFrame';
import { Field } from '../../components/creator/ApplyFormKit';
import { CommunityJoiningChoice, type CommunityJoiningMethod } from '../../components/creator/CommunityJoiningChoice';
import { useCreatorPageScope } from '../../hooks/useCreatorPageScope';
import { useCreatorAccessRead } from '../../hooks/useCreatorAccessRead';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { suggestHandle, HANDLE_SHAPE } from '../../lib/creatorMode';
import { isHouseCommunity } from '../../lib/houseCommunity';
import { getCommunityJoiningOptions } from '../../lib/communityJoiningOptions';
import { checkCommunityCreation, createCommunityWithJoining, finishCommunityCreation, readCommunityCreationAttempt,
  type CommunityCreationAttempt } from '../../lib/communityCreation';
import type { CreatorPageScope } from '../../lib/creatorPageReview';
import { setSelectedCommunityId } from '../../lib/selectedCommunity';
import { setWorkspace } from '../../lib/workspaceContext';
import { hapticSuccess } from '../../lib/haptics';
import Colors from '../../constants/Colors';
import { supabase } from '../../lib/supabase';
import { requestWithDeadline } from '../../lib/requestWithDeadline';

export default function SetupCommunityScreen() {
  const { scope, account } = useCreatorPageScope('create-community');
  return scope && !account.error && !account.isLoading
    ? <CommunitySetup key={`${scope.userId}:${account.epoch}`} scope={scope} />
    : <PageFrame title="Start a community"><Text style={s.body}>{account.isLoading ? 'Checking your account…' : account.error ? 'Couldn’t check your account. Try again to continue.' : 'Sign in to start a community.'}</Text>
      {!!account.error && <PageAction quiet singleLine title="Try again" onPress={() => { void account.retry(); }} />}</PageFrame>;
}

function CommunitySetup({ scope }: { scope: CreatorPageScope }) {
  const { fonts } = useAfterglowFonts(true, 'creator'), queryClient = useQueryClient();
  const access = useCreatorAccessRead();
  const [step, setStep] = useState<'details' | 'joining'>('details');
  const [name, setName] = useState(''), [handle, setHandle] = useState(''), [handleTouched, setHandleTouched] = useState(false);
  const [city, setCity] = useState('Los Angeles'), [purpose, setPurpose] = useState('');
  const [method, setMethod] = useState<CommunityJoiningMethod | null>(null);
  const [attempt, setAttempt] = useState<CommunityCreationAttempt | null>(null);
  const [created, setCreated] = useState<string | null>(null), [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [message, setMessage] = useState<string>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [handleAvailable, setHandleAvailable] = useState<boolean | null>(null);
  const reload = useRef<(() => Promise<void>) | null>(null);
  const lock = useRef(false), latest = useRef(scope);
  latest.current = scope;
  const current = () => latest.current === scope && scope.isCurrent();
  const allowed = !!access.data && access.data.hasLeaderGrant && !access.isError && !access.isLoading;
  const editable = allowed && available && !loading && !busy && !attempt;
  const body = (copy: string) => <Text style={[s.body, { fontFamily: fonts.regular }]}>{copy}</Text>;
  const details = () => ({ handle, name: name.trim(), city: city.trim(), purpose: purpose.trim(), method: method! });
  const restore = (saved: CommunityCreationAttempt) => {
    setAttempt(saved); setName(saved.details.name); setHandle(saved.details.handle); setHandleTouched(true);
    setCity(saved.details.city); setPurpose(saved.details.purpose); setMethod(saved.details.method); setStep('joining');
  };
  const load = async () => {
    if (!current() || lock.current) return;
    lock.current = true; setLoading(true); setAvailable(false); setMessage(undefined);
    try {
      const saved = await readCommunityCreationAttempt(scope);
      if (!current()) return;
      if (saved) restore(saved);
      const capability = await getCommunityJoiningOptions(null);
      if (!current()) return;
      setAvailable(!!capability);
      if (!capability) setMessage('Community setup is temporarily unavailable. Please try again.');
      if (saved && capability) {
        const id = await checkCommunityCreation(saved, scope);
        if (current()) { setCreated(id); if (!id) setMessage('This request is still unconfirmed. Check again or retry the same request.'); }
      }
    } catch { if (current()) setMessage('Couldn’t check community setup. Your saved request is kept. Try again.'); }
    finally { lock.current = false; if (current()) setLoading(false); else if (latest.current !== scope && latest.current.isCurrent()) void reload.current?.(); }
  };
  reload.current = load;
  useEffect(() => { void load(); }, [scope]);
  useEffect(() => {
    if (!editable || !HANDLE_SHAPE.test(handle) || isHouseCommunity(handle)) { setHandleAvailable(null); return; }
    let active = true; setHandleAvailable(null);
    const timer = setTimeout(async () => {
      try {
        const { data, error } = await requestWithDeadline(supabase.rpc('community_handle_available', { p_handle: handle }), 8_000);
        if (active && current()) setHandleAvailable(!error && typeof data === 'boolean' ? data : null);
      } catch { if (active && current()) setHandleAvailable(null); }
    }, 500);
    return () => { active = false; clearTimeout(timer); };
  }, [handle, editable, scope]);
  const continueToJoining = () => {
    if (!current() || !editable) return;
    const problems: Record<string, string> = {};
    if (name.trim().length < 2 || name.trim().length > 60) problems.name = 'Add a name, 2–60 characters.';
    if (!city.trim() || city.trim().length > 60) problems.city = 'Add your city.';
    if (purpose.trim().length < 10 || purpose.trim().length > 140) problems.purpose = 'Describe what brings people together, 10–140 characters.';
    if (!HANDLE_SHAPE.test(handle) || isHouseCommunity(handle)) problems.handle = 'Use 3–40 lowercase letters, numbers or hyphens.';
    else if (handleAvailable === false) problems.handle = 'That address is taken. Try another.';
    setErrors(problems); if (!Object.keys(problems).length) setStep('joining');
  };
  const create = async () => {
    if (!current() || lock.current || !allowed || !available || !method) return;
    lock.current = true; setBusy(true); setMessage(undefined);
    try {
      const result = await createCommunityWithJoining(attempt?.details ?? details(), scope);
      if (!current()) return;
      setAttempt(result.attempt); setCreated(result.id); hapticSuccess();
      void queryClient.invalidateQueries({ queryKey: ['creator-access'] });
    } catch (failure) {
      if (!current()) return;
      try { const saved = await readCommunityCreationAttempt(scope); if (current() && saved) restore(saved); }
      catch { if (current()) setAvailable(false); }
      if (current()) setMessage((failure as { code?: string })?.code === '23505' ? 'That address is taken. Go back and choose another.' : 'Couldn’t confirm this request. Check its status before starting another.');
    } finally { lock.current = false; if (current()) setBusy(false); else if (latest.current !== scope && latest.current.isCurrent()) { setBusy(false); void reload.current?.(); } }
  };
  const open = async (route: string) => {
    if (!current() || lock.current || !attempt || !created) return;
    lock.current = true; setBusy(true);
    try {
      const id = await finishCommunityCreation(attempt, scope);
      if (!current()) return;
      setWorkspace('community'); setSelectedCommunityId(id); router.dismissTo(route as never);
    } catch { if (current()) setMessage('Your community is saved. Check its status to reopen it.'); }
    finally { lock.current = false; if (current()) setBusy(false); else if (latest.current !== scope && latest.current.isCurrent()) { setBusy(false); void reload.current?.(); } }
  };
  return <PageFrame title={created ? 'Community created' : 'Start a community'}>
    <Text accessibilityRole="header" style={[s.heading, { fontFamily: fonts.display }]}>{created ? `${name} is saved.` : step === 'details' ? 'Bring your people together.' : name}</Text>
    {loading && <ActivityIndicator accessibilityLabel="Checking community setup" color={Colors.terracotta} />}
    {!!message && <Text accessibilityRole="alert" style={[s.body, { fontFamily: fonts.regular }]}>{message}</Text>}
    {created ? <>
      {body('Open your community to see its current status and next steps.')}
      <PageAction primary singleLine title="View community" disabled={busy} onPress={() => { void open('/(tabs)/friends/manage/(tools)/today'); }} />
      <PageAction quiet singleLine title="Edit page" disabled={busy} onPress={() => { void open('/creator/edit-page'); }} />
      <PageAction quiet singleLine title="Invite people" disabled={busy} onPress={() => { void open('/creator/member-invites'); }} />
    </> : <>
      {access.isError && body('Couldn’t check your creator access. Try again before continuing.')}
      {access.data && !allowed && body('Community creation is available after your creator application is approved.')}
      {step === 'details' ? <>
        {body('Step 1 of 2 · About your community')}
        <Field label="Community name" value={name} onChange={value => { setName(value); if (!handleTouched) setHandle(suggestHandle(value)); }} maxLength={60} editable={editable} />
        {errors.name && body(errors.name)}
        <Field label="What brings people together?" value={purpose} onChange={setPurpose} maxLength={140} multiline editable={editable} />
        {errors.purpose && body(errors.purpose)}
        <Field label="City" value={city} onChange={setCity} maxLength={60} editable={editable} />{errors.city && body(errors.city)}
        <Field label="Community address" value={handle} onChange={value => { setHandleTouched(true); setHandle(value.toLowerCase()); }} maxLength={40} autoCapitalize="none" editable={editable} />
        {body(`washedup.app/c/${handle || 'your-community'}`)}{errors.handle && body(errors.handle)}
        <PageAction primary singleLine title="Continue" disabled={!editable} onPress={continueToJoining} />
      </> : <>
        {body('Step 2 of 2 · Joining')}
        <CommunityJoiningChoice value={method} onChange={setMethod} disabled={!editable} />
        {body('Your page starts as a private draft. You choose when to publish it.')}
        <PageAction primary singleLine title={attempt ? 'Retry same request' : 'Create community'} disabled={busy || loading || !available || !allowed || !method} onPress={() => { void create(); }} />
        {!attempt && <PageAction quiet singleLine title="Back to details" disabled={busy} onPress={() => setStep('details')} />}
      </>}
    </>}
    {(!!attempt && !created || !!message || !available && !loading) && <PageAction quiet singleLine title={attempt ? 'Check status' : 'Try again'} disabled={busy || loading} onPress={() => { void load(); void access.refetch(); }} />}
  </PageFrame>;
}
