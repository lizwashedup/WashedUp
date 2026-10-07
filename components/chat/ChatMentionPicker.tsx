import React from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { X } from 'lucide-react-native';
import { AfterglowColors as Colors } from '../../constants/Colors';
import { AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';
import type { MentionMember } from '../../lib/chatMentions';

interface Props {
  members: readonly MentionMember[];
  fonts: AfterglowFontFamilies;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  onSelect: (member: MentionMember) => void;
  onClose: () => void;
}

/** A bounded, scrollable room-member picker; the conversation owns its query,
 * eligibility, caret, draft and current-visit guards. */
export function ChatMentionPicker({ members, fonts, loading, error, onRetry, onSelect, onClose }: Props) {
  return <View style={styles.panel}>
    <View style={styles.heading}>
      <Text style={[styles.caption, { fontFamily: fonts.medium }]}>People in this chat</Text>
      <TouchableOpacity style={styles.close} accessibilityRole="button" accessibilityLabel="Close mentions" onPress={onClose}>
        <X size={17} color={Colors.muted}/>
      </TouchableOpacity>
    </View>
    {error && <View style={styles.feedback}>
      <Text style={[styles.feedbackText, { fontFamily: fonts.regular }]}>{members.length ? 'The member list couldn’t refresh.' : 'The member list couldn’t load.'}</Text>
      {!!onRetry && <TouchableOpacity style={styles.retry} onPress={onRetry} disabled={loading} accessibilityRole="button" accessibilityLabel="Retry chat members">
        <Text style={[styles.retryText, { fontFamily: fonts.semibold }]}>{loading ? 'Checking…' : 'Retry'}</Text>
      </TouchableOpacity>}
    </View>}
    {members.length > 0 ? <FlatList data={members} keyExtractor={member => member.id} keyboardShouldPersistTaps="handled"
      initialNumToRender={12} style={styles.list} showsVerticalScrollIndicator
      renderItem={({item})=><TouchableOpacity style={styles.member} onPress={()=>onSelect(item)} accessibilityRole="button" accessibilityLabel={`Mention ${item.first_name}`}>
        {item.avatar_url ? <Image source={{uri:item.avatar_url}} style={styles.avatar} contentFit="cover"/> : <View style={[styles.avatar,styles.fallback]}>
          <Text style={[styles.initial,{fontFamily:fonts.medium}]}>{item.first_name?.slice(0,1).toUpperCase()}</Text>
        </View>}
        <Text style={[styles.name,{fontFamily:fonts.medium}]}>{item.first_name}</Text>
      </TouchableOpacity>}/>
      : !error && <View style={styles.feedback}>
        {loading && <ActivityIndicator size="small" color={Colors.clay}/>}
        <Text style={[styles.feedbackText,{fontFamily:fonts.regular}]}>{loading ? 'Loading people…' : 'No matching people in this chat.'}</Text>
      </View>}
  </View>;
}

const styles=StyleSheet.create({
  panel:{marginHorizontal:10,marginBottom:4,borderRadius:16,borderWidth:StyleSheet.hairlineWidth,borderColor:Colors.subtleLine,backgroundColor:Colors.white,overflow:'hidden'},
  heading:{flexDirection:'row',alignItems:'center',paddingLeft:12},
  caption:{...AfterglowType.caption,color:Colors.muted,flex:1},
  close:{width:44,height:44,alignItems:'center',justifyContent:'center'},
  list:{maxHeight:176},
  member:{minHeight:44,flexDirection:'row',alignItems:'center',gap:10,paddingHorizontal:12,paddingVertical:7},
  avatar:{width:28,height:28,borderRadius:14},
  fallback:{backgroundColor:Colors.paper,alignItems:'center',justifyContent:'center'},
  initial:{...AfterglowType.caption,color:Colors.clay},
  name:{...AfterglowType.body,color:Colors.ink,flex:1},
  feedback:{flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:12,paddingBottom:10},
  feedbackText:{...AfterglowType.caption,color:Colors.muted,flex:1},
  retry:{minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center'},
  retryText:{...AfterglowType.caption,color:Colors.clay},
});
