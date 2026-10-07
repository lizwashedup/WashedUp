import React,{useMemo,useRef,useEffect,useState} from 'react';
import {Pressable,StyleSheet,Text,View} from 'react-native';
import {useRouter} from 'expo-router';
import Colors,{AfterglowColors as C} from '../../constants/Colors';
import {AfterglowType as T} from '../../constants/Typography';
import {useAfterglowFonts} from '../../hooks/useAfterglowFonts';
import {attendeeMessageEventRoute,loadAttendeeNoticeLinks} from '../../lib/attendeeMessageNotification';
import {scopedTicketRequest} from '../../lib/creatorTicketRead';
import {supabase} from '../../lib/supabase';
export function AttendeeMessageInboxRow({notice,userId,visible,enabled,onClose}:{notice:{id:string;title:string;body:string|null};userId:string|null;visible:boolean;enabled:boolean;onClose:()=>void}){
 const router=useRouter(),{fonts}=useAfterglowFonts();
 const visit=useMemo(()=>({}),[notice.id,userId,visible]),latest=useRef(visit);latest.current=visit;
 const mounted=useRef(false);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const scope=useMemo(()=>({userId:userId??'',isCurrent:()=>mounted.current&&visible&&latest.current===visit}),[userId,visible,visit]);
 const lock=useRef<object|null>(null);
 const [state,setState]=useState<{visit:object;busy:boolean;expanded?:boolean;error?:string}>();
 const current=state?.visit===visit?state:undefined;
 const open=()=>{
  if(!scope.isCurrent()||lock.current===visit)return;
  if(!enabled){onClose();router.push('/(tabs)/explore');return;}
  lock.current=visit;setState(old=>({...old,visit,busy:true,error:undefined}));
  void(async()=>{
   try{
    const targets=await loadAttendeeNoticeLinks([notice.id],scope);if(!scope.isCurrent())return;
    const eventId=targets.get(notice.id);if(!eventId)throw new Error('This event update is no longer available.');
    const route=attendeeMessageEventRoute(eventId);
    // Read bookkeeping cannot redirect a confirmed event or discard the visible message.
    try{await scopedTicketRequest(scope,()=>supabase.from('app_notifications').update({status:'read'}).eq('id',notice.id).eq('user_id',scope.userId).select('id').maybeSingle());}catch{}
    if(!scope.isCurrent())return;onClose();router.push(route as never);
   }catch(error){if(scope.isCurrent())setState(old=>({...old,visit,busy:false,error:error instanceof Error?error.message:'This update could not be checked.'}));}
   finally{if(lock.current===visit)lock.current=null;if(scope.isCurrent())setState(old=>({...old,visit,busy:false}));}
  })();
 };
 return <View style={s.row}>
  <Text style={[s.title,{fontFamily:fonts.semibold}]}>{notice.title}</Text>
  {!!notice.body&&<Text numberOfLines={current?.expanded?undefined:3} style={[s.body,{fontFamily:fonts.regular}]}>{notice.body}</Text>}
  {!!current?.error&&<Text accessibilityRole="alert" style={[s.body,{fontFamily:fonts.regular}]}>{current.error}</Text>}
  <View style={s.actions}>
   {!!notice.body&&<Pressable accessibilityRole="button" accessibilityState={{expanded:!!current?.expanded}} accessibilityLabel={current?.expanded?'Show less':'Read update'} onPress={()=>setState(old=>({...old,visit,busy:old?.visit===visit?old.busy:false,expanded:!current?.expanded}))} style={s.action}>
    <Text style={[s.link,{fontFamily:fonts.semibold}]}>{current?.expanded?'Show less':'Read update'}</Text>
   </Pressable>}
   <Pressable accessibilityRole="button" accessibilityLabel={current?.error?'Check event':'Open event'} accessibilityState={{disabled:!!current?.busy}} disabled={!!current?.busy} onPress={open} style={s.action}>
    <Text style={[s.link,{fontFamily:fonts.semibold}]}>{current?.busy?'Checking…':current?.error?'Check event':'Open event'}</Text>
   </Pressable>
  </View>
 </View>;
}
const s=StyleSheet.create({row:{paddingHorizontal:16,paddingVertical:12,gap:6,borderBottomWidth:StyleSheet.hairlineWidth,borderColor:C.line},title:{...T.title,color:C.ink},body:{...T.body,color:C.muted},actions:{flexDirection:'row',flexWrap:'wrap',columnGap:20},action:{minHeight:44,justifyContent:'center'},link:{...T.section,color:Colors.terracotta}});
