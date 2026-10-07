import React,{useEffect,useMemo,useRef,useState} from 'react';
import {ActivityIndicator,Pressable,StyleSheet,View} from 'react-native';
import {ScaledText as Text} from '../ScaledText';
import {Image} from 'expo-image';
import {useInfiniteQuery,useQuery} from '@tanstack/react-query';
import {useObservedUser} from '../../hooks/useObservedUser';
import {useAfterglowFonts} from '../../hooks/useAfterglowFonts';
import {readCommunityCreators,readCommunityPeople,type CommunityPerson} from '../../lib/communityPeople';
import Colors,{SceneDetailColors as S} from '../../constants/Colors';
import {AfterglowType as T} from '../../constants/Typography';
function useScope(pageId:string){
 const viewer=useObservedUser(),mounted=useRef(false),visit=useMemo(()=>({}),[pageId,viewer.viewerId,viewer.epoch]),latest=useRef(visit);latest.current=visit;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const scope=useMemo(()=>({userId:viewer.viewerId??null,isCurrent:()=>mounted.current&&latest.current===visit&&viewer.isCurrent()}),[visit]);
 return {scope,key:[pageId,viewer.viewerId,viewer.epoch],ready:!viewer.isLoading&&!viewer.error};
}
function Face({person,size=36}:{person:CommunityPerson;size?:number}){
 const {fonts}=useAfterglowFonts(true,'creator');
 const [failed,setFailed]=useState<string>();
 return person.photo&&failed!==person.photo?<Image source={{uri:person.photo}} onError={()=>setFailed(person.photo!)} accessibilityLabel={person.name??'Community member'} style={{width:size,height:size,borderRadius:size/2}} contentFit="cover"/>:<View style={[s.face,{width:size,height:size,borderRadius:size/2}]}><Text style={[T.body,{fontFamily:fonts.medium,color:Colors.asphalt}]}>{(person.name??'?').slice(0,1).toUpperCase()}</Text></View>;
}
export function CommunityCreators({pageId,fallback}:{pageId:string;fallback:React.ReactNode}){
 const {scope,key,ready}=useScope(pageId),{fonts}=useAfterglowFonts(true,'creator');
 const q=useQuery({queryKey:['community-public-team',...key],enabled:ready,queryFn:()=>readCommunityCreators(pageId,scope),staleTime:30000});
 if(!ready)return null;
 if(q.error)return <>{fallback}</>;
 if(!q.data?.length)return <>{fallback}</>;
 return <View style={s.creators}>{q.data.map(p=><View key={p.id} style={s.person}><Face person={p}/><View style={s.name}><Text style={[T.body,{fontFamily:fonts.medium,color:S.text}]}>{p.name??'Community creator'}</Text><Text style={[T.caption,{fontFamily:fonts.regular,color:S.supporting}]}>{p.role==='creator'?'Creator':'Co-creator'}</Text></View></View>)}</View>;
}
export function CommunityMembers({pageId}:{pageId:string}){
 const {scope,key,ready}=useScope(pageId),{fonts}=useAfterglowFonts(true,'creator');
 const [expandedFor,setExpandedFor]=useState<string>();const stamp=JSON.stringify(key),expanded=expandedFor===stamp;
 const q=useInfiniteQuery({queryKey:['community-member-directory',...key],enabled:ready&&!!scope.userId,initialPageParam:0,queryFn:({pageParam})=>readCommunityPeople(pageId,scope,pageParam),getNextPageParam:last=>last.next,staleTime:30000});
 const people=Array.from(new Map((ready&&!q.error?q.data?.pages.flatMap(p=>p.people)??[]:[]).map(p=>[p.id,p])).values());
 const shown=expanded?people:people.slice(0,5);
 return <View style={s.members}>
  <Text accessibilityRole="header" style={[T.contextTitle,{fontFamily:fonts.medium,color:S.text}]}>Who’s here</Text>
  {q.isLoading?<ActivityIndicator color={S.text}/>:null}
  <View style={expanded?s.expanded:s.preview}>{shown.map(p=>expanded?<View key={p.id} style={s.person}><Face person={p}/><Text style={[T.body,{fontFamily:fonts.regular,color:S.text}]}>{p.name??'Community member'}</Text></View>:<Face key={p.id} person={p}/>)}</View>
  {q.error?<Pressable accessibilityRole="button" onPress={()=>void q.refetch()} style={s.control}><Text style={[T.body,{fontFamily:fonts.medium,color:S.text}]}>Couldn’t load members · Try again</Text></Pressable>:null}
  {(people.length>5||q.hasNextPage)&&<Pressable accessibilityRole="button" accessibilityState={{expanded}} onPress={()=>setExpandedFor(expanded?undefined:stamp)} style={s.control}><Text style={[T.body,{fontFamily:fonts.medium,color:S.text}]}>{expanded?'Show less':'See all members'}</Text></Pressable>}
  {expanded&&q.hasNextPage&&<Pressable accessibilityRole="button" disabled={q.isFetchingNextPage} onPress={()=>void q.fetchNextPage()} style={s.control}><Text style={[T.body,{fontFamily:fonts.medium,color:S.text}]}>{q.isFetchingNextPage?'Loading…':'More members'}</Text></Pressable>}
 </View>;
}
const s=StyleSheet.create({creators:{paddingHorizontal:20,paddingVertical:14,gap:12},person:{flexDirection:'row',alignItems:'center',gap:10},name:{flex:1,gap:2},face:{backgroundColor:Colors.parchment,alignItems:'center',justifyContent:'center'},members:{gap:12},preview:{flexDirection:'row',gap:8},expanded:{gap:14},control:{minHeight:44,justifyContent:'center',alignSelf:'flex-start',paddingHorizontal:12,borderWidth:1,borderColor:S.border,borderRadius:14}});
