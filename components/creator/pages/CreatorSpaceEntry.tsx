import React from 'react';
import { View, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { ScaledText as Text } from '../../ScaledText';
import { ChevronRight, Mail, Users } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import Colors, { AfterglowColors as C, CreatorSurfaceColors as G } from '../../../constants/Colors';
import { AfterglowType as T } from '../../../constants/Typography';
import { useAfterglowFonts } from '../../../hooks/useAfterglowFonts';
import { useCreatorPageScope } from '../../../hooks/useCreatorPageScope';
import { useCreatorPageRead } from '../../../hooks/useCreatorPageRead';
import { loadCreatorSpaceEntry } from '../../../lib/creatorSpaceEntry';

/** One contextual entry inside Yours, using the existing creator destinations. */
export function CreatorSpaceEntry({ userId }: { userId: string }) {
  const { scope, account }=useCreatorPageScope('yours-creator-entry');
  const owned=scope?.userId===userId?scope:null;
  const { data, loading, error, refresh }=useCreatorPageRead(owned,loadCreatorSpaceEntry);
  const { fonts }=useAfterglowFonts(true,'creator');
  if (!userId || account.viewerId===null) return null;
  const failed=!!(account.error || error);
  const current=data && !failed ? data : undefined;
  const invitations=current?.invitations??[];
  const open=(route:string)=>{if(owned?.isCurrent())router.push(route as never);};
  return <View style={s.wrap}>
    <Pressable cssInterop={false} accessibilityRole="button" accessibilityLabel={current ? `${current.title}: ${current.subtitle}` : 'Creator space'}
      disabled={!owned} accessibilityState={{disabled:!owned}}
      onPress={()=>open(current?.route??'/creator/pages')} style={({pressed})=>[s.entry,pressed&&s.pressed]}>
      <LinearGradient colors={[G.selectionTop,G.selectionBottom]} start={{x:0,y:0}} end={{x:1,y:1}} style={s.mark}>
        <Users size={20} color={C.ink} strokeWidth={1.7}/>
      </LinearGradient>
      <View style={s.copy}>
        <Text style={[s.title,{fontFamily:fonts.medium}]}>{current?.title??'Creator space'}</Text>
        <Text style={[s.subtitle,{fontFamily:fonts.regular}]}>{current?.subtitle??(failed?'Your spaces couldn’t load.':'Communities, organizations and invitations')}</Text>
      </View>
      {loading && !data ? <ActivityIndicator accessibilityLabel="Loading creator space" color={Colors.terracotta}/> : <ChevronRight size={18} color={C.muted}/>}
    </Pressable>
    {failed && <Pressable accessibilityRole="button" accessibilityLabel="Try again to load creator space" style={s.recovery}
      onPress={()=>{void (account.error?account.retry():refresh()).catch(()=>undefined);}}>
      <Text style={[s.link,{fontFamily:fonts.medium}]}>Try again</Text>
    </Pressable>}
    {invitations.length>0 && <Pressable cssInterop={false} accessibilityRole="button" accessibilityLabel={`Review ${invitations.length===1?'invitation':invitations.length+' invitations'}`} style={s.invitation}
      onPress={()=>open(invitations.length===1?`/creator/page-team?id=${invitations[0].pageId}&invitationId=${invitations[0].invitationId}`:'/creator/pages')}>
      <Mail size={16} color={Colors.terracotta}/><Text style={[s.link,{fontFamily:fonts.medium}]}>{invitations.length===1?'1 invitation':`${invitations.length} invitations`}</Text><ChevronRight size={16} color={Colors.terracotta}/>
    </Pressable>}
  </View>;
}
const s=StyleSheet.create({
  wrap:{paddingHorizontal:20,paddingBottom:16,gap:4},
  entry:{padding:16,borderRadius:20,backgroundColor:Colors.cardBg,borderWidth:1,borderColor:G.goldEdge,flexDirection:'row',alignItems:'center',gap:12,shadowColor:Colors.darkWarm,shadowOffset:{width:0,height:3},shadowOpacity:0.05,shadowRadius:10,elevation:2},
  mark:{width:44,height:44,borderRadius:14,alignItems:'center',justifyContent:'center'},
  copy:{flex:1,minWidth:0,gap:4},
  title:{...T.title,color:C.ink},subtitle:{...T.caption,color:C.muted},
  pressed:{opacity:0.8},recovery:{minHeight:44,justifyContent:'center',alignSelf:'flex-end',paddingHorizontal:12},
  invitation:{minHeight:44,flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:12,alignSelf:'flex-start'},
  link:{...T.caption,color:Colors.terracotta},
});
