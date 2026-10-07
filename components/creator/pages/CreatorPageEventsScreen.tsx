import {ScaledText as Text} from '../../ScaledText';
import { eventCategories, validEventCategories } from '../../../lib/eventCategories';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Pressable,StyleSheet,View,useWindowDimensions} from 'react-native';
import {router} from 'expo-router';
import {loadCreatorPageTeamWorkspace} from '../../../lib/creatorPageTeamWorkspace';
import {createCreatorPageEventDraft,type CreatorPageScope} from '../../../lib/creatorPageReview';
import {readCreatorPageEventAttempt,prepareCreatorPageEventAttempt,clearCreatorPageEventAttempt,type CreatorPageEventAttempt} from '../../../lib/creatorPageEventAttempt';
import {EVENT_CATEGORIES} from '../../../lib/creatorEvents';
import {useCreatorPageScope} from '../../../hooks/useCreatorPageScope';
import {useCreatorPageRead} from '../../../hooks/useCreatorPageRead';
import {useAfterglowFonts} from '../../../hooks/useAfterglowFonts';
import {PageAction,PageFrame,pageStyles as s} from './PageFrame';
import Colors, {AfterglowColors as C} from '../../../constants/Colors';
import {LinearGradient} from 'expo-linear-gradient';
import {SceneDetailColors,CreatorSurfaceColors} from '../../../constants/Colors';
import {AfterglowType as T} from '../../../constants/Typography';
import {CreatorEventRow} from './CreatorEventRow';
import {CreatorEventDraftFields} from './CreatorEventDraftFields';
import {listCreatorEventTemplates,creatorTemplateRoute} from '../../../lib/creatorPageEventTemplateLibrary';
import {getTodayInLA} from '../../../lib/laDate';
import {CalendarDays,Plus,Users,Copy,Trash2} from 'lucide-react-native';
import {useCreatorTemplateDeletion} from '../../../hooks/useCreatorTemplateDeletion';
import {BrandedAlert} from '../../BrandedAlert';
import {takeSavedCreatorEvent} from '../../../lib/creatorEventReturn';
/** Published-page event entry; no owner application or review reads. */
export default function CreatorPageEventsScreen({pageId}:{pageId:string}) {
  const {scope,account}=useCreatorPageScope(`events:${pageId}`),{fonts}=useAfterglowFonts(true, 'creator');
  const read=useCallback(async(owned:CreatorPageScope)=>({page:await loadCreatorPageTeamWorkspace(pageId,owned),attempt:await readCreatorPageEventAttempt(pageId,owned)}),[pageId]);
  const {data,error,loading,refresh}=useCreatorPageRead(scope,read);
  const [activity,setActivity]=useState<{scope:CreatorPageScope;busy?:boolean;uncertain?:boolean;message?:string}>();
  const {width,fontScale}=useWindowDimensions();
  const [tabsWidth,setTabsWidth]=useState(Math.max(0,width-40));
  const compactTabs=tabsWidth<320*Math.max(1,fontScale);
  const [section,setSection]=useState<'Live'|'Drafts'|'Past'|'Templates'>('Live');
  const returningEvent=useRef<{id:string;pageId:string;epoch:number;scope:CreatorPageScope}|null>(null);
  const templateRead=useCallback((owned:CreatorPageScope)=>listCreatorEventTemplates(owned),[]);
  const templates=useCreatorPageRead(section==='Templates'&&data?.page&&!error?scope:null,templateRead);
  const deletion=useCreatorTemplateDeletion(scope,templates.refresh);
  const [preparing,setPreparing]=useState(false),[title,setTitle]=useState(''),[categories,setCategories]=useState<string[]>([]);
  const lock=useRef<CreatorPageScope|null>(null);
  useEffect(()=>{setPreparing(false);setTitle('');setCategories([]);},[scope]);
  // A focus change retires operations, but must not hide the draft just saved.
  useEffect(()=>{setSection('Live');},[pageId,account.epoch]);
  const active=activity?.scope===scope?activity:undefined,busy=!!active?.busy;
  const ready=!!scope?.isCurrent()&&!!data?.page&&!error&&!loading&&!busy&&!active?.uncertain;
  useEffect(()=>{
    if(ready&&scope){
      const savedId=takeSavedCreatorEvent(pageId,scope);
      if(savedId){
        const saved=data?.page?.events.find(event=>event.id===savedId);
        if(saved)setSection(eventSection(saved));
        returningEvent.current=null;
        return;
      }
    }
    const target=returningEvent.current;
    if(!target)return;
    if(target.pageId!==pageId||target.epoch!==account.epoch){returningEvent.current=null;return;}
    if(!ready||scope===target.scope)return;
    const saved=data?.page?.events.find(event=>event.id===target.id);
    if(saved)setSection(eventSection(saved));
    returningEvent.current=null;
  },[ready,scope,data,pageId,account.epoch]);
  const rememberEvent=(id:string)=>{if(scope)returningEvent.current={id,pageId,epoch:account.epoch,scope};};
  const text=[s.body,{fontFamily:fonts.regular}],small=[s.small,{fontFamily:fonts.regular}];
  const open=(eventId:string)=>{if(scope?.isCurrent()&&ready){rememberEvent(eventId);router.push(`/creator/event-form?id=${eventId}&pageId=${pageId}&team=1` as never);}};
  const check=async()=>{
    if(!scope?.isCurrent()||lock.current===scope)return;
    const owned=scope;lock.current=owned;setActivity({scope:owned,busy:true});
    try{const result=await refresh();if(result&&owned.isCurrent()){if(result.attempt)setPreparing(false);setActivity(undefined);}}
    catch{if(owned.isCurrent())setActivity({scope:owned,uncertain:true,message:'Could not check these events. Try again.'});}
    finally{if(lock.current===owned)lock.current=null;if(owned.isCurrent())setActivity(old=>old?.scope===owned?{...old,busy:false}:old);}
  };
  const create=async(pending?:CreatorPageEventAttempt)=>{
    if(!scope?.isCurrent()||!ready||lock.current===scope||(!pending&&(!title.trim()||!validEventCategories(eventCategories({categories},data?.page?.kind==='community')))))return;
    const owned=scope;lock.current=owned;setActivity({scope:owned,busy:true});
    try{
      // Fresh capability preflight and the existing creation RPC both enforce
      // current exact-page access; no title/category edit changes the saved ID.
      await loadCreatorPageTeamWorkspace(pageId,owned);
      const attempt=pending??await prepareCreatorPageEventAttempt(pageId,title,eventCategories({categories},data?.page?.kind==='community')[0],owned,eventCategories({categories},data?.page?.kind==='community'));
      const eventId=await createCreatorPageEventDraft(attempt,owned);
      try{await clearCreatorPageEventAttempt(attempt,owned);}catch{/* A confirmed event remains confirmed; check its marker on return. */}
      if(owned.isCurrent()){rememberEvent(eventId);setSection('Drafts');setPreparing(false);router.push(`/creator/event-form?id=${eventId}&pageId=${pageId}&team=1` as never);}
    }catch{if(owned.isCurrent())setActivity({scope:owned,uncertain:true,message:'We couldn’t confirm whether your draft was saved. Check before trying again so you don’t create it twice.'});}
    finally{if(lock.current===owned)lock.current=null;if(owned.isCurrent())setActivity(old=>old?.scope===owned?{...old,busy:false}:old);}
  };
  return <PageFrame onRefresh={!preparing?()=>{void check();if(section==='Templates')void templates.refresh().catch(()=>undefined);}:undefined} refreshing={!!data?.page && (loading||busy)} title={preparing?'New event':'Events'} busy={busy} onBack={preparing?()=>{if(!busy)setPreparing(false);}:undefined}
    footer={preparing&&data?.page&&!error?<PageAction primary title="Continue" disabled={!ready||!title.trim()||!validEventCategories(eventCategories({categories},data?.page?.kind==='community'))} onPress={()=>create()} />:undefined}>
    {(loading||account.isLoading)&&!data?.page&&<ActivityIndicator accessibilityLabel="Loading page events" color={C.clay} />}
    {(error||account.error)&&<View style={s.notice}><Text accessibilityRole="alert" style={small}>Could not load this page’s events. Your access may have changed.</Text><PageAction title="Check page events" disabled={busy} onPress={()=>void(account.error?account.retry():check())} /></View>}
    {!account.isLoading&&!loading&&!scope&&!account.error&&<Text style={text}>Sign in to manage this page’s events.</Text>}
    {active?.message&&!error&&!account.error&&<View style={s.notice}><Text accessibilityRole="alert" style={small}>{active.message}</Text>{active.uncertain&&<PageAction title="Check draft" disabled={busy||loading} onPress={()=>check()} />}</View>}
    {data?.page&&!error&&scope?.isCurrent()&&<>
      <LinearGradient colors={[SceneDetailColors.middle,SceneDetailColors.lower]} start={{x:0,y:0}} end={{x:1,y:1}} style={look.identity}>
        <Text style={[look.kind,{fontFamily:fonts.medium}]}>{data.page.kind==='community'?'COMMUNITY':'ORGANIZATION'}</Text>
        <Text accessibilityRole="header" style={[look.name,{fontFamily:fonts.display}]}>{data.page.name}</Text>
      </LinearGradient>
      {preparing&&<Text style={text}>Give your event a name.{'\n'}Next, add the details and choose when to publish.</Text>}
      {preparing?<>
        <CreatorEventDraftFields title={title} categories={categories} community={data?.page?.kind==='community'} ready={ready&&!data.attempt} onTitle={setTitle} onCategories={setCategories} />
      </>:<>
        {data.attempt&&<View style={s.notice}><Text style={small}>Continue your saved event attempt: {data.attempt.title}</Text><PageAction title="Continue saved draft" disabled={!ready} onPress={()=>create(data.attempt!)} /></View>}
        <View style={look.eventsHeading}>
          <Text accessibilityRole="header" style={[look.section,{fontFamily:fonts.semibold}]}>Your events</Text>
          <PageAction compact primary leadingIcon={<Plus size={18} color={Colors.white} strokeWidth={1.8}/>} title="New event" disabled={!ready||!!data.attempt} onPress={()=>setPreparing(true)} />
        </View>
        <View accessibilityRole="tablist" style={look.tabs} onLayout={event=>setTabsWidth(event.nativeEvent.layout.width)}>
          {(['Live','Drafts','Past','Templates'] as const).map(name=><Pressable key={name} accessibilityRole="tab" accessibilityLabel={name} aria-selected={section===name} accessibilityState={{selected:section===name}} onPress={()=>{deletion.cancel();setSection(name);}} style={[look.tab,{flexBasis:compactTabs?'48%':'23%'},section===name&&look.selectedTab]}>{section===name&&<LinearGradient pointerEvents="none" colors={[CreatorSurfaceColors.selectionTop,CreatorSurfaceColors.selectionBottom]} start={{x:0,y:0}} end={{x:1,y:1}} style={[StyleSheet.absoluteFill,{borderRadius:9}]}/>}<Text style={[look.tabText,{fontFamily:fonts.medium},section===name&&{color:C.ink}]}>{name}</Text></Pressable>)}
        </View>
        {section==='Templates'?<View style={look.collection}>
          <Text style={small}>Choose a saved format for your next event.</Text>
          {deletion.current?.phase==='deleting'&&<ActivityIndicator accessibilityLabel="Deleting template" color={Colors.terracotta}/>}
          {(deletion.current?.phase==='check'||deletion.current?.phase==='checking')&&<View style={s.notice}><Text accessibilityRole="alert" style={small}>{deletion.current.message}</Text><PageAction title="Check templates" disabled={deletion.busy} onPress={()=>deletion.check()}/></View>}
          {templates.loading?<ActivityIndicator accessibilityLabel="Loading templates" color={Colors.terracotta}/>:templates.error?<View style={s.notice}><Text style={small}>Couldn’t load your templates.</Text><PageAction title="Try templates again" onPress={()=>{void templates.refresh().catch(()=>undefined);}}/></View>:<>
            {!templates.data?.some(template=>!deletion.removedIds.includes(template.id))&&<Text style={text}>No templates yet. Save an event as a template from its editor to use it again.</Text>}
            {templates.data?.filter(template=>!deletion.removedIds.includes(template.id)).map(template=><View key={template.id} style={[look.teamButton,look.templateCard]}>
              <PageAction quiet disclosure leadingIcon={<Copy size={18} color={Colors.terracotta}/>} title={template.name} disabled={!ready||templates.loading}
                onPress={()=>{if(scope?.isCurrent()&&ready)router.push(creatorTemplateRoute(template) as never);}}/>
              <View style={look.templateFooter}><Text style={[small,{flex:1}]}>{template.source_page_id===pageId?`For ${data.page.name}`:template.source_page_id?'Saved for another page':'Personal template'}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={`Delete template: ${template.name}`} disabled={!ready||templates.loading||!!deletion.current} accessibilityState={{disabled:!ready||templates.loading||!!deletion.current}} style={look.deleteTemplate} onPress={()=>{if(ready&&scope?.isCurrent())deletion.choose(template);}}><Trash2 size={18} strokeWidth={1.6} color={C.muted}/></Pressable>
              </View>
            </View>)}
          </>}
        </View>:<View style={look.collection}>
          {data.page.events.filter(event=>eventSection(event)===section).map(event=>{const displayStatus=section==='Past'&&event.status==='Live'?'Ended':undefined;return <CreatorEventRow key={event.id} event={event} displayStatus={displayStatus} ready={ready} isCurrent={()=>!!scope?.isCurrent()}
            editLabel={`Open ${event.title}, ${displayStatus??(event.status==='Draft'?'private draft':event.status)}`}
            onEdit={()=>open(event.id)}
            onManage={()=>{if(scope?.isCurrent()&&ready){rememberEvent(event.id);router.push(`/creator/event-summary?id=${event.id}&pageId=${pageId}` as never);}}}
            onDuplicate={()=>{if(scope?.isCurrent()&&ready)router.push(`/creator/page-event-reuse?pageId=${pageId}&sourceEventId=${event.id}` as never);}}
            onView={event.status==='Live'?()=>{if(scope?.isCurrent()&&ready)router.push(`/event/${event.id}` as never);}:undefined}/>;})}
          {!data.page.events.some(event=>eventSection(event)===section)&&<View style={look.empty}>
            <CalendarDays size={24} color={Colors.terracotta}/>
            <Text style={[look.emptyName,{fontFamily:fonts.display}]}>{section==='Live'?'Your next gathering starts here':section==='Drafts'?'Room for your next idea':'Your past events will be here'}</Text>
            <Text style={small}>{section==='Live'?'No live events right now. Create an event or continue a draft.':section==='Drafts'?'No drafts yet. Start an event and finish the details at your own pace.':'Completed, cancelled and earlier dated events stay available here.'}</Text>
          </View>}
        </View>}
        <View style={look.tools}>
        <View style={look.teamButton}><PageAction quiet disclosure leadingIcon={<Users size={19} color={Colors.terracotta}/>} title="Page & team" disabled={!ready} onPress={()=>{if(scope?.isCurrent()&&ready)router.dismissTo(`/creator/page-team?id=${pageId}` as never);}} /></View>
        </View>
      </>}
    </>}
    <BrandedAlert scrollMessage visible={deletion.current?.phase==='confirm'&&ready&&section==='Templates'} title="Delete this template?" message={deletion.current?`“${deletion.current.template.name}” will be permanently removed from your templates. Events created from it stay saved.`:undefined} onClose={deletion.cancel} appearance={{fonts,variant:'creator'}} buttons={[{text:'Keep template',style:'cancel'},{text:'Delete template',style:'destructive',onPress:()=>{void deletion.confirm();}}]}/>
  </PageFrame>;
}

