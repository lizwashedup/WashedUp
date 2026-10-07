import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import Colors, { CreatorSurfaceColors } from '../../constants/Colors';
import { LinearGradient } from 'expo-linear-gradient';
import { requestWithDeadline } from '../../lib/requestWithDeadline';
import { eventSummaryId } from '../../lib/eventSummary';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { ATTENDEE_MESSAGE_SEND_ENABLED, MESSAGE_TEST_SEND_ENABLED } from '../../constants/FeatureFlags';
import { FontSizes, type AfterglowFontFamilies } from '../../constants/Typography';
import { hapticLight } from '../../lib/haptics';
import { getCommunicationEvent, getCommunicationAudienceSources, CommunicationAudienceDenied, type CommunicationEvent } from '../../lib/creatorCommunications';
import type { CreatorPageScope } from '../../lib/creatorPageReview';
import { useCreatorPageScope } from '../../hooks/useCreatorPageScope';
import { useCreatorPageRead } from '../../hooks/useCreatorPageRead';
import { useAttendeeMessageSend } from '../../hooks/useAttendeeMessageSend';
import { useCommunicationDraft } from '../../hooks/useCommunicationDraft';
import { useCommunicationDraftExit } from '../../hooks/useCommunicationDraftExit';
import { PageFrame, PageAction } from '../../components/creator/pages/PageFrame';
import { EMPTY_MESSAGE_DRAFT, validCommunicationMessageDraft, messageDraftProblem, describeMessageExclusions, type CommunicationMessageDraft } from '../../lib/communicationMessageDraft';
import { ESSENTIAL_REASONS, ESSENTIAL_REASON_LABEL, MANUAL_MESSAGE_DAILY_CAP, MESSAGE_BODY_MAX, MESSAGE_SUBJECT_MAX, filterSeats, isFilterOpen, sendAttendeeMessageTestToSelf, type SeatFilter } from '../../lib/attendeeMessaging';
export const describeExclusions = describeMessageExclusions;

