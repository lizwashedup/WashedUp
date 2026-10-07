/**
 * The doc 09 join popup. Everything required: the leader's welcome message
 * up top (their voice), first and last name, email, zip, the leader's intro
 * question, and the guidelines checkbox with link. Submits through
 * the existing admission contract. New creator pages supply a scoped
 * controller for confirmed membership and interrupted-request recovery.
 */

import React, { useState } from 'react';
import { ScaledText as Text } from '../ScaledText';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { useQuery } from '@tanstack/react-query';
import {
  Modal,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Linking,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, X } from 'lucide-react-native';
import Colors, { AfterglowColors as C } from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights, AfterglowType as T, type AfterglowFontFamilies } from '../../constants/Typography';
import { CONFIGURABLE_JOIN_QUESTIONS_ENABLED } from '../../constants/FeatureFlags';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../keyboard/KeyboardDoneBar';
import { friendlyError } from '../../lib/friendlyError';
import { hapticLight, hapticSuccess } from '../../lib/haptics';
import {
  FALLBACK_GUIDELINES_URL,
  FALLBACK_INTRO_QUESTION,
  requestToJoinCommunity,
  validateJoinAnswers,
  type JoinAnswers,
  type JoinGate,
} from '../../lib/communityJoin';
import { getLeaderCards } from '../../lib/communityLeader';

export interface CommunityJoinFormFlow {
  submit: (answers: JoinAnswers) => Promise<void>;
  locked: boolean;
  busy?: boolean;
  message?: string;
  footer?: React.ReactNode;
}
interface Props {
  /** The verified admission controller already owns its native presentation. */
  embedded?: boolean;
  visible: boolean;
  gate: JoinGate;
  /** proposal 91: the community's join_policy is 'open', so sending this
   *  puts the person straight in rather than into a queue. Everything the
   *  form collects still applies; only the promise changes. */
  joinsInstantly?: boolean;
  onClose: () => void;
  /** Fires after the request lands; the host flips to its pending state. */
  onRequested: () => void;
  /** Screen 15: lets a leader see this exact popup, live, from the join-gate
   *  editor before saving. Renders every field but never submits -- the send
   *  button is replaced with an inert "applicants see this" banner. */
  previewMode?: boolean;
  /** Only the verified creator-page controller supplies this contract. */
  flow?: CommunityJoinFormFlow;
}

