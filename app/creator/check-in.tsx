/**
 * Check-in mode (spec 100 P0 #5): check a reference_code in by TYPE or SCAN,
 * one screen two paths. A big pass/fail that is never colour alone (icon +
 * text + colour, §8 WCAG). Live checked-in / total. Works on bad signal: a
 * network failure queues locally and syncs; a real verdict never queues
 * (lib/ticketDoor).
 *
 * The read gates on is_ticketing_organizer via RLS (§7); the RPC re-checks the
 * organizer server-side, so this screen is a courier, not the authority.
 *
 * O-09 (2026-08-19): renamed from door.tsx/DoorScreen/"at the door" -- this
 * screen and its route are reachable by producers (organizations), not just
 * community leaders, and "door" is one of the five banned membership/room
 * concepts (see organizerHome.ts's own header note). The underlying file
 * lib/ticketDoor.ts and the DoorAttendee/countAttendees helpers keep their
 * internal names; they are not user-facing navigation or copy.
 */

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, X, CircleAlert, Clock, Keyboard as KeyboardIcon, ScanLine } from 'lucide-react-native';
import Colors, { AfterglowColors as C, CreatorSurfaceColors } from '../../constants/Colors';
import { LinearGradient } from 'expo-linear-gradient';
import ProfileButton from '../../components/ProfileButton';
import { requestWithDeadline } from '../../lib/requestWithDeadline';
import { FontSizes, type AfterglowFontFamilies } from '../../constants/Typography';
import { CreatorActionFill } from '../../components/creator/CreatorActionFill';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { EventAction, EventSpacing } from '../../constants/EventDesign';
import { hapticSuccess, hapticError, hapticWarning, hapticLight } from '../../lib/haptics';
import { useCreatorPageScope } from '../../hooks/useCreatorPageScope';
import { useCreatorPageRead } from '../../hooks/useCreatorPageRead';
import { canReadCreatorTickets } from '../../lib/creatorTicketRead';
import { resolveCreatorEventEntry } from '../../lib/creatorEventEntry';
import { CREATOR_PAGES_ENABLED } from '../../constants/FeatureFlags';
import type { CreatorPageScope } from '../../lib/creatorPageReview';
import { PageFrame, PageAction, pageStyles } from '../../components/creator/pages/PageFrame';
import { countAttendees, getEventAttendees } from '../../lib/ticketAttendees';
import { formatTimestampLA } from '../../lib/laDate';
import {
  listQueued,
  readLegacyCheckins,
  confirmLegacyCheckins,
  normalizeCode,
  recordCheckin,
  syncQueuedCheckins,
  type CheckinOutcome,
  type CheckinContext,
  type QueuedCheckinView,
} from '../../lib/ticketDoor';

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
    if (o.result === 'duplicate') {
      // Screen 30: show staff exactly when this seat first came in, instead
      // of a bare "already checked in"
      const at = o.admittedAt ? formatTimestampLA(o.admittedAt) : null;
      return {
        tone: 'warn',
        label: 'already in',
        detail: at ? `${o.code} was already checked in at ${at}` : `${o.code} was already checked in`,
      };
    }
    return { tone: 'fail', label: 'void ticket', detail: `${o.code} is refunded or canceled` };
  }
  if (o.kind === 'unknown') return { tone: 'fail', label: 'no ticket', detail: `no ticket with code ${o.code}` };
  if (o.kind === 'queued') return { tone: 'pending', label: 'awaiting confirmation', detail: `${o.code} is saved on this device. Sync to confirm admission.` };
  return { tone: 'fail', label: 'did not go through', detail: o.message };
}

