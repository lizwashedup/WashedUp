import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AfterglowColors as Colors } from '../../constants/Colors';
import { AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';
import type { CommunityReplyComposerState } from '../../hooks/useCommunityReplyComposer';
import { ChatMentionPicker } from '../chat/ChatMentionPicker';
import { CommunityChatComposer } from '../chat/CommunityChatComposer';

export function CommunityReplyComposer({state,fonts}:{state:CommunityReplyComposerState;fonts:AfterglowFontFamilies}){
 const {composer}=state;
 return <View>
  {state.query!==null&&<ChatMentionPicker fonts={fonts} members={state.candidates} loading={state.membersLoading} error={state.membersError}
    onRetry={state.retryMembers} onSelect={state.select} onClose={state.closeMentions}/>}
  {(!composer.ready||composer.error||state.failure||composer.draft.attempt&&!state.sending)&&<View style={s.notice}>
    <Text style={[s.copy,{fontFamily:fonts.medium}]}>{composer.error?'Your reply could not be saved or checked.':!composer.ready?'Checking your draft…':state.failure??'Your previous reply is not confirmed.'}</Text>
    {composer.draft.attempt&&<Text numberOfLines={2} style={[s.copy,{fontFamily:fonts.regular}]}>{composer.draft.attempt.text}</Text>}
    {composer.error?<TouchableOpacity style={s.action} accessibilityRole="button" accessibilityLabel="Retry reply draft" onPress={()=>void composer.retry()}><Text style={[s.copy,{fontFamily:fonts.medium}]}>Try again</Text></TouchableOpacity>
     :composer.draft.attempt&&<View style={s.actions}><TouchableOpacity style={s.action} disabled={state.sending} accessibilityRole="button" accessibilityLabel="Check original reply" onPress={()=>void state.send(true)}><Text style={[s.copy,{fontFamily:fonts.medium}]}>Check</Text></TouchableOpacity><TouchableOpacity style={s.action} disabled={state.sending} accessibilityRole="button" accessibilityLabel="Retry original reply" onPress={()=>void state.send()}><Text style={[s.copy,{fontFamily:fonts.medium}]}>Retry original</Text></TouchableOpacity></View>}
  </View>}
  <CommunityChatComposer fonts={fonts} attachmentsVisible={false} composerInputRef={state.input}
    inputProps={{value:state.text,onChangeText:state.change,onSelectionChange:event=>state.selection(event.nativeEvent.selection.start),editable:composer.ready&&!composer.error,placeholder:'Reply…',accessibilityLabel:'Reply',multiline:true,maxLength:2000}}
    photo={{disabled:true,busy:false,onPress:()=>{}}} location={{disabled:true,onPress:()=>{}}}
    onSend={()=>void state.send()} sendDisabled={state.sendDisabled} sending={state.sending} editing={false} sendLabel="Send reply"/>
 </View>;
}
const s=StyleSheet.create({notice:{paddingHorizontal:14,paddingVertical:8,gap:4},copy:{...AfterglowType.caption,color:Colors.muted},actions:{flexDirection:'row',gap:12},action:{minHeight:44,justifyContent:'center',paddingHorizontal:8,alignSelf:'flex-start'}});
