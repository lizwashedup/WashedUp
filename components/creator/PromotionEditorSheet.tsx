import {CreatorActionFill} from './CreatorActionFill';
import {useAfterglowFonts} from '../../hooks/useAfterglowFonts';
import {useMemo} from 'react';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Check } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { type AfterglowFontFamilies, AfterglowType as T } from '../../constants/Typography';
import { hapticLight } from '../../lib/haptics';
import { laWallTimeToUTC } from '../../lib/laDate';
import type { CreatorPageScope } from '../../lib/creatorPageReview';
import type { PromoDraft } from '../../lib/ticketPromosAddons';

interface Props {
  visible: boolean;
  busy: boolean;
  draftKey?: string;
  scope?: CreatorPageScope;
  onSave: (draft: PromoDraft) => void | Promise<unknown>;
  onClose: () => void;
  onDiscard?: () => void;
}

/** Reject normalized dates such as February 31 before converting LA wall time. */
function dayInstant(text: string, end: boolean): string | null {
  const m = text.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [year, month, day] = m.slice(1).map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return laWallTimeToUTC(year, month - 1, day, end ? 23 : 0, end ? 59 : 0).toISOString();
}

export function PromotionEditorSheet({ visible, busy, draftKey, scope, onSave, onClose, onDiscard }: Props) {
  const {fonts}=useAfterglowFonts(true, 'creator');
  const styles=useMemo(()=>createStyles(fonts),[fonts]);
  const { width, fontScale } = useWindowDimensions();
  const stackDates = width < 375 || fontScale > 1.2;
  const [code, setCode] = useState('');
  const [percent, setPercent] = useState(true);
  const [amount, setAmount] = useState('');
  const [uses, setUses] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [hidden, setHidden] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [uncertain, setUncertain] = useState(false);
  const seeded = useRef<string | undefined>(undefined);
  const lock = useRef(false);
  const revealProblem = useRef(false);
  const scroll = useRef<ScrollView>(null);
  const locked = busy || saving;
  useEffect(() => {
    if (!visible || (draftKey !== undefined && seeded.current === draftKey)) return;
    seeded.current = draftKey;
    setCode(''); setPercent(true); setAmount(''); setUses(''); setStart(''); setEnd(''); setHidden(false);
    setProblem(undefined); setUncertain(false);
  }, [visible, draftKey]);

  const save = async () => {
    if (locked || lock.current || (scope && !scope.isCurrent())) return;
    const starts = start.trim() ? dayInstant(start, false) : null;
    const ends = end.trim() ? dayInstant(end, true) : null;
    const value = percent ? Number(amount.trim()) : Math.round(Number(amount.trim()) * 100);
    const maxUses = uses.trim() ? Number(uses.trim()) : null;
    const invalid = !code.trim() ? 'Give your code a name.'
      : !(percent ? /^\d+$/ : /^\d+(?:\.\d{1,2})?$/).test(amount.trim()) || !Number.isSafeInteger(value) || value < 1
        ? (percent ? 'Enter a whole percent from 1 to 100.' : 'Enter a dollar amount with up to two decimal places.')
      : percent && value > 100 ? 'A percent tops out at 100.'
      : maxUses !== null && (!/^\d+$/.test(uses.trim()) || !Number.isSafeInteger(maxUses) || maxUses < 1) ? 'Uses must be a positive whole number.'
      : (start.trim() && !starts) || (end.trim() && !ends) ? 'Use a real date in YYYY-MM-DD format.'
      : starts && ends && ends <= starts ? 'The end date must follow the start date.' : null;
    if (invalid) { revealProblem.current = true; setProblem(invalid); return; }
    const draft: PromoDraft = { code: code.trim().toUpperCase(), discount_type: percent ? 'percent' : 'flat', discount_value: value,
      max_uses: maxUses, starts_at: starts, ends_at: ends, unlocks_hidden: hidden, active: true };
    lock.current = true; setSaving(true); setProblem(undefined); hapticLight();
    try { await onSave(draft); if (!scope || scope.isCurrent()) setUncertain(false); }
    catch { if (!scope || scope.isCurrent()) { setUncertain(true); revealProblem.current = true; setProblem('Couldn’t confirm the save. Your code is kept. Retry to check its saved status.'); } }
    finally { lock.current = false; setSaving(false); }
  };
  const close = () => { if (!lock.current && !busy) onClose(); };
  // Keep the exact submitted values for reconciliation after an unknown result.
  const editable = !locked && !uncertain;
  const input = (label: string, value: string, change: (v: string) => void, placeholder: string, numeric = false) => <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <TextInput accessibilityLabel={label} editable={editable} style={styles.input} value={value} onChangeText={change}
      placeholder={placeholder} placeholderTextColor={Colors.textMedium} autoCorrect={false}
      keyboardType={numeric ? 'decimal-pad' : 'default'} autoCapitalize={label === 'Code' ? 'characters' : 'none'} maxLength={label === 'Code' ? 40 : undefined} />
  </View>;
  return <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={close}>
    <SafeAreaProvider><SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close code editor" disabled={locked} onPress={close} style={styles.headerAction}><Text style={styles.link}>Close</Text></TouchableOpacity>
        <Text accessibilityRole="header" style={styles.title}>New code</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Save promotion code" disabled={locked} onPress={() => void save()} style={[styles.save, locked && styles.disabled]}>
          <CreatorActionFill />
          {locked ? <ActivityIndicator color={Colors.white} /> : <Text numberOfLines={1} style={styles.saveText}>Save</Text>}
        </TouchableOpacity>
      </View>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView ref={scroll} contentContainerStyle={styles.content} onContentSizeChange={() => { if (revealProblem.current) { revealProblem.current = false; scroll.current?.scrollTo({ y: 0, animated: false }); } }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          {!!problem && <View style={styles.recovery}><Text accessibilityRole="alert" style={styles.problem}>{problem}</Text>
            {uncertain && onDiscard && <TouchableOpacity accessibilityRole="button" disabled={locked} onPress={onDiscard} style={styles.headerAction}><Text style={styles.link}>Discard draft</Text></TouchableOpacity>}
          </View>}
          <Text style={styles.intro}>A little invitation to join you.</Text>
          <View style={styles.panel}>
            {input('Code', code, setCode, 'EARLYBIRD')}
            <View style={styles.toggleRow} accessibilityRole="radiogroup" accessibilityLabel="Discount type">{[true, false].map(p => <TouchableOpacity key={String(p)} accessibilityRole="radio" aria-checked={percent === p} accessibilityState={{ selected: percent === p, checked: percent === p, disabled: !editable }} disabled={!editable}
              onPress={() => setPercent(p)} style={[styles.toggle, percent === p && styles.selected]}><Text style={[styles.label, percent === p && styles.selectedText]}>{p ? 'Percent off' : 'Dollars off'}</Text></TouchableOpacity>)}</View>
            {input(percent ? 'Discount (%)' : 'Discount ($)', amount, setAmount, percent ? '25' : '10.00', true)}
          </View>
          <Text accessibilityRole="header" style={styles.section}>Limits & timing</Text>
          <View style={styles.panel}>
            {input('Maximum uses', uses, setUses, 'Unlimited', true)}
            <View style={[styles.dateRow, stackDates && { flexDirection: 'column' }]}><View style={styles.date}>{input('Starts', start, setStart, 'YYYY-MM-DD')}</View><View style={styles.date}>{input('Ends', end, setEnd, 'YYYY-MM-DD')}</View></View>
            <Text style={styles.hint}>Optional · Los Angeles time. Blank start means now; blank end means sales close.</Text>
          </View>
          <TouchableOpacity accessibilityRole="checkbox" aria-checked={hidden} accessibilityLabel="Unlock hidden tickets" accessibilityState={{ checked: hidden, disabled: !editable }} disabled={!editable} onPress={() => setHidden(!hidden)} style={styles.checkRow}>
            <View style={[styles.checkbox, hidden && styles.selected]}>{hidden && <Check size={14} color={Colors.white} />}</View><Text style={styles.checkLabel}>Unlock hidden tickets</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView></SafeAreaProvider>
  </Modal>;
}
function createStyles(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.parchment },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: Colors.border },
  headerAction: { minHeight: 44, minWidth: 64, justifyContent: 'center', alignSelf: 'flex-start' },
  title: { ...T.contextTitle, fontFamily: fonts.semibold, color: Colors.asphalt },
  link: { ...T.body, fontFamily: fonts.medium, color: Colors.terracotta },
  save: { minHeight: 44, minWidth: 64, paddingHorizontal: 16, borderRadius: 22, backgroundColor: Colors.terracotta, alignItems: 'center', justifyContent: 'center' },
  saveText: { ...T.body, fontFamily: fonts.semibold, color: Colors.white },
  disabled: { opacity: 0.5 },
  content: { padding: 20, paddingBottom: 32 },
  intro: { ...T.body, fontFamily: fonts.regular, color: Colors.textMedium, marginBottom: 16 },
  panel: { padding: 16, gap: 14, borderRadius: 16, backgroundColor: Colors.white },
  field: { gap: 6 },
  label: { ...T.body, fontFamily: fonts.medium, color: Colors.asphalt },
  input: { ...T.message, fontFamily: fonts.regular, color: Colors.asphalt, minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, backgroundColor: Colors.white },
  toggleRow: { flexDirection: 'row', gap: 8 },
  toggle: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', padding: 6, borderWidth: 1, borderColor: Colors.border, borderRadius: 8 },
  selected: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  selectedText: { color: Colors.white },
  section: { ...T.title, fontFamily: fonts.semibold, color: Colors.asphalt, marginTop: 22, marginBottom: 10 },
  dateRow: { flexDirection: 'row', gap: 12 },
  date: { flex: 1, minWidth: 0 },
  hint: { ...T.caption, fontFamily: fonts.regular, color: Colors.textMedium },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, marginTop: 12 },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1, borderColor: Colors.textMedium, alignItems: 'center', justifyContent: 'center' },
  checkLabel: { ...T.body, flex: 1, fontFamily: fonts.regular, color: Colors.asphalt },
  recovery: { gap: 4, marginBottom: 16 },
  problem: { ...T.body, fontFamily: fonts.regular, color: Colors.errorBrand },
}); }
