import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { ChevronRight, Plus } from 'lucide-react-native';
import { PageCover } from './PageCover';
import { AfterglowType as T } from '../../../constants/Typography';
import { listLocalPageEditors, startPageEditor, readPageEditor, type PageEditorRecord } from '../../../lib/creatorPageEditor';
import { requestWithDeadline } from '../../../lib/requestWithDeadline';
import type { CreatorPageScope } from '../../../lib/creatorPageReview';
import { CreatorPageTeamInvitations } from './CreatorPageTeamInvitations';
import { isAdmin } from '../../../constants/Admin';
import { loadLegacyCreatorSpaces, type CreatorSpaceLink } from '../../../lib/creatorSpaceEntry';
import { setSelectedCommunityId } from '../../../lib/selectedCommunity';
import { setWorkspace } from '../../../lib/workspaceContext';
import { listCreatorPages } from '../../../lib/creatorPageWorkspace';
import { useCreatorPageScope } from '../../../hooks/useCreatorPageScope';
import { useCreatorPageRead } from '../../../hooks/useCreatorPageRead';
import { useAfterglowFonts } from '../../../hooks/useAfterglowFonts';
import { PageFrame, PageAction, pageStyles as s } from './PageFrame';
import Colors, { AfterglowColors, CreatorSurfaceColors } from '../../../constants/Colors';

