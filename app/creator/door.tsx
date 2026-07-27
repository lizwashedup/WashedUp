/**
 * Door mode (spec 100 P0 #5): check a reference_code in by TYPE or SCAN, one
 * screen two paths. A big pass/fail that is never colour alone (icon + text +
 * colour, §8 WCAG). Live checked-in / total. Works on bad signal: a network
 * failure queues locally and syncs; a real verdict never queues (lib/ticketDoor).
 *
 * The read gates on is_ticketing_organizer via RLS (§7); the RPC re-checks the
 * organizer server-side, so this screen is a courier, not the authority.
 */

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, X, CircleAlert, Clock, Keyboard as KeyboardIcon, ScanLine } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { EventAction, EventSpacing } from '../../constants/EventDesign';
import { hapticSuccess, hapticError, hapticWarning, hapticLight } from '../../lib/haptics';
import { countAttendees, getEventAttendees } from '../../lib/ticketAttendees';
import { normalizeCode, queuedCount, recordCheckin, syncQueuedCheckins, type CheckinOutcome } from '../../lib/ticketDoor';

// the camera layer is lazy-loaded so the type path never imports expo-camera
// (Cowork: scan must not block the door). It only functions in a build that
// includes the native module.
const TicketScanner = React.lazy(() => import('../../components/creator/TicketScanner'));

// ignore a re-read of the SAME code for this long, so one ticket held to the
// lens does not fire a wall of scans
const SCAN_COOLDOWN_MS = 2500;

type Mode = 'type' | 'scan';

interface Verdict {
  tone: 'pass' | 'fail' | 'warn' | 'pending';
  label: string;
  detail: string;
}

function outcomeToVerdict(o: CheckinOutcome): Verdict {
  if (o.kind === 'result') {
    if (o.result === 'admitted') return { tone: 'pass', label: 'admitted', detail: o.code };
    if (o.result === 'duplicate') return { tone: 'warn', label: 'already in', detail: `${o.code} was already checked in` };
    return { tone: 'fail', label: 'void ticket', detail: `${o.code} is refunded or canceled` };
  }
  if (o.kind === 'unknown') return { tone: 'fail', label: 'no ticket', detail: `no ticket with code ${o.code}` };
  if (o.kind === 'queued') return { tone: 'pending', label: 'saved offline', detail: `${o.code} will confirm when you are back online` };
  return { tone: 'fail', label: 'did not go through', detail: o.message };
}

