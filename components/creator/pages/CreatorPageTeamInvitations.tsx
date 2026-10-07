import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { listMyPageTeamInvitations, type PageTeamInvitation } from '../../../lib/creatorPageTeam';
import type { CreatorPageScope } from '../../../lib/creatorPageReview';
import { useCreatorPageRead } from '../../../hooks/useCreatorPageRead';
import { useAfterglowFonts } from '../../../hooks/useAfterglowFonts';
import { PageAction, pageStyles as s } from './PageFrame';
import { AfterglowType as T } from '../../../constants/Typography';
import Colors, { AfterglowColors as C, CreatorSurfaceColors as G } from '../../../constants/Colors';

const hasAccess = (invitation: PageTeamInvitation) => invitation.status === 'accepted' && !invitation.accessRevokedAt && !!invitation.currentPermissions?.length;
/** Independent read: unavailable team access never hides the creator's own spaces. */
export function CreatorPageTeamInvitations({ scope }: { scope: CreatorPageScope | null }) {
  const read = useCallback((owned: CreatorPageScope) => listMyPageTeamInvitations(owned), []);
  const { data, loading, error, refresh } = useCreatorPageRead(scope, read), { fonts } = useAfterglowFonts(true, 'creator');
  const mounted = useRef(true), latest = useRef({scope,data,loading,error});
  latest.current = {scope,data,loading,error};
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const [historyScope,setHistoryScope] = useState<CreatorPageScope|null>(null);
  const historyOpen = historyScope === scope;
  const retryLock = useRef<CreatorPageScope|null>(null);
  const current = () => mounted.current && !!scope && latest.current.scope === scope && scope.isCurrent();
  const ready = () => current() && !latest.current.loading && !latest.current.error && retryLock.current !== scope;
  const retry = () => {
    if(!current() || latest.current.loading || retryLock.current === scope)return;
    retryLock.current=scope;
    void refresh().catch(()=>undefined).finally(()=>{if(retryLock.current===scope)retryLock.current=null;});
  };
  if (!scope) return null;
  const pending = data?.filter(i => i.status === 'pending') ?? [];
  const history = data?.filter(i => i.status !== 'pending') ?? [];
  // Multiple accepted invitations may describe the same current assignment. Show one destination;
  // preserve every exact invitation in history instead of presenting duplicate active spaces.
  const teams = Array.from(new Map((data ?? []).filter(hasAccess).map(i => [i.pageId,i])).values());
  const row = (invitation: PageTeamInvitation, team=false) => {
    const pendingInvitation=invitation.status==='pending';
    const label=team?'Open':pendingInvitation?'Review':'View';
    const accessible=team?'Open co-creator space':pendingInvitation?'Review invitation':'View invitation';
    const status=invitation.accessRevokedAt?'Access revoked':({pending:'Co-creator invitation',accepted:'Invitation accepted',declined:'Invitation declined',canceled:'Invitation canceled',expired:'Invitation expired'} as const)[invitation.status];
    const kind=invitation.pageKind==='community'?'Community':invitation.pageKind==='organization'?'Organization':null;
    const detail=team?`${kind ? `${kind} · ` : ''}Co-creator`:`${kind ? `${kind} · ` : ''}${status}`;
    const noPermissions=!team&&invitation.status==='accepted'&&!invitation.accessRevokedAt&&!hasAccess(invitation);
    return <Pressable cssInterop={false} key={team?invitation.pageId:invitation.invitationId} accessibilityRole="button" accessibilityLabel={`${accessible}: ${invitation.pageName}, ${detail}${noPermissions ? ", No current team permissions" : ""}`}
      disabled={loading} accessibilityState={{disabled:loading}}
      onPress={()=>{
        if(!ready())return;
        const actual=latest.current.data?.find(i=>i.invitationId===invitation.invitationId);
        if(!actual || actual.pageId!==invitation.pageId || (team&&!hasAccess(actual)))return;
        router.push((team?`/creator/page-team?id=${actual.pageId}`:`/creator/page-team?id=${actual.pageId}&invitationId=${actual.invitationId}`) as never);
      }} style={({pressed})=>[look.row,team&&look.team,pressed&&look.pressed]}>
      {team&&<LinearGradient pointerEvents="none" colors={[G.sunsetGoldLight,Colors.white]} start={{x:0,y:0}} end={{x:1,y:1}} style={StyleSheet.absoluteFill}/>}
      <View style={look.identity}>
        <Text style={[T.body,{color:C.ink,fontFamily:fonts.semibold}]}>{invitation.pageName}</Text>
        <Text style={[T.caption,{color:C.muted,fontFamily:fonts.regular}]}>{detail}</Text>
        {!team&&invitation.status==='accepted'&&!invitation.accessRevokedAt&&!hasAccess(invitation)&&<Text style={[T.caption,{color:C.muted,fontFamily:fonts.regular}]}>No current team permissions</Text>}
      </View>
      <Text numberOfLines={1} style={[T.caption,look.action,{color:Colors.terracotta,fontFamily:fonts.semibold}]}>{label}</Text>
    </Pressable>;
  };
  const heading=(title:string)=> <Text accessibilityRole="header" style={[T.contextTitle,{color:C.ink,fontFamily:fonts.medium}]}>{title}</Text>;
  return <View style={look.section}>
    {loading&&<ActivityIndicator accessibilityLabel="Checking co-creator spaces and invitations" color={C.clay}/>}
    {error?<View style={look.group}>{heading('Co-creator access')}<Text accessibilityRole="alert" style={[s.small,{fontFamily:fonts.regular}]}>Couldn’t check your co-creator spaces and invitations.</Text><PageAction quiet compact singleLine title="Try again" onPress={retry}/></View>:
      data&&<>
        {teams.length>0&&<View style={look.group}>{heading('Co-creator spaces')}<Text style={[T.caption,{color:C.muted,fontFamily:fonts.regular}]}>Communities and organizations you help create.</Text>{teams.map(i=>row(i,true))}</View>}
        {pending.length>0&&<View style={look.group}>{heading('Invitations to review')}<Text style={[T.caption,{color:C.muted,fontFamily:fonts.regular}]}>Review the access before you decide.</Text>{pending.map(i=>row(i))}</View>}
        {data.length===0&&<View style={look.group}>{heading('Create together')}<Text style={[s.small,{fontFamily:fonts.regular}]}>When someone invites you to help create a community or organization, you can review it here.</Text></View>}
        {history.length>0&&<View style={look.group}>
          <Pressable cssInterop={false} accessibilityRole="button" accessibilityLabel="Invitation history" accessibilityState={{expanded:historyOpen,disabled:loading}} disabled={loading}
            onPress={()=>{if(ready())setHistoryScope(old=>old===scope?null:scope);}} style={look.history}>
            <Text style={[T.body,look.identity,{color:C.ink,fontFamily:fonts.medium}]}>Invitation history</Text>
            <Text numberOfLines={1} style={[T.caption,look.action,{color:Colors.terracotta,fontFamily:fonts.semibold}]}>{historyOpen?'Hide':'View'}</Text>
          </Pressable>
          {historyOpen&&history.map(i=>row(i))}
        </View>}
      </>}
  </View>;
}
const look=StyleSheet.create({
  section:{marginTop:24,gap:22},group:{gap:10},
  row:{minHeight:64,padding:14,flexDirection:'row',alignItems:'center',gap:12,borderRadius:16,borderWidth:1,borderColor:C.line,backgroundColor:Colors.white,overflow:'hidden'},
  team:{borderColor:G.goldEdge},identity:{flex:1,minWidth:0,gap:4},action:{flexShrink:0},pressed:{opacity:0.7},
  history:{minHeight:44,flexDirection:'row',alignItems:'center',gap:12,paddingVertical:8},
});