let nextCheckInVisit = 0;
class CheckInAccessUnavailable extends Error {}
async function boundedRead<T>(scope: CreatorPageScope, read: (owned: CreatorPageScope) => Promise<T>, signal?: AbortSignal): Promise<T> {
  let reading=true;
  const owned={userId:scope.userId,isCurrent:()=>reading&&!signal?.aborted&&scope.isCurrent()};
  try {
    if(!owned.isCurrent())throw new Error('This visit has ended.');
    const result=await requestWithDeadline(read(owned),12_000);
    if(!owned.isCurrent())throw new Error('This visit has ended.');
    return result;
  } finally {reading=false;}
}

export default function CheckInRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const {scope,account}=useCreatorPageScope(id??'');
  const validId=typeof id==='string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);
  const mounted=useRef(true),retryLock=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const read=useCallback((scope:CreatorPageScope)=>boundedRead(scope,async owned=>{
    if(!await canReadCreatorTickets(id!,owned))return null;
    if(CREATOR_PAGES_ENABLED){
      const entry=await resolveCreatorEventEntry({kind:'edit',id:id!},owned);
      if(entry.kind==='page')return {pageId:entry.pageId};
    }
    return {pageId:null};
  }),[id]);
  const access=useCreatorPageRead(validId?scope:null,read);
  const visit=useMemo(()=>++nextCheckInVisit,[scope,id,access.data]);
  const context=useMemo(()=>scope&&access.data?{eventId:id!,pageId:access.data.pageId,scope}:null,[id,scope,access.data]);
  const retryAccess=()=>{
    if(!mounted.current||retryLock.current||!(scope?.isCurrent()??account?.isCurrent()))return;
    retryLock.current=true;
    void(account?.error?account.retry():access.refresh()).catch(()=>undefined).finally(()=>{retryLock.current=false;});
  };
  if(context && scope?.isCurrent() && access.data && !access.loading && !access.error)return <CheckInScreen key={visit} id={id!} context={context} visit={visit} onAccessRetry={retryAccess}/>;
  return <PageFrame title="Check in">
    {account?.isLoading||access.loading?<ActivityIndicator accessibilityLabel="Checking event access" color={Colors.terracotta}/>:<>
      <Text style={pageStyles.body}>{access.error||account?.error?'Check-in couldn’t be loaded.':'Check-in isn’t available for this event and account.'}</Text>
      {validId&&<PageAction title="Try again" compact singleLine onPress={retryAccess}/>}
    </>}
  </PageFrame>;
}
function CheckInScreen({id,context,visit,onAccessRetry}:{id:string;context:CheckinContext;visit:number;onAccessRetry:()=>void}) {
  const styles = useStyles();
  const {scope}=context;
  const mounted=useRef(true),revoked=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const visitCurrent=useCallback(()=>mounted.current&&scope.isCurrent(),[scope]);
  const current=useCallback(()=>visitCurrent()&&!revoked.current,[visitCurrent]);
  const readScope=useMemo(()=>({userId:scope.userId,isCurrent:visitCurrent}),[scope.userId,visitCurrent]);
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>('type');
  const [codeInput, setCodeInput] = useState('');
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [busy, setBusy] = useState(false);
  const actionLock=useRef(false);
  const [queueProblem,setQueueProblem]=useState(false);
  const [legacyScans,setLegacyScans]=useState<QueuedCheckinView[]>([]);
  const [legacyProblem,setLegacyProblem]=useState(false);
  const [reviewLegacy,setReviewLegacy]=useState(false);
  const [queued, setQueued] = useState(0);
  const [queuedList, setQueuedList] = useState<QueuedCheckinView[]>([]);
  const [showQueuedList, setShowQueuedList] = useState(false);
  const lastScan = useRef<{ code: string; at: number }>({ code: '', at: 0 });

  const { data: attendees, isFetching: attendeesBusy, isError: attendeesError, error:attendanceFailure, refetch: retryAttendees } = useQuery({
    queryKey: ['event-attendees', id, scope.userId, 'check-in', visit],
    queryFn: ({signal}) => boundedRead(readScope,async owned=>{
      const allowed=await canReadCreatorTickets(id,owned);
      if(!owned.isCurrent())throw new Error('This visit has ended.');
      if(!allowed){revoked.current=true;throw new CheckInAccessUnavailable('Check-in access is no longer available.');}
      const rows=await getEventAttendees(id,owned);
      if(!owned.isCurrent())throw new Error('This visit has ended.');
      return rows;
    },signal),
    retry:false,
    staleTime: 10_000,
  });
  const accessDenied=revoked.current||attendanceFailure instanceof CheckInAccessUnavailable;
  const counts=attendees===undefined?undefined:countAttendees(attendees);
  const retryCountsLock=useRef(false);
  const [retrying,setRetrying]=useState(false);
  const retryCounts=()=>{
    if(!visitCurrent()||retryCountsLock.current||attendeesBusy)return;
    retryCountsLock.current=true;setRetrying(true);
    void retryAttendees({cancelRefetch:false}).finally(()=>{retryCountsLock.current=false;if(visitCurrent())setRetrying(false);});
  };
  const refreshQueued = useCallback(async () => {
    if(!current())return;
    const list = await listQueued(context);
    if(!current())return;
    setQueuedList(list);setQueued(list.length);setQueueProblem(false);
  }, [context,scope,current]);
  const refreshLegacy=useCallback(async()=>{
    if(!current())return;
    try{const rows=await readLegacyCheckins(context);if(current()){setLegacyScans(rows);setLegacyProblem(false);}}
    catch{if(current()){setLegacyScans([]);setLegacyProblem(true);}}
  },[context,scope,current]);
  useEffect(()=>{void refreshLegacy();},[refreshLegacy]);
  const confirmLegacy=useCallback(async()=>{
    if(!current()||actionLock.current||!legacyScans.length)return;
    actionLock.current=true;setBusy(true);
    try{
      const summary=await confirmLegacyCheckins(context,legacyScans);
      if(!current())return;
      const last=summary.processed[summary.processed.length-1];
      if(last)setVerdict(outcomeToVerdict(last.outcome));
      void queryClient.invalidateQueries({queryKey:['event-attendees',id,scope.userId]});
      await refreshQueued();await refreshLegacy();
    }catch{if(current())setLegacyProblem(true);}
    finally{actionLock.current=false;if(current())setBusy(false);}
  },[context,scope,current,id,legacyScans,queryClient,refreshQueued,refreshLegacy]);
  const syncNow = useCallback(async () => {
    if(!current()||actionLock.current)return;
    actionLock.current=true;setBusy(true);
    try{
      const summary=await syncQueuedCheckins(context);
      if(!current())return;
      if(summary.processed.length){
        void queryClient.invalidateQueries({queryKey:['event-attendees',id,scope.userId]});
        setVerdict(outcomeToVerdict(summary.processed[summary.processed.length-1].outcome));
      }
      await refreshQueued();
    }catch{if(current())setQueueProblem(true);}
    finally{actionLock.current=false;if(current())setBusy(false);}
  },[context,scope,current,id,queryClient,refreshQueued]);
  useEffect(()=>{void syncNow();},[syncNow]);

  const check = useCallback(async(rawCode:string)=>{
    const code=normalizeCode(rawCode);
    if(!code||!current()||actionLock.current)return;
    actionLock.current=true;setBusy(true);
    try{
      const outcome=await recordCheckin(code,context);
      if(!current())return;
      const next=outcomeToVerdict(outcome);setVerdict(next);
      if(next.tone==='pass')hapticSuccess();else if(next.tone==='warn')hapticWarning();else if(next.tone==='fail')hapticError();else hapticLight();
      if(outcome.kind==='result')void queryClient.invalidateQueries({queryKey:['event-attendees',id,scope.userId]});
      await refreshQueued();
      if(current() && (outcome.kind==='result'||outcome.kind==='queued'))setCodeInput('');
    }catch{if(current()){setQueueProblem(true);setVerdict({tone:'fail',label:'not confirmed',detail:'Check-in could not be confirmed. Keep this code and try again.'});}}
    finally{actionLock.current=false;if(current())setBusy(false);}
  },[context,scope,current,id,queryClient,refreshQueued]);

  const handleScanRaw = useCallback(
    (raw: string) => {
      if(!current())return;
      const code = normalizeCode(raw);
      const now = Date.now();
      if (!code) return;
      if (lastScan.current.code === code && now - lastScan.current.at < SCAN_COOLDOWN_MS) return;
      lastScan.current = { code, at: now };
      check(code);
    },
    [check,current],
  );

  if(accessDenied)return <PageFrame title="Check in">
    <Text style={pageStyles.body}>Check-in is no longer available for this event and account.</Text>
    <PageAction title={attendeesBusy?'Retrying…':'Try again'} compact singleLine disabled={attendeesBusy} onPress={()=>{if(visitCurrent())onAccessRetry();}}/>
  </PageFrame>;

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
        <TouchableOpacity onPress={() => {if(!current())return;if(router.canGoBack())router.back();else router.replace(`/creator/attendees?id=${id}` as never);}} style={styles.headerControl} accessibilityRole="button" accessibilityLabel="back">
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2} />
        </TouchableOpacity>
        {/* copy to the taste gate. O-09: was "at the door" */}
        <Text style={styles.headerTitle} numberOfLines={1}>Check in</Text>
        <ProfileButton compact/>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={styles.body}>
      {/* live count, with a text equivalent (never a bare number, §8) */}
      <View style={styles.attendanceCard}>
        <LinearGradient pointerEvents="none" colors={[CreatorSurfaceColors.sunsetGoldLight,C.white]} start={{x:0,y:0}} end={{x:1,y:1}} style={StyleSheet.absoluteFill}/>
        <Text style={styles.countLabel}>Attendance</Text>
        {counts?<View style={styles.countRow} accessibilityRole="summary">
          <Text style={styles.countBig}>{counts.checkedIn}</Text>
          <Text style={styles.countTotal}> / {counts.sold} checked in</Text>
        </View>:attendeesBusy?<ActivityIndicator accessibilityLabel="Loading attendance" color={Colors.terracotta}/>:null}
        {(attendeesError||retrying)?<View style={styles.recovery} accessibilityRole="alert">
          <Text style={[styles.countStatus,styles.recoveryStatus]}>{attendeesBusy?'Updating attendance…':counts?'Attendance couldn’t be refreshed. Showing the last confirmed count.':'Attendance couldn’t be loaded.'}</Text>
          <PageAction title={attendeesBusy?'Retrying…':'Try again'} compact singleLine disabled={attendeesBusy} onPress={retryCounts}/>
        </View>:counts&&attendeesBusy?<Text style={styles.countStatus}>Updating attendance…</Text>:null}
      </View>
      {queueProblem&&<View style={styles.queuedListBox} accessibilityRole="alert"><Text style={styles.queuedText}>Saved check-ins couldn’t be confirmed. Your saved records are kept.</Text><PageAction title="Try again" compact onPress={()=>{void syncNow();}}/></View>}
      {queued > 0 && (
        <>
          <TouchableOpacity
            style={styles.queuedRow}
            onPress={() => {if(current())setShowQueuedList((s) => !s);}}
            onLongPress={syncNow}
            disabled={busy}
            accessibilityRole="button"
            accessibilityHint="shows the list of codes waiting to sync. long-press to sync now."
          >
            <Clock size={14} color={Colors.terracotta} strokeWidth={2} />
            {/* copy to the taste gate */}
            <Text style={styles.queuedText}>
              {queued} saved offline. {showQueuedList ? 'hide list' : 'tap to view'}, long-press to sync.
            </Text>
          </TouchableOpacity>
          {showQueuedList && (
            <View style={styles.queuedListBox} accessibilityRole="list">
              {queuedList.map((item) => (
                <Text key={item.code} style={styles.queuedListRow}>{item.code}</Text>
              ))}
              <TouchableOpacity style={styles.queuedSyncBtn} onPress={syncNow} disabled={busy} accessibilityRole="button" accessibilityLabel="Sync saved check-ins">
                <Text numberOfLines={1} style={styles.queuedSyncBtnText}>Sync now</Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      )}

      {legacyProblem&&<View style={styles.queuedListBox} accessibilityRole="alert"><Text style={styles.queuedText}>Earlier saved scans couldn’t be verified. They have been kept.</Text><PageAction title="Try again" compact onPress={()=>{void refreshLegacy();}}/></View>}
      {legacyScans.length>0&&!legacyProblem&&<View style={styles.queuedListBox}>
        <Text style={styles.queuedText}>{legacyScans.length} earlier saved {legacyScans.length===1?'scan':'scans'} for this event</Text>
        {reviewLegacy?<>
          <Text style={pageStyles.body}>Confirm these scans to check in guests for this event. Already admitted tickets will keep their original check-in.</Text>
          {legacyScans.map(row=><Text key={`${row.code}:${row.queuedAt}`} style={styles.queuedListRow}>{row.code}</Text>)}
          <TouchableOpacity style={styles.queuedSyncBtn} onPress={confirmLegacy} disabled={busy} accessibilityRole="button" accessibilityLabel="Confirm earlier scans"><Text numberOfLines={1} style={styles.queuedSyncBtnText}>Confirm scans</Text></TouchableOpacity>
        </>:<PageAction title="Review scans" compact onPress={()=>{if(current())setReviewLegacy(true);}}/>}
      </View>}

      {/* the verdict: icon + text + colour, announced to screen readers */}
      {v && (
        <View style={[styles.panel, panelStyle]} accessibilityLiveRegion="assertive" accessibilityRole="alert">
          {v.tone === 'pass' && <Check size={32} color={Colors.brandDeep} strokeWidth={3} />}
          {v.tone === 'fail' && <X size={32} color={Colors.white} strokeWidth={3} />}
          {v.tone === 'warn' && <CircleAlert size={32} color={Colors.asphalt} strokeWidth={2.5} />}
          {v.tone === 'pending' && <Clock size={32} color={Colors.asphalt} strokeWidth={2.5} />}
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
          <Text style={styles.inputHeading}>Welcome them in</Text>
          <Text style={styles.inputHint}>Enter the code on their ticket, or scan it below.</Text>
          <TextInput
            style={styles.codeInput}
            value={codeInput}
            onChangeText={(t) => {if(current())setCodeInput(t.toUpperCase());}}
            placeholder="Ticket code"
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
            <CreatorActionFill />
            {busy ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              /* copy to the taste gate */
              <Text numberOfLines={1} style={styles.primaryBtnText}>Check in</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* switch paths, always both available (§5: scan OR type) */}
      <TouchableOpacity
        style={styles.switchBtn}
        accessibilityLabel={mode==='scan'?'Type a code':'Scan a ticket'}
        disabled={busy}
        onPress={() => { if(!current())return; hapticLight(); setMode((m) => (m === 'scan' ? 'type' : 'scan')); setVerdict(null); }}
        accessibilityRole="button"
      >
        {mode === 'scan' ? (
          <KeyboardIcon size={16} color={Colors.terracotta} strokeWidth={2} />
        ) : (
          <ScanLine size={16} color={Colors.terracotta} strokeWidth={2} />
        )}
        {/* copy to the taste gate */}
        <Text numberOfLines={1} style={styles.switchText}>{mode === 'scan' ? 'Type a code' : 'Scan a ticket'}</Text>
      </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: C.paper },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, minHeight:56, gap:12 },
  headerControl: {minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center'},
  headerTitle: { flex:1,minWidth:0,fontFamily: fonts.semibold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  body:{flexGrow:1,paddingHorizontal:20,paddingTop:12,paddingBottom:24,gap:16},
  attendanceCard:{padding:16,gap:8,borderWidth:1,borderColor:CreatorSurfaceColors.goldEdge,borderRadius:16,overflow:'hidden'},
  countLabel:{fontFamily:fonts.medium,fontSize:FontSizes.bodySM,color:C.muted},
  countRow:{flexDirection:'row',flexWrap:'wrap',alignItems:'baseline'},
  recoveryStatus:{flexGrow:1,flexBasis:130},
  countStatus:{fontFamily:fonts.regular,fontSize:FontSizes.bodySM,lineHeight:19,color:C.muted},
  recovery:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:12},
  countBig: { fontFamily: fonts.display, fontSize: FontSizes.displayLG, color: Colors.asphalt },
  countTotal: { fontFamily: fonts.medium, fontSize: FontSizes.bodyMD, color: Colors.textMedium },
  queuedRow: { paddingHorizontal: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, minHeight: 44 },
  queuedText: { flexShrink: 1, fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  queuedListBox: {
    backgroundColor: C.white,
    borderWidth:1,borderColor:C.subtleLine,
    borderRadius: 14,
    padding: 14,
    gap: 6,
  },
  queuedListRow: {
    fontFamily: fonts.medium,
    fontSize: FontSizes.bodySM,
    letterSpacing: 1,
    color: Colors.asphalt,
  },
  queuedSyncBtn: { alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 4, minHeight: 44, justifyContent: 'center' },
  queuedSyncBtnText: { fontFamily: fonts.semibold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  panel: {

    borderRadius: 16,
    padding:20,
    alignItems: 'center',
    gap: EventSpacing.sm,
  },
  panelPass: { backgroundColor: EventAction.success },
  panelFail: { backgroundColor: EventAction.error },
  panelWarn: { backgroundColor: Colors.inputBg, borderWidth: 1.5, borderColor: EventAction.success },
  panelPending: { backgroundColor: Colors.inputBg, borderWidth: 1.5, borderColor: Colors.border },
  panelLabel: { textAlign: 'center', fontFamily: fonts.semibold, fontSize: FontSizes.bodyLG },
  panelDetail: { fontFamily: fonts.regular, fontSize: FontSizes.bodyMD, textAlign: 'center' },
  panelText: { color: Colors.asphalt },
  panelTextOnDark: { color: Colors.white },
  scanArea: { flex: 1, minHeight: 240, justifyContent: 'center' },
  inputHeading: {fontFamily:fonts.display,fontSize:FontSizes.displayMD,color:Colors.asphalt},
  inputHint: {fontFamily:fonts.regular,fontSize:FontSizes.bodyMD,lineHeight:20,color:Colors.textMedium,marginBottom:4},
  typeArea: { backgroundColor:C.white,borderWidth:1,borderColor:C.subtleLine,borderRadius:16,padding:16,gap:12 },
  codeInput: {
    backgroundColor: C.paper,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 14,
    fontFamily: fonts.semibold,
    fontSize: FontSizes.displaySM,
    letterSpacing: 1,
    textAlign: 'center',
    color: Colors.asphalt,
  },
  primaryBtn: {
    backgroundColor: Colors.terracotta,
    overflow: 'hidden',
    borderRadius: 24,
    paddingVertical: 12,
    paddingHorizontal:20,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  primaryBtnOff: { opacity: 0.5 },
  primaryBtnText: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyLG, color: Colors.white },
  switchBtn: { flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,paddingVertical:12,paddingHorizontal:16,minHeight:44,borderWidth:1,borderColor:CreatorSurfaceColors.goldEdge,borderRadius:24,backgroundColor:C.white },
  switchText: { fontFamily: fonts.medium, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
}); }
function useStyles() { const {fonts}=useAfterglowFonts(true, 'creator'); return useMemo(()=>createStyles(fonts),[fonts]); }