type AudienceSources=Awaited<ReturnType<typeof getCommunicationAudienceSources>>;
let nextMessageVisit=0;
export default function AttendeeMessageScreen() {
  const s=useStyles();
  const params=useLocalSearchParams<{id?:string;pageId?:string}>(),id=eventSummaryId(params.id),pageId=eventSummaryId(params.pageId);
  const {scope,account}=useCreatorPageScope(`attendee-message:${pageId??''}:${id??''}`);
  const visit=useMemo(()=>({id:++nextMessageVisit,denials:0,denied:false}),[scope,id,pageId]),latest=useRef(visit),mounted=useRef(true);
  latest.current=visit;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const ownedScope=useMemo(()=>scope?{userId:scope.userId,isCurrent:()=>mounted.current&&latest.current===visit&&scope.isCurrent()}:null,[scope,visit]);
  const gate=useRef({visit,ready:false});
  const read=useCallback(async(initiatingScope:CreatorPageScope)=>{
    let reading=true;
    const owned={userId:initiatingScope.userId,isCurrent:()=>reading&&initiatingScope.isCurrent()};
    try{
      const result=await requestWithDeadline((async()=>{
        if(!owned.isCurrent())throw Error('This visit has ended.');
        const event=await getCommunicationEvent(id!,owned);
        if(!owned.isCurrent())throw Error('This visit has ended.');
        if(!event)throw new CommunicationAudienceDenied();
        const audience=await getCommunicationAudienceSources(id!,owned);
        if(!owned.isCurrent())throw Error('This visit has ended.');
        return {event,audience};
      })(),12_000);
      if(!owned.isCurrent())throw Error('This visit has ended.');
      visit.denied=false;return result;
    }catch(error){
      if(owned.isCurrent()&&error instanceof CommunicationAudienceDenied){visit.denials++;visit.denied=true;gate.current.ready=false;}
      throw error;
    }finally{reading=false;}
  },[id,visit]);
  const access=useCreatorPageRead(id?ownedScope:null,read);
  const editorScope=useMemo(()=>{
    const generation=visit.denials;
    return ownedScope?{userId:ownedScope.userId,isCurrent:()=>ownedScope.isCurrent()&&!visit.denied&&visit.denials===generation}:null;
  },[ownedScope,visit,visit.denials]);
  const retryLock=useRef<object|null>(null),[retryVisit,setRetryVisit]=useState<object|null>(null);
  const busy=access.loading||retryVisit===visit;
  const active=!!editorScope?.isCurrent()&&!account.isLoading&&!account.error&&!!access.data&&!access.error&&!busy&&retryLock.current!==visit;
  gate.current={visit,ready:active};
  const current=()=>mounted.current&&latest.current===visit&&(ownedScope?.isCurrent()??account.isCurrent());
  const retry=()=>{
    if(!id||!current()||retryLock.current===visit||access.loading||account.isLoading)return;
    retryLock.current=visit;gate.current.ready=false;setRetryVisit(visit);
    void(account.error?account.retry():access.refresh()).catch(()=>undefined).finally(()=>{
      if(retryLock.current===visit)retryLock.current=null;
      if(mounted.current&&latest.current===visit)setRetryVisit(null);
    });
  };
  const isActive=()=>current()&&gate.current.visit===visit&&gate.current.ready;
  const leave=()=>{
    if(!current())return;
    if(router.canGoBack())router.back();
    else router.replace((id?`/creator/event-messages?id=${encodeURIComponent(id)}${pageId?`&pageId=${encodeURIComponent(pageId)}`:''}`:'/creator/pages') as never);
  };
  if(access.data&&editorScope?.isCurrent()&&!account.isLoading&&!account.error)return <MessageEditor key={`${visit.id}:${visit.denials}`} event={access.data.event} audienceData={access.data.audience} scope={editorScope}
    active={active} isActive={isActive} accessBusy={busy} accessError={access.error} retryAccess={retry} leave={leave}/>;
  return <PageFrame title="New message" onBack={leave} onRefresh={retry} refreshing={false}>
    {account.isLoading||busy?<ActivityIndicator accessibilityLabel="Loading message and audience" color={Colors.terracotta}/>:<View style={s.recovery}>
      <Text accessibilityRole="header" style={s.title}>{visit.denied||!id?'Event unavailable':'Couldn’t load this message'}</Text>
      <Text style={s.body}>{visit.denied||!id?'This event’s messages aren’t available for this account.':'Your event and audience need to be checked. Your saved draft stays on this device.'}</Text>
      {!!id&&<PageAction compact quiet singleLine title="Try again" onPress={retry}/>}</View>}
  </PageFrame>;
}
function MessageEditor({event,audienceData,scope,active,isActive,accessBusy,accessError,retryAccess,leave}:{event:CommunicationEvent;audienceData:AudienceSources;scope:CreatorPageScope;active:boolean;isActive:()=>boolean;accessBusy:boolean;accessError?:string;retryAccess:()=>void;leave:()=>void}) {
  const s=useStyles();
  const mounted=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const current=()=>mounted.current&&scope.isCurrent();
  const canAct=()=>current()&&isActive();
  const retry=()=>{if(current())retryAccess();};
  const draft = useCommunicationDraft(event.id,'message',scope,EMPTY_MESSAGE_DRAFT,validCommunicationMessageDraft);
  useCommunicationDraftExit(scope,draft);
  const sending=useAttendeeMessageSend(event.id,scope,draft.value,ATTENDEE_MESSAGE_SEND_ENABLED,canAct);
  const viewed=sending.attempt?.message ?? draft.value;
  const [reviewing,setReviewing]=useState(false), [filtersOpen,setFiltersOpen]=useState(false), [reviewError,setReviewError]=useState('');
  const showingReview=reviewing || !!sending.attempt;
  const [testStatus,setTestStatus]=useState(''), [testing,setTesting]=useState(false);
  const [preparing,setPreparing]=useState(false);
  const testLock=useRef(false);
  const reviewLock=useRef(false);
  const d=draft.value;
  const editable=active && draft.ready && !testing && !preparing && !sending.loading && !sending.loadFailed && !sending.busy && !sending.attempt;
  const tiers=useMemo(()=>Array.from(new Set((audienceData.seats).map(s=>s.tierName).filter((t):t is string=>!!t))),[audienceData]);
  // Each order may have multiple seats; a buyer may also have multiple orders. Do not label this as unique people.
  const purchases=new Set(filterSeats(audienceData.seats,d.audience).map(s=>s.orderId)).size;
  const rsvps=isFilterOpen(d.audience) ? audienceData.rsvps : 0;
  const audienceText=purchases === null ? 'Registration audience unavailable' : `${purchases} ticket ${purchases===1?'purchase':'purchases'} · ${rsvps} ${rsvps===1?'RSVP':'RSVPs'}`;
  const latestState=useRef({draft,sending,editable});latestState.current={draft,sending,editable};
  const canEdit=()=>canAct()&&latestState.current.editable&&!testLock.current&&!reviewLock.current;
  const change=(patch:Partial<CommunicationMessageDraft>)=>{if(!canEdit())return;setReviewError('');latestState.current.draft.change(previous=>({...previous,...patch}));};
  const changeAudience=(patch:Partial<SeatFilter>)=>{if(canEdit())latestState.current.draft.change(previous=>({...previous,audience:{...previous.audience,...patch}}));};
  const toggleFilters=()=>{if(canEdit())setFiltersOpen(value=>!value);};
  const editReview=()=>{const value=latestState.current;if(canAct()&&!value.sending.busy&&!value.sending.attempt){value.sending.dismissReview();setReviewing(false);}};
  const checkRequest=(status:boolean)=>{const value=latestState.current;if(current()&&!value.sending.busy&&!value.sending.loading)void(status?value.sending.check():value.sending.load());};
  const dispatch=(original:boolean)=>{const value=latestState.current;if(canAct()&&!value.sending.busy)void(original?value.sending.retry():value.sending.send());};
  const finish=async(clear:boolean)=>{
    const value=latestState.current;if(!canAct()||value.sending.busy)return;
    if(await value.sending.finish(clear?()=>canAct()?value.draft.replace(EMPTY_MESSAGE_DRAFT):Promise.resolve(false):undefined)&&canAct())setReviewing(false);
  };
  const retryDraft=()=>{const value=latestState.current;if(canAct()&&!value.draft.loading&&!value.draft.saving)void value.draft.retry();};
  const review=async()=>{
    if(!canEdit())return;
    const value=latestState.current,problem=messageDraftProblem(value.draft.value);if(problem){setReviewError(problem);return;}
    Keyboard.dismiss();reviewLock.current=true;setPreparing(true);
    try{if(await value.draft.save()&&canAct()&&(!ATTENDEE_MESSAGE_SEND_ENABLED||await value.sending.prepare())&&canAct()){hapticLight();setReviewing(true);}}
    finally{reviewLock.current=false;if(current())setPreparing(false);}
  };
  const test=async()=>{
    if(!MESSAGE_TEST_SEND_ENABLED||!canEdit())return;
    const value=latestState.current.draft.value;if(messageDraftProblem(value))return;
    testLock.current=true;setTesting(true);setTestStatus('');
    let retired=false;
    const testScope={userId:scope.userId,isCurrent:()=>!retired&&canAct()};
    try{await requestWithDeadline(sendAttendeeMessageTestToSelf(event.id,value.subject,value.body,testScope),25_000);if(canAct())setTestStatus('Test notification queued for your account.');}
    catch{if(canAct())setTestStatus('Test delivery could not be confirmed. Check your notifications before trying again.');}
    finally{retired=true;testLock.current=false;if(current())setTesting(false);}
  };
  const back=()=>{if(!current())return;if(reviewing&&!latestState.current.sending.attempt&&canAct()){editReview();return;}leave();};
  return <PageFrame contentKey={sending.receipt?.deliveryStatus==='queued'?'queued':showingReview?'review':'compose'} title={sending.receipt?.deliveryStatus==='queued'?'Update queued':showingReview?'Review message':'New message'} onBack={back} onRefresh={retry} refreshing={accessBusy}>
    <View style={s.identity}>
      <LinearGradient pointerEvents="none" colors={[CreatorSurfaceColors.sunsetGoldLight,Colors.white]} start={{x:0,y:0}} end={{x:1,y:1}} style={StyleSheet.absoluteFill}/>
      <Text accessibilityRole="header" style={s.title}>{event.title}</Text>
      {!!event.venue&&<Text style={[s.caption,s.venue]}>{event.venue}</Text>}
    </View>
    {(accessBusy||accessError)&&<View style={s.accessRecovery}><Text style={[s.body,s.accessRecoveryText]}>{accessBusy?'Checking event and audience. Your draft stays here.':'Couldn’t refresh event and audience. Your draft and last checked counts are kept here.'}</Text><PageAction compact quiet singleLine title={accessBusy?'Retrying…':'Try again'} disabled={accessBusy} onPress={retry}/></View>}
    {sending.loadFailed && sending.error && <Text accessibilityRole="alert" style={[s.body,s.space]}>{sending.error}</Text>}
    {sending.loadFailed && <PageAction quiet compact singleLine title="Check request" onPress={()=>checkRequest(false)}/>}
    {draft.readError && draft.error && <Recovery text={draft.error} onRetry={retryDraft} disabled={!active || draft.loading || draft.saving}/>}
    {!draft.loaded ? !draft.readError && <ActivityIndicator accessibilityLabel="Loading your draft" color={Colors.terracotta}/> : <>
      {showingReview ? <>
        <Text style={s.heading}>{sending.receipt?.deliveryStatus==='queued'?'Your update is queued':sending.attempt?'Your update':'Review your update'}</Text>
        <View style={s.preview}><Text style={s.label}>{viewed.subject}</Text><Text selectable style={s.messageBody}>{viewed.body}</Text></View>
        <View style={s.reviewRows}>
          <ReviewRow label="Audience" value={sending.attempt || sending.review ? `${(sending.attempt?.review ?? sending.review!.receipt).recipientCount} recipients` : audienceText}/>
          <Text style={s.caption}>{describeExclusions(viewed.audience)}</Text>
          <ReviewRow label="Update" value={viewed.kind==='essential' ? `Essential · ${ESSENTIAL_REASON_LABEL[viewed.essentialReason!]}` : 'Regular update'}/>
          <ReviewRow label="Reply email" value={viewed.replyTo.trim() || 'Not specified'}/>
        </View>
        <Text style={s.caption}>{ATTENDEE_MESSAGE_SEND_ENABLED || sending.attempt ? 'In-app update, with push when available. Device delivery is not confirmed. Email delivery is not enabled.' : 'Final recipient totals and delivery channels haven’t been checked. Regular updates respect event message opt-outs.'}</Text>
        <View style={s.reviewActions}>
        {!!sending.error && !sending.loadFailed && <Text accessibilityRole="alert" style={s.body}>{sending.error}</Text>}
        {!!draft.error && !draft.readError && <Recovery text={draft.error} onRetry={retryDraft} disabled={!active || draft.loading || draft.saving}/>}
        {sending.receipt?.deliveryStatus==='queued' ? <>
          <Text accessibilityLiveRegion="polite" style={[s.body,s.space]}>{sending.receipt.pushQueuedCount} notifications queued.</Text>
          <PageAction primary compact singleLine title="Write another" disabled={sending.busy || !active} onPress={()=>{void finish(true);}}/>
        </> : sending.attempt ? <>
          {!sending.rejected && <PageAction compact singleLine title={sending.busy?'Working…':'Check status'} disabled={sending.busy} onPress={()=>checkRequest(true)}/>}
          {sending.retryOriginal && ATTENDEE_MESSAGE_SEND_ENABLED && <PageAction primary compact singleLine title="Retry original" disabled={sending.busy || !active} onPress={()=>dispatch(true)}/>}
          {sending.rejected && <PageAction compact singleLine title="Edit message" disabled={sending.busy || !active} onPress={()=>{void finish(false);}}/>}
        </> : <>
          {ATTENDEE_MESSAGE_SEND_ENABLED && <PageAction primary compact singleLine title={sending.busy?'Sending…':'Send update'} disabled={!editable || !sending.review} onPress={()=>dispatch(false)}/>}
          <PageAction quiet compact singleLine title="Back to editing" disabled={sending.busy || !active} onPress={editReview}/>
        </>}
        {MESSAGE_TEST_SEND_ENABLED && <PageAction compact singleLine title={testing?'Sending test…':'Test to me'} disabled={!editable || testLock.current} onPress={()=>{void test();}}/>}
        {!!testStatus && <Text accessibilityLiveRegion="polite" style={s.caption}>{testStatus}</Text>}
        </View>
      </> : <>
        <Text style={s.heading}>What should they know?</Text>
        <View style={s.fields}>
          <Text style={s.label}>Subject</Text><TextInput accessibilityLabel="Message subject" editable={editable} value={d.subject} onChangeText={subject=>change({subject})} maxLength={MESSAGE_SUBJECT_MAX}
            placeholder="A quick note about Sunday" placeholderTextColor={Colors.textLight} style={s.input}/>
          <Text style={s.label}>Your message</Text><TextInput accessibilityLabel="Your message" editable={editable} value={d.body} onChangeText={body=>change({body})} maxLength={MESSAGE_BODY_MAX}
            placeholder="What do they need to know?" placeholderTextColor={Colors.textLight} multiline textAlignVertical="top" style={[s.input,s.messageInput]}/>
        </View>
        <Text style={s.section}>Update type</Text>
        <View accessibilityRole="radiogroup" accessibilityLabel="Update type" style={s.choices}><Choice label="Regular update" selected={d.kind==='promotional'} disabled={!editable} onPress={()=>change({kind:'promotional',essentialReason:null})}/>
          <Choice label="Essential update" selected={d.kind==='essential'} disabled={!editable} onPress={()=>change({kind:'essential'})}/></View>
        {d.kind==='essential' ? <><View accessibilityRole="radiogroup" accessibilityLabel="Essential update reason" style={s.choices}>{ESSENTIAL_REASONS.map(reason=><Choice key={reason} label={ESSENTIAL_REASON_LABEL[reason]} selected={d.essentialReason===reason} disabled={!editable} onPress={()=>change({essentialReason:reason})}/>)}</View>
          <Text style={s.caption}>Cancellation, venue and time changes don’t count toward the daily limit.</Text></> : <Text style={s.caption}>Up to {MANUAL_MESSAGE_DAILY_CAP} regular updates per event per day. Event message opt-outs apply.</Text>}
        <Text style={s.section}>Audience</Text>
        <Text style={s.body}>{audienceText}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Filter message audience" accessibilityState={{expanded:filtersOpen,disabled:!editable}} disabled={!editable} onPress={toggleFilters} style={s.disclosure}>
          <Text style={s.link}>{filtersOpen?'Close filters':'Filter audience'}</Text>{filtersOpen?<ChevronUp size={17} color={Colors.terracotta}/>:<ChevronDown size={17} color={Colors.terracotta}/>}</Pressable>
        {(filtersOpen || !isFilterOpen(d.audience)) && <>
          {filtersOpen && <View style={s.filterGroup}>
            {tiers.length>0 && <><Text style={s.label}>Ticket tier</Text><View accessibilityRole="radiogroup" accessibilityLabel="Ticket tier" style={s.choices}><Choice label="All tiers" selected={!d.audience.tier} disabled={!editable} onPress={()=>changeAudience({tier:null})}/>{tiers.map(t=><Choice key={t} label={t} selected={d.audience.tier===t} disabled={!editable} onPress={()=>changeAudience({tier:t})}/>)}</View></>}
            <Text style={s.label}>Check-in</Text><View accessibilityRole="radiogroup" accessibilityLabel="Check-in filter" style={s.choices}>{(['all','in','out'] as const).map(v=><Choice key={v} label={v==='all'?'Everyone':v==='in'?'Checked in':'Not checked in'} selected={d.audience.checkedIn===v} disabled={!editable} onPress={()=>changeAudience({checkedIn:v})}/>)}</View>
            <Text style={s.label}>Refunds</Text><View accessibilityRole="radiogroup" accessibilityLabel="Refund filter" style={s.choices}>{(['all','no','yes'] as const).map(v=><Choice key={v} label={v==='all'?'Any refund status':v==='no'?'Not refunded':'Refunded'} selected={d.audience.refunded===v} disabled={!editable} onPress={()=>changeAudience({refunded:v})}/>)}</View>
          </View>}
          <Text style={s.caption}>{describeExclusions(d.audience)}</Text>
        </>}
        <Text style={[s.caption,s.space]}>Registration counts aren’t final recipient totals; one person may have more than one purchase or an RSVP.</Text>
        <Text style={s.section}>Reply email <Text style={s.caption}>(optional)</Text></Text>
        <TextInput accessibilityLabel="Reply email" editable={editable} value={d.replyTo} onChangeText={replyTo=>change({replyTo})} maxLength={200} autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
          placeholder="you@example.com" placeholderTextColor={Colors.textLight} style={s.input}/>
        {!!sending.error && !sending.loadFailed && <Text accessibilityRole="alert" style={[s.body,s.space]}>{sending.error}</Text>}
        {!!draft.error && !draft.readError && <Recovery text={draft.error} onRetry={retryDraft} disabled={!active || draft.loading || draft.saving}/>}
        {!!reviewError && <Text accessibilityRole="alert" style={[s.body,s.space]}>{reviewError}</Text>}
        <View style={s.space}><PageAction primary compact singleLine title={preparing?"Checking…":ATTENDEE_MESSAGE_SEND_ENABLED?"Review update":"Review draft"} disabled={!editable || draft.saving} onPress={()=>{void review();}}/></View>
      </>}
      {!sending.attempt && <Text accessibilityLiveRegion="polite" style={[s.caption,s.space]}>{draft.saving?'Saving draft…':draft.saved?'Draft saved on this device':draft.error?'Changes haven’t been saved':'Your draft saves as you write'}</Text>}
    </>}
    {!ATTENDEE_MESSAGE_SEND_ENABLED && !sending.attempt && <View style={s.delivery}><Text style={s.caption}>Sending isn’t available yet. Nothing is sent to attendees or scheduled from this draft.</Text></View>}
  </PageFrame>;
}
function Recovery({text,onRetry,disabled}:{text:string;onRetry:()=>void;disabled?:boolean}){const s=useStyles();return <View style={s.recovery}><Text accessibilityRole="alert" style={s.body}>{text}</Text><PageAction compact quiet title="Try again" disabled={disabled} onPress={onRetry}/></View>;}
function Choice({label,selected,disabled,onPress}:{label:string;selected:boolean;disabled:boolean;onPress:()=>void}){const s=useStyles();return <Pressable accessibilityRole="radio" accessibilityLabel={label} aria-checked={selected} accessibilityState={{checked:selected,disabled}} disabled={disabled} onPress={onPress} style={[s.choice,selected && s.selected]}><Text style={[s.choiceText,selected && s.selectedText]}>{label}</Text></Pressable>;}
function ReviewRow({label,value}:{label:string;value:string}){const s=useStyles();return <View style={s.reviewRow}><Text style={s.caption}>{label}</Text><Text style={s.body}>{value}</Text></View>;}
function createStyles(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  identity:{padding:16,borderWidth:1,borderColor:CreatorSurfaceColors.goldEdge,borderRadius:16,overflow:'hidden'},
  accessRecovery:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:12,padding:12,marginTop:12,borderWidth:1,borderColor:CreatorSurfaceColors.goldEdge,borderRadius:14,backgroundColor:Colors.white},accessRecoveryText:{flexGrow:1,flexBasis:140,minWidth:0},
  title:{fontFamily:fonts.semibold,fontSize:FontSizes.bodyLG,color:Colors.asphalt},venue:{marginTop:4},
  heading:{fontFamily:fonts.display,fontSize:FontSizes.displayMD,color:Colors.asphalt,marginTop:22,marginBottom:16},
  body:{fontFamily:fonts.regular,fontSize:FontSizes.bodyMD,lineHeight:20,color:Colors.textMedium},caption:{fontFamily:fonts.regular,fontSize:FontSizes.bodySM,lineHeight:18,color:Colors.textMedium},
  label:{fontFamily:fonts.medium,fontSize:FontSizes.bodyMD,color:Colors.asphalt},section:{fontFamily:fonts.medium,fontSize:FontSizes.bodyMD,color:Colors.asphalt,marginTop:22,marginBottom:8},
  fields:{gap:8},input:{backgroundColor:Colors.white,borderWidth:StyleSheet.hairlineWidth,borderColor:Colors.border,borderRadius:12,paddingHorizontal:12,paddingVertical:12,minHeight:44,fontFamily:fonts.regular,fontSize:FontSizes.bodyMD,color:Colors.asphalt},
  messageInput:{minHeight:120,maxHeight:260,lineHeight:20},choices:{flexDirection:'row',flexWrap:'wrap',gap:8,marginBottom:8},
  choice:{minHeight:44,paddingVertical:10,paddingHorizontal:12,borderRadius:22,borderWidth:1,borderColor:Colors.border,backgroundColor:Colors.white,justifyContent:'center',flexShrink:1},
  selected:{borderColor:Colors.terracotta,backgroundColor:Colors.inputBg},choiceText:{fontFamily:fonts.medium,fontSize:FontSizes.bodySM,color:Colors.asphalt},selectedText:{color:Colors.terracotta},
  disclosure:{flexDirection:'row',gap:8,alignItems:'center',alignSelf:'flex-start',minHeight:44},link:{fontFamily:fonts.medium,fontSize:FontSizes.bodyMD,color:Colors.terracotta},
  filterGroup:{gap:8},space:{marginTop:12},recovery:{backgroundColor:Colors.white,borderRadius:16,padding:16,gap:8,marginVertical:12},
  preview:{backgroundColor:Colors.white,borderRadius:18,padding:16,gap:12},messageBody:{fontFamily:fonts.regular,fontSize:FontSizes.bodyLG,lineHeight:24,color:Colors.asphalt},
  reviewActions:{marginTop:16,gap:8},
  reviewRows:{marginVertical:16,gap:8},reviewRow:{paddingVertical:8,gap:4,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:Colors.border},
  delivery:{marginTop:22,paddingTop:16,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:Colors.border},
}); }
function useStyles() { const {fonts}=useAfterglowFonts(true, 'creator'); return useMemo(()=>createStyles(fonts),[fonts]); }
