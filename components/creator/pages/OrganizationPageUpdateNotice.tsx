import React, { useCallback } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Colors, { AfterglowColors as C, CreatorSurfaceColors as G } from '../../../constants/Colors';
import { AfterglowType as T } from '../../../constants/Typography';
import { useAfterglowFonts } from '../../../hooks/useAfterglowFonts';
import { useCreatorPageRead } from '../../../hooks/useCreatorPageRead';
import { loadOrganizationPageUpdate } from '../../../lib/organizationPageUpdate';
import type { PageImageScope } from '../../../lib/publishedPageCover';
import { GoldSurfaceFill } from '../GoldSurfaceFill';
import { CreatorActionFill } from '../CreatorActionFill';
/** The notification's actual update stays visible near the page header, not buried in its event history. */
export function OrganizationPageUpdateNotice({pageId,updateId,scope}:{pageId:string;updateId:string;scope:PageImageScope|null}) {
  const {fonts}=useAfterglowFonts(true, 'creator');
  const load=useCallback((owned:PageImageScope)=>loadOrganizationPageUpdate(pageId,updateId,owned),[pageId,updateId]);
  const read=useCreatorPageRead(scope,load);
  return <View style={s.panel}>
    <GoldSurfaceFill />
    <Text accessibilityRole="header" style={[s.title,{fontFamily:fonts.semibold}]}>Update</Text>
    {read.data && <Text selectable style={[s.body,{fontFamily:fonts.regular}]}>{read.data.body}</Text>}
    {read.loading && !read.data && <ActivityIndicator accessibilityLabel="Loading update" color={C.ink}/>}
    {read.error && <><Text accessibilityRole="alert" style={[s.body,{fontFamily:fonts.regular}]}>This update could not be loaded.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Check update" disabled={read.loading} accessibilityState={{disabled:read.loading}} style={s.action} onPress={()=>{void read.refresh().catch(()=>undefined);}}><CreatorActionFill/><Text numberOfLines={1} style={[s.actionText,{fontFamily:fonts.semibold}]}>Check update</Text></Pressable></>}
    {!read.loading && !read.error && !read.data && <Text style={[s.body,{fontFamily:fonts.regular}]}>{scope?.userId ? 'This update is no longer available to this account.' : 'Sign in to read this update.'}</Text>}
  </View>;
}
const s=StyleSheet.create({
  panel:{borderWidth:StyleSheet.hairlineWidth,borderColor:G.goldEdge,borderRadius:16,padding:16,gap:12,marginBottom:24,overflow:'hidden'},
  title:{...T.title,color:C.ink},body:{...T.message,color:C.ink},actionText:{...T.section,color:Colors.white},
  action:{alignSelf:'flex-start',minHeight:44,paddingHorizontal:18,paddingVertical:10,borderRadius:24,overflow:'hidden',justifyContent:'center',alignItems:'center'},
});