export function eventSection(event:{status:string;event_date?:string|null}):'Live'|'Drafts'|'Past'{
 if(event.status==='Draft')return 'Drafts';
 if(['Completed','Cancelled','Archived'].includes(event.status))return 'Past';
 const today=getTodayInLA(),date=`${today.y}-${String(today.m+1).padStart(2,'0')}-${String(today.d).padStart(2,'0')}`;
 return event.event_date&&/^\d{4}-\d{2}-\d{2}$/.test(event.event_date)&&event.event_date<date?'Past':'Live';
}
const look=StyleSheet.create({
 tabs:{flexDirection:'row',flexWrap:'wrap',marginTop:20,padding:4,borderRadius:12,backgroundColor:Colors.inputBg,gap:2},
 tab:{flexGrow:1,flexShrink:1,minWidth:0,minHeight:44,paddingHorizontal:8,alignItems:'center',justifyContent:'center',paddingVertical:8,borderRadius:9},
 selectedTab:{backgroundColor:Colors.white,shadowColor:C.ink,shadowOpacity:0.07,shadowRadius:4,shadowOffset:{width:0,height:2},elevation:1},
 tabText:{...T.caption,color:C.muted,textAlign:'center',width:'100%'},
 identity:{gap:8,marginBottom:24,padding:20,borderRadius:18,borderBottomWidth:1,borderBottomColor:Colors.goldAccent},
 kind:{...T.timestamp,color:SceneDetailColors.supporting,letterSpacing:1.2},name:{...T.pageTitle,color:SceneDetailColors.text},emptyName:{...T.pageTitle,color:C.ink},
 empty:{backgroundColor:Colors.white,borderRadius:16,padding:20,gap:12,marginTop:20},
 eventsHeading:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8},
 collection:{marginTop:24,gap:12},section:{...T.contextTitle,color:C.ink},
 groupLabel:{...T.timestamp,color:C.muted,letterSpacing:1,textTransform:'uppercase'},
  templateCard:{borderLeftWidth:3,borderLeftColor:Colors.goldAccent},
  templateFooter:{flexDirection:'row',alignItems:'center',gap:12,paddingBottom:4},
  deleteTemplate:{width:44,minHeight:44,alignItems:'center',justifyContent:'center',borderRadius:8},
 teamButton:{backgroundColor:Colors.white,borderRadius:14,borderWidth:1,borderColor:C.subtleLine,paddingHorizontal:16,paddingVertical:4},
 tools:{marginTop:24,gap:4},
});
