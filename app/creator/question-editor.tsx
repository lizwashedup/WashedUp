import {useAfterglowFonts} from '../../hooks/useAfterglowFonts';
import {useMemo} from 'react';
import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { type AfterglowFontFamilies, FontSizes } from '../../constants/Typography';
import { hapticLight, hapticSuccess, hapticError } from '../../lib/haptics';
import { CreatorTicketEditorGate } from '../../components/creator/CreatorTicketEditorGate';
import type { CreatorPageScope } from '../../lib/creatorPageReview';
import { saveCreatorQuestion, CreatorQuestionChanged, CreatorQuestionRejected, questionDraftProblem, type QuestionDraft } from '../../lib/creatorQuestionEditor';
import {useCreatorQuestionDraft} from '../../hooks/useCreatorQuestionDraft';
import {useCommunicationDraftExit} from '../../hooks/useCommunicationDraftExit';
import type {CreatorQuestionRecord} from '../../lib/creatorQuestionDraft';
export type { QuestionDraft } from '../../lib/creatorQuestionEditor';
import {
  getQuestions,
  QUESTION_OPTIONS_MAX,
  QUESTION_PROMPT_MAX,
  QUESTION_TYPE_OPTIONS,
  QUESTION_TYPES_WITH_OPTIONS,
  type QuestionScope,
  type QuestionType,
  type TicketQuestion,
} from '../../lib/ticketing';

// a single option's label length is a UI nicety (the CHECK caps the array
// count, not each label)
const OPTION_LABEL_MAX = 200;

