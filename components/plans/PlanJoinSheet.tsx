import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors, { AfterglowColors } from '../../constants/Colors';
import { AfterglowType, Fonts, FontSizes, LineHeights, type AfterglowFontFamilies } from '../../constants/Typography';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../keyboard/KeyboardDoneBar';

export interface PlanJoinSheetProps {
  visible: boolean;
  /** Pass the actual ID even when two plans share a title and date. */
  planId?: string;
  appearance?: { fonts: AfterglowFontFamilies };
  planTitle: string;
  dateLabel: string;
  message: string;
  confirmed: boolean;
  error?: string | null;
  unconfirmed: boolean;
  busy: boolean;
  canJoin: boolean;
  onMessage: (value: string) => void;
  onConfirmed: (value: boolean) => void;
  onJoin: () => void | Promise<void>;
  onClose: () => void;
  onDismiss: () => void;
  onCheck: () => void | Promise<void>;
}

/** The caller retains the draft and owns joining, assent and recovery. */
export function PlanJoinSheet(props: PlanJoinSheetProps) {
  const target = props.planId ?? `${props.planTitle}\n${props.dateLabel}`;
  const visit = useRef({ target, visible: props.visible, generation: 0 });
  if (target !== visit.current.target || (props.visible && !visit.current.visible)) {
    visit.current.generation += 1;
  }
  visit.current.target = target;
  visit.current.visible = props.visible;
  const generation = visit.current.generation;
  // Keep this Modal mounted through visible=false so iOS can finish its native
  // dismissal before the caller opens the existing post-join sharing modal.
  return <PlanJoinVisit key={generation} {...props} isCurrent={() => visit.current.generation === generation} />;
}

