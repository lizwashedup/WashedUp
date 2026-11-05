import React from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Check } from 'lucide-react-native';
import { ScaledText as Text } from '../ScaledText';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import Colors, { AfterglowColors as C } from '../../constants/Colors';
import { AfterglowType as T } from '../../constants/Typography';

export type CommunityJoiningMethod = 'open' | 'approval_required';
const choices = [
  { value: 'open', label: 'Open', explanation: 'Eligible people can join right away.' },
  { value: 'approval_required', label: 'Review requests', explanation: 'People ask to join. You approve each person.' },
] as const;

/** The same question at creation and in settings. Selection alone does not publish. */
export function CommunityJoiningChoice({ value, onChange, disabled = false, error, onLayout, hint = 'You can change this later in your community’s settings.' }: {
  value: unknown; onChange: (method: CommunityJoiningMethod) => void; disabled?: boolean;
  error?: string; onLayout?: (event: LayoutChangeEvent) => void; hint?: string;
}) {
  const { fonts } = useAfterglowFonts(true, 'creator');
  return <View onLayout={onLayout} style={s.section}>
    <Text accessibilityRole="header" style={[s.title, { fontFamily: fonts.medium }]}>How should people join?</Text>
    <Text style={[s.hint, { fontFamily: fonts.regular }]}>{hint}</Text>
    {choices.map(choice => <Pressable key={choice.value} cssInterop={false} accessibilityRole="radio"
      accessibilityLabel={choice.label} accessibilityHint={choice.explanation}
      accessibilityState={{ checked: value === choice.value, disabled }} disabled={disabled}
      onPress={() => { if (!disabled) onChange(choice.value); }}
      style={({ pressed }) => [s.choice, value === choice.value && s.selected, pressed && s.pressed, disabled && s.disabled]}>
      <View style={s.copy}>
        <Text style={[s.label, { fontFamily: fonts.medium }]}>{choice.label}</Text>
        <Text style={[s.explanation, { fontFamily: fonts.regular }]}>{choice.explanation}</Text>
      </View>
      <View style={[s.radio, value === choice.value && s.radioSelected]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {value === choice.value && <Check size={14} color={Colors.white} />}
      </View>
    </Pressable>)}
    {!!error && <Text accessibilityRole="alert" style={[s.error, { fontFamily: fonts.regular }]}>{error}</Text>}
  </View>;
}
const s = StyleSheet.create({
  section: { gap: 8, marginVertical: 12 },
  title: { ...T.title, color: C.ink },
  hint: { ...T.body, color: C.muted, marginBottom: 4 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 72, padding: 14, borderWidth: 1, borderColor: C.line, borderRadius: 16, backgroundColor: Colors.white },
  selected: { borderColor: Colors.terracotta },
  pressed: { backgroundColor: Colors.inputBg },
  disabled: { opacity: 0.65 },
  copy: { flex: 1, gap: 4 },
  label: { ...T.title, color: C.ink },
  explanation: { ...T.body, color: C.muted },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  radioSelected: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  error: { color: Colors.errorRed, ...T.body },
});
