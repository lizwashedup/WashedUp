import React, { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ChevronRight, MoreHorizontal, X } from 'lucide-react-native';
import Colors, { AfterglowColors as C } from '../../constants/Colors';
import { AfterglowType as T, type AfterglowFontFamilies } from '../../constants/Typography';
import { chatHeaderActionStyle } from './ChatContextHeader';

interface Props {
  fonts: AfterglowFontFamilies;
  isCurrent: () => boolean;
  contextLabel: string;
  onViewContext?: () => void;
  notificationLabel: string;
  notificationBusy: boolean;
  onNotifications: () => void;
  children?: React.ReactNode;
}
/** Notification controls belong inside chat options; identity remains a direct
 * route to the community/event. Finish dismissing before navigation or alerts. */
export function ChatOptionsButton({ fonts, isCurrent, contextLabel, onViewContext, notificationLabel, notificationBusy, onNotifications, children }: Props) {
  const [open, setOpen] = useState(false), [closing, setClosing] = useState(false);
  const alive = useRef(true), pending = useRef<{ action?: () => void } | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; pending.current = null; }; }, []);
  const finish = () => {
    const choice = pending.current;
    if (!alive.current || !choice) return;
    pending.current = null; setOpen(false); setClosing(false);
    if (isCurrent()) choice.action?.();
  };
  const choose = (action?: () => void) => {
    if (!alive.current || !isCurrent() || pending.current) return;
    pending.current = { action }; setClosing(true);
  };
  useEffect(() => {
    if (!closing || Platform.OS === 'ios') return;
    const frame = requestAnimationFrame(finish);
    return () => cancelAnimationFrame(frame);
  }, [closing]);
  return <>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Chat options" style={chatHeaderActionStyle}
      onPress={() => { if (alive.current && isCurrent()) setOpen(true); }}><MoreHorizontal size={22} color={C.ink}/></TouchableOpacity>
    <Modal visible={open && !closing} transparent animationType={Platform.OS === 'ios' ? 'fade' : 'none'}
      onRequestClose={() => choose()} onDismiss={Platform.OS === 'ios' ? finish : undefined}>
      <View style={s.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => choose()} accessibilityRole="button" accessibilityLabel="Close chat options"/>
        <View style={s.panel} accessibilityViewIsModal>
          <View style={s.heading}><Text accessibilityRole="header" style={[s.title,{fontFamily:fonts.semibold}]}>Chat options</Text>
            <TouchableOpacity style={s.close} accessibilityRole="button" accessibilityLabel="Close chat options" onPress={() => choose()}><X size={20} color={C.ink}/></TouchableOpacity></View>
          {!!onViewContext && <TouchableOpacity style={s.row} accessibilityRole="button" accessibilityLabel={contextLabel} onPress={() => choose(onViewContext)}>
            <Text style={[s.label,{fontFamily:fonts.medium}]}>{contextLabel}</Text><ChevronRight size={18} color={C.muted}/></TouchableOpacity>}
          <TouchableOpacity style={s.row} accessibilityRole="button" accessibilityLabel={notificationLabel} disabled={notificationBusy}
            accessibilityState={{disabled:notificationBusy,busy:notificationBusy}} onPress={() => choose(onNotifications)}>
            <Text style={[s.label,{fontFamily:fonts.medium}]}>{notificationLabel}</Text><ChevronRight size={18} color={C.muted}/></TouchableOpacity>
          {children}
        </View>
      </View>
    </Modal>
  </>;
}
const s=StyleSheet.create({
  backdrop:{flex:1,justifyContent:'center',alignItems:'center',padding:20,backgroundColor:Colors.scrimSepia},
  panel:{width:'100%',maxWidth:340,borderRadius:22,padding:8,backgroundColor:C.white},
  heading:{flexDirection:'row',alignItems:'center',paddingLeft:12},title:{...T.body,color:C.ink,flex:1},close:{width:44,height:44,alignItems:'center',justifyContent:'center'},
  row:{minHeight:52,paddingHorizontal:12,paddingVertical:12,flexDirection:'row',alignItems:'center',gap:12,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:C.subtleLine},
  label:{...T.body,color:C.ink,flex:1},
});
