import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {ActivityIndicator,StyleSheet,Text,View} from 'react-native';
import {useLocalSearchParams,router} from 'expo-router';
import {useCreatorPageScope} from '../../hooks/useCreatorPageScope';
import {useCreatorPageRead} from '../../hooks/useCreatorPageRead';
import {useAfterglowFonts} from '../../hooks/useAfterglowFonts';
import {loadEventEarnings} from '../../lib/eventEarnings';
import {eventSummaryId} from '../../lib/eventSummary';
import {requestWithDeadline} from '../../lib/requestWithDeadline';
import type {CreatorPageScope} from '../../lib/creatorPageReview';
import type {CreatorAccess} from '../../lib/creatorMode';
import {EventEarningsView} from '../../components/creator/EventEarningsView';
import {PageFrame,PageAction,pageStyles as s} from '../../components/creator/pages/PageFrame';
import {AfterglowColors as C,CreatorSurfaceColors} from '../../constants/Colors';
import {FontSizes} from '../../constants/Typography';

/** Legacy helper retained for callers; the screen now checks exact-event finance authority. */
export function canSeeEventMoney(access:Pick<CreatorAccess,'hasEventHostGrant'>|null|undefined,canFinance:boolean){return canFinance||!!access?.hasEventHostGrant;}
export default function EventMoneyScreen(){
 const params=useLocalSearchParams<{id?:string;pageId?:string}>(),id=eventSummaryId(params.id),pageId=eventSummaryId(params.pageId);
 const {scope,account}=useCreatorPageScope(`earnings:${pageId??''}:${id??''}`),{fonts}=useAfterglowFonts(true,'creator');
 const visit=useMemo(()=>({}),[scope,id,pageId]),latestVisit=useRef(visit),mounted=useRef(true);
 latestVisit.current=visit;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const ownedScope=useMemo(()=>scope?{userId:scope.userId,isCurrent:()=>mounted.current&&latestVisit.current===visit&&scope.isCurrent()}:null,[scope,visit]);
 const gate=useRef({visit,ready:false,isPayee:false});
 const retryLock=useRef<object|null>(null),[retryVisit,setRetryVisit]=useState<object|null>(null);
 const retrying=retryVisit===visit;
 const read=useCallback(async(initiatingScope:CreatorPageScope)=>{
  let reading=true;
  const owned={userId:initiatingScope.userId,isCurrent:()=>reading&&initiatingScope.isCurrent()};
  try{
   if(!owned.isCurrent())throw Error('This visit has ended.');
   const result=id?await requestWithDeadline(loadEventEarnings(id,pageId,owned),12_000):null;
   if(!owned.isCurrent())throw Error('This visit has ended.');
   if(!result&&gate.current.visit===visit)gate.current.ready=false;
   return result;
  }catch(error){if(gate.current.visit===visit)gate.current.ready=false;throw error;}
  finally{reading=false;}
 },[id,pageId,visit]);
 const {data,error,loading,refresh}=useCreatorPageRead(ownedScope,read);
 const ready=!!ownedScope?.isCurrent()&&!loading&&!retrying&&retryLock.current!==visit&&!error&&!account.error&&!account.isLoading&&!!data;
 gate.current={visit,ready,isPayee:!!data?.isPayee};
 const current=()=>mounted.current&&latestVisit.current===visit&&(ownedScope?.isCurrent()??account.isCurrent());
 const retry=()=>{
  if(!id||!current()||retryLock.current===visit||loading||account.isLoading)return;
  retryLock.current=visit;gate.current.ready=false;setRetryVisit(visit);
  void(account.error?account.retry():refresh()).catch(()=>undefined).finally(()=>{
   if(retryLock.current===visit)retryLock.current=null;
   if(mounted.current&&latestVisit.current===visit)setRetryVisit(null);
  });
 };
 const navigate=(path:string,payeeOnly=false)=>{
  if(current()&&gate.current.visit===visit&&gate.current.ready&&(!payeeOnly||gate.current.isPayee))router.push(path as never);
 };
 const confirmed=!!ownedScope?.isCurrent()&&!account.isLoading&&!account.error&&!!data;
 const updating=loading||retrying;
 const back=()=>{
  if(!current())return;
  if(router.canGoBack())router.back();
  else if(id)router.replace({pathname:'/creator/event-summary',params:{id,...(pageId?{pageId}:{})}} as never);
  else router.replace('/creator/pages' as never);
 };
 return <PageFrame title="Event earnings" onBack={back} onRefresh={retry} refreshing={confirmed&&updating}>
  {!id?<Text style={[s.body,{fontFamily:fonts.regular}]}>Choose an event to view its earnings.</Text>
  :confirmed?<>
    {(updating||error)&&<View style={styles.recovery} accessibilityRole={error?'alert':undefined}>
      <Text style={[styles.recoveryText,{fontFamily:fonts.regular}]}>{updating?'Updating earnings. Showing the last confirmed figures.':'Earnings couldn’t be refreshed. Showing the last confirmed figures.'}</Text>
      {(error||retrying)&&<PageAction title={updating?'Retrying…':'Try again'} compact singleLine disabled={updating} onPress={retry}/>}
    </View>}
    <EventEarningsView data={data!} disabled={!ready} onSetup={()=>navigate('/creator/payouts',true)} onSupport={()=>navigate('/creator/help')} onRefresh={retry}/>
   </>
  :account.isLoading||updating?<ActivityIndicator accessibilityLabel="Loading earnings" color={C.clay}/>
  :account.error||error?<View style={s.notice}><Text accessibilityRole="alert" style={[s.body,{fontFamily:fonts.regular}]}>We couldn’t load this event’s earnings. Check again to see the latest figures.</Text><PageAction title="Try again" compact singleLine onPress={retry}/></View>
  :<Text style={[s.body,{fontFamily:fonts.regular}]}>Earnings are available to this event’s owner and finance team.</Text>}
 </PageFrame>;
}
const styles=StyleSheet.create({
 recovery:{padding:12,marginBottom:16,borderWidth:1,borderColor:CreatorSurfaceColors.goldEdge,borderRadius:14,backgroundColor:C.white,flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:12},
 recoveryText:{flexGrow:1,flexBasis:150,minWidth:0,fontSize:FontSizes.bodySM,lineHeight:20,color:C.muted},
});
