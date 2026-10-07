import {useAfterglowFonts} from '../../hooks/useAfterglowFonts';
import {useMemo} from 'react';
import React from 'react';
import { AccountEmailVerification } from './AccountEmailVerification';
import { saleAlertStatus } from '../../lib/eventSaleAlerts';
import { ActivityIndicator, Platform, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import Colors, { AfterglowColors as C } from '../../constants/Colors';
import { type AfterglowFontFamilies, AfterglowType as T } from '../../constants/Typography';
import { useCreatorPageScope } from '../../hooks/useCreatorPageScope';
import { useSaleAlertPreference } from '../../hooks/useSaleAlertPreference';
export function EventSaleAlertPreference({eventId}:{eventId:string}) {
  const {fonts}=useAfterglowFonts(true, 'creator');
  const s=useMemo(()=>createStyles(fonts),[fonts]);
 const {scope,account}=useCreatorPageScope(`sale-alert:${eventId}`);
 const state=useSaleAlertPreference(eventId,scope);
 if(!scope||account.error||account.isLoading||state.unavailable)return null;
 return <View style={s.section}>
  <Text style={s.title}>Your sale alerts</Text>
  <View style={s.row}><Text style={s.label}>Email me for each ticket sale</Text>
   {state.remote ? <Switch accessibilityLabel="Email me for each ticket sale" value={state.remote.enabled} disabled={state.busy||!!state.error}
    thumbColor={Colors.white} {...(Platform.OS==='web'?{activeThumbColor:Colors.white}:{})} trackColor={{false:C.line,true:Colors.terracotta}} onValueChange={()=>void state.change()} /> : !state.error ? <ActivityIndicator accessibilityLabel="Loading sale alert preference" color={Colors.terracotta}/> : null}
  </View>
  {!!state.error&&<View accessibilityRole="alert"><Text style={s.copy}>{state.error}</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Check sale alert status" style={s.retry} disabled={state.busy} onPress={()=>void state.check()}><Text style={s.action}>{state.busy?'Checking…':'Check status'}</Text></TouchableOpacity></View>}
  {!!state.remote&&!state.error&&<Text accessibilityLiveRegion="polite" style={s.copy}>{state.busy?'Updating…':saleAlertStatus(state.remote)}</Text>}
  {!!state.remote&&!state.error&&<TouchableOpacity accessibilityRole="button" accessibilityLabel="Refresh sale alert status" style={s.retry} disabled={state.busy} onPress={()=>void state.check()}><Text style={s.action}>{state.busy?'Updating…':'Refresh status'}</Text></TouchableOpacity>}
  {state.remote?.emailVerified===false&&!state.error&&<AccountEmailVerification scope={scope} onVerified={()=>void state.check()}/>}
  <Text style={s.copy}>This only changes your alerts. Buyer confirmations stay on.</Text>
 </View>;
}
function createStyles(fonts: AfterglowFontFamilies) { return StyleSheet.create({section:{marginTop:20,paddingTop:12,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:C.line,gap:6},title:{...T.body,fontFamily:fonts.semibold,color:C.ink},row:{flexDirection:'row',alignItems:'center',gap:12},label:{...T.body,fontFamily:fonts.regular,color:C.ink,flex:1},copy:{...T.caption,fontFamily:fonts.regular,color:C.muted},retry:{minHeight:44,alignSelf:'flex-start',justifyContent:'center'},action:{...T.body,fontFamily:fonts.medium,color:Colors.terracotta}}); }
