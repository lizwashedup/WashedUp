import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Switch, Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import Colors, { CreatorSurfaceColors } from '../../constants/Colors';
import { LinearGradient } from 'expo-linear-gradient';
import { requestWithDeadline } from '../../lib/requestWithDeadline';
import { eventSummaryId } from '../../lib/eventSummary';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { FontSizes, type AfterglowFontFamilies } from '../../constants/Typography';
import { reminderDeliveryCopy } from '../../lib/eventReminders';
import { hapticLight } from '../../lib/haptics';
import { getCommunicationEvent, type CommunicationEvent } from '../../lib/creatorCommunications';
import type { CreatorPageScope } from '../../lib/creatorPageReview';
import { useCreatorPageScope } from '../../hooks/useCreatorPageScope';
import { useCreatorPageRead } from '../../hooks/useCreatorPageRead';
import { useEventReminderSettings } from '../../hooks/useEventReminderSettings';
import { useCommunicationDraftExit } from '../../hooks/useCommunicationDraftExit';
import { PageFrame, PageAction } from '../../components/creator/pages/PageFrame';

let nextReminderVisit=0;
export default function EventRemindersScreen() {
  const s = useStyles();
  const params=useLocalSearchParams<{id?:string;pageId?:string}>(),id=eventSummaryId(params.id),pageId=eventSummaryId(params.pageId);
  const { scope, account } = useCreatorPageScope(`event-reminders:${pageId??''}:${id??''}`);
  const visit=useMemo(()=>({id:++nextReminderVisit,denials:0,denied:false}),[scope,id,pageId]),latest=useRef(visit),mounted=useRef(true);
  latest.current=visit;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const ownedScope=useMemo(()=>scope?{userId:scope.userId,isCurrent:()=>mounted.current&&latest.current===visit&&scope.isCurrent()}:null,[scope,visit]);
  const gate=useRef({visit,ready:false});
  const read=useCallback(async(initiatingScope:CreatorPageScope)=>{
    let reading=true;
    const owned={userId:initiatingScope.userId,isCurrent:()=>reading&&initiatingScope.isCurrent()};
    try{
      if(!owned.isCurrent())throw Error('This visit has ended.');
      const result=await requestWithDeadline(getCommunicationEvent(id!,owned),12_000);
      if(!owned.isCurrent())throw Error('This visit has ended.');
      if(!result){visit.denials++;visit.denied=true;gate.current.ready=false;}
      else visit.denied=false;
      return result;
    }finally{reading=false;}
  },[id,visit]);
  const event=useCreatorPageRead(id?ownedScope:null,read);
  const editorScope=useMemo(()=>{
    const generation=visit.denials;
    return ownedScope?{userId:ownedScope.userId,isCurrent:()=>ownedScope.isCurrent()&&!visit.denied&&visit.denials===generation}:null;
  },[ownedScope,visit,visit.denials]);
  const retryLock=useRef<object|null>(null),[retryVisit,setRetryVisit]=useState<object|null>(null);
  const retrying=retryVisit===visit;
  const active=!!editorScope?.isCurrent()&&!account.isLoading&&!account.error&&!!event.data&&!event.error&&!event.loading&&!retrying&&retryLock.current!==visit;
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
  const confirmed=!!editorScope?.isCurrent()&&!account.isLoading&&!account.error&&!!event.data;
  const updating=event.loading||retrying;
  return <PageFrame title="Event reminders" onBack={back} onRefresh={retry} refreshing={confirmed&&updating}>
    {account.isLoading||updating&&!confirmed?<ActivityIndicator accessibilityLabel="Loading reminders" color={Colors.terracotta}/>:
      confirmed&&editorScope?<ReminderEditor key={`${visit.id}:${visit.denials}`} event={event.data!} scope={editorScope} active={active} isActive={isActive}
        accessError={event.error} accessBusy={updating} retryAccess={retry}/>:
        <View style={s.recovery}><Text accessibilityRole="header" style={s.title}>{account.error||event.error?'Couldn’t load reminders':'Event unavailable'}</Text>
          <Text style={s.body}>{account.error||event.error?'Try again to check this event and your saved preferences.':'This event isn’t available for this account.'}</Text>
          {(account.error||event.error)&&<PageAction compact singleLine title="Try again" onPress={retry}/>}</View>}
  </PageFrame>;
}
function ReminderEditor({event, scope, active, isActive, accessError, accessBusy, retryAccess}: {event: CommunicationEvent; scope: CreatorPageScope; active: boolean; isActive:()=>boolean; accessError?: string; accessBusy:boolean; retryAccess: () => void}) {
  const s = useStyles();
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const canAct=()=>mounted.current&&scope.isCurrent()&&isActive();
  const settings = useEventReminderSettings(event.id, scope, canAct);
  const latestSettings=useRef(settings);latestSettings.current=settings;
  const refreshSettings=()=>{const value=latestSettings.current;if(canAct()&&!value.loading&&!value.busy)void value.refresh();};
  const saveSettings=()=>{const value=latestSettings.current;if(canAct()&&value.canSave)void value.save();};
  const retryLocal=()=>{const value=latestSettings.current;if(canAct()&&!value.localSaving)void value.retryLocal();};
  const resolveConflict=(useSaved:boolean)=>{const value=latestSettings.current;if(canAct()&&value.editable)value.resolveConflict(useSaved);};
  useCommunicationDraftExit(scope, {loaded:settings.loaded, saving:settings.localSaving, readError:settings.readError,
    error:settings.localError, save:settings.retryLocal});
  const change = (field: 'dayBeforeOn' | 'dayOfOn', value: boolean) => {
    if(!canAct()||!latestSettings.current.editable)return;
    hapticLight();latestSettings.current.change(field,value);
  };
  return <>
    <View style={s.identity}>
      <LinearGradient pointerEvents="none" colors={[CreatorSurfaceColors.sunsetGoldLight,Colors.white]} start={{x:0,y:0}} end={{x:1,y:1}} style={StyleSheet.absoluteFill}/>
      <Text accessibilityRole="header" style={s.title}>{event.title}</Text>
      {!!event.venue&&<Text style={[s.body,s.venue]}>{event.venue}</Text>}
    </View>
    <Text style={s.heading}>A little reminder helps</Text>
    <Text style={[s.body, s.intro]}>Choose the reminders you’d like to prepare for your attendees.</Text>
    {(accessBusy||accessError)&&<View style={s.accessRecovery} accessibilityRole={accessError?'alert':undefined}>
      <Text style={[s.body,s.accessRecoveryText]}>{accessBusy?(settings.draft?'Checking event access. Your draft stays here.':'Checking event access…'):(settings.draft?'Couldn’t refresh event access. Your draft is kept here.':'Couldn’t refresh event access.')}</Text>
      <PageAction compact singleLine title={accessBusy?'Retrying…':'Try again'} disabled={accessBusy} onPress={()=>{if(mounted.current&&scope.isCurrent())retryAccess();}}/>
    </View>}
    {!settings.loaded && !settings.error ? <ActivityIndicator accessibilityLabel="Loading saved reminders" color={Colors.terracotta}/> : <>
      {!!settings.error && <View style={s.recovery}><Text accessibilityRole="alert" style={s.body}>{settings.error}</Text>
        <PageAction compact quiet singleLine title={settings.uncertain ? "Check saved" : "Try again"} disabled={!active || settings.loading || settings.busy}
          onPress={refreshSettings}/></View>}
      {settings.loaded && settings.draft && !settings.denied && <>
        <View style={s.group}>
          <Reminder title="The day before" timing="About 24 hours before the event" value={settings.draft.dayBeforeOn} disabled={!active || !settings.editable}
            onChange={v => change('dayBeforeOn', v)}/>
          <View style={s.divider}/>
          <Reminder title="On the day" timing="About 2 hours before the event" value={settings.draft.dayOfOn} disabled={!active || !settings.editable}
            onChange={v => change('dayOfOn', v)}/>
        </View>
        {settings.conflict && !settings.uncertain && settings.remote && <View style={s.conflict}>
          <Text accessibilityRole="alert" style={s.label}>Your team’s saved settings changed</Text>
          <Text style={s.body}>Saved: day before {settings.remote.dayBeforeOn ? 'on' : 'off'} · on the day {settings.remote.dayOfOn ? 'on' : 'off'}. Your draft is still above.</Text>
          <View style={s.actions}><PageAction compact quiet singleLine title="Use saved" disabled={!active || !settings.editable} onPress={()=>resolveConflict(true)}/>
            <PageAction compact quiet singleLine title="Keep my changes" disabled={!active || !settings.editable} onPress={()=>resolveConflict(false)}/></View>
        </View>}
        <Text accessibilityLiveRegion="polite" style={s.saveStatus}>{settings.busy ? 'Saving event settings…' : settings.uncertain ? 'Save not yet confirmed.' : settings.closed ? 'This event no longer accepts reminder changes.' : settings.saved ? 'Saved for this event' : settings.localSaving ? 'Keeping your draft…' : 'Draft changes — save to update this event.'}</Text>
        {!!settings.localError && <View style={s.conflict}><Text accessibilityRole="alert" style={s.body}>{settings.localError}</Text>
          <PageAction compact quiet singleLine title="Retry draft" disabled={!active || settings.localSaving} onPress={retryLocal}/></View>}
        {!settings.saved && !settings.closed && <View style={s.saveAction}><PageAction compact primary singleLine title="Save settings" disabled={!active || !settings.canSave} onPress={saveSettings}/></View>}
      </>}
    </>}
    {settings.remote && !settings.denied && <View style={s.delivery}>
      <View style={s.statusHeading}><Text style={s.label}>Reminder status</Text>
        <PageAction compact quiet singleLine title="Refresh status" disabled={!active || settings.loading || settings.busy} onPress={refreshSettings}/></View>
      <Text style={s.body}>{reminderDeliveryCopy(settings.remote)}</Text>
      {!!settings.remote.deliverySummary?.length && <>
        {settings.remote.deliverySummary.map(item => <View key={item.timing} style={s.statusRow}>
          <Text style={s.label}>{item.timing === 'day_before' ? 'The day before' : 'On the day'}</Text>
          <Text style={s.caption}>{item.queuedCount} queued{item.stoppedCount ? ` · ${item.stoppedCount} stopped` : ''}</Text>
        </View>)}
        <Text style={s.caption}>Queued does not confirm delivery. Stopped reminders will not be pushed.</Text>
      </>}
    </View>}

  </>;
}
function Reminder({title, timing, value, disabled, onChange}: {title: string; timing: string; value: boolean; disabled: boolean; onChange: (value: boolean) => void}) {
  const s = useStyles();
  return <View style={s.reminder}>
    <View style={s.row}><View style={s.rowText}><Text style={s.label}>{title}</Text><Text style={s.caption}>{timing}</Text></View>
      <Switch accessibilityLabel={`${title} reminder draft`} accessibilityHint="Changes your draft. Use Save settings to update the event." value={value} disabled={disabled} onValueChange={onChange}
        trackColor={{false: Colors.border, true: Colors.terracotta}} thumbColor={Colors.white}
        {...(Platform.OS === 'web' ? {activeThumbColor: Colors.white} : {})}/></View>
  </View>;
}
function createStyles(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  identity:{padding:16,borderWidth:1,borderColor:CreatorSurfaceColors.goldEdge,borderRadius:16,overflow:'hidden'},
  accessRecovery:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:12,padding:12,marginBottom:16,borderWidth:1,borderColor:CreatorSurfaceColors.goldEdge,borderRadius:14,backgroundColor:Colors.white},
  accessRecoveryText:{flexGrow:1,flexBasis:140,minWidth:0},
  title: {fontFamily: fonts.semibold, fontSize: FontSizes.bodyLG, color: Colors.asphalt},
  venue: {marginTop: 4}, heading: {fontFamily: fonts.display, fontSize: FontSizes.displayMD, color: Colors.asphalt, marginTop: 22, marginBottom: 6},
  body: {fontFamily: fonts.regular, fontSize: FontSizes.bodyMD, lineHeight: 20, color: Colors.textMedium},
  caption: {fontFamily: fonts.regular, fontSize: FontSizes.bodySM, lineHeight: 18, color: Colors.textMedium},
  intro: {marginBottom: 18}, group: {backgroundColor: Colors.white, borderRadius: 18, paddingHorizontal: 14},
  reminder: {paddingVertical: 14, gap: 12}, row: {flexDirection: 'row', alignItems: 'center', gap: 10}, rowText: {flex: 1, minWidth: 0, gap: 4},
  label: {fontFamily: fonts.medium, fontSize: FontSizes.bodyMD, color: Colors.asphalt},
  statusHeading: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6},
  statusRow: {gap: 3, paddingVertical: 4},
  divider: {height: StyleSheet.hairlineWidth, backgroundColor: Colors.border},
  saveStatus: {fontFamily: fonts.regular, fontSize: FontSizes.bodySM, color: Colors.textMedium, lineHeight: 18, marginTop: 10},
  delivery: {marginTop: 24, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border, gap: 6},
  actions: {flexDirection: 'row', flexWrap: 'wrap', gap: 12}, conflict: {marginTop: 14, gap: 6}, saveAction: {marginTop: 14},
  recovery: {backgroundColor: Colors.white, borderRadius: 16, padding: 16, gap: 8, marginBottom: 16},
}); }
function useStyles() { const {fonts}=useAfterglowFonts(true, 'creator'); return useMemo(()=>createStyles(fonts),[fonts]); }
