import ProfileButton from '../ProfileButton';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, MessageCircle } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { CreatorActionFill } from '../creator/CreatorActionFill';

/** The same recoverable entrance for Plan, Circle and direct conversations. */
export function ChatEntryState({ state, retrying = false, onRetry, onBack }: {
  state: 'loading' | 'error' | 'unavailable'; retrying?: boolean; onRetry?: () => void; onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  const loading = state === 'loading';
  return <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
    <View style={styles.header}><TouchableOpacity style={styles.back} accessibilityRole="button" accessibilityLabel="Back to Chats" onPress={onBack}>
      <ChevronLeft size={22} color={Colors.asphalt}/><Text style={styles.backText}>Chats</Text>
    </TouchableOpacity><ProfileButton compact/></View>
    <View style={styles.card}>
      <View style={styles.icon}>{loading ? <ActivityIndicator color={Colors.terracotta} accessibilityLabel="Loading chat"/> : <MessageCircle size={26} color={Colors.terracotta}/>}</View>
      <Text style={styles.title} accessibilityRole={loading ? 'header' : 'alert'}>{loading ? 'Opening your chat' : state === 'error' ? 'Chat couldn’t load' : 'Chat unavailable'}</Text>
      <Text style={styles.body}>{loading ? 'Getting your conversation ready…' : state === 'error' ? 'Check your connection and try again.' : 'Return to Chats to see your available conversations.'}</Text>
      {!loading && onRetry && <TouchableOpacity style={styles.retry} accessibilityRole="button" accessibilityLabel="Retry opening chat" accessibilityState={{disabled:retrying,busy:retrying}} disabled={retrying} onPress={onRetry}>
        <CreatorActionFill/><Text style={styles.retryText} numberOfLines={1}>{retrying ? 'Trying…' : 'Try again'}</Text>
      </TouchableOpacity>}
    </View>
  </View>;
}
const styles = StyleSheet.create({
  screen:{flex:1,backgroundColor:Colors.parchment},
  header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingRight:12},
  back:{minHeight:48,alignSelf:'flex-start',paddingHorizontal:16,flexDirection:'row',alignItems:'center',gap:6},
  backText:{fontFamily:Fonts.sansMedium,fontSize:FontSizes.bodyLG,color:Colors.asphalt},
  card:{margin:20,padding:24,borderRadius:24,borderWidth:1,borderColor:Colors.border,backgroundColor:Colors.cardBg,gap:12,alignItems:'flex-start'},
  icon:{height:48,width:48,borderRadius:24,backgroundColor:Colors.accentSubtle,alignItems:'center',justifyContent:'center',marginBottom:4},
  title:{fontFamily:Fonts.sansBold,fontSize:FontSizes.bodyLG,color:Colors.asphalt},
  body:{fontFamily:Fonts.sans,fontSize:FontSizes.bodyMD,color:Colors.secondary},
  retry:{minHeight:48,borderRadius:24,paddingHorizontal:24,alignItems:'center',justifyContent:'center',marginTop:8},
  retryText:{fontFamily:Fonts.sansBold,fontSize:FontSizes.bodyMD,color:Colors.white},
});
