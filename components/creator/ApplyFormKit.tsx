/**
 * Shared pieces for the two creator application forms (phase 2).
 * Copy source of truth: Events_Communities/12-application-forms-draft.md.
 */

import React from 'react';
import { ScaledText } from '../ScaledText';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Linking } from 'react-native';
import { Check } from 'lucide-react-native';
import Colors, { AfterglowColors, SceneDetailColors as Scene, CreatorSurfaceColors } from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights, type AfterglowFontFamilies } from '../../constants/Typography';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../keyboard/KeyboardDoneBar';
import { hapticLight, hapticSelection } from '../../lib/haptics';
import type { Option } from '../../lib/operatorApplications';
import type { ApplicationFieldGuidance } from './useApplicationFormGuidance';

type ApplicationAppearance = { fonts: AfterglowFontFamilies; application?: boolean; remeasureText?: boolean };

export function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
  multiline = false,
  maxLength,
  autoCapitalize = 'sentences',
  editable = true, keyboardType = 'default', appearance, guidance,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  maxLength?: number;
  autoCapitalize?: 'none' | 'sentences';
  editable?: boolean; keyboardType?: 'default' | 'email-address';
  appearance?: ApplicationAppearance;
  guidance?: ApplicationFieldGuidance;
}) {
  // Refresh only copy leaves; the input/ref and its native focus stay mounted.
  const CopyText = appearance?.remeasureText ? ScaledText : Text;
  return (
    <View onLayout={guidance?.onLayout} style={[styles.fieldWrap, appearance?.application && presentation.fieldWrap]}>
      <CopyText style={[styles.fieldLabel, appearance && { fontFamily: appearance.fonts.semibold, color: AfterglowColors.ink }]}>{label}</CopyText>
      {hint ? <CopyText style={[styles.fieldHint, appearance && { fontFamily: appearance.fonts.regular, color: appearance.application ? Scene.supporting : AfterglowColors.muted }]}>{hint}</CopyText> : null}
      <TextInput
        ref={guidance?.inputRef}
        onFocus={guidance?.onFocus}
        onBlur={guidance?.onBlur}
        accessibilityHint={guidance?.error}
        accessibilityLabel={label}
        style={[styles.input, multiline && styles.inputMultiline, appearance && [appearance.application && presentation.input, { fontFamily: appearance.fonts.regular, color: AfterglowColors.ink, backgroundColor: AfterglowColors.white, borderColor: AfterglowColors.line, borderRadius: 12 }], guidance?.error && presentation.inputError]}
        editable={editable} keyboardType={keyboardType} autoCorrect={keyboardType !== 'email-address'}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={Colors.inkSoft}
        multiline={multiline}
        maxLength={maxLength}
        autoCapitalize={autoCapitalize}
        inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
      />
      <FieldError message={guidance?.error} appearance={appearance} />
      {maxLength && multiline ? (
        <CopyText style={[styles.charCount, appearance && { fontFamily: appearance.fonts.regular, color: AfterglowColors.muted }]}>{value.length}/{maxLength}</CopyText>
      ) : null}
    </View>
  );
}

