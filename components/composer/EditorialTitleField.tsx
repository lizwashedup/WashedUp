/**
 * EditorialTitleField - the plan title as a name, not a form field. Cormorant
 * italic ~28px on a single underline rule, no border box (design study v3).
 * Shared by both composer surfaces (PlanComposerV2 + CirclePlanComposer).
 */
import { useMemo, type Ref } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import Colors, { AfterglowColors } from '../../constants/Colors';
import { Fonts, AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';

interface EditorialTitleFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  label?: string;
  maxLength?: number;
  autoFocus?: boolean;
  appearance?: { fonts: AfterglowFontFamilies };
  inputRef?: Ref<TextInput>;
  error?: string;
}

export default function EditorialTitleField({
  value,
  onChangeText,
  placeholder,
  label = 'what',
  maxLength = 80,
  autoFocus = false,
  appearance,
  inputRef,
  error,
}: EditorialTitleFieldProps) {
  const s = useMemo(() => appearance ? { ...styles, ...titleAppearance(appearance.fonts) } : styles, [appearance?.fonts]);
  return (
    <View style={s.container}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        ref={inputRef}
        style={[s.input, error ? { borderBottomColor: Colors.errorBrand } : undefined]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={appearance ? AfterglowColors.muted : Colors.inkSoft}
        maxLength={maxLength}
        autoFocus={autoFocus}
        returnKeyType="next"
        multiline={false}
        accessibilityLabel={`${label}, plan title`}
        accessibilityHint={error}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
  },
  label: {
    fontFamily: Fonts.sansSemibold,
    fontSize: 13,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: Colors.terracotta,
    marginBottom: 8,
  },
  input: {
    fontFamily: Fonts.display,
    fontSize: 28,
    lineHeight: 32,
    color: Colors.darkWarm,
    borderBottomWidth: 1.5,
    borderBottomColor: Colors.border,
    paddingBottom: 6,
    paddingTop: 0,
  },
});

function titleAppearance(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  label: { ...AfterglowType.section, fontFamily: fonts.semibold, color: AfterglowColors.muted, marginBottom: 8 },
  input: { ...AfterglowType.identity, fontFamily: fonts.display, color: AfterglowColors.ink,
    minHeight: 48, borderBottomWidth: 1, borderBottomColor: AfterglowColors.line, paddingVertical: 8 },
}); }
