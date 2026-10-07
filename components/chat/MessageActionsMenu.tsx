import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { ArrowUpLeft, Copy, Flag, Pencil, Trash2, UserX, X } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import type { BrandedAlertButton } from '../BrandedAlert';
import { QuickReactionBar } from './QuickReactionBar';
export interface MessageMenu {
  title: string;
  buttons: BrandedAlertButton[];
  preview: string;
  own?: boolean;
  selectedReaction?: string;
  onReact?: (emoji: string) => void;
  isCurrent: () => boolean;
}
const icons: Record<string, typeof Pencil> = { reply: ArrowUpLeft, copy: Copy, delete: Trash2, edit: Pencil, report: Flag, block: UserX, 'delete this message': Trash2, 'remove this message': Trash2 };
/** Presentation only: existing room callbacks retain authorization and receipts. */
export function MessageActionsMenu({ menu, onClose }: { menu: MessageMenu | null; onClose: () => void }) {
  const { height } = useWindowDimensions();
  const [closing, setClosing] = useState(false);
  const active = useRef(menu);
  const pending = useRef<{ menu: MessageMenu; action?: () => void } | null>(null);
  useLayoutEffect(() => { active.current = menu; pending.current = null; setClosing(false); return () => { active.current = null; pending.current = null; }; }, [menu]);
  const finish = (opening: MessageMenu | null) => {
    const choice = pending.current;
    if (!opening || !choice || choice.menu !== opening || active.current !== opening) return;
    pending.current = null;
    onClose();
    if (opening.isCurrent()) choice.action?.();
  };
  const choose = (action?: () => void) => {
    if (!menu || active.current !== menu || pending.current) return;
    pending.current = { menu, action }; setClosing(true);
  };
  useEffect(() => {
    if (!closing || Platform.OS === 'ios') return;
    const opening = menu;
    const frame = requestAnimationFrame(() => finish(opening));
    return () => cancelAnimationFrame(frame);
  }, [closing, menu]);
  const more = menu?.buttons.find(button => button.text === 'react');
  return <Modal visible={!!menu && !closing} transparent animationType={Platform.OS === 'ios' ? 'fade' : 'none'}
    onRequestClose={() => choose()} onDismiss={Platform.OS === 'ios' ? () => finish(menu) : undefined} statusBarTranslucent>
    <View style={s.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => choose()} accessibilityRole="button" accessibilityLabel="Close message actions" />
      <ScrollView style={{ flexGrow: 0, flexShrink: 1, maxHeight: Math.max(160, height - 64), width: '100%', maxWidth: 340 }} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" accessibilityViewIsModal>
        {menu?.onReact && more && <QuickReactionBar selected={menu.selectedReaction} onSelect={emoji => choose(() => menu.onReact?.(emoji))} onMore={() => choose(more.onPress)} />}
        <View style={[s.preview, menu?.own && s.own]} accessible accessibilityLabel={`Selected message from ${menu?.own ? 'You' : menu?.title}: ${menu?.preview}`}>
          <Text style={[s.name, menu?.own && s.light]}>{menu?.own ? 'You' : menu?.title}</Text>
          <Text numberOfLines={4} style={[s.body, menu?.own && s.light]}>{menu?.preview}</Text>
        </View>
        <View style={s.actions}>
          {menu?.buttons.filter(button => button.text !== 'react' && button.style !== 'cancel').map((button, index) => {
            const Icon = icons[button.text] ?? ArrowUpLeft;
            const color = button.style === 'destructive' ? Colors.errorRed : Colors.asphalt;
            const label = button.text.charAt(0).toUpperCase() + button.text.slice(1);
            return <TouchableOpacity key={button.text} style={[s.action, index > 0 && s.divider]} accessibilityRole="button" accessibilityLabel={label} onPress={() => choose(button.onPress)}>
              <Text style={[s.label, {color}]}>{label}</Text><Icon size={19} color={color}/>
            </TouchableOpacity>;
          })}
        </View>
        <TouchableOpacity style={s.close} onPress={() => choose()} accessibilityRole="button" accessibilityLabel="Close message actions"><X size={20} color={Colors.asphalt}/></TouchableOpacity>
      </ScrollView>
    </View>
  </Modal>;
}
const s = StyleSheet.create({
  backdrop: {flex:1,justifyContent:'center',alignItems:'center',padding:12,backgroundColor:Colors.scrimSepia},
  content:{gap:12,alignItems:'center'},
  preview:{alignSelf:'flex-start',maxWidth:'100%',padding:14,borderRadius:18,backgroundColor:Colors.cardBg,gap:4},
  own:{alignSelf:'flex-end',backgroundColor:Colors.terracotta},
  name:{fontFamily:Fonts.sansBold,fontSize:FontSizes.bodySM,color:Colors.terracotta},
  body:{fontFamily:Fonts.sans,fontSize:FontSizes.bodyLG,lineHeight:LineHeights.bodyLG,color:Colors.asphalt},
  light:{color:Colors.white},
  actions:{width:'100%',borderRadius:18,backgroundColor:Colors.cardBg,overflow:'hidden'},
  action:{minHeight:48,paddingVertical:14,paddingHorizontal:18,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:16},
  divider:{borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:Colors.border},
  label:{fontFamily:Fonts.sansMedium,fontSize:FontSizes.bodyLG,flex:1},
  close:{width:44,height:44,borderRadius:22,backgroundColor:Colors.cardBg,alignItems:'center',justifyContent:'center'},
});
