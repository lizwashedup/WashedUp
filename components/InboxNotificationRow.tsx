import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useClearInboxNotifications } from '../hooks/useClearInboxNotifications';

export function InboxNotificationRow({ notice, scope, visit, isOpen, showDismiss, onOpen, stacked, hasOwnActions, openSpotActions, children }: {
  notice: { id: string; created_at: string; title: string };
  scope: Parameters<typeof useClearInboxNotifications>[0]; visit: object; isOpen: () => boolean;
  showDismiss: boolean; onOpen?: () => void;
  stacked?: boolean;
  hasOwnActions?: boolean;
  openSpotActions?: (control: { pass: () => void; label: string; busy: boolean }) => React.ReactNode;
  children: React.ReactNode;
}) {
  const { phase, press } = useClearInboxNotifications(scope, visit, isOpen, { id: notice.id });
  const dismiss = () => press([notice]);
  const busy = phase === 'clearing' || phase === 'checking';
  const label = {idle:'Dismiss', clearing:'Dismissing…', retry:'Retry dismiss', unknown:'Check status', checking:'Checking…'}[phase];
  return <View style={s.container}>
    {openSpotActions ? <>
      <View style={[s.row, s.offerSummary]}>{children}</View>
      <View style={s.offerActions}>{openSpotActions({ pass: dismiss, busy, label: {
        idle:'Pass', clearing:'Passing…', retry:'Retry pass', unknown:'Check status', checking:'Checking…',
      }[phase] })}</View>
    </> : <View style={[s.row, stacked && s.stackedRow]}>
      {hasOwnActions ? <View style={[s.content, stacked && s.stackedContent]}>{children}</View> : (
        <TouchableOpacity accessibilityRole="button" activeOpacity={0.7} style={[s.content, stacked && s.stackedContent]} onPress={onOpen ?? dismiss}>{children}</TouchableOpacity>
      )}
      {showDismiss && <TouchableOpacity accessibilityRole="button" accessibilityLabel={label + ': ' + notice.title}
        style={stacked && s.stackedDismiss} disabled={busy} onPress={dismiss} hitSlop={{top:8,bottom:8,left:8,right:8}}>
        <Text style={s.dismiss}>{label}</Text>
      </TouchableOpacity>}
    </View>}
    {phase === 'retry' || phase === 'unknown' ? <Text accessibilityLiveRegion="polite" style={s.note}>
      {phase === 'retry' ? 'This notification wasn’t dismissed. You can try again.' : 'We couldn’t confirm whether this notification was dismissed.'}
    </Text> : null}
  </View>;
}
const s = StyleSheet.create({
  container:{borderBottomWidth:1,borderBottomColor:'#F5EDE0'},
  row:{flexDirection:'row',alignItems:'center',paddingVertical:12},
  content:{flex:1,minHeight:44,flexDirection:'row',alignItems:'center'},
  stackedRow:{flexDirection:'column',alignItems:'stretch'},
  stackedContent:{flex:0,alignItems:'flex-start'},
  stackedDismiss:{alignSelf:'flex-start',marginLeft:38,minHeight:44,justifyContent:'center'},
  offerSummary:{paddingBottom:0},
  offerActions:{marginLeft:46,paddingBottom:12},
  dismiss:{fontSize:12,color:'#78695C',marginLeft:8},
  note:{fontSize:13,color:'#78695C',paddingBottom:10},
});