export default function CreatorPagesScreen() {
  const { scope, account } = useCreatorPageScope('your-pages');
  const read = useCallback(async (owned: CreatorPageScope) => ({
    saved: await listCreatorPages(owned), local: await listLocalPageEditors(owned),
  }), []);
  const { data, loading, error, refresh } = useCreatorPageRead(scope, read);
  // Existing creator approvals remain available even when a new-page read fails.
  const legacy = useCreatorPageRead(scope, loadLegacyCreatorSpaces);
  const latestLegacy = useRef(legacy);latestLegacy.current = legacy;
  type StartAttempt={scope:CreatorPageScope;record?:PageEditorRecord;settled:'pending'|'saved'|'failed';checking:boolean};
  const attempt=useRef<StartAttempt|null>(null),mounted=useRef(true),latestScope=useRef(scope);
  latestScope.current=scope;
  const [startState,setStartState]=useState<{owner:StartAttempt;phase:'starting'|'unknown'|'checking'|'saved';problem?:string}>();
  const [problem,setProblem]=useState<{scope:CreatorPageScope;text:string}>();
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const current=(owned:CreatorPageScope|null=scope)=>mounted.current&&!!owned&&latestScope.current===owned&&owned.isCurrent();
  const ownedAttempt=attempt.current?.scope===scope?attempt.current:null;
  const state=startState?.owner===ownedAttempt?startState:undefined;
  const starting=state?.phase==='starting',checking=state?.phase==='checking';
  const open=(record:PageEditorRecord,owned:StartAttempt)=>{
    if(!current(owned.scope)||attempt.current!==owned)return;
    router.push(`/creator/page-edit?id=${record.id}` as never);
  };
  const start=async()=>{
    if(!current()||!scope||ownedAttempt||attempt.current?.scope===scope||loading||error)return;
    const owned:StartAttempt={scope,settled:'pending',checking:false};attempt.current=owned;
    setStartState({owner:owned,phase:'starting'});setProblem(undefined);
    const pending=startPageEditor(scope,record=>{owned.record=record;});
    // Observe the original write without canceling it or starting another serialized write.
    void pending.then(record=>{owned.record=record;owned.settled='saved';},()=>{owned.settled='failed';});
    try{
      const record=await requestWithDeadline(pending,12_000);
      open(record,owned);
      if(current(owned.scope)&&attempt.current===owned)setStartState({owner:owned,phase:'saved'});
    }catch{
      if(current(owned.scope)&&attempt.current===owned)setStartState({owner:owned,phase:'unknown'});
    }
  };
  const checkDraft=async()=>{
    const owned=attempt.current;
    if(!owned||owned.scope!==scope||!current()||owned.checking||starting)return;
    owned.checking=true;setStartState({owner:owned,phase:'checking'});
    let reading=true;
    const readScope={userId:owned.scope.userId,isCurrent:()=>reading&&current(owned.scope)&&attempt.current===owned};
    try{
      if(!owned.record){
        // A failed reservation lookup dispatched no write. A still-pending
        // lookup retains ownership and must not start a competing draft.
        if(owned.settled==='failed'){
          attempt.current=null;setStartState(undefined);setProblem({scope:owned.scope,text:'The draft wasn’t started. Try creating a page again.'});
        }else setStartState({owner:owned,phase:'unknown',problem:'The original draft check is still unresolved. Check again shortly.'});
        return;
      }
      const record=owned.settled==='saved'?owned.record:await requestWithDeadline(readPageEditor(owned.record.id,readScope),12_000);
      if(!readScope.isCurrent())return;
      if(record){if(record.id!==owned.record.id)throw Error('The saved draft did not match.');open(record,owned);setStartState({owner:owned,phase:'saved'});}
      else if(owned.settled==='failed'){
        attempt.current=null;setStartState(undefined);setProblem({scope:owned.scope,text:'The draft wasn’t saved. You can start a new page.'});
      }else setStartState({owner:owned,phase:'unknown',problem:'The original save is still unresolved. Check this draft again shortly.'});
    }catch{
      if(readScope.isCurrent())setStartState({owner:owned,phase:'unknown',problem:'Couldn’t confirm the draft yet. Check again before starting another.'});
    }finally{reading=false;owned.checking=false;}
  };
  const { fonts } = useAfterglowFonts(true, 'creator');
  const localDrafts = data?.local.filter(local => !data.saved.some(saved => saved.id === local.id)) ?? [];
  const legacySpaces = (legacy.data ?? []).filter(space => !data?.saved.some(page => page.id === space.id));
  const empty = !!data && data.saved.length === 0 && localDrafts.length === 0 && legacySpaces.length === 0 && !legacy.loading && !legacy.error;
  const openLegacy = (space: CreatorSpaceLink) => {
    if (!current() || latestLegacy.current.loading || latestLegacy.current.error) return;
    const actual = latestLegacy.current.data?.find(candidate => candidate.id === space.id);
    if (!actual?.legacy) return;
    setWorkspace(actual.legacy.workspace);
    if (actual.legacy.communityId) setSelectedCommunityId(actual.legacy.communityId);
    router.push(actual.route as never);
  };
  const createAction = scope ? <PageAction compact primary singleLine accessibilityLabel="Create a page"
    title={starting ? 'Starting…' : 'New page'} disabled={loading || !!error || !!ownedAttempt}
    leadingIcon={starting ? <ActivityIndicator color={Colors.white} /> : <Plus size={18} color={Colors.white} strokeWidth={1.8} />}
    onPress={() => void start()} /> : null;
  return <PageFrame title="Creator space">
    <View style={look.headingRow}>
      <Text accessibilityRole="header" style={[look.heading, { fontFamily: fonts.display }]}>Your communities & organizations</Text>
      {!empty && !error && !account.error && createAction}
    </View>
    {!empty && !error && !account.error && <Text style={[look.intro, { fontFamily: fonts.regular }]}>Choose a space to manage its events, details and team.</Text>}
    {(account.isLoading || loading) && <ActivityIndicator accessibilityLabel="Loading your pages" color={Colors.terracotta} />}
    {(account.error || error) && <View style={look.recovery}>
      <Text accessibilityRole="alert" style={[look.name, { fontFamily: fonts.semibold }]}>{account.error ? 'Couldn’t check your account' : 'Couldn’t load your pages'}</Text>
      <Text style={[s.small, {fontFamily:fonts.regular}]}>Try loading your pages and saved drafts again.</Text>
      <PageAction quiet compact title="Try again" onPress={() => { void (account.error ? account.retry() : refresh()).catch(() => undefined); }} />
    </View>}
    {!account.isLoading && !account.error && account.viewerId === null && <Text style={[s.body, { fontFamily: fonts.regular }]}>Sign in to see your pages.</Text>}
    {empty && <View style={look.welcome}>
      <View style={look.welcomeMark}><Plus size={28} color={Colors.terracotta} /></View>
      <Text accessibilityRole="header" style={[look.welcomeTitle, { fontFamily: fonts.display }]}>Bring your people together</Text>
      <Text style={[s.small, { fontFamily: fonts.regular }]}>Give your community or organization a home. Add your details, then prepare your first event.</Text>
      {createAction}
    </View>}
    {state&&state.phase!=='starting'&&<View style={[look.recovery,look.draftRecovery]}>
      <Text accessibilityRole="alert" style={[look.name,{fontFamily:fonts.semibold}]}>{checking?'Checking your draft…':state.phase==='saved'?'Your draft is saved':'Your new draft needs checking'}</Text>
      <Text style={[s.small,{fontFamily:fonts.regular}]}>{state.phase==='saved'?'Continue adding details to the same draft.':state.problem??'The save hasn’t been confirmed here. Check the original draft to continue; your other spaces are still available.'}</Text>
      <PageAction compact primary singleLine title={checking?'Checking…':state.phase==='saved'?'Continue draft':'Check draft'} disabled={checking} onPress={()=>void checkDraft()}/>
    </View>}
    {problem?.scope===scope&&<Text accessibilityRole="alert" style={[s.body,{fontFamily:fonts.regular}]}>{problem.text}</Text>}
    {!!data?.saved.length && <View style={look.collection}>
      {data.saved.map((page, index) => <PageEntry key={page.id} id={page.id} data={page.published_data ?? page.page_data} scope={scope} separated={index > 0}
        kind={`${page.page_kind === 'community' ? 'Community' : 'Organization'} · ${page.published_data ? 'Published' : 'Private page'}`}
        onPress={() => { if (current()) router.push(`/creator/page?id=${page.id}` as never); }} />)}
    </View>}
    {localDrafts.length > 0 && <View style={look.drafts}>
      <Text accessibilityRole="header" style={[look.section, { fontFamily: fonts.semibold }]}>Continue creating</Text>
      <View style={look.draftCollection}>
      {localDrafts.map((local, index) => <PageEntry key={local.id} id={local.id} data={local.pageData} scope={scope} local separated={index > 0}
        kind={`${local.kind === 'community' ? 'Community' : 'Organization'} · ${local.pending ? 'Check saved status' : 'Draft on this device'}`}
        onPress={() => { if (current()) router.push(`/creator/page-edit?id=${local.id}` as never); }} />)}
      </View>
    </View>}
    {legacy.loading && <ActivityIndicator accessibilityLabel="Checking existing creator access" color={Colors.terracotta} />}
    {legacy.error && <View style={look.recovery}>
      <Text accessibilityRole="alert" style={[s.small, {fontFamily:fonts.regular}]}>Couldn’t check your existing creator access.</Text>
      <PageAction quiet compact title="Try again" accessibilityLabel="Try again to load existing creator access" onPress={() => { void legacy.refresh().catch(() => undefined); }} />
    </View>}
    {legacySpaces.length > 0 && <View style={look.drafts}>
      <View style={look.collection}>
        {legacySpaces.map((space, index) => <PageEntry key={space.id} id={space.id} scope={scope} data={{name:space.name}} separated={index > 0}
          kind={space.legacy?.status === 'approved' ? space.kind === 'community' ? 'Approved · Start your community' : 'Approved organizer' : space.legacy?.status === 'active' ? 'Community' : space.legacy?.status === 'archived' ? 'Archived community' : 'Community draft'}
          onPress={() => openLegacy(space)} />)}
      </View>
    </View>}
    <CreatorPageTeamInvitations scope={scope} />
    {scope && isAdmin(scope.userId) && <PageAction quiet title="Review creator applications" onPress={() => { if (current()) router.push('/admin/applications' as never); }} />}
  </PageFrame>;
}


