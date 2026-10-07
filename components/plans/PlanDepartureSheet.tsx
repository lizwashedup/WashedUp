import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors, { AfterglowColors as C } from '../../constants/Colors';
import { Fonts, FontSizes, AfterglowType as T, type AfterglowFontFamilies } from '../../constants/Typography';
import type { PlanDepartureAction, PlanDepartureResult } from '../../hooks/usePlanDeparture';

type Props = {
  action: PlanDepartureAction; planTitle: string; appearance?: { fonts: AfterglowFontFamilies };
  busy: boolean; unknown: boolean; error: string | null; result: PlanDepartureResult | null;
  onConfirm: () => void; onCheck: () => void; onClose: () => void; onDone: () => void;
};
/** Mounted once per confirmation. Outcomes stay in the same native modal. */
export function PlanDepartureSheet(p: Props) {
  const latest = useRef(p); latest.current = p;
  const live = useRef(false), exitClaimed = useRef(false);
  useLayoutEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const insets = useSafeAreaInsets(), { height } = useWindowDimensions();
  const s = useMemo(() => styles(p.appearance?.fonts), [p.appearance?.fonts]);
  const close = () => {
    if (!live.current || exitClaimed.current || latest.current.busy) return;
    exitClaimed.current = true;
    if (latest.current.result) latest.current.onDone(); else latest.current.onClose();
  };
  const act = () => {
    if (!live.current || exitClaimed.current || latest.current.busy) return;
    if (latest.current.result) { close(); return; }
    if (latest.current.unknown) latest.current.onCheck(); else latest.current.onConfirm();
  };
  const title = p.result ? p.action === 'cancel' ? 'Plan cancelled' : 'You’re no longer going' : p.unknown ? 'Check the result' : p.action === 'cancel' ? 'Cancel this plan?' : 'Can’t make it?';
  const body = p.result
    ? p.result.announcementUnconfirmed ? 'The change is saved. We couldn’t confirm the update in the chat.' : p.action === 'cancel' ? 'This plan is cancelled for everyone.' : 'You’ve left this plan.'
    : p.unknown ? 'We haven’t confirmed the change yet. Check its status before trying again.'
      : p.action === 'cancel' ? 'This cancels the plan for everyone.' : 'You’ll be removed from the people going to this plan.';
  const button = p.busy ? p.unknown ? 'Checking…' : p.action === 'cancel' ? 'Cancelling…' : 'Leaving…' : p.result ? 'Back to Plans' : p.unknown ? 'Check status' : p.action === 'cancel' ? 'Cancel plan' : 'Leave plan';
  return <Modal visible transparent animationType="fade" onRequestClose={close} onAccessibilityEscape={close}>
    <Pressable style={s.overlay} onPress={close} accessibilityLabel="Dismiss confirmation">
      <Pressable style={[s.card, { maxHeight: Math.max(0, height - insets.top - insets.bottom - 32) }]} onPress={e => e.stopPropagation()} accessibilityViewIsModal>
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <Text accessibilityRole="header" style={s.title}>{title}</Text>
          <Text style={s.plan}>{p.planTitle}</Text>
          <Text style={s.body}>{body}</Text>
          {p.error ? <Text accessibilityRole="alert" style={s.error}>{p.error}</Text> : null}
        </ScrollView>
        <View style={s.footer}>
          <TouchableOpacity accessibilityRole="button" style={s.primary} disabled={p.busy} accessibilityState={{disabled:p.busy,busy:p.busy}} onPress={act}><Text style={s.primaryText} numberOfLines={1}>{button}</Text></TouchableOpacity>
          {!p.result ? <TouchableOpacity accessibilityRole="button" style={s.secondary} disabled={p.busy} onPress={close}><Text style={s.secondaryText} numberOfLines={1}>{p.unknown ? 'Close' : p.action === 'cancel' ? 'Keep plan' : 'Stay'}</Text></TouchableOpacity> : null}
        </View>
      </Pressable>
    </Pressable>
  </Modal>;
}
function styles(f?: AfterglowFontFamilies) {
  const ink=f?C.ink:Colors.asphalt, muted=f?C.muted:Colors.secondary, accent=f?C.clay:Colors.terracotta;
  return StyleSheet.create({
    overlay:{flex:1,backgroundColor:Colors.overlayDark,justifyContent:'center',padding:24},
    card:{backgroundColor:f?C.paper:Colors.parchment,borderRadius:8,overflow:'hidden'},
    content:{padding:24,gap:14},title:{...(f?T.contextTitle:{fontSize:FontSizes.displayMD}),fontFamily:f?.semibold??Fonts.sansBold,color:ink},
    plan:{...(f?T.message:{fontSize:FontSizes.bodyLG}),fontFamily:f?.semibold??Fonts.sansBold,color:ink},
    body:{...(f?T.message:{fontSize:FontSizes.bodyLG}),fontFamily:f?.regular??Fonts.sans,color:muted},
    error:{...(f?T.body:{fontSize:FontSizes.bodyMD}),fontFamily:f?.medium??Fonts.sansMedium,color:Colors.errorRed},
    footer:{paddingHorizontal:24,paddingBottom:16,gap:4},primary:{minHeight:48,backgroundColor:accent,borderRadius:6,alignItems:'center',justifyContent:'center',paddingHorizontal:12},
    primaryText:{...(f?T.body:{fontSize:FontSizes.bodyLG}),fontFamily:f?.semibold??Fonts.sansBold,color:Colors.white},
    secondary:{minHeight:44,alignItems:'center',justifyContent:'center'},secondaryText:{...(f?T.body:{fontSize:FontSizes.bodyLG}),fontFamily:f?.semibold??Fonts.sansBold,color:muted},
  });
}
