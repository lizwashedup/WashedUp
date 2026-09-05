/**
 * The buyer-question editor as its own routed screen (Build 35 Screen 58,
 * spec §6.2: specs/washedup-BUILD35-SCREEN58-QUESTION-DELETE-20260901.md).
 * The source PDF calls this a "focused page" behind Guest questionnaire ->
 * Add question or Edit. Ported from components/creator/QuestionEditorSheet.tsx
 * (a Modal owned by tickets.tsx) -- same fields, same createQuestion /
 * updateQuestion calls, same styling; only the shell changed from a
 * page-sheet Modal to a routed screen so it has its own back-stack entry
 * instead of overlapping the rest of ticket setup underneath it.
 *
 * Reads and writes the SAME ['ticket-questions', id] react-query cache
 * tickets.tsx uses, so tickets.tsx's list reflects a save the moment we
 * invalidate that key, with no new fetch function invented for this screen.
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router, Redirect } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { hapticLight, hapticSuccess, hapticError } from '../../lib/haptics';
import { getCreatorAccess, canManageEvents, creatorLandingRoute } from '../../lib/creatorMode';
import {
  createQuestion,
  getQuestions,
  QUESTION_OPTIONS_MAX,
  QUESTION_PROMPT_MAX,
  QUESTION_TYPE_OPTIONS,
  QUESTION_TYPES_WITH_OPTIONS,
  updateQuestion,
  type QuestionScope,
  type QuestionType,
} from '../../lib/ticketing';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';

// a single option's label length is a UI nicety (the CHECK caps the array
// count, not each label)
const OPTION_LABEL_MAX = 200;

/** the object shape lib/ticketing's create/updateQuestion accept. */
export interface QuestionDraft {
  prompt: string;
  qtype: QuestionType;
  options: string[] | null;
  required: boolean;
  scope: QuestionScope;
}

/**
 * Choice types need at least two real options to be a choice at all (the
 * CHECK constraint allows one, but a one-option pick is not a question).
 * Extracted from QuestionEditorSheet's inline `canSave` check so it is
 * unit-testable on its own, matching this repo's convention of exporting one
 * pure decision helper per extracted screen (see event-money.tsx's
 * canSeeEventMoney, event-summary.tsx's summaryStatusLine).
 */
export function canSaveQuestionDraft(prompt: string, qtype: QuestionType, options: string[]): boolean {
  const needsOptions = QUESTION_TYPES_WITH_OPTIONS.includes(qtype);
  const cleanCount = options.map((o) => o.trim()).filter((o) => o.length > 0).length;
  return prompt.trim().length > 0 && (!needsOptions || cleanCount >= 2);
}

