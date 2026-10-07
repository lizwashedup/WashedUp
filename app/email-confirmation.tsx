import React from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import Colors, { AfterglowColors as C } from '../constants/Colors';
import { Fonts, AfterglowType as T } from '../constants/Typography';
import { useCreatorPageScope } from '../hooks/useCreatorPageScope';
import { AccountEmailVerification } from '../components/creator/AccountEmailVerification';
/** Read the current account; never consume URL credentials or recovery callbacks. */
export default function AccountEmailReturn() {
 const {scope,account}=useCreatorPageScope('account-email-return');const router=useRouter();
 return <SafeAreaView style={s.screen}><Stack.Screen options={{headerShown:false}}/>
  <KeyboardAvoidingView style={s.screen} behavior={Platform.OS==='ios'?'padding':undefined}><ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
   <Text style={s.title}>Your account email</Text>
   <Text style={s.copy}>Check whether your email is verified, then return to your event.</Text>
   {account.isLoading?<ActivityIndicator accessibilityLabel="Loading account" color={Colors.terracotta}/>:account.error?<><Text accessibilityRole="alert" style={s.copy}>Could not check your account. Try again.</Text><TouchableOpacity accessibilityRole="button" style={s.button} onPress={()=>void account.retry()}><Text style={s.label}>Try again</Text></TouchableOpacity></>:scope?<AccountEmailVerification scope={scope} initiallyOpen/>:<Text style={s.copy}>Open WashedUp with your existing account to check your email status.</Text>}
   <TouchableOpacity accessibilityRole="button" style={s.button} onPress={()=>router.canGoBack()?router.back():router.replace('/(tabs)/plans')}><Text style={s.label}>Done</Text></TouchableOpacity>
  </ScrollView></KeyboardAvoidingView>
 </SafeAreaView>;
}
const s=StyleSheet.create({screen:{flex:1,backgroundColor:Colors.parchment},content:{padding:20,gap:12},title:{...T.pageTitle,fontFamily:Fonts.displayBold,color:C.ink},copy:{...T.body,fontFamily:Fonts.sans,color:C.muted},button:{minHeight:44,alignSelf:'flex-start',justifyContent:'center',paddingHorizontal:16,borderRadius:16,backgroundColor:Colors.terracotta},label:{...T.body,fontFamily:Fonts.sansSemibold,color:Colors.white}});