export function JoinCommunityPopup({ visible, gate, joinsInstantly = false, onClose, onRequested, previewMode = false, flow, embedded = false }: Props) {
  const { fonts } = useAfterglowFonts(!!flow);
  const styles = flow ? creatorFormStyles(fonts) : legacyStyles;
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [zip, setZip] = useState('');
  const [introAnswer, setIntroAnswer] = useState('');
  const [reasonAnswer, setReasonAnswer] = useState('');
  const [sourceAnswer, setSourceAnswer] = useState('');
  const [rulesConfirmed, setRulesConfirmed] = useState(false);
  const [openAnswer, setOpenAnswer] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const introQuestion = gate.introQuestion ?? FALLBACK_INTRO_QUESTION;
  const guidelinesUrl = gate.guidelinesUrl ?? FALLBACK_GUIDELINES_URL;

  // Liz decision #11 (2026-09-03): the flag ANDs against every one of the
  // community's toggles here, once, so the rest of this component (render,
  // validate, submit) never has to check CONFIGURABLE_JOIN_QUESTIONS_ENABLED
  // itself -- a community's saved config can never surface early just
  // because the flag flips before the migration does, or vice versa.
  const effectiveConfig = {
    askReason: (!!flow || CONFIGURABLE_JOIN_QUESTIONS_ENABLED) && gate.askReason,
    askSource: (!!flow || CONFIGURABLE_JOIN_QUESTIONS_ENABLED) && gate.askSource,
    askRulesConfirm: (!!flow || CONFIGURABLE_JOIN_QUESTIONS_ENABLED) && gate.askRulesConfirm,
    openQuestion: (!!flow || CONFIGURABLE_JOIN_QUESTIONS_ENABLED) ? gate.openQuestion : null,
  };

  // the 30a v1.3 disclosure names the operator literally through the
  // proposal-41 leader card (world-callable, works pre-join); until 41 is
  // live the card resolves empty and the role-based interim stands
  const { data: operatorName = null } = useQuery({
    queryKey: ['leader-card-name', gate.communityId],
    queryFn: async () =>
      (await getLeaderCards([gate.communityId])).get(gate.communityId)?.display_name ?? null,
    staleTime: 60_000,
  });

  const handleSend = async () => {
    if (sending || flow?.locked) return;
    const answers: JoinAnswers = {
      first_name: firstName,
      last_name: lastName,
      email,
      zip,
      intro_answer: introAnswer,
      guidelines_accepted: accepted,
      ...(effectiveConfig.askReason ? { reason_answer: reasonAnswer } : {}),
      ...(effectiveConfig.askSource ? { source_answer: sourceAnswer } : {}),
      ...(effectiveConfig.askRulesConfirm ? { rules_confirmed: rulesConfirmed } : {}),
      ...(effectiveConfig.openQuestion ? { open_answer: openAnswer } : {}),
    };
    const invalid = validateJoinAnswers(answers, effectiveConfig);
    if (invalid) {
      setProblem(invalid);
      return;
    }
    setProblem(null);
    setSending(true);
    try {
      if (flow) { await flow.submit(answers); return; }
      await requestToJoinCommunity(gate.communityId, answers);
      hapticSuccess();
      onRequested();
    } catch (e) {
      setProblem(friendlyError(e, 'That did not send. Try again in a moment.'));
    } finally {
      setSending(false);
    }
  };

  const content = (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close joining form" style={flow ? { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' } : undefined}>
              <X size={22} color={Colors.asphalt} strokeWidth={2.5} />
            </TouchableOpacity>
          </View>
          {previewMode && (
            <View style={styles.previewBanner}>
              <Text style={styles.previewBannerText}>preview -- this is exactly what applicants see. nothing here sends.</Text>
            </View>
          )}
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text accessibilityRole="header" style={styles.title}>{flow?.locked ? gate.name : `join ${gate.name}`}</Text>
            {!flow?.locked && <>

            {!!gate.welcomeMessage && (
              <View style={styles.welcomeCard}>
                <Text style={styles.welcomeText}>{gate.welcomeMessage}</Text>
                <Text style={styles.welcomeFrom}>from {gate.name}</Text>
              </View>
            )}

            <Text style={styles.fieldLabel}>first name</Text>
            <TextInput
              style={styles.input}
              value={firstName}
              editable={!flow?.locked}
              accessibilityLabel="First name"
              onChangeText={setFirstName}
              autoCapitalize="words"
              maxLength={100}
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />
            <Text style={styles.fieldLabel}>last name</Text>
            <TextInput
              style={styles.input}
              value={lastName}
              editable={!flow?.locked}
              accessibilityLabel="Last name"
              onChangeText={setLastName}
              autoCapitalize="words"
              maxLength={100}
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />
            <Text style={styles.fieldLabel}>email</Text>
            <TextInput
              style={styles.input}
              value={email}
              editable={!flow?.locked}
              accessibilityLabel="Email"
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              maxLength={254}
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />
            <Text style={styles.fieldLabel}>zip code</Text>
            <TextInput
              style={styles.input}
              value={zip}
              editable={!flow?.locked}
              accessibilityLabel="ZIP code"
              onChangeText={setZip}
              keyboardType="number-pad"
              maxLength={5}
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />

            {flow && <Text style={styles.finePrint}>Your introduction is shared with community members after you join. Extra answers stay out of chat.</Text>}
            <Text style={styles.fieldLabel}>{introQuestion}</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={introAnswer}
              editable={!flow?.locked}
              accessibilityLabel={introQuestion}
              onChangeText={setIntroAnswer}
              multiline
              maxLength={1000}
              placeholder="your introduction"
              placeholderTextColor={Colors.inkSoft}
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />

            {/* Liz decision #11 (2026-09-03): up to 3 more questions, each
                only rendered when this community has turned it on. These
                answers are never posted to chat -- only intro_answer above
                ever is (review_community_join, unchanged). */}
            {effectiveConfig.askReason && (
              <>
                <Text style={styles.fieldLabel}>why do you want to join?</Text>
                <TextInput
                  style={[styles.input, styles.inputMultiline]}
                  value={reasonAnswer}
              editable={!flow?.locked}
              accessibilityLabel="Why do you want to join?"
                  onChangeText={setReasonAnswer}
                  multiline
                  maxLength={1000}
                  placeholder="your reason for joining"
                  placeholderTextColor={Colors.inkSoft}
                  inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
                />
              </>
            )}

            {effectiveConfig.askSource && (
              <>
                <Text style={styles.fieldLabel}>how did you hear about this community?</Text>
                <TextInput
                  style={styles.input}
                  value={sourceAnswer}
              editable={!flow?.locked}
              accessibilityLabel="How did you hear about this community?"
                  onChangeText={setSourceAnswer}
                  maxLength={500}
                  placeholder="wherever you found us"
                  placeholderTextColor={Colors.inkSoft}
                  inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
                />
              </>
            )}

            {effectiveConfig.askRulesConfirm && (
              <TouchableOpacity
                style={styles.checkboxRow}
                disabled={flow?.locked}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: rulesConfirmed, disabled: !!flow?.locked }}
                onPress={() => { hapticLight(); setRulesConfirmed((v) => !v); }}
              >
                <View style={[styles.checkbox, rulesConfirmed && styles.checkboxOn]}>
                  {rulesConfirmed && <Check size={14} color={Colors.white} strokeWidth={3} />}
                </View>
                <Text style={styles.checkboxText}>I meet this community&apos;s membership requirement</Text>
              </TouchableOpacity>
            )}

            {!!effectiveConfig.openQuestion && (
              <>
                <Text style={styles.fieldLabel}>{effectiveConfig.openQuestion}</Text>
                <TextInput
                  style={[styles.input, styles.inputMultiline]}
                  value={openAnswer}
              editable={!flow?.locked}
              accessibilityLabel={effectiveConfig.openQuestion ?? 'Answer to the community question'}
                  onChangeText={setOpenAnswer}
                  multiline
                  maxLength={1000}
                  placeholder="your answer"
                  placeholderTextColor={Colors.inkSoft}
                  inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
                />
              </>
            )}

            <TouchableOpacity
              style={styles.checkboxRow}
              disabled={flow?.locked}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: accepted, disabled: !!flow?.locked }}
              onPress={() => { hapticLight(); setAccepted((a) => !a); }}
            >
              <View style={[styles.checkbox, accepted && styles.checkboxOn]}>
                {accepted && <Check size={14} color={Colors.white} strokeWidth={3} />}
              </View>
              <Text style={styles.checkboxText}>
                I accept the{' '}
                <Text style={styles.link} onPress={() => Linking.openURL(guidelinesUrl)}>
                  community guidelines
                </Text>
              </Text>
            </TouchableOpacity>

            {/* LIZ COPY (house-lowercased): the 30a v1.3 just-in-time
                disclosure, counsel's adopted template. The operator name
                resolves through the proposal-41 leader card and falls back
                to the role-based interim until 41 is live. The withhold
                promise line becomes literally TRUE at the API layer when
                proposal 42 rides the convergence — both are launch gates,
                so the flag never flips ahead of them. The template's
                [learn about the operator] and [privacy policy] links land
                with the privacy-policy gate. */}
            <Text style={styles.finePrint}>
              before you apply, {operatorName ? operatorName.toLowerCase() : `whoever runs ${gate.name}`},
              the independent operator of this community, will receive your
              display name, general area (city or neighborhood), and your
              answers below to review your request, administer and moderate
              the community, keep it safe, and communicate with you in
              washedup. the operator will not receive your email address,
              phone number, raw zip code, or precise location.
            </Text>

            </>}
            {flow?.busy && <ActivityIndicator accessibilityLabel="Checking joining request" color={C.clay} />}
            {!!problem && <Text accessibilityRole="alert" style={styles.problem}>{problem}</Text>}
            {!!flow?.message && <Text accessibilityLiveRegion="polite" style={styles.welcomeText}>{flow.message}</Text>}
            {flow?.footer}

            {flow?.locked ? null : previewMode ? (
              <View style={[styles.sendBtn, styles.previewSendBtn]}>
                <Text style={styles.sendBtnText}>{joinsInstantly ? 'join' : 'ask to join'}</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.sendBtn, sending && styles.sendBtnBusy]}
                onPress={handleSend}
                accessibilityRole="button"
                accessibilityLabel={joinsInstantly ? 'Join community' : 'Request to join'}
                disabled={sending}
              >
                {sending ? (
                  <ActivityIndicator size="small" color={Colors.white} />
                ) : (
                  <Text style={styles.sendBtnText}>{joinsInstantly ? 'join' : 'ask to join'}</Text>
                )}
              </TouchableOpacity>
            )}
            {/* LIZ COPY */}
            {/* LIZ COPY: the promise has to match the policy. Telling an
                open community's visitor that a person reviews them would be
                false, and telling a gated one that they are in would be worse */}
            <Text style={styles.gateNote}>
              {flow?.locked ? '' : joinsInstantly
                ? "you're in as soon as you send this."
                : 'a real person approves every request.'}
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
  );
  if (embedded) return visible ? content : null;
  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    {content}
  </Modal>;
}

const legacyStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  flex: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 16, paddingVertical: 10 },
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayLG,
    lineHeight: LineHeights.displayLG,
    color: Colors.darkWarm,
    marginBottom: 14,
  },
  welcomeCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    borderLeftWidth: 3,
    borderLeftColor: Colors.gold,
    padding: 14,
    marginBottom: 18,
  },
  welcomeText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.darkWarm, lineHeight: LineHeights.bodyMD },
  welcomeFrom: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.tertiary, marginTop: 8 },
  fieldLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  input: {
    backgroundColor: Colors.inputBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.darkWarm,
    marginBottom: 14,
  },
  inputMultiline: { minHeight: 90, textAlignVertical: 'top' },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.cardBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  checkboxText: { flex: 1, fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  link: { color: Colors.terracotta, fontFamily: Fonts.sansMedium },
  finePrint: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
    lineHeight: LineHeights.bodySM,
    marginBottom: 16,
  },
  problem: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.errorRed, marginBottom: 10 },
  sendBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
  },
  sendBtnBusy: { opacity: 0.6 },
  previewSendBtn: { opacity: 0.7 },
  sendBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.white },
  previewBanner: {
    backgroundColor: Colors.inputBg,
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  previewBannerText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.textMedium,
    textAlign: 'center',
  },
  gateNote: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
    textAlign: 'center',
    marginTop: 10,
  },
});

