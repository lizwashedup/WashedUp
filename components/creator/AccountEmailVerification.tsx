import {useAfterglowFonts} from '../../hooks/useAfterglowFonts';
import {useMemo} from 'react';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Colors, { AfterglowColors as C } from '../../constants/Colors';
import { type AfterglowFontFamilies, AfterglowType as T } from '../../constants/Typography';
import { useAccountEmailVerification } from '../../hooks/useAccountEmailVerification';
import type { AccountEmailScope } from '../../lib/accountEmail';
export function AccountEmailVerification({scope,onVerified,initiallyOpen=false,returnUrl=process.env.EXPO_PUBLIC_ACCOUNT_EMAIL_RETURN_URL??''}:{scope:AccountEmailScope;onVerified?:()=>void;initiallyOpen?:boolean;returnUrl?:string}) {
  const {fonts}=useAfterglowFonts(true, 'creator');
  const s=useMemo(()=>createStyles(fonts),[fonts]);
 const [open,setOpen]=useState(initiallyOpen);const state=useAccountEmailVerification(open?scope:null,returnUrl);
 const reported=useRef<string|null>(null);
 useEffect(()=>{const key=state.remote?.verified?`${scope.userId}:${state.remote.email}`:null;if(!key){reported.current=null;return;}if(key!==reported.current&&scope.isCurrent()){reported.current=key;onVerified?.();}},[state.remote?.verified,state.remote?.email,scope,onVerified]);
 if(!scope.isCurrent())return null;
 if(!open)return <TouchableOpacity accessibilityRole="button" style={s.action} onPress={()=>setOpen(true)}><Text style={s.link}>Verify email</Text></TouchableOpacity>;
 const pending=state.remote?.pendingEmail;
 return <View style={s.panel}>
  <Text style={s.title}>Your account email</Text>
  {state.remote?.verified?<Text style={s.copy} accessibilityLiveRegion="polite">Your account email is verified. Your phone login stays the same.</Text>:<>
   <Text style={s.copy}>{pending?'Open the verification link in your email, then check its status here.':'Verify an email address to receive your sale alerts. Your phone login stays the same.'}</Text>
   {state.remote&&<><TextInput accessibilityLabel="Account email" style={s.input} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" value={state.draft} onChangeText={state.setDraft} editable={!state.busy&&!state.unknown} placeholder="you@example.com" placeholderTextColor={C.muted}/>
    {!returnUrl?<Text style={s.copy}>Email verification is not available in this build yet.</Text>:<TouchableOpacity accessibilityRole="button" style={s.action} disabled={state.busy||state.unknown} onPress={()=>void state.send(!!pending&&pending===state.draft.trim().toLowerCase())}><Text style={s.link}>{state.busy?'Please wait…':pending&&pending===state.draft.trim().toLowerCase()?'Resend link':'Send link'}</Text></TouchableOpacity>}
   </>}
  </>}
  {!!state.error&&<Text accessibilityRole="alert" style={s.error}>{state.error}</Text>}
  {state.busy?<ActivityIndicator accessibilityLabel="Checking account email" color={Colors.terracotta}/>:<TouchableOpacity accessibilityRole="button" style={s.action} onPress={()=>void state.check()}><Text style={s.link}>Check status</Text></TouchableOpacity>}
 </View>;
}
function createStyles(fonts: AfterglowFontFamilies) { return StyleSheet.create({panel:{marginTop:4,padding:12,backgroundColor:Colors.cardBg,borderRadius:16,gap:6},title:{...T.body,fontFamily:fonts.semibold,color:C.ink},copy:{...T.caption,fontFamily:fonts.regular,color:C.muted},input:{...T.body,fontFamily:fonts.regular,color:C.ink,minHeight:44,paddingHorizontal:12,borderWidth:StyleSheet.hairlineWidth,borderColor:C.line,borderRadius:12,backgroundColor:Colors.parchment},action:{minHeight:44,justifyContent:'center',alignSelf:'flex-start'},link:{...T.body,fontFamily:fonts.medium,color:Colors.terracotta},error:{...T.caption,fontFamily:fonts.regular,color:Colors.errorRed}}); }