function PageEntry({ id, data, scope, kind, local = false, separated = false, onPress }: {
  id: string; data: Record<string, unknown>; scope: CreatorPageScope | null; kind: string; local?: boolean; separated?: boolean; onPress: () => void;
}) {
  const { fonts } = useAfterglowFonts(true, 'creator');
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale > 1.3;
  const [brokenPhoto, setBrokenPhoto] = useState<string>();
  const name = typeof data.name === 'string' && data.name.trim() ? data.name : 'New page';
  const photo = typeof data.photo_url === 'string' ? data.photo_url : undefined;
  return <Pressable cssInterop={false} accessibilityRole="button" accessibilityLabel={`${local ? 'Continue' : 'Manage'} ${name}, ${kind}`}
    onPress={onPress} style={({ pressed }) => [look.card, local && look.draftCard, separated && look.separator, stacked && look.stacked, pressed && look.pressed]}>
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[look.cover, local && look.draftCover]}>
      {typeof data.cover_media_id === 'string' && data.cover_media_id
        ? <PageCover pageId={id} mediaId={data.cover_media_id} scope={scope} thumbnail compactFallback height={local ? 48 : 64} />
        : photo && brokenPhoto !== photo ? <Image source={{ uri: photo }} contentFit="cover" style={[look.photo, local && look.draftCover]}
            accessibilityLabel={`${name} cover`} onError={() => setBrokenPhoto(photo)} />
          : <Text accessible={false} style={[look.initial, { fontFamily: fonts.display }]}>{name.charAt(0).toUpperCase()}</Text>}
    </View>
    <View style={look.pageLink}>
      <View style={look.text}>
        <Text numberOfLines={stacked ? undefined : 2} ellipsizeMode="tail" style={[look.name, { fontFamily: fonts.semibold }]}>{name}</Text>
        <Text style={[look.kind, { fontFamily: fonts.regular }]}>{kind}{!local && typeof data.city === 'string' && !!data.city.trim() ? ` · ${data.city}` : ''}</Text>
      </View>
      <ChevronRight size={18} color={Colors.terracotta} />
    </View>
  </Pressable>;
}
const look = StyleSheet.create({
  headingRow: {flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap'},
  heading: {...T.identity,color:AfterglowColors.ink,flexShrink:1,maxWidth:'100%'},
  intro: {...T.body,color:AfterglowColors.muted,marginTop:6,marginBottom:18},
  recovery: {padding:16,backgroundColor:Colors.white,borderRadius:16,gap:5,marginTop:14,marginBottom:4},
  draftRecovery: {backgroundColor:CreatorSurfaceColors.sunsetGoldLight,borderWidth:1,borderColor:CreatorSurfaceColors.goldEdge,gap:10,marginBottom:16},
  welcome: { padding: 18, backgroundColor: Colors.white, borderRadius: 18, gap: 12, marginTop: 16, marginBottom: 20 },
  welcomeMark: { width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.inputBg, alignItems: 'center', justifyContent: 'center' },
  welcomeTitle: { ...T.identity, color: AfterglowColors.ink },
  collection: { backgroundColor: Colors.white, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, borderColor: AfterglowColors.line, paddingHorizontal: 14 },
  drafts: { marginTop: 22 },
  draftCollection: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: AfterglowColors.line },
  draftCard: { paddingVertical: 10 },
  draftCover: { width: 48, height: 48, minHeight: 48 },
  pressed: { opacity: 0.7 },
  section: { ...T.contextTitle, color: AfterglowColors.ink, marginBottom: 10 },
  card: { paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  separator: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: AfterglowColors.line },
  stacked: { flexDirection: 'column', alignItems: 'stretch' },
  cover: { width: 64, minHeight: 64, borderRadius: 8, backgroundColor: Colors.inputBg, alignItems: 'center', justifyContent: 'center' },
  photo: { width: 64, height: 64, borderRadius: 8 },
  initial: { ...T.pageTitle, color: Colors.terracotta },
  pageLink: { minHeight: 44, flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  text: { flex: 1, minWidth: 0, gap: 4 },
  kind: { ...T.body, color: AfterglowColors.muted },
  name: { ...T.contextTitle, color: AfterglowColors.ink },
});