/** Selected cream/Mona treatment, restricted to the new page admission flow. */
function creatorFormStyles(fonts: AfterglowFontFamilies) {
  return { ...legacyStyles,
    container: { ...legacyStyles.container, backgroundColor: C.paper },
    title: { ...legacyStyles.title, ...T.pageTitle, fontFamily: fonts.display, color: C.ink },
    welcomeCard: { ...legacyStyles.welcomeCard, backgroundColor: C.white, borderColor: C.line, borderLeftColor: C.clay },
    welcomeText: { ...legacyStyles.welcomeText, ...T.body, fontFamily: fonts.regular, color: C.ink },
    welcomeFrom: { ...legacyStyles.welcomeFrom, ...T.body, fontFamily: fonts.medium, color: C.muted },
    fieldLabel: { ...legacyStyles.fieldLabel, ...T.body, letterSpacing: 0, fontFamily: fonts.semibold, color: C.ink },
    input: { ...legacyStyles.input, ...T.body, minHeight: 48, fontFamily: fonts.regular, color: C.ink, backgroundColor: C.white, borderColor: C.line },
    checkboxRow: { ...legacyStyles.checkboxRow, minHeight: 44 },
    checkbox: { ...legacyStyles.checkbox, borderColor: C.line, backgroundColor: C.white },
    checkboxOn: { backgroundColor: C.clay, borderColor: C.clay },
    checkboxText: { ...legacyStyles.checkboxText, ...T.body, fontFamily: fonts.regular, color: C.ink },
    link: { color: C.clay, fontFamily: fonts.medium },
    finePrint: { ...legacyStyles.finePrint, ...T.caption, fontFamily: fonts.regular, color: C.muted },
    problem: { ...legacyStyles.problem, ...T.body, fontFamily: fonts.medium },
    sendBtn: { ...legacyStyles.sendBtn, minHeight: 48, backgroundColor: C.clay },
    sendBtnText: { ...legacyStyles.sendBtnText, ...T.body, fontFamily: fonts.semibold, color: C.paper },
    gateNote: { ...legacyStyles.gateNote, ...T.caption, fontFamily: fonts.regular, color: C.muted },
  };
}
