import React, { useMemo, useRef, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Colors, { AfterglowColors as C } from '../../constants/Colors';
import { AfterglowType as T } from '../../constants/Typography';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { loadPageInvitationTarget, markPageInvitationRead, PageInvitationIdentityError, pageInvitationRoute } from '../../lib/pageInvitationNotification';
import { CreatorActionFill } from '../creator/CreatorActionFill';
export function PageInvitationInboxRow({notice,userId,visible,enabled,onClose,onRead}:{notice:{id:string;title:string;body:string|null};userId:string|null;visible:boolean;enabled:boolean;onClose:()=>void;onRead?:()=>void}) {
  const router=useRouter(),{fonts}=useAfterglowFonts();
  const visit=useMemo(()=>({}),[notice.id,userId,visible,enabled]);const latest=useRef(visit);latest.current=visit;
  const mounted=useRef(false);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const scope=useMemo(()=>({userId,isCurrent:()=>mounted.current&&visible&&latest.current===visit}),[userId,visible,visit]);
  const operation=useRef<object|null>(null);const [state,setState]=useState<{visit:object;busy:boolean;error?:string}>();
  const current=state?.visit===visit?state:undefined;
  const open=()=>{
    if (!scope.isCurrent() || operation.current===visit) return;
    if (!enabled) {onClose();router.push('/(tabs)/friends');return;}
    operation.current=visit;setState({visit,busy:true});
    void (async()=>{
      try {
        const target=await loadPageInvitationTarget(notice.id,scope);
        if (!scope.isCurrent()) return;
        if (!target) throw new Error('This invitation is no longer available.');
        const route=pageInvitationRoute(target);
        // Read status is optional bookkeeping. Failure never redirects to a
        // different context or prevents opening the confirmed page target.
        let read=false;
        try {await markPageInvitationRead(notice.id,scope);read=true;}
        catch(error) {if(error instanceof PageInvitationIdentityError) throw error;}
        if (!scope.isCurrent()) return;
        if(read)onRead?.();
        onClose();router.push(route as never);
      } catch (error) {
        if (scope.isCurrent()) setState({visit,busy:false,error:error instanceof Error?error.message:'This invitation could not be checked.'});
      } finally {if(operation.current===visit)operation.current=null;if(scope.isCurrent())setState(old=>old?.visit===visit?{...old,busy:false}:old);}
    })();
  };
  return <View style={s.row}>
    <Text style={[s.title,{fontFamily:fonts.semibold}]}>{notice.title}</Text>
    {!!notice.body && <Text numberOfLines={3} style={[s.body,{fontFamily:fonts.regular}]}>{notice.body}</Text>}
    {!!current?.error && <Text accessibilityRole="alert" style={[s.body,{fontFamily:fonts.regular}]}>{current.error}</Text>}
    <Pressable accessibilityRole="button" accessibilityLabel={current?.error?'Check invitation':'Review invitation'} accessibilityState={{disabled:!!current?.busy,busy:!!current?.busy}} disabled={!!current?.busy} onPress={open} style={s.action}>
      <CreatorActionFill />
      <Text numberOfLines={1} style={[s.actionText,{fontFamily:fonts.semibold}]}>{current?.busy?'Checking…':current?.error?'Check invitation':'Review invitation'}</Text>
    </Pressable>
  </View>;
}
const s=StyleSheet.create({
 row:{paddingHorizontal:16,paddingVertical:14,gap:10,borderBottomWidth:StyleSheet.hairlineWidth,borderColor:C.line},
 title:{...T.title,color:C.ink},body:{...T.body,color:C.muted},
 action:{alignSelf:'flex-end',minHeight:44,paddingHorizontal:18,paddingVertical:10,borderRadius:24,overflow:'hidden',justifyContent:'center',alignItems:'center'},
 actionText:{...T.section,color:Colors.white},
});