/** the object shape lib/ticketing's create/updateQuestion accept. */
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
  return <CreatorTicketEditorGate eventId={id} recordId={questionId} title="Registration question">{(visit,active)=><QuestionEditor id={id!} questionId={questionId!} visit={visit} active={active}/>}</CreatorTicketEditorGate>;
}
function QuestionEditor({id,questionId,visit,active}:{id:string;questionId:string;visit:CreatorPageScope;active:boolean}) {
  const {fonts}=useAfterglowFonts(true, 'creator');
  const styles=useMemo(()=>createStyles(fonts),[fonts]);
  const {fontScale}=useWindowDimensions();
  const queryClient=useQueryClient();
  const {data:questions,isLoading:questionsLoading,error:questionsError,refetch}=useQuery({queryKey:['ticket-questions',id,visit.userId],queryFn:()=>getQuestions(id,true,visit),enabled:active,staleTime:0});
  const saveLock=useRef(false);
  const scroll=useRef<ScrollView>(null),revealProblem=useRef(false);
  const [saveProblem,setSaveProblem]=useState<string>();
  const [conflict,setConflict]=useState(false);
  const isNew=questionId==='new';
  const question=isNew?null:(questions??[]).find(q=>q.id===questionId)??null;
  const editor=useCreatorQuestionDraft(id,questionId,visit,active&&!questionsLoading&&!questionsError,question);
  useCommunicationDraftExit(visit,editor);
  const {prompt='',qtype='short_text',options=['',''],required=false,scope='per_order'}=editor.value?.form??{};
  const uncertain=!!editor.value?.pending,confirmed=!!editor.value?.confirmed;
  const setPrompt=(prompt:string)=>editor.change(form=>({...form,prompt}));
  const setQtype=(qtype:QuestionType)=>editor.change(form=>({...form,qtype}));
  const setOptions=(update:(options:string[])=>string[])=>editor.change(form=>({...form,options:update(form.options)}));
  const setRequired=(required:boolean)=>editor.change(form=>({...form,required}));
  const setScope=(scope:QuestionScope)=>editor.change(form=>({...form,scope}));

  const saveMutation = useMutation({
    mutationFn: async ({record,write}:{record:CreatorQuestionRecord;write:boolean}) => {
      return saveCreatorQuestion(id,record.recordId,record.pending!,record.baseline,visit,write,{previouslyDispatched:record.dispatched??true,beforeDispatch:editor.markDispatched});
    },
    onSuccess: async () => {
      void queryClient.invalidateQueries({queryKey:['ticket-questions',id,visit.userId]});
      if(!visit.isCurrent())return;
      hapticSuccess();if(await editor.finish()&&visit.isCurrent())router.back();
    },
    onError: async (error) => {
      if(!visit.isCurrent())return;
      if(error instanceof CreatorQuestionRejected){
        await editor.releaseRejected();if(!visit.isCurrent())return;
        hapticError();setConflict(false);revealProblem.current=true;setSaveProblem(error.message);return;
      }
      hapticError();setConflict(error instanceof CreatorQuestionChanged);revealProblem.current=true;setSaveProblem(error instanceof CreatorQuestionChanged?'This question has changed. Use the saved version before editing again.':'Couldn’t confirm the save. Your question is kept. Check its status or retry the same question.');
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

  const handleSave = async (write=true) => {
    if(saveLock.current || saveMutation.isPending || !active || !visit.isCurrent()||!editor.ready||conflict)return;
    if(confirmed){saveLock.current=true;try{if(await editor.finish()&&visit.isCurrent())router.back();}finally{saveLock.current=false;}return;}
    const draft=editor.value?.pending??{prompt:prompt.trim(),qtype,options:needsOptions?cleanOptions:null,required,scope};
    const problem=questionDraftProblem(draft);
    if(problem){hapticError();revealProblem.current=true;setSaveProblem(problem);return;}
    saveLock.current=true;setSaveProblem(undefined);
    try {const record=await editor.prepare(draft);if(record&&visit.isCurrent())await saveMutation.mutateAsync({record,write});}catch {}finally{saveLock.current=false;}
  };
  const close=()=>{if(!saveLock.current&&visit.isCurrent())router.back();};
  const locked=saveMutation.isPending||uncertain||confirmed||!active||!editor.ready;
  const mayEdit=()=>!saveLock.current&&!uncertain&&!confirmed&&active&&editor.ready&&visit.isCurrent();
  if(questionsLoading||questionsError||(!isNew&&!question&&!editor.value?.pending))return <SafeAreaView style={styles.sheet} edges={['top','bottom']}>
    <Stack.Screen options={{headerShown:false}}/><View style={styles.header}><TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" onPress={close} style={styles.headerAction}><Text style={styles.cancel}>Back</Text></TouchableOpacity><Text style={styles.headerTitle}>Question</Text></View>
    <View style={styles.content}>{questionsLoading?<ActivityIndicator accessibilityLabel="Loading question" color={Colors.terracotta}/>:<>
      <Text accessibilityRole="alert" style={styles.hint}>{questionsError?'Couldn’t load the saved question.':'This question is no longer available.'}</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry question lookup" style={styles.headerAction} onPress={()=>{void refetch();}}><Text style={styles.cancel}>Try again</Text></TouchableOpacity>
    </>}</View>
  </SafeAreaView>;

  return (
    <SafeAreaView style={styles.sheet} edges={['top', 'bottom']}>
      <Stack.Screen options={{headerShown:false}}/>
      <View style={styles.header}>
        <TouchableOpacity onPress={close} disabled={saveMutation.isPending} style={styles.headerAction} accessibilityRole="button" accessibilityLabel="Close question editor">
          {/* LIZ COPY */}
          <Text style={styles.cancel}>Close</Text>
        </TouchableOpacity>
        {/* copy to the taste gate */}
        <Text accessibilityRole="header" style={styles.headerTitle}>{question ? 'Edit question' : 'New question'}</Text>
        <TouchableOpacity onPress={()=>void handleSave()} disabled={saveMutation.isPending||!editor.ready||conflict} style={[styles.headerAction,{alignItems:'flex-end'}]} accessibilityRole="button" accessibilityLabel="Save registration question">
          <Text style={[styles.save, (!canSave || saveMutation.isPending) && styles.saveOff]}>{saveMutation.isPending?'Saving…':confirmed?'Done':uncertain?'Retry':'Save'}</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView ref={scroll} onContentSizeChange={()=>{if(revealProblem.current){revealProblem.current=false;scroll.current?.scrollTo({y:0,animated:false});}}} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          {!editor.loaded&&!editor.readError&&<ActivityIndicator accessibilityLabel="Loading question draft" color={Colors.terracotta}/>}
          {editor.error&&<View><Text accessibilityRole="alert" style={styles.problem}>{editor.error}</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry device draft" style={styles.headerAction} onPress={()=>void editor.retry()}><Text style={styles.save}>Try again</Text></TouchableOpacity></View>}
          {confirmed&&<Text accessibilityLiveRegion="polite" style={styles.hint}>Your question is saved. Tap Done to return.</Text>}
          {uncertain&&!confirmed&&!conflict&&<TouchableOpacity accessibilityRole="button" accessibilityLabel="Check question save" disabled={saveMutation.isPending} style={styles.headerAction} onPress={()=>void handleSave(false)}><Text style={styles.save}>Check saved status</Text></TouchableOpacity>}
          {conflict&&<TouchableOpacity accessibilityRole="button" accessibilityLabel="Use saved question" disabled={saveMutation.isPending} style={styles.headerAction} onPress={()=>{void(async()=>{if(visit.isCurrent()&&await editor.discard()&&visit.isCurrent())router.back();})();}}><Text style={styles.save}>Use saved version</Text></TouchableOpacity>}
          {saveProblem&&<Text accessibilityRole="alert" style={styles.problem}>{saveProblem}</Text>}
          <View style={styles.panel}>
          {/* the prompt */}
          <Text style={[styles.label,{marginTop:0}]}>Your question</Text>
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            editable={!locked}
            accessibilityLabel="Question text"
            value={prompt}
            onChangeText={setPrompt}
            placeholder={qtype === 'terms' ? 'the terms they agree to' : 'what should we call you at the door?'}
            placeholderTextColor={Colors.textLight}
            multiline
            maxLength={QUESTION_PROMPT_MAX}
          />

          {/* the type */}
          </View><Text accessibilityRole="header" style={styles.section}>Answer type</Text><View style={styles.panel}>
          <View style={styles.chipWrap} accessibilityRole="radiogroup" accessibilityLabel="Answer type">
            {QUESTION_TYPE_OPTIONS.map((t) => (
              <TouchableOpacity
                key={t.value}
                disabled={locked}
                accessibilityRole="radio" aria-checked={qtype===t.value}
                accessibilityState={{checked:qtype===t.value,disabled:locked}}
                style={[styles.chip, styles.typeChip, fontScale>1.2&&styles.typeChipLarge, qtype === t.value && styles.chipOn]}
                onPress={() => { if(mayEdit()){hapticLight(); setQtype(t.value);} }}
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
                    accessibilityLabel={`Choice ${i+1}`}
                    editable={!locked}
                    value={opt}
                    onChangeText={(v) => setOption(i, v)}
                    placeholder={`option ${i + 1}`}
                    placeholderTextColor={Colors.textLight}
                    maxLength={OPTION_LABEL_MAX}
                  />
                  {options.length > 2 && (
                    <TouchableOpacity disabled={locked} accessibilityRole="button" accessibilityLabel={`Remove choice ${i+1}`} onPress={() => {if(mayEdit())removeOption(i);}} hitSlop={10} style={styles.optionRemove}>
                      <X size={16} color={Colors.textMedium} strokeWidth={2} />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
              {options.length < QUESTION_OPTIONS_MAX && (
                <TouchableOpacity style={styles.addOption} disabled={locked} accessibilityRole="button" accessibilityLabel="Add choice" onPress={()=>{if(mayEdit())addOption();}} hitSlop={8}>
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
          </View><Text accessibilityRole="header" style={styles.section}>Who answers</Text><View style={styles.panel}><Text style={[styles.label,{marginTop:0}]}>Answer required?</Text>
          <View style={styles.chipWrap} accessibilityRole="radiogroup" accessibilityLabel="Answer required">
            <TouchableOpacity
              style={[styles.chip, !required && styles.chipOn]}
              disabled={locked} accessibilityRole="radio" aria-checked={required===false} accessibilityState={{checked:required===false,disabled:locked}} onPress={() => {if(mayEdit()){hapticLight(); setRequired(false);}}}
              activeOpacity={0.85}
            >
              <Text style={[styles.chipText, !required && styles.chipTextOn]}>optional</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.chip, required && styles.chipOn]}
              disabled={locked} accessibilityRole="radio" aria-checked={required===true} accessibilityState={{checked:required===true,disabled:locked}} onPress={() => {if(mayEdit()){hapticLight(); setRequired(true);}}}
              activeOpacity={0.85}
            >
              <Text style={[styles.chipText, required && styles.chipTextOn]}>required</Text>
            </TouchableOpacity>
          </View>

          {/* scope */}
          <Text style={styles.label}>Ask once</Text>
          <Text style={styles.labelHint}>Collect one answer per purchase or one for each ticket.</Text>
          <View style={styles.chipWrap} accessibilityRole="radiogroup" accessibilityLabel="Ask once">
            <TouchableOpacity
              style={[styles.chip, scope === 'per_order' && styles.chipOn]}
              disabled={locked} accessibilityRole="radio" aria-checked={scope==='per_order'} accessibilityState={{checked:scope==='per_order',disabled:locked}} onPress={() => {if(mayEdit()){hapticLight(); setScope('per_order');}}}
              activeOpacity={0.85}
            >
              <Text style={[styles.chipText, scope === 'per_order' && styles.chipTextOn]}>Per purchase</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.chip, scope === 'per_attendee' && styles.chipOn]}
              disabled={locked} accessibilityRole="radio" aria-checked={scope==='per_attendee'} accessibilityState={{checked:scope==='per_attendee',disabled:locked}} onPress={() => {if(mayEdit()){hapticLight(); setScope('per_attendee');}}}
              activeOpacity={0.85}
            >
              <Text style={[styles.chipText, scope === 'per_attendee' && styles.chipTextOn]}>Per ticket</Text>
            </TouchableOpacity>
          </View>

          </View>
        </ScrollView>
      </KeyboardAvoidingView>


    </SafeAreaView>
  );
}

function createStyles(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  panel: {backgroundColor:Colors.white,borderRadius:16,padding:16},
  section: {fontFamily:fonts.semibold,fontSize:FontSizes.bodyLG,color:Colors.asphalt,marginTop:22,marginBottom:10},
  problem: {fontFamily:fonts.regular,fontSize:FontSizes.bodyMD,color:Colors.errorBrand,marginBottom:12},
  headerAction: {minWidth:64,minHeight:44,justifyContent:'center'},
  sheet: { flex: 1, backgroundColor: Colors.parchment },
  flex: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  cancel: { fontFamily: fonts.medium, fontSize: FontSizes.bodyMD, color: Colors.textMedium },
  headerTitle: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  save: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  saveOff: { color: Colors.textLight },
  content: { padding: 20, paddingBottom: 40 },
  label: { fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: Colors.secondary, marginBottom: 6, marginTop: 16 },
  optionHint: { fontFamily: fonts.regular, fontSize: FontSizes.bodySM, color: Colors.secondary, marginTop: 4 },
  labelHint: { fontFamily: fonts.regular, fontSize: FontSizes.caption, color: Colors.textMedium, marginBottom: 8, marginTop: -2 },
  input: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.regular,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
  },
  inputMultiline: { minHeight: 104, textAlignVertical: 'top' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: {flexBasis:'45%',flexGrow:1,paddingHorizontal:6,alignItems:'center'},
  typeChipLarge: {flexBasis:'100%'},
  chip: {
    minHeight:44,justifyContent:'center',borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.cardBg,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipOn: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  chipText: { fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: Colors.darkWarm },
  chipTextOn: { color: Colors.white },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  optionInput: { flex: 1, minWidth: 0 },
  optionRemove: { minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center' },
  addOption: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight:44, paddingVertical: 6, marginTop: 2 },
  addOptionText: { fontFamily: fonts.semibold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  hint: { fontFamily: fonts.regular, fontSize: FontSizes.bodySM, color: Colors.textMedium, marginTop: 16 },
}); }
