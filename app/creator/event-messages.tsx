import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { EventMediaImage } from '../../components/events/EventMediaImage';
import { useLocalSearchParams, router } from 'expo-router';
import { Bell, ChevronRight, SendHorizonal, UserPlus } from 'lucide-react-native';
import Colors, { CreatorSurfaceColors } from '../../constants/Colors';
import { LinearGradient } from 'expo-linear-gradient';
import { requestWithDeadline } from '../../lib/requestWithDeadline';
import { eventSummaryId } from '../../lib/eventSummary';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { ATTENDEE_MESSAGE_SEND_ENABLED, INVITE_AUDIENCE_ENABLED } from '../../constants/FeatureFlags';
import { AttendeeMessageHistory } from '../../components/creator/AttendeeMessageHistory';
import { FontSizes, type AfterglowFontFamilies } from '../../constants/Typography';
import { hapticLight } from '../../lib/haptics';
import { getCommunicationEvent, getCommunicationAudience, CommunicationAudienceDenied } from '../../lib/creatorCommunications';
import type { CreatorPageScope } from '../../lib/creatorPageReview';
import { useCreatorPageScope } from '../../hooks/useCreatorPageScope';
import { useCreatorPageRead } from '../../hooks/useCreatorPageRead';
import { PageFrame, PageAction } from '../../components/creator/pages/PageFrame';

async function boundedRead<T>(scope:CreatorPageScope,read:(owned:CreatorPageScope)=>Promise<T>):Promise<T>{
  let reading=true;
  const owned={userId:scope.userId,isCurrent:()=>reading&&scope.isCurrent()};
  try{
    if(!owned.isCurrent())throw Error('This visit has ended.');
    const result=await requestWithDeadline(read(owned),12_000);
    if(!owned.isCurrent())throw Error('This visit has ended.');
    return result;
  }finally{reading=false;}
}

