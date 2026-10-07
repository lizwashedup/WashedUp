import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, ChevronLeft, ChevronRight, AtSign, QrCode, Users, Send } from 'lucide-react-native';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../../constants/Typography';
import BottomSheet from '../primitives/BottomSheet';
import PlanHistoryBacklog from './PlanHistoryBacklog';
import HandleLookupView from './HandleLookupView';
import QRShareView from './QRShareView';
import { COPY } from '../state/constants';
import { useReferral } from '../../../hooks/useReferral';
import type { ObservedUser } from '../../../hooks/useObservedUser';
import { openInviteComposer } from '../../../lib/yours/invite';

type Mode = 'menu' | 'plans' | 'handle' | 'qr';
export type PathsSheetProps = {
  visible: boolean; onClose: () => void; userId: string; backlogCount: number; viewer: ObservedUser;
  onPressPerson: (id: string) => void; appearance?: { fonts: AfterglowFontFamilies };
};
/** The existing four ways to add people, owned by one visible account visit. */
export default function PathsSheet(props: PathsSheetProps) {
  return props.visible ? <PathsVisit {...props}/> : null;
}
function PathsVisit({ onClose, userId, backlogCount, onPressPerson, appearance, viewer }: PathsSheetProps) {
  // The screen already authorized this opening. A second identity observer would
  // replace its presenting native Modal when its initial account read settles.
  const opening = useRef({ userId, epoch: viewer.epoch }).current;
  const sameOpening = opening.userId === userId && opening.epoch === viewer.epoch;
  const [page, setPage] = useState({ mode: 'menu' as Mode });
  const latestPage = useRef(page); latestPage.current = page;
  const mounted = useRef(false), retired = useRef(false), inviteAttempt = useRef<object | null>(null);
  const [inviting, setInviting] = useState(false), [failure, setFailure] = useState<string | null>(null);
  const { ensureReferralCode } = useReferral();
  const ready = sameOpening && viewer.viewerId === userId && !viewer.isLoading && !viewer.error && viewer.isCurrent();
  const identityReady = useRef(ready); identityReady.current = ready;
  const latest = useRef({ onClose, onPressPerson }); latest.current = { onClose, onPressPerson };
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => mounted.current && !retired.current && identityReady.current && viewer.isCurrent();
  const operationScope = useMemo(() => ({ userId, isCurrent: () => current() && latestPage.current === page }), [page, userId]);
  const colors = appearance ? AfterglowColors : { paper: Colors.parchment, ink: Colors.asphalt, muted: Colors.secondary, clay: Colors.terracotta, line: Colors.border };
  const styles = useMemo(() => appearance ? { ...base, ...afterglow(appearance.fonts) } : base, [appearance?.fonts]);
  const close = () => { if (retired.current || !mounted.current) return; retired.current = true; latest.current.onClose(); };
  const move = (mode: Mode) => {
    if (!current()) return;
    const next = { mode }; latestPage.current = next; setPage(next); inviteAttempt.current = null; setInviting(false); setFailure(null);
  };
  const openPerson = (id: string) => {
    if (!operationScope.isCurrent()) return;
    retired.current = true; latest.current.onPressPerson(id);
  };
  const invite = async () => {
    if (!operationScope.isCurrent() || page.mode !== 'menu' || inviteAttempt.current) return;
    const attempt = {}; inviteAttempt.current = attempt; setInviting(true); setFailure(null);
    const owns = () => operationScope.isCurrent() && inviteAttempt.current === attempt;
    try {
      const code = await ensureReferralCode(userId, { isCurrent: owns });
      if (!owns()) return;
      await openInviteComposer(code, owns);
    } catch {
      if (owns()) setFailure('Couldn’t open your invite. Try again.');
    } finally {
      if (inviteAttempt.current === attempt) { inviteAttempt.current = null; if (operationScope.isCurrent()) setInviting(false); }
    }
  };
  const status = viewer.isLoading ? <View style={styles.feedback}><ActivityIndicator color={colors.clay}/><Text style={styles.sub}>Checking your account…</Text></View> : !ready ?
    <View style={styles.feedback}><Text style={styles.sub}>Couldn’t check your account.</Text><Pressable accessibilityRole="button" accessibilityLabel="Try again to check account" onPress={() => { if (mounted.current && !retired.current) void viewer.retry(); }} style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable></View> : null;

  // An account change closes this presentation; it never replaces a native
  // Modal in place. The parent must close and explicitly open a new visit.
  if (!sameOpening) return null;

  if (page.mode !== 'menu') return <Modal visible animationType="slide" onRequestClose={() => move('menu')}>
    <SafeAreaView style={[styles.full, { backgroundColor: colors.paper }]}>
      <View style={styles.bar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to add people" onPress={() => move('menu')} style={styles.icon}><ChevronLeft size={24} color={colors.ink}/></Pressable>
        <Text accessibilityRole="header" style={styles.barTitle}>{page.mode === 'plans' ? 'Past plans' : page.mode === 'handle' ? 'Find by handle' : 'Your invite code'}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close add people" onPress={close} style={styles.icon}><X size={24} color={colors.ink}/></Pressable>
      </View>
      <View style={styles.fullBody}>{status || (page.mode === 'plans' ?
        <PlanHistoryBacklog userId={userId} onPressPerson={openPerson} appearance={appearance} operationScope={operationScope}/> : page.mode === 'handle' ?
        <HandleLookupView userId={userId} onPressPerson={openPerson} appearance={appearance} operationScope={operationScope}/> :
        <QRShareView userId={userId} appearance={appearance} operationScope={operationScope}/>)}</View>
    </SafeAreaView>
  </Modal>;

  const row = (key: string, title: string, detail: string, Icon: typeof Users, action: () => void, busy = false) => <Pressable key={key}
    style={styles.row} accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: !ready || busy, busy }} disabled={!ready || busy} onPress={action}>
      <Icon size={22} color={colors.clay}/><View style={styles.rowBody}><Text style={styles.title} numberOfLines={1}>{title}</Text><Text style={styles.sub}>{detail}</Text></View>
      {busy ? <ActivityIndicator color={colors.clay}/> : <ChevronRight size={18} color={colors.muted}/>}</Pressable>;
  return <BottomSheet visible onClose={close} appearance={appearance}>
    <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={styles.menu}>
      <Text accessibilityRole="header" style={styles.heading}>Add people</Text>
      <Text style={styles.intro}>Keep in touch with people you meet.</Text>
      {status}
      {row('plans', 'Past plans', COPY.pathPlansCount(backlogCount), Users, () => move('plans'))}
      {row('invite', failure ? 'Try again' : 'Invite someone', inviting ? 'Opening your invite…' : 'Send an invite they can accept in the app.', Send, () => { void invite(); }, inviting)}
      {failure && <Text accessibilityRole="alert" style={styles.error}>{failure}</Text>}
      {row('handle', 'Find by handle', 'Enter someone’s exact WashedUp handle.', AtSign, () => move('handle'))}
      {row('qr', 'Show my code', 'Let someone scan your WashedUp invite.', QrCode, () => move('qr'))}
    </ScrollView>
  </BottomSheet>;
}
const base = StyleSheet.create({
  menu: { paddingBottom: 8 }, full: { flex: 1, backgroundColor: Colors.parchment }, fullBody: { flex: 1, paddingHorizontal: 20 },
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 12, gap: 8 },
  icon: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  barTitle: { flex: 1, fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  heading: { fontFamily: Fonts.displayBold, fontSize: FontSizes.displayMD, color: Colors.asphalt },
  intro: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.secondary, marginTop: 8, marginBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 18, minHeight: 68, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  rowBody: { flex: 1, minWidth: 0, gap: 3 }, title: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  sub: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.secondary },
  feedback: { gap: 10, marginVertical: 12 }, retry: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: 12 },
  retryText: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyMD, color: Colors.terracotta }, error: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.errorRed, marginTop: 8 },
});
function afterglow(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  heading: { ...AfterglowType.identity, fontFamily: fonts.display, color: AfterglowColors.ink },
  intro: { ...base.intro, ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted },
  title: { ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.ink },
  barTitle: { ...base.barTitle, ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.ink },
  sub: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted },
  row: { ...base.row, borderBottomColor: AfterglowColors.subtleLine },
  retryText: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.clay },
  error: { ...base.error, ...AfterglowType.body, fontFamily: fonts.regular },
}); }
