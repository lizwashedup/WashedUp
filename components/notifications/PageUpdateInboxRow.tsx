import React, { useMemo, useRef, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Colors, { AfterglowColors as C } from '../../constants/Colors';
import { AfterglowType as T } from '../../constants/Typography';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { loadOrganizationPageUpdateTarget, markOrganizationPageUpdateRead, OrganizationUpdateIdentityError, organizationPageUpdateRoute } from '../../lib/organizationPageUpdate';
import { CreatorActionFill } from '../creator/CreatorActionFill';
export function PageUpdateInboxRow({notice,userId,visible,enabled,onClose,onRead}:{notice:{id:string;title:string;body:string|null};userId:string|null;visible:boolean;enabled:boolean;onClose:()=>void;onRead?:()=>void}) {
  const router=useRouter(),{fonts}=useAfterglowFonts();
  const visit=useMemo(()=>({}),[notice.id,userId,visible,enabled]);const latest=useRef(visit);latest.current=visit;
  const mounted=useRef(false);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const scope=useMemo(()=>({userId,isCurrent:()=>mounted.current&&visible&&latest.current===visit}),[userId,visible,visit]);
  const operation=useRef<object|null>(null);const [state,setState]=useState<{visit:object;busy:boolean;error?:string}>();
  const current=state?.visit===visit?state:undefined;
  const open=()=>{
    if (!scope.isCurrent() || operation.current===visit) return;
    if (!enabled) {onClose();router.push('/(tabs)/explore');return;}
    operation.current=visit;setState({visit,busy:true});
    void (async()=>{
      try {
        const target=await loadOrganizationPageUpdateTarget(notice.id,scope);
        if (!scope.isCurrent()) return;
        if (!target) throw new Error('This update is no longer available.');
        const route=organizationPageUpdateRoute(target);
        // Read status is optional bookkeeping. Failure never redirects to a
        // different context or prevents opening the confirmed page target.
        let read=false;
        try { await markOrganizationPageUpdateRead(notice.id,scope); read=true; }
        catch (error) { if(error instanceof OrganizationUpdateIdentityError) throw error; }
        if (!scope.isCurrent()) return;
        if(read)onRead?.();
        onClose();router.push(route as never);
      } catch (error) {
        if (scope.isCurrent()) setState({visit,busy:false,error:error instanceof Error?error.message:'This update could not be checked.'});
      } finally {if(operation.current===visit)operation.current=null;if(scope.isCurrent())setState(old=>old?.visit===visit?{...old,busy:false}:old);}
    })();
  };
  return <View style={s.row}>
    <Text style={[s.title,{fontFamily:fonts.semibold}]}>{notice.title}</Text>
    {!!notice.body && <Text numberOfLines={3} style={[s.body,{fontFamily:fonts.regular}]}>{notice.body}</Text>}
    {!!current?.error && <Text accessibilityRole="alert" style={[s.body,{fontFamily:fonts.regular}]}>{current.error}</Text>}
    <Pressable accessibilityRole="button" accessibilityLabel={current?.error?'Check update':'Open update'} accessibilityState={{disabled:!!current?.busy,busy:!!current?.busy}} disabled={!!current?.busy} onPress={open} style={s.action}>
      <CreatorActionFill />
      <Text numberOfLines={1} style={[s.actionText,{fontFamily:fonts.semibold}]}>{current?.busy?'Checking…':current?.error?'Check update':'Open update'}</Text>
    </Pressable>
  </View>;
}
const s=StyleSheet.create({
  row:{paddingHorizontal:16,paddingVertical:14,gap:10,borderBottomWidth:StyleSheet.hairlineWidth,borderColor:C.line},
  title:{...T.title,color:C.ink},body:{...T.body,color:C.muted},actionText:{...T.section,color:Colors.white},
  action:{alignSelf:'flex-end',minHeight:44,paddingHorizontal:18,paddingVertical:10,borderRadius:24,overflow:'hidden',justifyContent:'center',alignItems:'center'},
});
