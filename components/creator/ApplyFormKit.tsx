/**
 * Shared pieces for the two creator application forms (phase 2).
 * Copy source of truth: Events_Communities/12-application-forms-draft.md.
 */

import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Linking } from 'react-native';
import { Check } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../keyboard/KeyboardDoneBar';
import { hapticLight, hapticSelection } from '../../lib/haptics';
import type { Option } from '../../lib/operatorApplications';

export function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
  multiline = false,
  maxLength,
  autoCapitalize = 'sentences',
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  maxLength?: number;
  autoCapitalize?: 'none' | 'sentences';
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={Colors.inkSoft}
        multiline={multiline}
        maxLength={maxLength}
        autoCapitalize={autoCapitalize}
        inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
      />
      {maxLength && multiline ? (
        <Text style={styles.charCount}>{value.length}/{maxLength}</Text>
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
}: {
  label: string;
  hint?: string;
  options: Option[];
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
      <View style={styles.choiceGroup}>
        {options.map((opt, i) => {
          const active = selected === opt.key;
          return (
            <TouchableOpacity
              key={opt.key}
              style={[styles.choiceRow, i === options.length - 1 && styles.choiceRowLast, active && styles.choiceRowActive]}
              onPress={() => {
                hapticSelection();
                onSelect(opt.key);
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.radio, active && styles.radioActive]}>
                {active && <View style={styles.radioDot} />}
              </View>
              <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{opt.label}</Text>
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
}: {
  label: string;
  options: Option[];
  selected: string[];
  onToggle: (key: string) => void;
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.chipWrap}>
        {options.map((opt) => {
          const active = selected.includes(opt.key);
          return (
            <TouchableOpacity
              key={opt.key}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => {
                hapticSelection();
                onToggle(opt.key);
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{opt.label}</Text>
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
}: {
  label: string;
  hint: string;
  links: string[];
  onChange: (links: string[]) => void;
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldHint}>{hint}</Text>
      {links.map((link, i) => (
        <TextInput
          key={i}
          style={[styles.input, { marginBottom: 8 }]}
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

export function TermsCheck({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  return (
    <TouchableOpacity
      style={styles.termsRow}
      onPress={() => {
        hapticLight();
        onToggle();
      }}
      activeOpacity={0.7}
    >
      <View style={[styles.checkbox, checked && styles.checkboxActive]}>
        {checked && <Check size={14} color={Colors.white} strokeWidth={3} />}
      </View>
      <Text style={styles.termsText}>
        i agree to the{' '}
        <Text style={styles.termsLink} onPress={() => Linking.openURL('https://washedup.app/terms')}>
          creator terms
        </Text>
      </Text>
    </TouchableOpacity>
  );
}

export function SubmitButton({
  disabled,
  submitting,
  onPress,
}: {
  disabled: boolean;
  submitting: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.submitBtn, (disabled || submitting) && styles.submitBtnDisabled]}
      onPress={onPress}
      disabled={disabled || submitting}
      activeOpacity={0.85}
    >
      {submitting ? (
        <ActivityIndicator size="small" color={Colors.white} />
      ) : (
        <Text style={styles.submitBtnText}>send it in</Text>
      )}
    </TouchableOpacity>
  );
}

export function Confirmation({ onDone }: { onDone: () => void }) {
  return (
    <View style={styles.confirmWrap}>
      <View style={styles.confirmBadge}>
        <Check size={28} color={Colors.darkWarm} strokeWidth={2.5} />
      </View>
      <Text style={styles.confirmTitle}>got it</Text>
      <Text style={styles.confirmBody}>a real person is reading this, you'll hear from us within a day.</Text>
      <TouchableOpacity style={styles.confirmBtn} onPress={onDone} activeOpacity={0.85}>
        <Text style={styles.confirmBtnText}>done</Text>
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