function PlanJoinVisit(props: PlanJoinSheetProps & { isCurrent: () => boolean }) {
  const latest = useRef(props); latest.current = props;
  const mounted = useRef(false);
  const closing = useRef(false);
  const didDismiss = useRef(false);
  const beganVisible = useRef(props.visible);
  const operation = useRef<object | null>(null);
  const [pending, setPending] = useState<'join' | 'check' | null>(null);
  const [callbackError, setCallbackError] = useState<string | null>(null);
  const [callbackUnconfirmed, setCallbackUnconfirmed] = useState(false);
  const uncertain = useRef(false); uncertain.current = props.unconfirmed || callbackUnconfirmed;
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const fonts = props.appearance?.fonts;
  const styles = useMemo(() => fonts ? { ...legacy, ...afterglow(fonts) } : legacy, [fonts]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; operation.current = null; };
  }, []);
  const current = () => mounted.current && latest.current.isCurrent();
  const active = () => current() && latest.current.visible && !closing.current;
  const blocked = () => !active() || latest.current.busy || !!operation.current;
  const disabled = props.busy || pending !== null;
  const editable = !disabled && !uncertain.current;
  const canSubmit = props.canJoin && props.confirmed && !!props.message.trim() && props.message.length <= 200 && !uncertain.current;

  const close = () => {
    if (blocked()) return;
    closing.current = true;
    Keyboard.dismiss();
    latest.current.onClose();
  };
  const dismiss = () => {
    if (!current() || latest.current.visible || !beganVisible.current || didDismiss.current) return;
    didDismiss.current = true;
    latest.current.onDismiss();
  };
  const run = async (kind: 'join' | 'check') => {
    if (blocked()) return;
    const value = latest.current;
    if (kind === 'join' && (!value.canJoin || !value.confirmed || !value.message.trim() || value.message.length > 200 || uncertain.current)) return;
    if (kind === 'check' && !uncertain.current) return;
    const attempt = {}; operation.current = attempt;
    setPending(kind); setCallbackError(null); Keyboard.dismiss();
    try {
      await (kind === 'join' ? value.onJoin() : value.onCheck());
    } catch {
      // The parent owns receipt classification. Never turn a thrown join result
      // into an invitation to submit again, or discard its retained greeting.
      if (active() && operation.current === attempt) {
        setCallbackError(kind === 'check' ? 'Couldn’t check the plan. Try checking again.' : 'Couldn’t confirm the result. Your message is still here.');
        if (kind === 'join') { uncertain.current = true; setCallbackUnconfirmed(true); }
      }
    } finally {
      if (current() && operation.current === attempt) {
        operation.current = null; setPending(null);
      }
    }
  };
  const label = pending === 'check' ? 'Checking…' : disabled ? 'Joining…' : uncertain.current ? 'Check plan' : 'Join';
  // The uncertainty notice already explains the membership result once.
  const shownError = (!props.unconfirmed && props.error) || callbackError;
  const actionDisabled = disabled || (!uncertain.current && !canSubmit);

  return <Modal visible={props.visible} transparent animationType="fade" statusBarTranslucent
    onRequestClose={close} onDismiss={dismiss} onAccessibilityEscape={close}>
    <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel="Close join plan" disabled={disabled} />
      <View style={[styles.sheet, { maxHeight: Math.max(0, height - insets.top - 24) },
        fonts && { paddingBottom: Math.max(16, insets.bottom + 12) }]}
        accessibilityViewIsModal onAccessibilityEscape={close} testID="plan-join-sheet">
        <ScrollView style={layout.scroll} contentContainerStyle={layout.content} keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag" showsVerticalScrollIndicator>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>{fonts ? props.planTitle : `You're joining ${props.planTitle}`}</Text>
          <TouchableOpacity onPress={close} disabled={disabled} accessibilityRole="button" accessibilityLabel="Close"
            accessibilityState={{ disabled }} style={styles.closeButton}>
            <Text numberOfLines={1} style={styles.closeLabel}>{fonts ? 'Close' : '✕'}</Text>
          </TouchableOpacity>
        </View>
          {!!props.dateLabel && <Text style={styles.date}>{props.dateLabel}</Text>}
          {!fonts && <View style={styles.infoBox}>
            <Text style={styles.infoTitle}>washedup plans are small on purpose.</Text>
            <Text style={styles.infoText}>You're not just a number.</Text>
            <Text style={styles.infoText}>You're part of the plan.</Text>
          </View>}
          <Text style={styles.label}>Say something to everyone <Text style={styles.required}>{fonts ? '(required)' : '*required'}</Text></Text>
          <TextInput style={[styles.input, !props.message.trim() && props.confirmed && styles.inputRequired]}
            accessibilityLabel="Say something to everyone (required)" accessibilityHint="Your message is posted to the plan chat when you join. Maximum 200 characters."
            placeholder="Hey everyone! Can't wait" placeholderTextColor={fonts ? AfterglowColors.muted : Colors.textLight}
            value={props.message} onChangeText={value => {
              if (blocked() || uncertain.current) return;
              setCallbackError(null); latest.current.onMessage(value);
            }} editable={editable} multiline maxLength={200} inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID} />
          <View style={styles.hintRow}>
            <Text style={styles.hint}>This will be posted to the chat when you join.</Text>
            {!!fonts && <Text style={styles.count} accessibilityLabel={`${props.message.length} of 200 characters`}>{props.message.length}/200</Text>}
          </View>
          <TouchableOpacity style={styles.checkRow} activeOpacity={0.7} disabled={!editable}
            accessibilityRole="checkbox" accessibilityLabel="I'm coming" aria-checked={props.confirmed} accessibilityState={{ checked: props.confirmed, disabled: !editable }}
            onPress={() => { if (!blocked() && !uncertain.current) latest.current.onConfirmed(!latest.current.confirmed); }}>
            <View style={[styles.checkbox, props.confirmed && styles.checkboxChecked]}>
              {props.confirmed && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <Text style={styles.checkLabel}>I'm coming</Text>
          </TouchableOpacity>
          {uncertain.current && <View style={styles.notice} accessibilityLiveRegion="polite">
            <Text style={styles.noticeTitle}>We haven’t confirmed your spot yet.</Text>
            <Text style={styles.noticeText}>Check the plan before trying to join again. Your message is still here.</Text>
          </View>}
          {!!shownError && <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">{shownError}</Text>}
        </ScrollView>
        <View style={styles.footer}>
          <TouchableOpacity onPress={() => { void run(uncertain.current ? 'check' : 'join'); }}
            style={[styles.joinButton, actionDisabled && styles.disabled]} disabled={actionDisabled} activeOpacity={0.85}
            accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: actionDisabled, busy: disabled }}>
            {disabled && <ActivityIndicator size="small" color={fonts ? AfterglowColors.white : Colors.white} />}
            <Text numberOfLines={1} style={styles.joinText}>{label}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

