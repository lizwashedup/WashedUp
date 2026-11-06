import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ActivityIndicator,
  ScrollView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { submitMemberReport } from '../../lib/memberReportSubmission';
import { requestWithDeadline } from '../../lib/requestWithDeadline';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';

const REPORT_REASONS = [
  'Inappropriate behavior',
  'Harassment or bullying',
  'Fake profile or spam',
  'No-show to plan',
  'Made me feel unsafe',
  'Other',
] as const;

/** A captured readable room/account visit. Reporting remains available when
 * posting has expired; callers must not substitute a composer write gate. */
export interface ReportOperationScope {
  userId: string;
  isCurrent: () => boolean;
}

export interface ReportModalProps {
  visible: boolean;
  onClose: () => void;
  reportedUserId: string;
  reportedUserName: string;
  eventId?: string;
  scope?: ReportOperationScope | null;
}

type ReportContext = {
  reportedUserId: string;
  eventId: string | undefined;
  scope: ReportOperationScope | null | undefined;
  authRevision: number;
};
type ReportVisit = { context: ReportContext; visible: boolean; retired: boolean; submitted?: boolean };
type ReportAttempt = { visit: ReportVisit; phase: 'checking' | 'sending' };
type ReportAlert = { title: string; message: string; visit: ReportVisit; success?: boolean };