export default function QuestionEditorScreen() {
  const { id, questionId } = useLocalSearchParams<{ id: string; questionId: string }>();
  const queryClient = useQueryClient();

  const { data: access } = useQuery({ queryKey: ['creator-access'], queryFn: getCreatorAccess });

  // same queryKey tickets.tsx uses for its own list -- this reads the
  // already-cached data instead of re-fetching, and invalidating it on save
  // is what makes tickets.tsx's list pick up the change on the way back.
  const { data: questions, isLoading: questionsLoading } = useQuery({
    queryKey: ['ticket-questions', id],
    queryFn: () => getQuestions(id!),
    enabled: !!id,
    staleTime: 15_000,
  });

  const isNew = questionId === 'new';
  const question = isNew ? null : (questions ?? []).find((q) => q.id === questionId) ?? null;

  const [prompt, setPrompt] = useState('');
  const [qtype, setQtype] = useState<QuestionType>('short_text');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [required, setRequired] = useState(false);
  const [scope, setScope] = useState<QuestionScope>('per_order');
  const [hydrated, setHydrated] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);

  // hydrate the form once, the first time we have something to hydrate from
  // -- guarded so a background refetch of the questions list never clobbers
  // an in-progress edit.
  useEffect(() => {
    if (hydrated) return;
    if (isNew) { setHydrated(true); return; }
    if (!question) return; // list still loading
    setPrompt(question.prompt);
    setQtype(question.qtype);
    setOptions(question.options && question.options.length ? [...question.options] : ['', '']);
    setRequired(question.required);
    setScope(question.scope);
    setHydrated(true);
  }, [hydrated, isNew, question]);

  const saveMutation = useMutation({
    mutationFn: async (draft: QuestionDraft) => {
      const result = question
        ? await updateQuestion(question.id, draft)
        : await createQuestion(id!, draft, questions?.length ?? 0);
      if (!result.ok) throw new Error(result.message ?? 'save failed');
    },
    onSuccess: () => {
      hapticSuccess();
      queryClient.invalidateQueries({ queryKey: ['ticket-questions', id] });
      router.back();
    },
    onError: (e: any) => {
      hapticError();
      setAlertInfo({ title: 'that did not save', message: e?.message ?? 'give it another try.' });
    },
  });

  const needsOptions = QUESTION_TYPES_WITH_OPTIONS.includes(qtype);
  const cleanOptions = options.map((o) => o.trim()).filter((o) => o.length > 0);
  const canSave = canSaveQuestionDraft(prompt, qtype, options);

  const setOption = (i: number, v: string) => {
    setOptions((prev) => prev.map((o, idx) => (idx === i ? v.slice(0, OPTION_LABEL_MAX) : o)));
  };
  const addOption = () => {
    if (options.length >= QUESTION_OPTIONS_MAX) return;
    hapticLight();
    setOptions((prev) => [...prev, '']);
  };
  const removeOption = (i: number) => {
    hapticLight();
    setOptions((prev) => (prev.length <= 2 ? prev : prev.filter((_, idx) => idx !== i)));
  };

  const handleSave = () => {
    if (saveMutation.isPending) return;
    // Tappable-when-incomplete: a bad tap gives a haptic and the inline
    // "add at least two options" hint (below) explains the non-obvious
    // choice-type requirement, instead of the button silently doing nothing.
    if (!canSave) { hapticError(); return; }
    saveMutation.mutate({
      prompt: prompt.trim(),
      qtype,
      options: needsOptions ? cleanOptions : null,
      required,
      scope,
    });
  };

  if (access && !access.hasEventHostGrant && !canManageEvents(access)) {
    return <Redirect href={creatorLandingRoute(access)} />;
  }

  if (!isNew && questionsLoading && !question) {
    return (
      <SafeAreaView style={styles.sheet} edges={['top', 'bottom']}>
        <View style={styles.loading}>
          <ActivityIndicator size="small" color={Colors.terracotta} />
        </View>
      </SafeAreaView>
    );
  }

  if (!isNew && !questionsLoading && !question) {
    return (
      <SafeAreaView style={styles.sheet} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            {/* LIZ COPY */}
            <Text style={styles.cancel}>back</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.loading}>
          {/* copy to the taste gate */}
          <Text style={styles.hint}>that question is gone. it may have already been removed.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.sheet} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          {/* LIZ COPY */}
          <Text style={styles.cancel}>cancel</Text>
        </TouchableOpacity>
        {/* copy to the taste gate */}
        <Text style={styles.headerTitle}>{question ? 'edit question' : 'a question'}</Text>
        <TouchableOpacity onPress={handleSave} disabled={saveMutation.isPending} hitSlop={12}>
          <Text style={[styles.save, (!canSave || saveMutation.isPending) && styles.saveOff]}>save</Text>
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
            maxLength={QUESTION_PROMPT_MAX}
          />

          {/* the type */}
          <Text style={styles.label}>the kind of answer</Text>
          <View style={styles.chipWrap}>
            {QUESTION_TYPE_OPTIONS.map((t) => (
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
              {options.length < QUESTION_OPTIONS_MAX && (
                <TouchableOpacity style={styles.addOption} onPress={addOption} hitSlop={8}>
                  <Plus size={14} color={Colors.terracotta} strokeWidth={2.5} />
                  {/* copy to the taste gate */}
                  <Text style={styles.addOptionText}>another option</Text>
                </TouchableOpacity>
              )}
              {cleanOptions.length < 2 && (
                <Text style={styles.optionHint}>add at least two options so it&apos;s a real choice.</Text>
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
          <Text style={styles.labelHint}>once per purchase, or once for every ticket in the purchase.</Text>
          <View style={styles.chipWrap}>
            <TouchableOpacity
              style={[styles.chip, scope === 'per_order' && styles.chipOn]}
              onPress={() => { hapticLight(); setScope('per_order'); }}
              activeOpacity={0.85}
            >
              <Text style={[styles.chipText, scope === 'per_order' && styles.chipTextOn]}>once per purchase</Text>
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

      <BrandedAlert
        visible={!!alertInfo}
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message}
        buttons={alertInfo?.buttons}
        onClose={() => setAlertInfo(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: Colors.parchment },
  flex: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
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
  optionHint: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary, marginTop: 4 },
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
