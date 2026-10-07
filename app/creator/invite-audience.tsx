import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, router } from 'expo-router';
import {AttendeeMessageHistory} from '../../components/creator/AttendeeMessageHistory';
import {loadEventInvitationHistory} from '../../lib/eventInvitationHistory';
import type {MessageHistoryCursor} from '../../lib/attendeeMessageHistory';
import { Check } from 'lucide-react-native';
import Colors, { CreatorSurfaceColors } from '../../constants/Colors';
import { LinearGradient } from 'expo-linear-gradient';
import { requestWithDeadline } from '../../lib/requestWithDeadline';
import { eventSummaryId } from '../../lib/eventSummary';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { INVITE_AUDIENCE_ENABLED } from '../../constants/FeatureFlags';
import { useEventInvitationSend } from '../../hooks/useEventInvitationSend';
import { type AfterglowFontFamilies, FontSizes } from '../../constants/Typography';
import type { CreatorPageScope } from '../../lib/creatorPageReview';
import { useCreatorPageScope } from '../../hooks/useCreatorPageScope';
import { useCreatorPageRead } from '../../hooks/useCreatorPageRead';
import { useCommunicationDraft } from '../../hooks/useCommunicationDraft';
import { useCommunicationDraftExit } from '../../hooks/useCommunicationDraftExit';
import { PageAction, PageFrame } from '../../components/creator/pages/PageFrame';
import { EMPTY_INVITATION, getEventInvitation, invitationAudienceLabel, validInvitationDraft,
  type EventInvitation, type InvitationDraft } from '../../lib/eventInvitation';