export function ReportModal({
  visible,
  onClose,
  reportedUserId,
  reportedUserName,
  eventId,
  scope,
}: ReportModalProps) {
  const insets = useSafeAreaInsets();
  const authUser = useRef<string | null | undefined>(undefined);
  const authRevisionRef = useRef(0);
  const [authRevision, setAuthRevision] = useState(0);
  const context = useMemo<ReportContext>(() => ({ reportedUserId, eventId, scope, authRevision }), [reportedUserId, eventId, scope, authRevision]);
  const visit = useMemo<ReportVisit>(() => ({ context, visible, retired: false }), [context, visible]);
  const activeContext = useRef<ReportContext | null>(null);
  const activeVisit = useRef<ReportVisit | null>(null);
  const attemptRef = useRef<ReportAttempt | null>(null);
  const [selection, setSelection] = useState<{ visit: ReportVisit; reason: string } | null>(null);
  const [accountErrorVisit, setAccountErrorVisit] = useState<ReportVisit | null>(null);
  const [attempt, setAttempt] = useState<ReportAttempt | null>(null);
  const [alertInfo, setAlertInfo] = useState<ReportAlert | null>(null);

  const contextIsCurrent = (owner: ReportContext) => activeContext.current === owner &&
    authRevisionRef.current === owner.authRevision && owner.scope !== null &&
    (!owner.scope || (!!owner.scope.userId && owner.scope.isCurrent() &&
      (authUser.current === undefined || authUser.current === owner.scope.userId)));
  const visitIsCurrent = (owner: ReportVisit) => activeVisit.current === owner &&
    owner.visible && !owner.retired && !owner.submitted && contextIsCurrent(owner.context);

  useLayoutEffect(() => {
    activeContext.current = context;
    activeVisit.current = visit;
    attemptRef.current = null;
    setAttempt(null);
    setAccountErrorVisit(null);
    setSelection(null);
    setAlertInfo(null);
  }, [context, visit, visible]);

  useLayoutEffect(() => () => {
    activeContext.current = null;
    activeVisit.current = null;
    attemptRef.current = null;
  }, []);

  useEffect(() => {
    let active = true;
    // Observe transitions synchronously, including A -> B -> A between renders.
    // Legacy callers retain their submit-time getUser read; this observer never
    // changes a session or performs another auth request inside its callback.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      const next = session?.user.id ?? null;
      const previous = authUser.current === undefined ? activeContext.current?.scope?.userId : authUser.current;
      authUser.current = next;
      if (next !== previous) {
        authRevisionRef.current++;
        setAuthRevision(authRevisionRef.current);
      }
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  const selectedReason = selection?.visit === visit ? selection.reason : null;
  const submitting = attempt?.visit === visit;
  const scopeReady = scope !== null && (!scope || (!!scope.userId && scope.isCurrent() &&
    (authUser.current === undefined || authUser.current === scope.userId)));
  const visibleAlert = alertInfo?.visit === visit && visible && !visit.retired && contextIsCurrent(context) ? alertInfo : null;


  const handleClose = () => {
    // Dismissal remains available if account/scope eligibility is unknown.
    if (activeVisit.current !== visit || !visible || visit.retired ||
        authRevisionRef.current !== context.authRevision ||
        (attemptRef.current?.visit === visit && attemptRef.current.phase === 'sending')) return;
    visit.retired = true;
    setSelection(null);
    setAlertInfo(null);
    onClose();
  };

  const handleSubmit = async () => {
    if (!selectedReason || !reportedUserId || !visitIsCurrent(visit) || attemptRef.current?.visit === visit) return;
    let ownedAttempt: ReportAttempt = { visit, phase: 'checking' };
    setAccountErrorVisit(null);
    attemptRef.current = ownedAttempt;
    setAttempt(ownedAttempt);
    setAlertInfo(null);
    const ownsAttempt = () => attemptRef.current === ownedAttempt && visitIsCurrent(visit);

    try {
      const { data: { user }, error: authError } = await requestWithDeadline(supabase.auth.getUser(), 12_000);
      if (!ownsAttempt()) return;
      if (authError) throw authError;
      if (!user || (scope && user.id !== scope.userId) ||
          (authUser.current !== undefined && user.id !== authUser.current)) throw new Error('Account could not be confirmed');
      // The initiating account is now fixed. Do not perform another auth read
      // or adopt a new account before dispatching the existing reports insert.
      const reporterId = scope?.userId ?? user.id;
      if (authUser.current === undefined) authUser.current = reporterId;

      ownedAttempt = { visit, phase: 'sending' };
      attemptRef.current = ownedAttempt;
      setAttempt(ownedAttempt);
      const receipt = await submitMemberReport({
        reporter_user_id: reporterId,
        reported_user_id: reportedUserId,
        reason: selectedReason,
        reported_event_id: eventId ?? null,
        details: eventId ? 'Reported from plan' : 'Reported from user search',
      }, ownsAttempt);

      if (!ownsAttempt()) return;
      if (receipt === 'previous') {
        setAlertInfo({ title: 'Earlier report received', message: 'Your earlier reason was submitted. Tap Submit Report again to send this reason separately.', visit });
        return;
      }

      // Some callers unmount the form on close. Keep the receipt in this
      // sheet until Done, and retire Submit synchronously so a tap cannot
      // create another report while React is switching to the receipt.
      visit.submitted = true;
      setSelection(null);
      setAlertInfo({ title: 'Report submitted', message: 'Thank you. We review all reports within 24 hours.', visit, success: true });
    } catch {
      if (!ownsAttempt()) return;
      if (ownedAttempt.phase === 'checking') {
        setAccountErrorVisit(visit);
        return;
      }
      setAlertInfo({
        title: 'Could not confirm report',
        message: 'Try submitting again to check whether we received your report. You can also email hello@washedup.app.',
        visit,
      });
    } finally {
      // A retired attempt must never unlock a newer target/account's submit.
      if (attemptRef.current === ownedAttempt) {
        attemptRef.current = null;
        setAttempt(null);
      }
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={handleClose}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityLabel="Close report"
            accessibilityRole="button"
            disabled={submitting && attempt?.phase === 'sending'}
          >
            <Ionicons name="close" size={22} color={Colors.asphalt} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Report User</Text>
          {/* Spacer to keep title centered */}
          <View style={{ width: 22 }} />
        </View>

        <ScrollView
          decelerationRate="normal"
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {visibleAlert?.success ? (
            <View>
              <Text style={styles.subtitle} accessibilityRole="header">{visibleAlert.title}</Text>
              <Text style={styles.disclaimer} accessibilityRole="alert" accessibilityLiveRegion="polite">{visibleAlert.message}</Text>
            </View>
          ) : <>
          <Text style={styles.subtitle}>
            Why are you reporting{'\n'}
            <Text style={styles.subtitleName}>{reportedUserName}</Text>?
          </Text>

          {/* Reason list */}
          <View style={styles.reasonList}>
            {REPORT_REASONS.map((reason, i) => {
              const isSelected = selectedReason === reason;
              return (
                <TouchableOpacity
                  key={reason}
                  style={[
                    styles.reasonRow,
                    i < REPORT_REASONS.length - 1 && styles.reasonRowBorder,
                  ]}
                  onPress={() => { if (visitIsCurrent(visit) && attemptRef.current?.visit !== visit) setSelection({ visit, reason }); }}
                  disabled={submitting || !scopeReady}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.reasonText, isSelected && styles.reasonTextSelected]}>
                    {reason}
                  </Text>
                  <View style={[styles.check, isSelected && styles.checkSelected]}>
                    {isSelected && (
                      <Ionicons name="checkmark" size={14} color={Colors.white} />
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.disclaimer}>
            Your report is anonymous. We review all reports within 24 hours.
          </Text>
          </>}
        </ScrollView>

        {/* Sticky submit button */}
        <View
          style={[
            styles.footer,
            {
              // Android edge-to-edge: add nav/gesture bar inset so submit
              // button stays tappable. iOS keeps its existing 32px.
              paddingBottom:
                Platform.OS === 'ios' ? 32 : 20 + insets.bottom,
            },
          ]}
        >
          {visibleAlert && !visibleAlert.success && (
            <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.accountError}>
              {visibleAlert.message}
            </Text>
          )}
          {accountErrorVisit === visit && scopeReady && (
            <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.accountError}>
              We couldn’t check your account. Try submitting again.
            </Text>
          )}
          {visibleAlert?.success ? (
            <TouchableOpacity style={styles.submitBtn} onPress={handleClose} accessibilityRole="button">
              <Text style={styles.submitBtnText}>Done</Text>
            </TouchableOpacity>
          ) : <TouchableOpacity
            style={[styles.submitBtn, (!selectedReason || !scopeReady) && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={!selectedReason || submitting || !scopeReady}
            activeOpacity={0.9}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <Text style={styles.submitBtnText}>Submit Report</Text>
            )}
          </TouchableOpacity>}
        </View>
      </View>

    </Modal>

  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.parchment,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.inputBg,
    backgroundColor: Colors.white,
  },
  headerTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },

  // Body
  content: {
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 24,
    gap: 20,
  },
  subtitle: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.displaySM,
    color: Colors.asphalt,
    textAlign: 'center',
    lineHeight: 26,
  },
  subtitleName: {
    color: Colors.terracotta,
    fontFamily: Fonts.sansBold,
  },

  // Reason list
  reasonList: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.inputBg,
    shadowColor: Colors.asphalt,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  reasonRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.inputBg,
  },
  reasonText: {
    flex: 1,
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  reasonTextSelected: {
    color: Colors.terracotta,
    fontFamily: Fonts.sansBold,
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkSelected: {
    backgroundColor: Colors.terracotta,
    borderColor: Colors.terracotta,
  },

  disclaimer: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.warmGray,
    textAlign: 'center',
    lineHeight: 18,
  },

  // Footer
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.inputBg,
  },
  accountError: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.asphalt,
    marginBottom: 8,
  },
  submitBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 14,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.terracotta,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  submitBtnDisabled: {
    backgroundColor: Colors.inputBg,
    shadowOpacity: 0,
    elevation: 0,
  },
  submitBtnText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.white,
  },
});