export default function DoorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>('type');
  const [codeInput, setCodeInput] = useState('');
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(0);
  const lastScan = useRef<{ code: string; at: number }>({ code: '', at: 0 });

  const { data: attendees = [] } = useQuery({
    queryKey: ['event-attendees', id],
    queryFn: () => getEventAttendees(id!),
    enabled: !!id,
    staleTime: 10_000,
  });
  const counts = countAttendees(attendees);

  const refreshQueued = useCallback(async () => setQueued(await queuedCount()), []);

  // on open: drain anything queued from a prior bad-signal spell, then refresh
  useEffect(() => {
    (async () => {
      const summary = await syncQueuedCheckins();
      if (summary.processed.length > 0) {
        queryClient.invalidateQueries({ queryKey: ['event-attendees', id] });
      }
      await refreshQueued();
    })();
  }, [id, queryClient, refreshQueued]);

  const check = useCallback(
    async (rawCode: string) => {
      const code = normalizeCode(rawCode);
      if (!code || busy) return;
      setBusy(true);
      const outcome = await recordCheckin(code);
      const v = outcomeToVerdict(outcome);
      setVerdict(v);
      if (v.tone === 'pass') hapticSuccess();
      else if (v.tone === 'warn') hapticWarning();
      else if (v.tone === 'fail') hapticError();
      else hapticLight();
      if (outcome.kind === 'result' && outcome.result === 'admitted') {
        queryClient.invalidateQueries({ queryKey: ['event-attendees', id] });
      }
      await refreshQueued();
      setCodeInput('');
      setBusy(false);
    },
    [busy, id, queryClient, refreshQueued],
  );

  const handleScanRaw = useCallback(
    (raw: string) => {
      const code = normalizeCode(raw);
      const now = Date.now();
      if (!code) return;
      if (lastScan.current.code === code && now - lastScan.current.at < SCAN_COOLDOWN_MS) return;
      lastScan.current = { code, at: now };
      check(code);
    },
    [check],
  );

  const syncNow = useCallback(async () => {
    hapticLight();
    const summary = await syncQueuedCheckins();
    if (summary.processed.length > 0) {
      queryClient.invalidateQueries({ queryKey: ['event-attendees', id] });
    }
    await refreshQueued();
  }, [id, queryClient, refreshQueued]);

  const v = verdict;
  const panelStyle =
    v?.tone === 'pass' ? styles.panelPass
      : v?.tone === 'fail' ? styles.panelFail
        : v?.tone === 'warn' ? styles.panelWarn
          : styles.panelPending;
  const panelTextStyle = v?.tone === 'fail' ? styles.panelTextOnDark : styles.panelText;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="back">
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2} />
        </TouchableOpacity>
        {/* copy to the taste gate */}
        <Text style={styles.headerTitle}>at the door</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* live count, with a text equivalent (never a bare number, §8) */}
      <View style={styles.countRow} accessibilityRole="summary">
        <Text style={styles.countBig}>{counts.checkedIn}</Text>
        <Text style={styles.countTotal}> / {counts.sold} checked in</Text>
      </View>
      {queued > 0 && (
        <TouchableOpacity style={styles.queuedRow} onPress={syncNow} accessibilityRole="button">
          <Clock size={14} color={Colors.terracotta} strokeWidth={2} />
          {/* copy to the taste gate */}
          <Text style={styles.queuedText}>{queued} saved offline. tap to sync.</Text>
        </TouchableOpacity>
      )}

      {/* the verdict: icon + text + colour, announced to screen readers */}
      {v && (
        <View style={[styles.panel, panelStyle]} accessibilityLiveRegion="assertive" accessibilityRole="alert">
          {v.tone === 'pass' && <Check size={44} color={Colors.brandDeep} strokeWidth={3} />}
          {v.tone === 'fail' && <X size={44} color={Colors.white} strokeWidth={3} />}
          {v.tone === 'warn' && <CircleAlert size={44} color={Colors.asphalt} strokeWidth={2.5} />}
          {v.tone === 'pending' && <Clock size={44} color={Colors.asphalt} strokeWidth={2.5} />}
          <Text style={[styles.panelLabel, panelTextStyle]}>{v.label}</Text>
          <Text style={[styles.panelDetail, panelTextStyle]}>{v.detail}</Text>
        </View>
      )}

      {/* the two input paths */}
      {mode === 'scan' ? (
        <View style={styles.scanArea}>
          <Suspense fallback={<ActivityIndicator size="large" color={Colors.terracotta} />}>
            <TicketScanner onScan={handleScanRaw} busy={busy} />
          </Suspense>
        </View>
      ) : (
        <View style={styles.typeArea}>
          <TextInput
            style={styles.codeInput}
            value={codeInput}
            onChangeText={(t) => setCodeInput(t.toUpperCase())}
            placeholder="ticket code"
            placeholderTextColor={Colors.textLight}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={() => check(codeInput)}
            accessibilityLabel="ticket reference code"
          />
          <TouchableOpacity
            style={[styles.primaryBtn, (!codeInput.trim() || busy) && styles.primaryBtnOff]}
            onPress={() => check(codeInput)}
            disabled={!codeInput.trim() || busy}
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              /* copy to the taste gate */
              <Text style={styles.primaryBtnText}>check in</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* switch paths, always both available (§5: scan OR type) */}
      <TouchableOpacity
        style={styles.switchBtn}
        onPress={() => { hapticLight(); setMode((m) => (m === 'scan' ? 'type' : 'scan')); setVerdict(null); }}
        accessibilityRole="button"
      >
        {mode === 'scan' ? (
          <KeyboardIcon size={16} color={Colors.terracotta} strokeWidth={2} />
        ) : (
          <ScanLine size={16} color={Colors.terracotta} strokeWidth={2} />
        )}
        {/* copy to the taste gate */}
        <Text style={styles.switchText}>{mode === 'scan' ? 'type a code instead' : 'scan a ticket instead'}</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, gap: 12 },
  headerTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  headerSpacer: { flex: 1 },
  countRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', paddingTop: EventSpacing.sm },
  countBig: { fontFamily: Fonts.displayBold, fontSize: FontSizes.displayLG, color: Colors.asphalt },
  countTotal: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.textMedium },
  queuedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, minHeight: 44 },
  queuedText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  panel: {
    marginHorizontal: 20,
    marginVertical: EventSpacing.md,
    borderRadius: 20,
    paddingVertical: EventSpacing.xl,
    paddingHorizontal: EventSpacing.lg,
    alignItems: 'center',
    gap: EventSpacing.sm,
  },
  panelPass: { backgroundColor: EventAction.success },
  panelFail: { backgroundColor: EventAction.error },
  panelWarn: { backgroundColor: Colors.inputBg, borderWidth: 1.5, borderColor: EventAction.success },
  panelPending: { backgroundColor: Colors.inputBg, borderWidth: 1.5, borderColor: Colors.border },
  panelLabel: { fontFamily: Fonts.sansBold, fontSize: FontSizes.displaySM, textTransform: 'uppercase', letterSpacing: 1 },
  panelDetail: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, textAlign: 'center' },
  panelText: { color: Colors.asphalt },
  panelTextOnDark: { color: Colors.white },
  scanArea: { flex: 1, paddingHorizontal: 20, justifyContent: 'center' },
  typeArea: { flex: 1, paddingHorizontal: 20, gap: EventSpacing.md, justifyContent: 'center' },
  codeInput: {
    backgroundColor: Colors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 18,
    paddingVertical: 16,
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.displaySM,
    letterSpacing: 3,
    textAlign: 'center',
    color: Colors.asphalt,
  },
  primaryBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  primaryBtnOff: { opacity: 0.5 },
  primaryBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.white },
  switchBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 16, minHeight: 44 },
  switchText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
});
