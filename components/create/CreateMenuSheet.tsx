import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarDays, ChevronRight, MessageCircle, UsersRound, X } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { useReduceMotion } from '../yours/a11y/useReduceMotion';

export type CreationKind = 'plan' | 'event' | 'community';

const choices = [
  { kind: 'plan', title: 'Make a plan', description: 'Find company for something you want to do.', Icon: MessageCircle },
  { kind: 'event', title: 'Create an event', description: 'Organize a gathering with RSVPs or tickets.', Icon: CalendarDays },
  { kind: 'community', title: 'Start a community', description: 'Bring people together around a shared interest and keep meeting up.', Icon: UsersRound },
] as const;

/** The native sheet finishes closing before opening a full-page creation flow. */
export default function CreateMenuSheet({ visible, onClose, onSelect }: {
  visible: boolean; onClose: () => void; onSelect: (kind: CreationKind) => void;
}) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const visit = useMemo(() => ({}), [visible]);
  const active = useRef<object | null>(null);
  const pending = useRef<(() => void) | null>(null);
  const locked = useRef(false);
  const [closing, setClosing] = useState(false);

  useLayoutEffect(() => {
    active.current = visible ? visit : null;
    pending.current = null;
    locked.current = false;
    setClosing(false);
    return () => { active.current = null; pending.current = null; };
  }, [visit, visible]);

  const finish = useCallback(() => {
    if (active.current !== visit) return;
    const action = pending.current;
    pending.current = null;
    action?.();
  }, [visit]);
  const dismissThen = (action: () => void) => {
    if (active.current !== visit || locked.current) return;
    locked.current = true;
    pending.current = action;
    setClosing(true);
    if (Platform.OS !== 'ios') finish();
  };
  const close = () => dismissThen(onClose);

  return <Modal visible={visible && !closing} transparent animationType={reduceMotion ? 'none' : 'slide'} statusBarTranslucent
    onRequestClose={close} onAccessibilityEscape={close} onDismiss={finish}>
    <View style={[styles.backdrop, { paddingTop: insets.top + 12 }]}>
      <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={close} />
      <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={styles.heading}>
          <Text accessibilityRole="header" style={styles.title}>What do you want to create?</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close create menu" onPress={close} style={styles.close}>
            <X size={22} color={Colors.secondary} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.choices} showsVerticalScrollIndicator={false} bounces={false}>
          {choices.map(({ kind, title, description, Icon }) => <Pressable key={kind} accessibilityRole="button"
            accessibilityLabel={title} accessibilityHint={description} accessibilityState={{ disabled: closing }} disabled={closing}
            style={({ pressed }) => [styles.choice, pressed && styles.pressed]} onPress={() => dismissThen(() => onSelect(kind))}>
            <View style={styles.choiceHeading}>
              <Icon size={22} color={Colors.terracotta} />
              <Text style={styles.choiceTitle}>{title}</Text>
              <ChevronRight size={18} color={Colors.secondary} />
            </View>
            <Text style={styles.description}>{description}</Text>
          </Pressable>)}
        </ScrollView>
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: Colors.overlayDark40 },
  sheet: { flexShrink: 1, backgroundColor: Colors.parchment, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 16 },
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 20, paddingBottom: 16 },
  title: { flex: 1, fontFamily: Fonts.displayBold, fontSize: FontSizes.displayLG, lineHeight: LineHeights.displayLG, color: Colors.darkWarm },
  close: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  choices: { paddingHorizontal: 20, paddingBottom: 8, gap: 12 },
  choice: { padding: 16, borderRadius: 16, backgroundColor: Colors.cardBg, borderWidth: 1, borderColor: Colors.border, gap: 8 },
  choiceHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  choiceTitle: { flex: 1, fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, lineHeight: LineHeights.bodyLG, color: Colors.darkWarm },
  description: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD, color: Colors.secondary },
  pressed: { opacity: 0.75 },
});