export default function EventMessagesScreen() {
  const styles = useStyles();
  const params=useLocalSearchParams<{id?:string;pageId?:string}>();
  const id=eventSummaryId(params.id),pageId=eventSummaryId(params.pageId);
  const { scope, account } = useCreatorPageScope(`event-messages:${pageId??''}:${id??''}`);
  const visit=useMemo(()=>({denials:0,denied:false}),[scope,id,pageId]),latest=useRef(visit),mounted=useRef(true);
  latest.current=visit;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const ownedScope=useMemo(()=>scope?{userId:scope.userId,isCurrent:()=>mounted.current&&latest.current===visit&&scope.isCurrent()}:null,[scope,visit]);
  const gate=useRef({visit,ready:false});
  const [audienceDenial,setAudienceDenial]=useState<object|null>(null);
  const readEvent = useCallback((owned:CreatorPageScope)=>boundedRead(owned,async reading=>{
    const result=await getCommunicationEvent(id!,reading);
    if(!reading.isCurrent())throw Error('This visit has ended.');
    if(!result){visit.denials++;visit.denied=true;gate.current.ready=false;}
    else {visit.denied=false;setAudienceDenial(null);}
    return result;
  }),[id,visit]);
  const event = useCreatorPageRead(id ? ownedScope : null, readEvent);
  const readAudience = useCallback(async(owned:CreatorPageScope)=>{
    const denialGeneration=visit.denials;
    try{
      return await boundedRead({userId:owned.userId,isCurrent:()=>owned.isCurrent()&&!visit.denied&&visit.denials===denialGeneration},reading=>getCommunicationAudience(id!,reading));
    }catch(error){
      if(error instanceof CommunicationAudienceDenied&&owned.isCurrent()){
        visit.denials++;visit.denied=true;
        if(gate.current.visit===visit)gate.current.ready=false;
        setAudienceDenial(visit);
      }
      throw error;
    }
  },[id,visit]);
  const audienceScope=useMemo(()=>{
    const generation=visit.denials;
    return ownedScope?{userId:ownedScope.userId,isCurrent:()=>ownedScope.isCurrent()&&!visit.denied&&visit.denials===generation}:null;
  },[ownedScope,visit,visit.denials]);
  const audience = useCreatorPageRead(event.data&&!visit.denied ? audienceScope : null, readAudience);
  const [failedImage, setFailedImage] = useState<{visit:object;reference:string}>();
  const retryLock=useRef<object|null>(null),[retryVisit,setRetryVisit]=useState<object|null>(null);
  const retrying=retryVisit===visit;
  const current=()=>mounted.current&&latest.current===visit&&(ownedScope?.isCurrent()??account.isCurrent());
  const active=!!ownedScope?.isCurrent()&&!account.isLoading&&!account.error&&!!event.data&&!visit.denied&&!event.error&&!event.loading&&!!audience.data&&!audience.error&&!audience.loading&&!retrying&&retryLock.current!==visit;
  gate.current={visit,ready:active};
  const retry=()=>{
    if(!id||!current()||retryLock.current===visit||event.loading||audience.loading||account.isLoading)return;
    retryLock.current=visit;gate.current.ready=false;setRetryVisit(visit);
    void(async()=>{
      if(account.error){await account.retry();return;}
      const checked=await event.refresh();
      if(!current()||!checked)return;
      // A first successful event read mounts the audience read automatically.
      if(event.data&&!visit.denied)await audience.refresh();
    })().catch(()=>undefined).finally(()=>{
      if(retryLock.current===visit)retryLock.current=null;
      if(mounted.current&&latest.current===visit)setRetryVisit(null);
    });
  };
  const open = (route:string) => {if(current()&&gate.current.visit===visit&&gate.current.ready){hapticLight();router.push(`${route}?id=${encodeURIComponent(id!)}` as never);}};
  const back=()=>{
    if(!current())return;
    if(router.canGoBack())router.back();
    else router.replace((id?`/creator/event-summary?id=${encodeURIComponent(id)}${pageId?`&pageId=${encodeURIComponent(pageId)}`:''}`:'/creator/pages') as never);
  };
  const confirmed=!!ownedScope?.isCurrent()&&!account.isLoading&&!account.error&&!!event.data&&!visit.denied&&audienceDenial!==visit;
  const updating=event.loading||audience.loading||retrying;
  const problem=!!event.error||!!audience.error;
  return <PageFrame title="Messages" onBack={back} onRefresh={retry} refreshing={confirmed&&updating}>
    {account.isLoading || (event.loading||retrying) && !confirmed ? <ActivityIndicator accessibilityLabel="Loading event messages" color={Colors.terracotta}/> :
      !confirmed ? <View style={styles.recovery}>
        <Text accessibilityRole="header" style={styles.title}>{account.error || event.error ? 'Couldn’t load messages' : 'Event unavailable'}</Text>
        <Text style={styles.body}>{account.error || event.error ? 'Your event could not be checked. Try again.' : 'This event isn’t available for this account.'}</Text>
        {(account.error || event.error) && <PageAction quiet compact title="Try again" singleLine onPress={retry}/>}
      </View> : <>
        <View style={styles.identity}>
          <LinearGradient pointerEvents="none" colors={[CreatorSurfaceColors.sunsetGoldLight,Colors.white]} start={{x:0,y:0}} end={{x:1,y:1}} style={StyleSheet.absoluteFill}/>
          {event.data!.image && !(failedImage?.visit===visit&&failedImage.reference===event.data!.image) ? <EventMediaImage eventId={event.data!.id} reference={event.data!.image} style={styles.image} contentFit="cover" accessibilityLabel={`${event.data!.title} artwork`} onError={() => {if(current())setFailedImage({visit,reference:event.data!.image!});}}/>
            : <View style={[styles.image,styles.monogram]}><Text style={styles.initial}>{event.data!.title.slice(0,1)}</Text></View>}
          <View style={styles.identityText}><Text accessibilityRole="header" style={styles.title}>{event.data!.title}</Text>
            {!!event.data!.venue && <Text style={styles.body}>{event.data!.venue}</Text>}</View>
        </View>
        {(event.loading||event.error||retrying)&&<View style={styles.inlineRecovery} accessibilityRole={problem?'alert':undefined}>
          <Text style={[styles.body,styles.recoveryText]}>{updating?'Checking event access and registration counts…':'Couldn’t refresh event access. Showing the last confirmed details.'}</Text>
          <PageAction compact singleLine title={updating?'Retrying…':'Try again'} disabled={updating} onPress={retry}/>
        </View>}
        <Text style={styles.heading}>Keep people in the loop</Text>
        <Text style={[styles.body,styles.intro]}>Prepare a useful update for the people joining you.</Text>
        <PageAction primary singleLine title="Write message" accessibilityLabel="New attendee message" disabled={!active}
          leadingIcon={<SendHorizonal size={18} color={Colors.white}/>} onPress={() => open('/creator/attendee-message')}/>
        <View style={styles.actions}>
          {INVITE_AUDIENCE_ENABLED && <Pressable accessibilityRole="button" accessibilityLabel="Invite people" accessibilityState={{disabled:!active}} disabled={!active} onPress={() => open('/creator/invite-audience')} style={styles.action}>
            <UserPlus size={20} color={Colors.terracotta}/><View style={styles.actionText}><Text style={styles.actionTitle}>Invite people</Text><Text style={styles.body}>Prepare an invitation for this page’s audience.</Text></View><ChevronRight size={18} color={Colors.textMedium}/>
          </Pressable>}
          <Pressable accessibilityRole="button" accessibilityLabel="Edit reminders" accessibilityState={{disabled:!active}} disabled={!active} onPress={() => open('/creator/event-reminders')} style={styles.action}>
            <Bell size={20} color={Colors.terracotta}/><View style={styles.actionText}><Text style={styles.actionTitle}>Event reminders</Text><Text style={styles.body}>Prepare day-before and day-of reminders.</Text></View><ChevronRight size={18} color={Colors.textMedium}/>
          </Pressable>
        </View>
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.label}>Registration audience</Text>
          {audience.data&&<>
            <Text style={styles.body}>{audience.data.purchases} ticket {audience.data.purchases === 1 ? 'purchase' : 'purchases'} · {audience.data.rsvps} {audience.data.rsvps === 1 ? 'RSVP' : 'RSVPs'}</Text>
            <Text style={styles.caption}>Recipient totals depend on your audience and delivery preferences.</Text>
          </>}
          {!audience.data&&audience.loading&&<ActivityIndicator accessibilityLabel="Loading registration audience" color={Colors.terracotta}/>}
          {audience.data&&updating&&<Text style={styles.caption}>Updating registration counts. Showing the last confirmed counts.</Text>}
          {audience.data&&event.error&&<Text style={styles.caption}>Registration counts were last confirmed before this access check.</Text>}
          {audience.error&&<View style={styles.audienceRecovery} accessibilityRole="alert">
            <Text style={[styles.body,styles.recoveryText]}>{audience.data?'Couldn’t refresh the registration audience. Showing the last confirmed counts.':'Couldn’t load the registration audience.'}</Text>
            {!retrying&&!event.error&&<PageAction compact singleLine title="Try again" disabled={updating} onPress={retry}/>}
          </View>}

        </View>
        {ATTENDEE_MESSAGE_SEND_ENABLED && ownedScope && active ? <AttendeeMessageHistory eventId={id!} scope={ownedScope}/> :
          <View style={[styles.section,styles.divider]}><Text accessibilityRole="header" style={styles.label}>Delivery</Text><Text style={styles.body}>{ATTENDEE_MESSAGE_SEND_ENABLED?'Event access needs to be checked before reading updates.':'Sending isn’t available yet. You can prepare drafts; nothing is sent or scheduled.'}</Text></View>}
      </>}
  </PageFrame>;
}
function createStyles(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  identity:{flexDirection:'row',gap:12,alignItems:'center',marginBottom:20,padding:16,borderWidth:1,borderColor:CreatorSurfaceColors.goldEdge,borderRadius:16,overflow:'hidden'},
  image:{width:60,height:72,borderRadius:8},monogram:{backgroundColor:Colors.inputBg,alignItems:'center',justifyContent:'center'},
  initial:{fontFamily:fonts.display,fontSize:FontSizes.displayMD,color:Colors.terracotta},
  identityText:{flex:1,minWidth:0,gap:4},title:{fontFamily:fonts.semibold,fontSize:FontSizes.bodyLG,color:Colors.asphalt},
  heading:{fontFamily:fonts.display,fontSize:FontSizes.displayMD,color:Colors.asphalt,marginBottom:6},
  intro:{marginBottom:18},body:{fontFamily:fonts.regular,fontSize:FontSizes.bodyMD,color:Colors.textMedium,lineHeight:20},
  caption:{fontFamily:fonts.regular,fontSize:FontSizes.bodySM,color:Colors.textMedium,lineHeight:18},
  actions:{marginTop:16,backgroundColor:Colors.white,borderRadius:12,paddingHorizontal:14},action:{flexDirection:'row',gap:12,alignItems:'center',minHeight:56,paddingVertical:14},
  actionText:{flex:1,minWidth:0,gap:4},actionTitle:{fontFamily:fonts.medium,fontSize:FontSizes.bodyMD,color:Colors.terracotta},
  divider:{borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:Colors.border},
  section:{marginTop:20,paddingTop:12,gap:6},label:{fontFamily:fonts.medium,fontSize:FontSizes.bodySM,color:Colors.asphalt},
  inlineRecovery:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:12,padding:12,marginBottom:16,borderRadius:14,borderWidth:1,borderColor:CreatorSurfaceColors.goldEdge,backgroundColor:Colors.white},
  audienceRecovery:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:12},
  recoveryText:{flexGrow:1,flexBasis:140,minWidth:0},
  recovery:{backgroundColor:Colors.white,borderRadius:16,padding:16,gap:8,marginBottom:16},
}); }
function useStyles() { const {fonts}=useAfterglowFonts(true, 'creator'); return useMemo(()=>createStyles(fonts),[fonts]); }
