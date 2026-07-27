/**
 * The buyer-question editor (92B §3.8): prompt, one of the six types, options
 * for the choice types, required, and scope (once per order / for each ticket).
 * Mirrors TierEditorSheet's shell. No helper-text field: the live
 * ticket_questions table has no such column (flagged to Cowork).
 */

import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Plus, X } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { EventSpacing } from '../../constants/EventDesign';
import { hapticLight } from '../../lib/haptics';
import {
  OPTION_LABEL_MAX,
  OPTION_MAX,
  PROMPT_MAX,
  QUESTION_TYPES,
  typeNeedsOptions,
  type QuestionDraft,
  type QuestionScope,
  type QuestionType,
  type TicketQuestion,
} from '../../lib/ticketQuestions';

interface QuestionEditorSheetProps {
  visible: boolean;
  /** null = creating a new question */
  question: TicketQuestion | null;
  busy: boolean;
  onSave: (draft: QuestionDraft) => void;
  onClose: () => void;
}

export function QuestionEditorSheet({ visible, question, busy, onSave, onClose }: QuestionEditorSheetProps) {
  const [prompt, setPrompt] = useState('');
  const [qtype, setQtype] = useState<QuestionType>('short_text');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [required, setRequired] = useState(false);
  const [scope, setScope] = useState<QuestionScope>('per_order');

  useEffect(() => {
    if (!visible) return;
    setPrompt(question?.prompt ?? '');
    setQtype(question?.qtype ?? 'short_text');
    setOptions(question?.options && question.options.length ? [...question.options] : ['', '']);
    setRequired(question?.required ?? false);
    setScope(question?.scope ?? 'per_order');
  }, [visible, question]);

  const needsOptions = typeNeedsOptions(qtype);
  const cleanOptions = options.map((o) => o.trim()).filter((o) => o.length > 0);
  // choice types need at least two real options to be a choice at all (the
  // CHECK allows one, but a one-option pick is not a question)
  const canSave = prompt.trim().length > 0 && (!needsOptions || cleanOptions.length >= 2);

  const setOption = (i: number, v: string) => {
    setOptions((prev) => prev.map((o, idx) => (idx === i ? v.slice(0, OPTION_LABEL_MAX) : o)));
  };
  const addOption = () => {
    if (options.length >= OPTION_MAX) return;
    hapticLight();
    setOptions((prev) => [...prev, '']);
  };
  const removeOption = (i: number) => {
    hapticLight();
    setOptions((prev) => (prev.length <= 2 ? prev : prev.filter((_, idx) => idx !== i)));
  };

  const handleSave = () => {
    if (!canSave || busy) return;
    onSave({
      prompt: prompt.trim(),
      qtype,
      options: needsOptions ? cleanOptions : null,
      required,
      scope,
    });
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <SafeAreaView style={styles.sheet} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            {/* LIZ COPY */}
            <Text style={styles.cancel}>cancel</Text>
          </TouchableOpacity>
          {/* copy to the taste gate */}
          <Text style={styles.headerTitle}>{question ? 'edit question' : 'a question'}</Text>
          <TouchableOpacity onPress={handleSave} disabled={!canSave || busy} hitSlop={12}>
            <Text style={[styles.save, (!canSave || busy) && styles.saveOff]}>save</Text>
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {/* the prompt */}
            <Text style={styles.label}>what you'll ask</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={prompt}
              onChangeText={setPrompt}
              placeholder={qtype === 'terms' ? 'the terms they agree to' : 'what should we call you at the door?'}
              placeholderTextColor={Colors.textLight}
              multiline
              maxLength={PROMPT_MAX}
            />

            {/* the type */}
            <Text style={styles.label}>the kind of answer</Text>
            <View style={styles.chipWrap}>
              {QUESTION_TYPES.map((t) => (
                <TouchableOpacity
                  key={t.value}
                  style={[styles.chip, qtype === t.value && styles.chipOn]}
                  onPress={() => { hapticLight(); setQtype(t.value); }}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.chipText, qtype === t.value && styles.chipTextOn]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* options, for the choice types only */}
            {needsOptions && (
              <>
                <Text style={styles.label}>the options</Text>
                {options.map((opt, i) => (
                  <View key={i} style={styles.optionRow}>
                    <TextInput
                      style={[styles.input, styles.optionInput]}
                      value={opt}
                      onChangeText={(v) => setOption(i, v)}
                      placeholder={`option ${i + 1}`}
                      placeholderTextColor={Colors.textLight}
                      maxLength={OPTION_LABEL_MAX}
                    />
                    {options.length > 2 && (
                      <TouchableOpacity onPress={() => removeOption(i)} hitSlop={10} style={styles.optionRemove}>
                        <X size={16} color={Colors.textMedium} strokeWidth={2} />
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
                {options.length < OPTION_MAX && (
                  <TouchableOpacity style={styles.addOption} onPress={addOption} hitSlop={8}>
                    <Plus size={14} color={Colors.terracotta} strokeWidth={2.5} />
                    {/* copy to the taste gate */}
                    <Text style={styles.addOptionText}>another option</Text>
                  </TouchableOpacity>
                )}
              </>
            )}

            {/* required */}
            <Text style={styles.label}>do they have to answer</Text>
            <View style={styles.chipWrap}>
              <TouchableOpacity
                style={[styles.chip, !required && styles.chipOn]}
                onPress={() => { hapticLight(); setRequired(false); }}
                activeOpacity={0.85}
              >
                <Text style={[styles.chipText, !required && styles.chipTextOn]}>optional</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.chip, required && styles.chipOn]}
                onPress={() => { hapticLight(); setRequired(true); }}
                activeOpacity={0.85}
              >
                <Text style={[styles.chipText, required && styles.chipTextOn]}>required</Text>
              </TouchableOpacity>
            </View>

            {/* scope */}
            <Text style={styles.label}>ask it</Text>
            <Text style={styles.labelHint}>once per order, or once for every ticket in the order.</Text>
            <View style={styles.chipWrap}>
              <TouchableOpacity
                style={[styles.chip, scope === 'per_order' && styles.chipOn]}
                onPress={() => { hapticLight(); setScope('per_order'); }}
                activeOpacity={0.85}
              >
                <Text style={[styles.chipText, scope === 'per_order' && styles.chipTextOn]}>once per order</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.chip, scope === 'per_attendee' && styles.chipOn]}
                onPress={() => { hapticLight(); setScope('per_attendee'); }}
                activeOpacity={0.85}
              >
                <Text style={[styles.chipText, scope === 'per_attendee' && styles.chipTextOn]}>for each ticket</Text>
              </TouchableOpacity>
            </View>

            {needsOptions && cleanOptions.length < 2 && (
              /* copy to the taste gate */
              <Text style={styles.hint}>a choice needs at least two options.</Text>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: Colors.parchment },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  cancel: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.textMedium },
  headerTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  save: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  saveOff: { color: Colors.textLight },
  content: { padding: 20, paddingBottom: 40 },
  label: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.secondary, marginBottom: 6, marginTop: 16 },
  labelHint: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.tertiary, marginBottom: 8, marginTop: -2 },
  input: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  inputMultiline: { minHeight: 64, textAlignVertical: 'top' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.cardBg,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipOn: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  chipText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.darkWarm },
  chipTextOn: { color: Colors.white },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  optionInput: { flex: 1 },
  optionRemove: { padding: 4 },
  addOption: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, marginTop: 2 },
  addOptionText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  hint: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium, marginTop: 16 },
});