export function ChoiceList({
  label,
  hint,
  options,
  selected,
  onSelect,
  appearance,
  guidance,
}: {
  label: string;
  hint?: string;
  options: Option[];
  selected: string | null;
  onSelect: (key: string) => void;
  appearance?: ApplicationAppearance;
  guidance?: ApplicationFieldGuidance;
}) {
  return (
    <View onLayout={guidance?.onLayout} style={[styles.fieldWrap, appearance?.application && presentation.fieldWrap]}>
      <Text style={[styles.fieldLabel, appearance && { fontFamily: appearance.fonts.medium, color: Scene.text, lineHeight: LineHeights.bodyMD }]}>{label}</Text>
      {hint ? <Text style={[styles.fieldHint, appearance && { fontFamily: appearance.fonts.regular, color: Scene.supporting }]}>{hint}</Text> : null}
      <FieldError message={guidance?.error} appearance={appearance} beforeControl />
      <View style={[styles.choiceGroup, appearance && presentation.choiceGroup]}>
        {options.map((opt, i) => {
          const active = selected === opt.key;
          return (
            <TouchableOpacity
              key={opt.key}
              accessibilityRole="radio"
              accessibilityLabel={`${label}: ${opt.label}`}
              accessibilityState={{ checked: active }}
              aria-checked={active}
              style={[styles.choiceRow, appearance && presentation.choiceRow, i === options.length - 1 && styles.choiceRowLast, active && styles.choiceRowActive, appearance && active && presentation.choiceActive]}
              onPress={() => {
                hapticSelection();
                onSelect(opt.key);
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.radio, appearance && presentation.controlIcon, active && styles.radioActive]}>
                {active && <View style={styles.radioDot} />}
              </View>
              <Text style={[styles.choiceText, active && styles.choiceTextActive, appearance && { fontFamily: active ? appearance.fonts.medium : appearance.fonts.regular, color: Scene.text, lineHeight: LineHeights.bodyMD, minWidth: 0 }]}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

export function ChipMulti({
  label,
  options,
  selected,
  onToggle,
  appearance,
  guidance,
}: {
  label: string;
  options: Option[];
  selected: string[];
  onToggle: (key: string) => void;
  appearance?: ApplicationAppearance;
  guidance?: ApplicationFieldGuidance;
}) {
  return (
    <View onLayout={guidance?.onLayout} style={[styles.fieldWrap, appearance?.application && presentation.fieldWrap]}>
      <Text style={[styles.fieldLabel, appearance && { fontFamily: appearance.fonts.medium, color: Scene.text, lineHeight: LineHeights.bodyMD }]}>{label}</Text>
      <FieldError message={guidance?.error} appearance={appearance} beforeControl />
      <View style={styles.chipWrap}>
        {options.map((opt) => {
          const active = selected.includes(opt.key);
          return (
            <TouchableOpacity
              key={opt.key}
              accessibilityRole={appearance ? 'checkbox' : undefined}
              accessibilityLabel={appearance ? opt.label : undefined}
              accessibilityState={appearance ? { checked: active } : undefined}
              style={[styles.chip, appearance && presentation.chip, active && styles.chipActive]}
              onPress={() => {
                hapticSelection();
                onToggle(opt.key);
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive, appearance && { fontFamily: appearance.fonts.medium, lineHeight: LineHeights.bodySM, flexShrink: 1 }]}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

export function LinksInput({
  label,
  hint,
  links,
  onChange,
  appearance,
  guidance,
}: {
  label: string;
  hint: string;
  links: string[];
  onChange: (links: string[]) => void;
  appearance?: ApplicationAppearance;
  guidance?: ApplicationFieldGuidance;
}) {
  return (
    <View onLayout={guidance?.onLayout} style={[styles.fieldWrap, appearance?.application && presentation.fieldWrap]}>
      <Text style={[styles.fieldLabel, appearance && { fontFamily: appearance.fonts.medium, color: Scene.text, lineHeight: LineHeights.bodyMD }]}>{label}</Text>
      <Text style={[styles.fieldHint, appearance && { fontFamily: appearance.fonts.regular, color: Scene.supporting }]}>{hint}</Text>
      <FieldError message={guidance?.error} appearance={appearance} beforeControl />
      {links.map((link, i) => (
        <TextInput
          key={i}
          ref={i === 0 ? guidance?.inputRef : undefined}
          onFocus={guidance?.onFocus}
          accessibilityHint={guidance?.error}
          accessibilityLabel={appearance ? `${label}: link ${i + 1}` : undefined}
          style={[styles.input, { marginBottom: 8 }, appearance && [presentation.input, { fontFamily: appearance.fonts.regular, color: Scene.text, backgroundColor: Scene.surface, borderColor: Scene.border }], guidance?.error && presentation.inputError]}
          value={link}
          onChangeText={(v) => {
            const next = [...links];
            next[i] = v;
            onChange(next);
          }}
          placeholder={i === 0 ? 'https://... (at least one)' : 'https://... (optional)'}
          placeholderTextColor={Colors.inkSoft}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
        />
      ))}
    </View>
  );
}

export function TermsCheck({ checked, onToggle, appearance, guidance }: { checked: boolean; onToggle: () => void; appearance?: ApplicationAppearance; guidance?: ApplicationFieldGuidance }) {
  const control = (
    <TouchableOpacity
      style={[styles.termsRow, appearance && presentation.termsRow, guidance && { marginBottom: 0 }]}
      accessibilityRole={appearance ? 'checkbox' : undefined}
      accessibilityLabel={appearance ? 'I agree to the creator terms' : undefined}
      accessibilityState={appearance ? { checked } : undefined}
      onPress={() => {
        hapticLight();
        onToggle();
      }}
      activeOpacity={0.7}
    >
      <View style={[styles.checkbox, appearance && presentation.controlIcon, checked && styles.checkboxActive]}>
        {checked && <Check size={14} color={Colors.white} strokeWidth={3} />}
      </View>
      <Text style={[styles.termsText, appearance && { fontFamily: appearance.fonts.regular, color: Scene.text, flex: 1, minWidth: 0, lineHeight: LineHeights.bodyMD }]}>
        i agree to the{' '}
        {/* repointed to the real creator-terms page (web built it; doc 43) */}
        <Text style={[styles.termsLink, appearance && { fontFamily: appearance.fonts.medium }]} onPress={() => Linking.openURL('https://washedup.app/creator-terms')}>
          creator terms
        </Text>
      </Text>
    </TouchableOpacity>
  );
  return guidance ? <View onLayout={guidance.onLayout} style={presentation.consentWrap}>{control}<FieldError message={guidance.error} appearance={appearance} /></View> : control;
}

export function FieldError({ message, appearance, beforeControl = false }: { message?: string; appearance?: ApplicationAppearance; beforeControl?: boolean }) {
  const CopyText = appearance?.remeasureText ? ScaledText : Text;
  return message ? <CopyText style={[presentation.errorText, beforeControl && { marginBottom: 8 }, appearance && { fontFamily: appearance.fonts.medium }]}>{message}</CopyText> : null;
}

export function SubmitButton({
  disabled = false,
  inactive = false,
  submitting,
  onPress,
  appearance,
  label = 'send it in',
}: {
  disabled?: boolean;
  // `inactive` greys the button (form incomplete) but keeps it TAPPABLE, so the
  // press handler can explain what's missing instead of the tap being swallowed.
  // Only `disabled`/`submitting` actually block the press.
  inactive?: boolean;
  submitting: boolean;
  onPress: () => void;
  appearance?: ApplicationAppearance;
  label?: string;
}) {
  return (
    <TouchableOpacity
      style={[styles.submitBtn, appearance && presentation.submitButton, (inactive || disabled || submitting) && styles.submitBtnDisabled]}
      accessibilityRole={appearance ? 'button' : undefined}
      accessibilityLabel={appearance ? label : undefined}
      accessibilityState={appearance ? { disabled: disabled || submitting, busy: submitting } : undefined}
      onPress={onPress}
      disabled={disabled || submitting}
      activeOpacity={0.85}
    >
      {submitting ? (
        <ActivityIndicator size="small" color={Colors.white} />
      ) : (
        <Text style={[styles.submitBtnText, appearance && { fontFamily: appearance.fonts.medium, lineHeight: LineHeights.bodyLG }]}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

export function Confirmation({ onDone, appearance, title = 'got it', doneLabel = 'done' }: { onDone: () => void; appearance?: ApplicationAppearance; title?: string; doneLabel?: string }) {
  return (
    <View style={[styles.confirmWrap, appearance && presentation.confirmWrap]}>
      <View style={styles.confirmBadge}>
        <Check size={28} color={Colors.darkWarm} strokeWidth={2.5} />
      </View>
      <Text style={[styles.confirmTitle, appearance && { fontFamily: appearance.fonts.display, color: Scene.text, lineHeight: LineHeights.displayLG, textAlign: 'center' }]}>{title}</Text>
      <Text style={[styles.confirmBody, appearance && { fontFamily: appearance.fonts.regular, color: Scene.supporting }]}>Application received. Check Apply to Scene for updates.</Text>
      <TouchableOpacity accessibilityRole={appearance ? 'button' : undefined} accessibilityLabel={appearance ? doneLabel : undefined} style={[styles.confirmBtn, appearance && presentation.confirmButton]} onPress={onDone} activeOpacity={0.85}>
        <Text style={[styles.confirmBtnText, appearance && { fontFamily: appearance.fonts.medium }]}>{doneLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  fieldWrap: { marginBottom: 20 },
  fieldLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.darkWarm,
    marginBottom: 4,
  },
  fieldHint: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    lineHeight: LineHeights.bodySM,
    color: Colors.secondary,
    marginBottom: 8,
  },
  input: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.borderWarm,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.darkWarm,
  },
  inputMultiline: { minHeight: 96, textAlignVertical: 'top' },
  charCount: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
    alignSelf: 'flex-end',
    marginTop: 4,
  },

  choiceGroup: {
    backgroundColor: Colors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.borderWarm,
    overflow: 'hidden',
  },
  choiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dividerWarm,
  },
  choiceRowLast: { borderBottomWidth: 0 },
  choiceRowActive: { backgroundColor: Colors.brandSoft },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.borderWarm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
  },
  radioActive: { borderColor: Colors.terracotta },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.terracotta },
  choiceText: { flex: 1, fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  choiceTextActive: { fontFamily: Fonts.sansMedium },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: Colors.borderWarm,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: Colors.white,
  },
  chipActive: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  chipText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.darkWarm },
  chipTextActive: { color: Colors.white },

  termsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: Colors.borderWarm,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxActive: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  termsText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  termsLink: { fontFamily: Fonts.sansMedium, color: Colors.terracotta },

  submitBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: 'center',
    shadowColor: Colors.terracotta,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  submitBtnDisabled: { opacity: 0.4 },
  submitBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.white },

  confirmWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, gap: 12 },
  confirmBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.goldBadgeSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  confirmTitle: { fontFamily: Fonts.display, fontSize: FontSizes.displayLG, color: Colors.darkWarm },
  confirmBody: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    lineHeight: LineHeights.bodyMD,
    color: Colors.secondary,
    textAlign: 'center',
  },
  confirmBtn: {
    marginTop: 16,
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    borderRadius: 999,
    paddingHorizontal: 36,
    paddingVertical: 12,
  },
  confirmBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
});

// Optional creator presentation; legacy consumers retain their current defaults.
const presentation = StyleSheet.create({
  inputError: { borderColor: Colors.errorBrand },
  errorText: { color: Scene.text, fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, lineHeight: LineHeights.bodySM, marginTop: 6, borderLeftWidth: 2, borderLeftColor: Colors.errorBrand, paddingLeft: 8 },
  consentWrap: { width: '100%', marginBottom: 20 },
  fieldWrap: { width: '100%', minWidth: 0 },
  input: { width: '100%', minHeight: 48, fontSize: FontSizes.bodyLG, lineHeight: LineHeights.bodyLG },
  choiceGroup: { width: '100%', backgroundColor: Scene.surface, borderColor: Scene.border },
  choiceRow: { minHeight: 48 },
  choiceActive: { backgroundColor: CreatorSurfaceColors.sunsetGoldLight },
  controlIcon: { flexShrink: 0 },
  chip: { minHeight: 44, maxWidth: '100%', justifyContent: 'center' },
  termsRow: { minHeight: 44, alignItems: 'flex-start', paddingVertical: 8 },
  submitButton: { minHeight: 48, width: '100%', justifyContent: 'center', shadowOpacity: 0.12, elevation: 1 },
  confirmWrap: { paddingHorizontal: 24 },
  confirmButton: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
});