const layout = StyleSheet.create({
  scroll: { minHeight: 0, flexShrink: 1 }, content: { paddingBottom: 4 },
});
const legacy = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: Colors.overlayDark, justifyContent: 'center', alignItems: 'center', padding: 24 },
  sheet: { width: '100%', maxWidth: 400, flexShrink: 1, minHeight: 0, backgroundColor: Colors.white, borderRadius: 20, padding: 24 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, flexShrink: 0, marginBottom: 4 },
  title: { flex: 1, minWidth: 0, fontFamily: Fonts.sansBold, fontSize: FontSizes.displayMD, color: Colors.asphalt },
  closeButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: -8, marginRight: -8 },
  closeLabel: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.displaySM, color: Colors.textLight },
  date: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textLight, marginBottom: 20 },
  infoBox: { backgroundColor: Colors.parchment, borderRadius: 12, padding: 16, marginBottom: 20, alignItems: 'center' },
  infoTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.asphalt, textAlign: 'center', marginBottom: 4 },
  infoText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, lineHeight: LineHeights.bodySM, color: Colors.textMedium, textAlign: 'center' },
  label: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.asphalt, marginBottom: 8 },
  required: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.terracotta },
  input: { minHeight: 80, backgroundColor: Colors.white, borderWidth: 1.5, borderColor: Colors.inputBg, borderRadius: 12, padding: 14,
    fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.asphalt, textAlignVertical: 'top' },
  inputRequired: { borderColor: Colors.terracotta },
  hintRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 6, marginBottom: 12 },
  hint: { flex: 1, fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.textLight },
  count: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.textLight },
  checkRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  checkbox: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  checkmark: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.white },
  checkLabel: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.asphalt, flex: 1 },
  notice: { borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.parchment, borderRadius: 12, padding: 12, marginBottom: 8, gap: 4 },
  noticeTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  noticeText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, lineHeight: LineHeights.bodySM, color: Colors.textMedium },
  error: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.errorRed, marginBottom: 8 },
  footer: { flexShrink: 0, paddingTop: 12 },
  joinButton: { minHeight: 48, flexDirection: 'row', gap: 8, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 12,
    backgroundColor: Colors.terracotta, alignItems: 'center', justifyContent: 'center' },
  joinText: { color: Colors.white, fontFamily: Fonts.sansBold, fontSize: FontSizes.displaySM },
  disabled: { opacity: 0.35 },
});

function afterglow(fonts: AfterglowFontFamilies) {
  return StyleSheet.create({
    overlay: { ...legacy.overlay, justifyContent: 'flex-end', padding: 0 },
    sheet: { ...legacy.sheet, maxWidth: 560, padding: 20, borderRadius: 0, borderTopLeftRadius: 8, borderTopRightRadius: 8, backgroundColor: AfterglowColors.paper },
    header: { ...legacy.header, marginBottom: 8, gap: 12 },
    title: { ...legacy.title, ...AfterglowType.identity, fontFamily: fonts.display, color: AfterglowColors.ink },
    closeButton: { ...legacy.closeButton, marginRight: 0 },
    closeLabel: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.muted },
    date: { ...legacy.date, ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted, marginBottom: 20 },
    label: { ...legacy.label, ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.ink },
    required: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted },
    input: { ...legacy.input, ...AfterglowType.message, fontFamily: fonts.regular, color: AfterglowColors.ink, padding: 12,
      backgroundColor: AfterglowColors.white, borderColor: AfterglowColors.line, borderRadius: 4, borderWidth: 1 },
    inputRequired: { borderColor: AfterglowColors.clay },
    hint: { ...legacy.hint, ...AfterglowType.caption, fontFamily: fonts.regular, color: AfterglowColors.muted },
    count: { ...AfterglowType.caption, fontFamily: fonts.regular, color: AfterglowColors.muted },
    checkbox: { ...legacy.checkbox, borderRadius: 4, borderColor: AfterglowColors.line },
    checkboxChecked: { backgroundColor: AfterglowColors.clay, borderColor: AfterglowColors.clay },
    checkmark: { ...AfterglowType.section, fontFamily: fonts.semibold, color: AfterglowColors.white },
    checkLabel: { ...legacy.checkLabel, ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.ink },
    notice: { ...legacy.notice, borderRadius: 4, borderColor: AfterglowColors.line, backgroundColor: AfterglowColors.paper },
    noticeTitle: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.ink },
    noticeText: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted },
    error: { ...legacy.error, ...AfterglowType.body, fontFamily: fonts.medium },
    footer: { ...legacy.footer, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: AfterglowColors.subtleLine },
    joinButton: { ...legacy.joinButton, borderRadius: 4, paddingVertical: 12, backgroundColor: AfterglowColors.clay },
    joinText: { ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.white },
  });
}
