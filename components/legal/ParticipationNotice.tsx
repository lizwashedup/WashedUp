/**
 * The Independent Activity Notice (51-legal-v4/13, Participation Notice
 * v1.0): shown once per material terms version before the user's first
 * join/RSVP. The notice body and the checkbox sentence are LEGAL COPY,
 * VERBATIM from counsel's document. Never edit, never lowercase, never
 * reword without counsel; the vocabulary rules for product copy do not
 * apply inside the quoted legal text. A separate unchecked checkbox is the
 * assent mechanism (doc 13 implementation rules: never a footer link,
 * never silent continued use).
 */

import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, Check } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { hapticLight } from '../../lib/haptics';

const TERMS_URL = 'https://washedup.app/terms';

interface ParticipationNoticeProps {
  visible: boolean;
  /** The organizer's display name as rendered on the listing (doc 13:
      never an anonymous role alone when identity can be surfaced). */
  organizerName: string;
  /** Records the assent and proceeds; resolve false to keep the sheet up
      with the try-again line. */
  onAgree: () => Promise<boolean>;
  onClose: () => void;
}

export function ParticipationNotice({ visible, organizerName, onAgree, onClose }: ParticipationNoticeProps) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const handleAgree = async () => {
    if (!checked || busy) return;
    setBusy(true);
    setProblem(null);
    const ok = await onAgree();
    setBusy(false);
    if (!ok) {
      // LIZ COPY
      setProblem('that did not go through. give it another try.');
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <X size={22} color={Colors.asphalt} strokeWidth={2.5} />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          {/* LIZ COPY */}
          <Text style={styles.title}>one thing before you're in</Text>

          {/* LEGAL COPY, verbatim (Participation Notice v1.0) */}
          <View style={styles.noticeCard}>
            <Text style={styles.noticeKicker}>independent activity notice</Text>
            <Text style={styles.noticeText}>
              This activity is independently organized by {organizerName}, not by WashedUp.
              WashedUp provides software for discovery, communication, and coordination.
              WashedUp does not organize, host, supervise, control, inspect, insure, or
              guarantee the activity, venue, organizer, participants, transportation,
              products, or services. Meeting people and participating in real-world
              activities can involve known and unknown risks. You decide whether to join
              and participate voluntarily, using your own judgment.
            </Text>
          </View>

          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => { hapticLight(); setChecked((c) => !c); }}
          >
            <View style={[styles.checkbox, checked && styles.checkboxOn]}>
              {checked && <Check size={14} color={Colors.white} strokeWidth={3} />}
            </View>
            {/* LEGAL COPY, verbatim (Participation Notice v1.0 required action copy) */}
            <Text style={styles.checkboxText}>
              I understand this is an independent activity and agree to the
              assumption-of-risk, release, and limitation provisions in the WashedUp
              Terms of Service.{' '}
              <Text style={styles.link} onPress={() => Linking.openURL(TERMS_URL)}>
                View Terms
              </Text>
            </Text>
          </TouchableOpacity>

          {!!problem && <Text style={styles.problem}>{problem}</Text>}

          <TouchableOpacity
            style={[styles.agreeBtn, (!checked || busy) && styles.agreeBtnOff]}
            onPress={handleAgree}
            disabled={!checked || busy}
          >
            {busy ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              /* LIZ COPY */
              <Text style={styles.agreeBtnText}>got it, count me in</Text>
            )}
          </TouchableOpacity>
          {/* LIZ COPY */}
          <Text style={styles.quietNote}>you'll only see this once in a while, when our terms change.</Text>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  header: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10 },
  content: { paddingHorizontal: 20, paddingBottom: 24 },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayMD,
    lineHeight: LineHeights.displayMD,
    color: Colors.darkWarm,
    marginBottom: 14,
  },
  noticeCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    marginBottom: 16,
  },
  noticeKicker: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  noticeText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    lineHeight: 19,
    color: Colors.darkWarm,
  },
  checkboxRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.cardBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxOn: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  checkboxText: {
    flex: 1,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    lineHeight: 19,
    color: Colors.darkWarm,
  },
  link: { fontFamily: Fonts.sansMedium, color: Colors.terracotta },
  problem: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.errorRed,
    marginBottom: 10,
  },
  agreeBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  agreeBtnOff: { opacity: 0.45 },
  agreeBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  quietNote: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
    textAlign: 'center',
    marginTop: 10,
  },
});
