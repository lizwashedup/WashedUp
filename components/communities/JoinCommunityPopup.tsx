/**
 * The doc 09 join popup. Everything required: the leader's welcome message
 * up top (their voice), first and last name, email, zip, the leader's intro
 * question, and the guidelines checkbox with link. Submits through
 * request_to_join_community (approval-gated, never immediate). Functionally
 * minimal per decision 15a.
 */

import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
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
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../keyboard/KeyboardDoneBar';
import { friendlyError } from '../../lib/friendlyError';
import { hapticLight, hapticSuccess } from '../../lib/haptics';
import {
  FALLBACK_GUIDELINES_URL,
  FALLBACK_INTRO_QUESTION,
  requestToJoinCommunity,
  validateJoinAnswers,
  type JoinGate,
} from '../../lib/communityJoin';

interface Props {
  visible: boolean;
  gate: JoinGate;
  onClose: () => void;
  /** Fires after the request lands; the host flips to its pending state. */
  onRequested: () => void;
}

export function JoinCommunityPopup({ visible, gate, onClose, onRequested }: Props) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [zip, setZip] = useState('');
  const [introAnswer, setIntroAnswer] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const introQuestion = gate.introQuestion ?? FALLBACK_INTRO_QUESTION;
  const guidelinesUrl = gate.guidelinesUrl ?? FALLBACK_GUIDELINES_URL;

  const handleSend = async () => {
    const answers = {
      first_name: firstName,
      last_name: lastName,
      email,
      zip,
      intro_answer: introAnswer,
      guidelines_accepted: accepted,
    };
    const invalid = validateJoinAnswers(answers);
    if (invalid) {
      setProblem(invalid);
      return;
    }
    setProblem(null);
    setSending(true);
    try {
      await requestToJoinCommunity(gate.communityId, answers);
      hapticSuccess();
      onRequested();
    } catch (e) {
      setProblem(friendlyError(e, 'That did not send. Try again in a moment.'));
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <X size={22} color={Colors.asphalt} strokeWidth={2.5} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>join {gate.name}</Text>

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
              onChangeText={setFirstName}
              autoCapitalize="words"
              maxLength={100}
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />
            <Text style={styles.fieldLabel}>last name</Text>
            <TextInput
              style={styles.input}
              value={lastName}
              onChangeText={setLastName}
              autoCapitalize="words"
              maxLength={100}
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />
            <Text style={styles.fieldLabel}>email</Text>
            <TextInput
              style={styles.input}
              value={email}
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
              onChangeText={setZip}
              keyboardType="number-pad"
              maxLength={5}
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />

            <Text style={styles.fieldLabel}>{introQuestion}</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={introAnswer}
              onChangeText={setIntroAnswer}
              multiline
              maxLength={1000}
              placeholder="your introduction"
              placeholderTextColor={Colors.inkSoft}
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />

            <TouchableOpacity
              style={styles.checkboxRow}
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

            {/* LIZ COPY: the fine print, what stays private vs public */}
            <Text style={styles.finePrint}>
              your answers go to whoever runs {gate.name}. only your introduction
              and your general area become public, woven into a short hello in
              the community chat when you are approved. never your zip.
            </Text>

            {!!problem && <Text style={styles.problem}>{problem}</Text>}

            <TouchableOpacity
              style={[styles.sendBtn, sending && styles.sendBtnBusy]}
              onPress={handleSend}
              disabled={sending}
            >
              {sending ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <Text style={styles.sendBtnText}>ask to join</Text>
              )}
            </TouchableOpacity>
            {/* LIZ COPY */}
            <Text style={styles.gateNote}>a real person approves every request.</Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
  sendBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.white },
  gateNote: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
    textAlign: 'center',
    marginTop: 10,
  },
});