let nextInvitationVisit=0;
export default function InviteAudienceScreen() {
  const s=useStyles();
  const params=useLocalSearchParams<{id?:string;pageId?:string}>(),id=eventSummaryId(params.id),pageId=eventSummaryId(params.pageId);
  const {scope,account}=useCreatorPageScope(`event-invitation:${pageId??''}:${id??''}`);
  const visit=useMemo(()=>({id:++nextInvitationVisit,denials:0,denied:false}),[scope,id,pageId]),latest=useRef(visit),mounted=useRef(true);
  latest.current=visit;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const ownedScope=useMemo(()=>scope?{userId:scope.userId,isCurrent:()=>mounted.current&&latest.current===visit&&scope.isCurrent()}:null,[scope,visit]);
  const gate=useRef({visit,ready:false});
  const read=useCallback(async(initiatingScope:CreatorPageScope)=>{
    let reading=true;
    const owned={userId:initiatingScope.userId,isCurrent:()=>reading&&initiatingScope.isCurrent()};
    try {
      if(!owned.isCurrent())throw Error('This visit has ended.');
      const result=await requestWithDeadline(getEventInvitation(id!,owned),12_000);
      if(!owned.isCurrent())throw Error('This visit has ended.');
      if(!result||(pageId&&result.pageId!==pageId))throw Object.assign(Error('Invitation unavailable'),{code:'42501'});
      visit.denied=false;
      return result;
    } catch(error) {
      if(owned.isCurrent()&&(error as {code?:string})?.code==='42501') {
        visit.denied=true;visit.denials++;gate.current.ready=false;
      }
      throw error;
    } finally {reading=false;}
  },[id,pageId,visit]);
  const event=useCreatorPageRead(id?ownedScope:null,read);
  const editorScope=useMemo(()=>{
    const generation=visit.denials;
    return ownedScope?{userId:ownedScope.userId,isCurrent:()=>ownedScope.isCurrent()&&!visit.denied&&visit.denials===generation}:null;
  },[ownedScope,visit,visit.denials]);
  const retryLock=useRef<object|null>(null),[retryVisit,setRetryVisit]=useState<object|null>(null);
  const busy=event.loading||retryVisit===visit;
  const active=!!editorScope?.isCurrent()&&!account.isLoading&&!account.error&&!!event.data&&!event.error&&!busy&&retryLock.current!==visit;
  gate.current={visit,ready:active};
  const current=()=>mounted.current&&latest.current===visit&&(ownedScope?.isCurrent()??account.isCurrent());
  const retry=()=>{
    if(!id||!current()||retryLock.current===visit||event.loading||account.isLoading)return;
    retryLock.current=visit;gate.current.ready=false;setRetryVisit(visit);
    void(account.error?account.retry():event.refresh()).catch(()=>undefined).finally(()=>{
      if(retryLock.current===visit)retryLock.current=null;
      if(mounted.current&&latest.current===visit)setRetryVisit(null);
    });
  };
  const isActive=()=>current()&&gate.current.visit===visit&&gate.current.ready;
  const back=()=>{
    if(!current())return;
    if(router.canGoBack())router.back();
    else router.replace((id?`/creator/event-messages?id=${encodeURIComponent(id)}${pageId?`&pageId=${encodeURIComponent(pageId)}`:''}`:'/creator/pages') as never);
  };
  if(id&&editorScope?.isCurrent()&&!account.isLoading&&!account.error) return <InvitationEditor key={`${visit.id}:${visit.denials}`} eventId={id} event={event.data} scope={editorScope}
    active={active} isActive={isActive} loading={busy} retryAccess={retry} back={back}/>;
  return <PageFrame title="Invite people" onBack={back} onRefresh={retry} refreshing={false}>
    {account.isLoading||busy ? <ActivityIndicator accessibilityLabel="Loading invitation" color={Colors.terracotta}/> :
      <View style={s.recovery}><Text accessibilityRole="header" style={s.title}>{visit.denied||!id?'Invitation unavailable':'Couldn’t load this invitation'}</Text>
        <Text style={s.body}>{visit.denied||!id?'This event’s invitation isn’t available for this account.':'Check your connection and access to this page, then try again. Your saved draft stays on this device.'}</Text>
        {!!id&&<PageAction compact quiet singleLine title="Try again" onPress={retry}/>}</View>}
  </PageFrame>;
}
function InvitationEditor({eventId,event,scope,active,isActive,loading,retryAccess,back}: {eventId:string;event?:EventInvitation;scope:CreatorPageScope;active:boolean;isActive:()=>boolean;loading:boolean;retryAccess:()=>void;back:()=>void}) {
  const s=useStyles(),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const isCurrent=()=>mounted.current&&scope.isCurrent();
  const canAct=()=>isCurrent()&&isActive();
  const retry=()=>{if(isCurrent())retryAccess();};
  const historyLoader=useCallback((id:string,owned:CreatorPageScope,cursor:MessageHistoryCursor|null=null)=>loadEventInvitationHistory(id,event?.pageId??'',owned,cursor),[event?.pageId]);
  const draft = useCommunicationDraft(eventId,'invitation',scope,EMPTY_INVITATION,validInvitationDraft);
  useCommunicationDraftExit(scope,draft);
  const sending = useEventInvitationSend(eventId,scope,draft.value,event?.pageId,INVITE_AUDIENCE_ENABLED,canAct);
  const [reviewing,setReviewing] = useState(false);
  const [checking,setChecking] = useState(false);
  const reviewLock = useRef(false);
  const [imageFailed,setImageFailed] = useState(false);
  const reviewed = sending.attempt?.review ?? sending.review?.receipt;
  const review = reviewed && (reviewing || sending.attempt) ? {context:reviewed.context,message:reviewed.message} : null;
  const current = review?.context ?? event;
  const message = review?.message ?? draft.value;
  const audience = event?.audiences.find(a => a.type === message.audience);
  const canEdit = active && draft.ready && !checking && !sending.loading && !sending.loadFailed && !sending.busy && !sending.attempt && scope.isCurrent();
  const latestState=useRef({draft,sending,canEdit,audience});latestState.current={draft,sending,canEdit,audience};
  const editable=()=>canAct()&&latestState.current.canEdit&&!reviewLock.current;
  const editDraft=()=>{const value=latestState.current;if(canAct()&&!value.sending.busy&&!value.sending.attempt){value.sending.dismissReview();setReviewing(false);}};
  const leave=()=>{if(isCurrent())back();};
  const change=(update:(old:InvitationDraft)=>InvitationDraft)=>{if(editable())latestState.current.draft.change(update);};
  const retryDraft=()=>{const value=latestState.current;if(canAct()&&!value.draft.loading&&!value.draft.saving&&!reviewLock.current)void value.draft.retry();};
  // Checking a durable request only reconciles its status; it cannot send or resend.
  const checkRequest=(status:boolean)=>{const value=latestState.current;if(isCurrent()&&!value.sending.busy&&!value.sending.loading)void(status?value.sending.check():value.sending.load());};
  const send=(original:boolean)=>{const value=latestState.current;if(canAct()&&!value.sending.busy)void(original?value.sending.retry():value.sending.send());};
  const reviewDraft=async()=>{
    const value=latestState.current;
    if(!editable()||!value.draft.value.body.trim()||!value.audience)return;
    reviewLock.current=true;Keyboard.dismiss();setChecking(true);
    try{if(await value.draft.save()&&canAct()&&await value.sending.prepare()&&canAct())setReviewing(true);}
    finally{reviewLock.current=false;if(isCurrent())setChecking(false);}
  };
  const finish=async()=>{
    const value=latestState.current;
    if(!canAct()||value.sending.busy||!value.draft.ready)return;
    if(await value.sending.finish(value.sending.receipt?()=>canAct()?value.draft.replace(EMPTY_INVITATION):Promise.resolve(false):undefined)&&canAct())setReviewing(false);
  };
  if (!current) return <PageFrame title="Invite people" onBack={leave} onRefresh={retry} refreshing={false}>
    {loading || sending.loading ? <ActivityIndicator accessibilityLabel="Loading invitation" color={Colors.terracotta}/> :
      <View style={s.recovery}><Text accessibilityRole="header" style={s.title}>Couldn’t load this invitation</Text>
      <Text style={s.body}>Check your connection and access to this page, then try again. Your saved draft stays on this device.</Text>
      <PageAction compact quiet singleLine title="Try again" onPress={retry}/></View>}
    {sending.error && <Text accessibilityRole="alert" style={s.error}>{sending.error}</Text>}
    {sending.loadFailed && <PageAction compact quiet singleLine title="Check request" onPress={()=>checkRequest(false)}/>}
  </PageFrame>;
  return <PageFrame title={sending.receipt?'Invitation queued':review?'Review invitation':'Invite people'} contentKey={sending.receipt?'queued':review?'review':'compose'} onRefresh={retry} refreshing={loading} onBack={() => {
    if(review && !sending.attempt && canAct())editDraft();else leave();
  }}>
    <View style={s.identity}>
      <LinearGradient pointerEvents="none" colors={[CreatorSurfaceColors.sunsetGoldLight,Colors.white]} start={{x:0,y:0}} end={{x:1,y:1}} style={StyleSheet.absoluteFill}/>
      {current.eventImage && !imageFailed ? <Image source={{uri:current.eventImage}} style={s.image} contentFit="cover" accessibilityLabel="Event artwork" onError={() => {if(isCurrent())setImageFailed(true);}}/> :
        <View style={[s.image,s.monogram]}><Text style={s.initial}>{current.eventTitle.slice(0,1)}</Text></View>}
      <View style={s.identityText}><Text style={s.caption}>{current.pageName}</Text><Text accessibilityRole="header" style={s.title}>{current.eventTitle}</Text></View>
    </View>
    <Text accessibilityRole="header" style={s.heading}>{sending.receipt ? 'Your invitation is queued' : review ? 'Review your invitation' : 'Bring your people along'}</Text>
    <Text style={[s.body,s.intro]}>{review ? 'Your message and audience, together.' : 'Invite people from this page to consider your event. An invitation doesn’t register them.'}</Text>
    {!active && <View style={s.accessRecovery}><Text style={[s.body,s.accessRecoveryText]}>{loading?'Checking event access. Your draft stays here.':'Couldn’t refresh event access. Your draft is kept here. You can still check a saved request.'}</Text><PageAction compact quiet singleLine title={loading?'Retrying…':'Try again'} disabled={loading} onPress={retry}/></View>}
    {sending.loadFailed && <PageAction compact quiet singleLine title="Check request" onPress={()=>checkRequest(false)}/>}
    {!draft.loaded && !draft.readError && !review ? <ActivityIndicator accessibilityLabel="Loading invitation draft" color={Colors.terracotta}/> : <>
      {draft.readError && draft.error && <View style={s.recovery}><Text accessibilityRole="alert" style={s.body}>{draft.error}</Text><PageAction compact quiet title="Try again" disabled={!active || checking || draft.loading || draft.saving} onPress={retryDraft}/></View>}
      {(draft.loaded || review) && <>
        {!review ? <View style={s.group}>{event!.audiences.map((a,index) => <Pressable key={a.type} accessibilityRole="radio" accessibilityLabel={invitationAudienceLabel(a.type)} accessibilityState={{selected:message.audience===a.type,disabled:!canEdit}}
          disabled={!canEdit} onPress={() => change(old=>({...old,audience:a.type}))} style={[s.choice,index>0&&s.divider]}>
          <View style={s.choiceText}><Text style={s.label}>{invitationAudienceLabel(a.type)}</Text><Text style={s.caption}>{a.eligibleCount} {a.eligibleCount===1?'person':'people'} · this page only</Text></View>
          <View style={[s.radio,message.audience===a.type&&s.selected]}>{message.audience===a.type&&<Check size={12} color={Colors.white}/>}</View>
        </Pressable>)}</View> : <View style={s.reviewAudience}><Text style={s.label}>{invitationAudienceLabel(message.audience)}</Text><Text style={s.body}>{reviewed?.recipientCount ?? 0} {reviewed?.recipientCount===1?'person':'people'}</Text></View>}
        {!review && audience && <Text style={s.note}>{audience.excludedCount} excluded, including people already going or unavailable for this invitation. Delivery preferences still need to be checked before sending.</Text>}
        {review ? <View style={s.message}><Text selectable style={s.messageText}>{message.body}</Text></View> : <>
          <Text style={[s.label,s.messageLabel]}>Your invitation</Text><TextInput style={s.input} accessibilityLabel="Invitation message" value={draft.value.body} onChangeText={body=>change(old=>({...old,body}))}
            editable={canEdit} maxLength={2000} multiline textAlignVertical="top" placeholder="What would you love them to join you for?" placeholderTextColor={Colors.textLight}/>
          <Text style={s.counter}>{draft.value.body.length}/2000</Text></>}
        {!draft.readError && draft.error && <View style={s.recovery}><Text accessibilityRole="alert" style={s.body}>{draft.error}</Text><PageAction compact quiet title="Try again" disabled={!active || checking || draft.loading || draft.saving} onPress={retryDraft}/></View>}
        {sending.error && <Text accessibilityRole="alert" style={s.error}>{sending.error}</Text>}
        {review && reviewed?.recipientCount===0 && <Text style={s.note}>No one can receive this invitation right now. Choose another audience.</Text>}
        {review && <Text style={s.note}>{sending.receipt ? `${sending.receipt.recipientCount} notifications queued. Device delivery isn’t confirmed.` : 'In-app invitation, with push when available. An invitation doesn’t register anyone.'}</Text>}
        <View style={s.actions}>{sending.receipt ? <PageAction compact quiet singleLine title="Write another" disabled={sending.busy || !active || !draft.ready} onPress={()=>{void finish();}}/> :
          sending.attempt ? <>
            {!sending.rejected && <PageAction compact quiet singleLine title={sending.busy?'Working…':'Check status'} disabled={sending.busy} onPress={()=>checkRequest(true)}/>}
            {sending.retryOriginal && active && INVITE_AUDIENCE_ENABLED && <PageAction compact primary singleLine title="Retry original" disabled={sending.busy} onPress={()=>send(true)}/>}
            {sending.rejected && <PageAction compact quiet singleLine title="Edit draft" disabled={sending.busy || !active} onPress={()=>{void finish();}}/>}
          </> : review ? <>
            {INVITE_AUDIENCE_ENABLED && reviewed?.sendingEnabled && current.eventStatus==='Live' && <PageAction compact primary singleLine title={sending.busy?'Sending…':'Send invitation'} disabled={!canEdit || !reviewed.recipientCount} onPress={()=>send(false)}/>}
            <PageAction compact quiet singleLine title="Edit draft" disabled={sending.busy || !active} onPress={editDraft}/>
          </> : <PageAction compact primary singleLine title={checking?'Checking…':'Review draft'} disabled={!canEdit || !message.body.trim() || !audience} onPress={()=>{void reviewDraft();}}/>}</View>
        {!sending.attempt && <Text accessibilityLiveRegion="polite" style={s.caption}>{draft.saving?'Saving draft…':draft.error?'Changes haven’t been saved':draft.saved?'Draft saved on this device':'Your draft saves as you write'}</Text>}
      </>}
    </>}
    {!sending.attempt && (!INVITE_AUDIENCE_ENABLED || !reviewed?.sendingEnabled || current.eventStatus!=='Live') && <View style={s.delivery}><Text style={s.label}>Before this goes out</Text><Text style={s.body}>{current.eventStatus==='Live'?'You can save and review your invitation. Sending remains unavailable until delivery is enabled.':'Publish this event before inviting people. Your invitation stays a draft; nothing is sent.'}</Text></View>}
    {!review && active && event && <AttendeeMessageHistory eventId={eventId} scope={scope} invitation historyLoader={historyLoader}/>}
  </PageFrame>;
}
function createStyles(fonts:AfterglowFontFamilies){return StyleSheet.create({
  accessRecovery:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:12,padding:12,marginBottom:16,borderWidth:1,borderColor:CreatorSurfaceColors.goldEdge,borderRadius:14,backgroundColor:Colors.white},accessRecoveryText:{flexGrow:1,flexBasis:140,minWidth:0},
  identity:{padding:16,borderWidth:1,borderColor:CreatorSurfaceColors.goldEdge,borderRadius:16,overflow:'hidden',flexDirection:'row',gap:12,alignItems:'center',marginBottom:20},image:{width:56,height:68,borderRadius:8},
  monogram:{backgroundColor:Colors.inputBg,alignItems:'center',justifyContent:'center'},initial:{fontFamily:fonts.display,fontSize:FontSizes.displayMD,color:Colors.terracotta},
  identityText:{flex:1,minWidth:0,gap:4},title:{fontFamily:fonts.semibold,fontSize:FontSizes.bodyLG,color:Colors.asphalt},
  heading:{fontFamily:fonts.display,fontSize:FontSizes.displayMD,color:Colors.asphalt,marginBottom:6},intro:{marginBottom:16},
  body:{fontFamily:fonts.regular,fontSize:FontSizes.bodyMD,lineHeight:20,color:Colors.textMedium},caption:{fontFamily:fonts.regular,fontSize:FontSizes.bodySM,lineHeight:18,color:Colors.textMedium},
  label:{fontFamily:fonts.medium,fontSize:FontSizes.bodyMD,color:Colors.asphalt},group:{backgroundColor:Colors.white,borderRadius:18,paddingHorizontal:14},
  choice:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:14,minHeight:56},choiceText:{flex:1,gap:4},divider:{borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:Colors.border},
  radio:{width:20,height:20,borderRadius:10,borderWidth:1,borderColor:Colors.border,alignItems:'center',justifyContent:'center'},selected:{backgroundColor:Colors.terracotta,borderColor:Colors.terracotta},
  note:{fontFamily:fonts.regular,fontSize:FontSizes.bodySM,lineHeight:18,color:Colors.textMedium,marginTop:10},messageLabel:{marginTop:20,marginBottom:8},
  input:{backgroundColor:Colors.white,borderRadius:16,minHeight:132,padding:14,fontFamily:fonts.regular,fontSize:FontSizes.bodyMD,lineHeight:20,color:Colors.asphalt},
  counter:{fontFamily:fonts.regular,fontSize:FontSizes.caption,color:Colors.textMedium,textAlign:'right',marginTop:6},actions:{flexDirection:'row',flexWrap:'wrap',gap:10,marginTop:18,marginBottom:8},
  reviewAudience:{gap:4},message:{backgroundColor:Colors.white,borderRadius:16,padding:16,marginTop:18},messageText:{fontFamily:fonts.regular,fontSize:FontSizes.bodyMD,lineHeight:21,color:Colors.asphalt},
  delivery:{borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:Colors.border,paddingTop:16,marginTop:22,gap:6},
  recovery:{backgroundColor:Colors.white,borderRadius:16,padding:16,gap:8},error:{fontFamily:fonts.regular,fontSize:FontSizes.bodySM,color:Colors.errorRed,lineHeight:18,marginTop:10},
});}
function useStyles(){const {fonts}=useAfterglowFonts(true,'creator');return useMemo(()=>createStyles(fonts),[fonts]);}
