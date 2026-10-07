/**
 * At-a-glance attendee list (spec 100 P0 #1, native read-only slice). One row
 * per SEAT (ticket_order_positions), never per order. Search by name or
 * reference code; filter by tier and by checked-in / refunded. Counts on top.
 *
 * §7: the read is organizer-only by RLS; we show buyer_name_snapshot and the
 * seat's status, never email / phone / internal fields. §8: statuses are text +
 * icon, never colour alone; real 44pt controls; every count has a text label.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, Check, ChevronDown, ChevronRight, ChevronUp, ScanLine } from 'lucide-react-native';
import Colors, { CreatorSurfaceColors } from '../../constants/Colors';
import { FontSizes, type AfterglowFontFamilies } from '../../constants/Typography';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { EventSpacing } from '../../constants/EventDesign';
import { hapticLight } from '../../lib/haptics';
import { attendeesToCsv, checkRefundAttempt, executeRefund, formatCents, getRefundAccess, previewRefund, type RefundTarget, type RefundPreview } from '../../lib/ticketing';
import { RefundReasonModal } from '../../components/creator/RefundReasonModal';
import {
  attachAnswers,
  countAttendees,
  getEventAnswers,
  getEventAttendees,
  getEventMoneySummary,
  getEventQuestions,
  isLiveSeat,
  sumRefundedCentsOnPaidOrders,
  type DoorAttendee,
} from '../../lib/ticketAttendees';
import { useCreatorPageScope } from '../../hooks/useCreatorPageScope';
import { useCreatorPageRead } from '../../hooks/useCreatorPageRead';
import { readPurchaseExtras } from '../../lib/purchaseExtras';
import type { CreatorPageScope } from '../../lib/creatorPageReview';
import { PurchaseExtras, PurchaseExtrasNotice } from '../../components/tickets/PurchaseExtras';
import { canReadCreatorTickets } from '../../lib/creatorTicketRead';
import { PageFrame, PageAction, pageStyles } from '../../components/creator/pages/PageFrame';
import { requestWithDeadline } from '../../lib/requestWithDeadline';
import { MoneySummaryCard } from '../../components/creator/MoneySummaryCard';

let nextReadVisit = 0;
async function boundedRead<T>(scope: CreatorPageScope, read: (owned: CreatorPageScope) => Promise<T>, signal?: AbortSignal): Promise<T> {
  let active = true;
  const owned = { userId: scope.userId, isCurrent: () => active && !signal?.aborted && scope.isCurrent() };
  try {
    if (!owned.isCurrent()) throw new Error('This visit has ended.');
    const result = await requestWithDeadline(read(owned), 12_000);
    if (!owned.isCurrent()) throw new Error('This visit has ended.');
    return result;
  } finally { active = false; }
}

type StatusFilter = 'all' | 'in' | 'notin' | 'refunded';

export default function AttendeesRoute() {
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { scope, account } = useCreatorPageScope(id ?? '');
  const accessRetryLock = useRef(false);
  const routeMounted = useRef(true);
  useEffect(() => { routeMounted.current = true; return () => { routeMounted.current = false; }; }, []);
  const visit = useMemo(() => ++nextReadVisit, [scope, id]);
  const loadAccess = useCallback((owned: CreatorPageScope) => boundedRead(owned, current => canReadCreatorTickets(id!, current)), [id]);
  const access = useCreatorPageRead(id ? scope : null, loadAccess);
  const retryAccess = () => {
    if (!routeMounted.current || accessRetryLock.current || !(scope?.isCurrent() ?? account?.isCurrent())) return;
    accessRetryLock.current = true;
    void (account?.error ? account.retry() : access.refresh()).catch(() => undefined).finally(() => { accessRetryLock.current = false; });
  };
  if (scope?.isCurrent() && access.data === true && !access.error) {
    return <AttendeesScreen key={visit} id={id!} scope={scope} visit={visit} />;
  }
  return <PageFrame title="Who's coming">
    {account?.isLoading || access.loading ? <ActivityIndicator accessibilityLabel="Checking event access" color={Colors.terracotta} /> : <>
      <Text style={[pageStyles.body, styles.accessCopy]}>{access.error || account?.error ? 'This event couldn’t be loaded.' : 'Attendee access isn’t available for this event and account.'}</Text>
      <PageAction compact title="Try again" onPress={retryAccess} />
    </>}
  </PageFrame>;
}

function ReadNotice({ label, retry, busy = false }: { label: string; retry(): void; busy?: boolean }) {
  const styles = useStyles();
  return <View style={styles.readNotice} accessibilityRole="alert">
    <Text style={styles.readNoticeText}>{label}</Text>
    <TouchableOpacity onPress={retry} disabled={busy} accessibilityState={{ busy, disabled: busy }} style={styles.readRetry} accessibilityRole="button" accessibilityLabel={`Retry: ${label}`}>
      <Text numberOfLines={1} style={styles.readRetryText}>{busy ? 'Retrying…' : 'Try again'}</Text>
    </TouchableOpacity>
  </View>;
}

function AttendeesScreen({ id, scope: incomingScope, visit }: { id: string; scope: CreatorPageScope; visit: number }) {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const scope = useMemo(() => ({ userId: incomingScope.userId, isCurrent: () => mounted.current && incomingScope.isCurrent() }), [incomingScope]);
  const retries = useRef(new Set<string>());
  const retry = (name: string, refetch: (options: { cancelRefetch: boolean }) => Promise<unknown>) => {
    if (!scope.isCurrent() || retries.current.has(name)) return;
    retries.current.add(name);
    void refetch({ cancelRefetch: false }).catch(() => undefined).finally(() => retries.current.delete(name));
  };
  const styles = useStyles();
  const queryClient = useQueryClient();
  const extrasScope = scope;
  const [query, setQuery] = useState('');
  const [showMoney, setShowMoney] = useState(false);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [tier, setTier] = useState<string | null>(null);
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const refundLock = useRef(false);
  const refundAttempt = useRef(0);
  const [refundProblem,setRefundProblem] = useState<string>();

  const { data: attendeeData, isLoading, isFetching: attendeesBusy, isError: attendeeError, refetch: retryAttendees } = useQuery({
    queryKey: ['event-attendees', id, scope.userId, visit],
    queryFn: ({ signal }) => boundedRead(scope, owned => getEventAttendees(id!, owned), signal),
    retry: false,
    enabled: !!id,
    staleTime: 10_000,
  });
  const attendees = attendeeData ?? [];
  const { data: money, isError: moneyError, isPending: moneyLoading, isFetching: moneyBusy, refetch: retryMoney } = useQuery({
    queryKey: ['event-money-summary', id, scope.userId, visit],
    queryFn: ({ signal }) => boundedRead(scope, owned => getEventMoneySummary(id!, owned), signal),
    retry: false,
    enabled: !!id,
    staleTime: 10_000,
  });
  // Safe default while loading and for anyone who isn't the exact organizer
  // identity or a granted delegate (Liz's item 14) the refund function
  // checks (e.g. a co_leader with no grant): no button.
  const { data: refundAccess, isError: refundAccessError, isFetching: refundAccessBusy, refetch: retryRefundAccess } = useQuery({
    queryKey: ['event-refund-access', id, scope.userId, visit],
    queryFn: ({ signal }) => boundedRead(scope, owned => getRefundAccess(id!, owned), signal),
    retry: false,
    enabled: !!id,
    staleTime: 60_000,
  });
  const canRefund = !attendeeError && !attendeesBusy && !refundAccessError && !refundAccessBusy && (refundAccess?.canRefund ?? false);
  const refundReady=useRef(false);
  refundReady.current=canRefund;

  // Screen 54 addendum: questionnaire answers, a separate read from
  // getEventAttendees above so screens that never show answers don't pay for
  // it (lib/ticketAttendees.ts). getEventAnswers only runs once there is both
  // an active question and a real order to scope it to.
  const { data: questionData, isError: questionError, isPending: questionsLoading, isFetching: questionsBusy, refetch: retryQuestions } = useQuery({
    queryKey: ['event-questions', id, scope.userId, visit],
    queryFn: ({ signal }) => boundedRead(scope, owned => getEventQuestions(id!, owned), signal),
    retry: false,
    enabled: !!id,
    staleTime: 30_000,
  });
  const questions = questionData ?? [];
  const orderIds = useMemo(() => Array.from(new Set(attendees.map((a) => a.orderId))), [attendees]);
  const orderIdsKey = orderIds.join(',');
  const readExtras = useCallback((scope: CreatorPageScope) => boundedRead(scope, owned => readPurchaseExtras(id!, orderIdsKey ? orderIdsKey.split(',') : [], owned, false)), [id, orderIdsKey]);
  const extrasRead = useCreatorPageRead(id && orderIds.length ? extrasScope : null, readExtras);
  const { data: answerData, isError: answerError, isFetching: answersBusy, refetch: retryAnswers } = useQuery({
    queryKey: ['event-answers', id, scope.userId, visit, orderIdsKey],
    queryFn: ({ signal }) => boundedRead(scope, owned => getEventAnswers(orderIds, owned), signal),
    retry: false,
    enabled: !!id && questions.length > 0 && orderIds.length > 0,
    staleTime: 10_000,
  });
  const answerRows = answerData ?? [];
  const needsAnswers = questions.length > 0 && orderIds.length > 0;
  const exportReady = attendeeData !== undefined && questionData !== undefined && (!needsAnswers || answerData !== undefined)
    && !attendeeError && !questionError && !answerError && !attendeesBusy && !questionsBusy && !answersBusy;
  const exportReadyRef = useRef(false);
  exportReadyRef.current = exportReady;
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleAnswers = (positionId: string) => {
    if (!scope.isCurrent()) return;
    hapticLight();
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(positionId)) next.delete(positionId);
      else next.add(positionId);
      return next;
    });
  };

  const counts = countAttendees(attendees);
  // Only refunds on still-'paid' orders: fully-refunded orders are already
  // excluded from gross/commission by getEventMoneySummary, so counting their
  // refunded_cents here double-subtracted them from net (see helper's doc).
  const refundedCents = useMemo(() => sumRefundedCentsOnPaidOrders(attendees), [attendees]);
  const tiers = useMemo(
    () => Array.from(new Set(attendees.map((a) => a.tierName).filter((t): t is string => !!t))),
    [attendees],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return attendees.filter((a) => {
      if (q && !a.buyerName.toLowerCase().includes(q) && !a.referenceCode.toLowerCase().includes(q)) return false;
      if (tier && a.tierName !== tier) return false;
      if (status === 'in' && !(isLiveSeat(a) && a.checkedIn)) return false;
      if (status === 'notin' && !(isLiveSeat(a) && !a.checkedIn)) return false;
      if (status === 'refunded' && !(a.refundedCents > 0 || a.voided)) return false;
      return true;
    });
  }, [attendees, query, status, tier]);

  // BR-1 attachment is pure/synchronous, so it's cheap to recompute on every
  // filter change; only the network read (answerRows) is cached/gated above.
  const filteredWithAnswers = useMemo(
    () => attachAnswers(filtered, questions, answerRows),
    [filtered, questions, answerRows],
  );

  // native's own share sheet (mail, files, Messages, etc), same real-export
  // pattern as payouts.tsx's handleExportPurchases -- BR-6: exports the
  // CURRENTLY FILTERED view, not the unfiltered attendees array.
  const handleExportAttendees = useCallback(async () => {
    if (!scope.isCurrent() || !exportReadyRef.current || filteredWithAnswers.length === 0) return;
    hapticLight();
    try {
      await Share.share({ message: attendeesToCsv(filteredWithAnswers, questions) });
    } catch {
      /* copy to the taste gate */
      if (!scope.isCurrent()) return;
      Alert.alert('that did not share', 'give it another try in a moment.');
    }
  }, [filteredWithAnswers, questions, scope]);

  const statusChips: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'everyone' },
    { key: 'notin', label: 'not in yet' },
    { key: 'in', label: 'checked in' },
    { key: 'refunded', label: 'refunded' },
  ];

  const seatLine = (a: DoorAttendee): string => {
    if (a.refundedCents > 0 || a.voided) return 'refunded';
    if (!isLiveSeat(a)) return a.orderStatus;
    return a.checkedIn ? 'checked in' : 'not in yet';
  };

  /**
   * Organizer refund (doc 108; web's AttendeeTable 67d5ee2 is the lockstep
   * reference): voluntary buyer_request only, per seat via 1-based
   * position_indexes or the whole remaining order. organizer_cancel is the
   * §4 cancellation slice and is deliberately NOT wired here. Amounts shown
   * come from the server preview (money is DB law), never client arithmetic.
   */
  type Review = {attendee:DoorAttendee;target:RefundTarget;preview:RefundPreview;attempt:number;scopeLabel:string};
  type Recovery = {review:Review;state:'unknown'|'refused'|'pending';message:string;originalTickets:Pick<DoorAttendee,'positionId'|'positionIndex'|'referenceCode'>[]};
  // Lock every seat of an order whose dispatch has no confirmed outcome.
  const recoveries=useRef(new Map<string,Recovery>());
  const [refundRecoveries,setRefundRecoveries]=useState<Recovery[]>([]);
  const retainRecovery=(orderId:string,recovery:Omit<Recovery,'originalTickets'>|null)=>{
    if(recovery){
      // A failed refresh can replace query data. Keep the first identities so
      // a later Check cannot accept those replacement rows as its baseline.
      const originalTickets=recoveries.current.get(orderId)?.originalTickets
        ??attendees.filter(row=>row.orderId===orderId).map(({positionId,positionIndex,referenceCode})=>({positionId,positionIndex,referenceCode}));
      recoveries.current.set(orderId,{...recovery,originalTickets});
    }else recoveries.current.delete(orderId);
    setRefundRecoveries([...recoveries.current.values()]);
  };
  const retainPendingReview=(review:Review)=>{
    const pending=(review.preview as RefundPreview & {pendingAttempt?:'unknown'|'confirmed'}).pendingAttempt;
    if(!pending)return false;
    retainRecovery(review.attendee.orderId,{review,state:pending==='confirmed'?'pending':'unknown',message:pending==='confirmed'?'The refund went through and is finishing up. Check status refreshes the tickets.':'The refund result isn’t confirmed. Check status refreshes the tickets.'});
    setReasonModal(null);
    return true;
  };
  const [reasonModal,setReasonModal]=useState<(Review & {amountLabel:string})|null>(null);
  const reasonOrder=useRef<string|null>(null);
  const reasonReview=useRef(0);
  const [reasonSubmitting,setReasonSubmitting]=useState(false);
  const currentAttempt=(attempt:number)=>scope.isCurrent()&&refundAttempt.current===attempt;
  const attemptScope=(attempt:number):CreatorPageScope=>({userId:scope.userId,isCurrent:()=>currentAttempt(attempt)});
  const cancelAttempt=(attempt:number)=>{if(currentAttempt(attempt)&&!refundLock.current){refundAttempt.current++;setReasonModal(null);setRefundProblem(undefined);}};

  const showReview=(review:Review,isDelegate:boolean)=>{
    if(!currentAttempt(review.attempt))return;
    if(isDelegate){reasonOrder.current=review.attendee.orderId;setReasonModal({...review,amountLabel:formatCents(review.preview.refundAmountCents)});return;}
    Alert.alert(`refund ${formatCents(review.preview.refundAmountCents)} to the buyer?`,review.scopeLabel+'.',[
      {text:'never mind',style:'cancel',onPress:()=>cancelAttempt(review.attempt)},
      {text:'yes, refund it',style:'destructive',onPress:()=>runRefund(review)},
    ]);
  };

  const readReview=(orderId:string,target:RefundTarget,attempt:number)=>boundedRead(attemptScope(attempt),async owned=>{
    const access=await getRefundAccess(id,owned);
    if(!owned.isCurrent())throw new Error('This review has ended.');
    if(!access.canRefund)throw new Error('Refund access changed.');
    const preview=await previewRefund(orderId,target,owned);
    if(!preview)throw new Error('Preview unavailable.');
    return {access,preview};
  });
  const chooseRefund=async(a:DoorAttendee,mode:'seat'|'order',selectionAttempt:number,recovery?:Recovery)=>{
    if(!currentAttempt(selectionAttempt)||refundLock.current)return;
    const retained=recoveries.current.get(a.orderId);
    if(retained&&(retained!==recovery||recovery?.state!=='refused'))return;
    if(recovery&&retained!==recovery)return;
    const attempt=++refundAttempt.current;
    refundLock.current=true;setRefundingId(a.positionId);setRefundProblem(undefined);
    const target:RefundTarget={kind:'buyer_request',positionIndexes:mode==='seat'?[a.positionIndex]:null};
    try {
      const {access,preview}=await readReview(a.orderId,target,attempt);
      if(!currentAttempt(attempt))return;
      if(retainPendingReview({attendee:a,target,preview,attempt,scopeLabel:mode==='seat'?`this seat only, for ${a.buyerName}`:`${a.buyerName}'s whole remaining purchase`}))return;
      if(!preview.allowed){Alert.alert('about that refund',"that refund isn't available for this purchase.");refundAttempt.current++;return;}
      // A refusal retry keeps its draft; a new explicit review starts empty.
      if(!recovery)reasonReview.current++;
      retainRecovery(a.orderId,null);
      showReview({attendee:a,target,preview,attempt,scopeLabel:mode==='seat'?`this seat only, for ${a.buyerName}`:`${a.buyerName}'s whole remaining purchase`},access.isDelegate);
    } catch {
      if(currentAttempt(attempt))Alert.alert('Refund preview unavailable','Couldn’t load the refund amount. Try again.');
    } finally {
      refundLock.current=false;
      if(scope.isCurrent())setRefundingId(null);
    }
  };

  const runRefund=async(review:Review,reason?:string):Promise<boolean>=>{
    const {attendee:a,target,attempt}=review;
    if(!currentAttempt(attempt)||refundLock.current||recoveries.current.has(a.orderId))return false;
    const activeAttempt=++refundAttempt.current;
    refundLock.current=true;setRefundProblem(undefined);setRefundingId(a.positionId);
    let dispatched=false;
    try {
      const {access,preview:fresh}=await readReview(a.orderId,target,activeAttempt);
      if(!currentAttempt(activeAttempt))return false;
      if(retainPendingReview({...review,preview:fresh,attempt:activeAttempt}))return false;
      if(!fresh.allowed){
        const message='This purchase can no longer be refunded here. Refresh its status.';
        setReasonModal(null);setRefundProblem(message);Alert.alert('Refund unavailable',message);return false;
      }
      if(fresh.refundAmountCents!==review.preview.refundAmountCents||fresh.positionCount!==review.preview.positionCount||(access.isDelegate&&!reason?.trim())){
        setRefundProblem('The refund details changed. Review them before confirming again.');
        showReview({...review,preview:fresh,attempt:activeAttempt},access.isDelegate);
        return false;
      }
      dispatched=true;
      retainRecovery(a.orderId,{review,state:'unknown',message:'The refund result isn’t confirmed. Check status refreshes the tickets.'});
      const outcome=await boundedRead(attemptScope(activeAttempt),owned=>executeRefund(a.orderId,{...target,reviewedAmountCents:fresh.refundAmountCents,reviewedPositionCount:fresh.positionCount,...(reason?{reason}: {})},owned));
      if(!currentAttempt(activeAttempt))return false;
      if(outcome.ok){
        retainRecovery(a.orderId,outcome.pending?{review,state:'pending',message:'The refund went through and is finishing up. Check status refreshes the tickets.'}:null);
        refundAttempt.current++;
        void queryClient.invalidateQueries({queryKey:['event-attendees',id,scope.userId]});
        void queryClient.invalidateQueries({queryKey:['event-money-summary',id,scope.userId]});
        Alert.alert('refund sent',outcome.pending?'the refund went through and is finishing up. this list catches up in a minute.':`refunded ${formatCents(outcome.refundAmountCents)} to the buyer.`);
        return true;
      }
      if(outcome.notStarted===true)retainRecovery(a.orderId,{review,state:'refused',message:'No refund was started. Review the latest refund details before confirming again.'});
      setReasonModal(null);setRefundProblem(outcome.message);return false;
    } catch {
      if(currentAttempt(activeAttempt)){
        setReasonModal(null);
        if(!dispatched)Alert.alert('Refund preview unavailable','Couldn’t load the refund amount. Review it again before confirming.');
      }
      return false;
    } finally {refundLock.current=false;if(scope.isCurrent())setRefundingId(null);}
  };

  const checkRefundStatus=async(recovery:Recovery)=>{
    const a=recovery.review.attendee;
    if(!scope.isCurrent()||refundLock.current||recoveries.current.get(a.orderId)!==recovery)return;
    const originalRows=recovery.originalTickets;
    const attempt=++refundAttempt.current;
    refundLock.current=true;setRefundingId(a.positionId);
    let statusChecked=false;
    try{
      const {status,refreshedRows}=await boundedRead(attemptScope(attempt),async visit=>{
        const receipt=await checkRefundAttempt(a.orderId,visit);
        if(!visit.isCurrent()||(receipt.isCurrent&&!receipt.isCurrent()))throw new Error('This status check has ended.');
        statusChecked=true;
        const [tickets]=await Promise.all([
          retryAttendees({cancelRefetch:false,throwOnError:true}),
          retryMoney({cancelRefetch:false,throwOnError:true}),
          retryRefundAccess({cancelRefetch:false,throwOnError:true}),
        ]);
        return {status:receipt,refreshedRows:(tickets.data??[]).filter(row=>row.orderId===a.orderId)};
      });
      if(!currentAttempt(attempt)||recoveries.current.get(a.orderId)!==recovery||(status.isCurrent&&!status.isCurrent()))return;
      const sameOriginalTickets=originalRows.length>0&&refreshedRows.length===originalRows.length
        &&originalRows.every(row=>refreshedRows.some(fresh=>fresh.positionId===row.positionId
          &&fresh.positionIndex===row.positionIndex&&fresh.referenceCode===row.referenceCode));
      if(status.state==='complete'){
        const fullyRefunded=sameOriginalTickets&&refreshedRows.every(row=>row.orderStatus==='refunded'&&(row.voided||row.refundedCents>0));
        const target=status.target;
        const indexes=target?target.positionIndexes:(recovery.review.target.positionIndexes??null);
        const reviewedCount=target?target.reviewedPositionCount:recovery.review.preview.positionCount;
        // Another view may have saved request B while this screen remembers A.
        // Only B's exact saved target can reconcile B's completion.
        if(!sameOriginalTickets||(target&&!status.requestId)
          ||(reviewedCount>0?status.positionsVoided!==reviewedCount:!fullyRefunded)
          ||(indexes===null?!fullyRefunded:indexes.some(index=>!refreshedRows.some(row=>row.positionIndex===index&&(row.voided||row.refundedCents>0))))){
          retainRecovery(a.orderId,{...recovery,message:'The saved refund result doesn’t match the tickets yet. Check status to refresh them.'});
          return;
        }
        retainRecovery(a.orderId,null);
      }else if(status.state==='not-started'){
        const indexes=status.target?status.target.positionIndexes:(recovery.review.target.positionIndexes??null);
        const eligible=refreshedRows.filter(row=>isLiveSeat(row)&&row.refundedCents===0);
        const targets=indexes===null?eligible:eligible.filter(row=>indexes.includes(row.positionIndex));
        // A fresh review must still describe the exact original tickets. A
        // multi-ticket selection cannot become a wider whole-purchase refund.
        if(!sameOriginalTickets||(status.target&&!status.requestId)||targets.length===0
          ||(indexes!==null&&(targets.length!==indexes.length||(indexes.length>1&&targets.length!==eligible.length)))){
          retainRecovery(a.orderId,{...recovery,state:'unknown',message:'No refund was started. These tickets could not be verified for a new review. Check status to refresh them.'});
          return;
        }
        const positionIndexes=indexes!==null&&indexes.length===1?[...indexes]:null;
        const oldIndexes=recovery.review.target.positionIndexes;
        if((oldIndexes===null)!==(positionIndexes===null)||oldIndexes?.join(',')!==positionIndexes?.join(',')
          ||recovery.review.attendee.positionId!==targets[0].positionId)reasonReview.current++;
        const review={...recovery.review,attendee:targets[0],target:{...recovery.review.target,positionIndexes},
          scopeLabel:positionIndexes?`this seat only, for ${targets[0].buyerName}`:`${targets[0].buyerName}'s whole remaining purchase`};
        retainRecovery(a.orderId,{...recovery,review,state:'refused',message:'No refund was started. Review the latest refund details before confirming again.'});
      }else if(status.state==='confirmed')retainRecovery(a.orderId,{...recovery,state:'pending',message:'The refund went through and is finishing up. Check status refreshes the tickets.'});
      else retainRecovery(a.orderId,{...recovery,message:recovery.state==='pending'?'The refund went through and is finishing up. Check status refreshes the tickets.':'The refund result isn’t confirmed. Check status refreshes the tickets.'});
    }catch{
      if(currentAttempt(attempt))retainRecovery(a.orderId,{...recovery,message:(recovery.state==='pending'?'The refund went through and is finishing up.':'The refund result isn’t confirmed.')+(statusChecked?' Tickets couldn’t be refreshed.':' Refund status couldn’t be checked.')+' Check status checks the saved request and refreshes the tickets.'});
    }finally{refundLock.current=false;if(scope.isCurrent())setRefundingId(null);}
  };

  const submitReasonRefund=async(reason:string):Promise<boolean>=>{
    if(!reasonModal||refundLock.current||!currentAttempt(reasonModal.attempt))return false;
    setReasonSubmitting(true);
    const succeeded=await runRefund(reasonModal,reason);
    if(scope.isCurrent()){setReasonSubmitting(false);if(succeeded)setReasonModal(null);}
    return succeeded;
  };

  const startRefund=(a:DoorAttendee)=>{
    if(!scope.isCurrent()||refundLock.current||!refundReady.current||recoveries.current.has(a.orderId))return;
    const attempt=++refundAttempt.current;
    hapticLight();
    Alert.alert(`refund ${a.buyerName}?`,'the ticket price goes back to their card.',[
      {text:'never mind',style:'cancel',onPress:()=>cancelAttempt(attempt)},
      {text:'this seat',onPress:()=>chooseRefund(a,'seat',attempt)},
      {text:'whole purchase',onPress:()=>chooseRefund(a,'order',attempt)},
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => { if (scope.isCurrent()) router.back(); }} style={styles.headerControl} accessibilityRole="button" accessibilityLabel="back">
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2} />
        </TouchableOpacity>
        {/* copy to the taste gate */}
        <Text style={styles.headerTitle}>who's coming</Text>
        <TouchableOpacity onPress={() => { if (!scope.isCurrent()) return; hapticLight(); router.push(`/creator/check-in?id=${id}` as never); }} style={styles.headerControl} accessibilityRole="button" accessibilityLabel="open check-in">
          <ScanLine size={20} color={Colors.terracotta} strokeWidth={2} />
        </TouchableOpacity>
      </View>

      {/* counts, each with its own text label (§8) */}
      <View style={styles.countsRow}>
        <View style={styles.countCell}>
          <Text style={styles.countN}>{attendeeData ? counts.sold : '—'}</Text>
          <Text style={styles.countL}>sold</Text>
        </View>
        <View style={styles.countCell}>
          <Text style={styles.countN}>{attendeeData ? counts.checkedIn : '—'}</Text>
          <Text style={styles.countL}>checked in</Text>
        </View>
        <View style={styles.countCell}>
          <Text style={styles.countN}>{attendeeData ? counts.refunded : '—'}</Text>
          <Text style={styles.countL}>refunded</Text>
        </View>
      </View>

      {attendeeData !== undefined && (attendeesBusy || attendeeError) && <Text style={styles.readStatus}>Counts from the last successful load.</Text>}
      {refundRecoveries.map(recovery=><View key={recovery.review.attendee.orderId} style={styles.refundNotice} accessibilityRole="alert">
        <Text style={styles.refundNoticeText}>Purchase refund status · {recovery.review.attendee.buyerName}: {recovery.message}</Text>
        <PageAction compact singleLine title={refundingId===recovery.review.attendee.positionId?'Checking…':recovery.state==='refused'?'Review refund':'Check status'} disabled={refundingId!==null} onPress={()=>recovery.state==='refused'?chooseRefund(recovery.review.attendee,recovery.review.target.positionIndexes?'seat':'order',refundAttempt.current,recovery):checkRefundStatus(recovery)}/>
      </View>)}
      {refundAccessError && <ReadNotice label="Refund access couldn’t be checked." busy={refundAccessBusy} retry={() => retry('refund-access', retryRefundAccess)} />}
      {moneyLoading && <Text style={styles.readStatus}>Checking sales…</Text>}
      {attendeeError && <ReadNotice label="Attendees couldn’t be refreshed." busy={attendeesBusy} retry={() => retry('attendees', retryAttendees)} />}
      {moneyError && <ReadNotice label="Sales couldn’t be refreshed." busy={moneyBusy} retry={() => retry('money', retryMoney)} />}

      {attendeeData && <>
      <TextInput
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        placeholder="search a name or code"
        placeholderTextColor={Colors.textLight}
        autoCorrect={false}
        accessibilityLabel="search attendees by name or reference code"
      />

      <ScrollView horizontal style={styles.filterStrip} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
        {statusChips.map((c) => (
          <TouchableOpacity
            key={c.key}
            style={[styles.chip, status === c.key && styles.chipOn]}
            onPress={() => { if (!scope.isCurrent()) return; hapticLight(); setStatus(c.key); }}
            accessibilityRole="button"
            accessibilityState={{ selected: status === c.key }}
          >
            <Text numberOfLines={1} style={[styles.chipText, status === c.key && styles.chipTextOn]}>{c.label}</Text>
          </TouchableOpacity>
        ))}
        {tiers.map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.chip, tier === t && styles.chipOn]}
            onPress={() => { if (!scope.isCurrent()) return; hapticLight(); setTier(tier === t ? null : t); }}
            accessibilityRole="button"
            accessibilityState={{ selected: tier === t }}
          >
            <Text numberOfLines={1} style={[styles.chipText, tier === t && styles.chipTextOn]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      </>}

      {/* Screen 54 sub-destination: the event-wide questionnaire reader
          (per-question filters, aggregate counts for choice questions) that
          this screen's inline expand-per-attendee view doesn't cover. Only
          worth showing when the event actually has active questions. */}
      {questionsLoading && <Text style={styles.readStatus}>Checking questionnaire…</Text>}
      {needsAnswers && answerData === undefined && answersBusy && <Text style={styles.readStatus}>Loading answers…</Text>}
      {questionError && <ReadNotice label="Questions couldn’t be loaded." busy={questionsBusy} retry={() => retry('questions', retryQuestions)} />}
      {answerError && <ReadNotice label="Answers couldn’t be loaded." busy={answersBusy} retry={() => retry('answers', retryAnswers)} />}
      {questions.length > 0 && (
        <TouchableOpacity
          style={styles.responsesLinkRow}
          onPress={() => { if (!scope.isCurrent()) return; hapticLight(); router.push(`/creator/questionnaire-responses?id=${id}` as never); }}
          accessibilityRole="button"
          accessibilityLabel="open questionnaire responses"
        >
          {/* copy to the taste gate */}
          <Text style={styles.responsesLinkText}>questionnaire responses</Text>
          <ChevronRight size={16} color={Colors.terracotta} strokeWidth={2} />
        </TouchableOpacity>
      )}

      {filtered.length > 0 && exportReady && (
        <View style={styles.exportRow}>
          <TouchableOpacity onPress={handleExportAttendees} style={styles.readRetry} accessibilityRole="button" accessibilityLabel="export attendees">
            {/* LIZ COPY */}
            <Text style={styles.exportLink}>export</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.extrasNotice}><PurchaseExtrasNotice error={extrasRead.error} loading={extrasRead.loading && !extrasRead.data}
        onRetry={() => retry('extras', extrasRead.refresh)} /></View>
      {isLoading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={Colors.terracotta} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {money && attendeeData && <>
            <TouchableOpacity style={styles.salesDisclosure} onPress={() => { if (scope.isCurrent()) setShowMoney(value => !value); }} accessibilityRole="button" accessibilityLabel="Sales summary" accessibilityState={{ expanded: showMoney }}>
              <Text style={styles.readRetryText}>Sales summary</Text>
              {showMoney ? <ChevronUp size={16} color={Colors.terracotta} /> : <ChevronDown size={16} color={Colors.terracotta} />}
            </TouchableOpacity>
            {showMoney && <MoneySummaryCard inset={false} money={money} ticketsSold={counts.sold} refundedCents={refundedCents} />}
          </>}
          {filteredWithAnswers.length === 0 ? (
            /* copy to the taste gate (empty-state) */
            attendeeError ? null : <Text style={styles.empty}>{query || tier || status !== 'all' ? 'No attendees match these filters.' : 'Share your event to welcome your first guests.'}</Text>
          ) : (
            filteredWithAnswers.map((a, index) => {
              const line = seatLine(a);
              const isIn = isLiveSeat(a) && a.checkedIn;
              const isRefunded = a.refundedCents > 0 || a.voided;
              const hasAnswers = questions.length > 0 && answerData !== undefined;
              const isExpanded = expandedIds.has(a.positionId);
              return (
                <View key={a.positionId} style={styles.rowGroup}>
                  <View style={styles.row}>
                    {hasAnswers && (
                      <TouchableOpacity
                        onPress={() => toggleAnswers(a.positionId)}
                        hitSlop={12}
                        accessibilityRole="button"
                        accessibilityLabel={isExpanded ? `hide answers for ${a.buyerName}` : `show answers for ${a.buyerName}`}
                        accessibilityState={{ expanded: isExpanded }}
                      >
                        {isExpanded ? (
                          <ChevronUp size={16} color={Colors.textMedium} strokeWidth={2} />
                        ) : (
                          <ChevronDown size={16} color={Colors.textMedium} strokeWidth={2} />
                        )}
                      </TouchableOpacity>
                    )}
                    <View style={styles.rowBody}>
                      <Text style={styles.rowName}>{a.buyerName}</Text>
                      <Text style={styles.rowMeta}>
                        {a.referenceCode}{a.tierName ? ` · ${a.tierName}` : ''}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.rowFooter}>
                    {/* status: icon + text, never colour alone (§8) */}
                    <View style={styles.statusWrap}>
                      {isIn && <Check size={15} color={Colors.brandDeep} strokeWidth={2.5} />}
                      {isRefunded && <Ban size={14} color={Colors.textMedium} strokeWidth={2} />}
                      <Text style={[styles.statusText, isIn && styles.statusIn, isRefunded && styles.statusRefunded]}>
                        {line}
                      </Text>
                    </View>
                    {/* refund lives on live seats only, for the real organizer only; the fn re-checks server-side */}
                    {isLiveSeat(a) && canRefund && !recoveries.current.has(a.orderId) && (
                      <TouchableOpacity
                        style={styles.refundPill}
                        onPress={() => startRefund(a)}
                        disabled={refundingId != null}
                        accessibilityRole="button"
                        accessibilityLabel={`refund ${a.buyerName}`}
                      >
                        {refundingId === a.positionId ? (
                          <ActivityIndicator size="small" color={Colors.darkWarm} />
                        ) : (
                          /* copy to the taste gate */
                          <Text style={styles.refundPillText}>refund</Text>
                        )}
                      </TouchableOpacity>
                    )}
                  </View>
                  {filteredWithAnswers.findIndex(seat => seat.orderId === a.orderId) === index && !!extrasRead.data?.get(a.orderId)?.length && <View style={styles.extrasPanel}>
                    <PurchaseExtras shared extras={extrasRead.data.get(a.orderId)!} />
                  </View>}
                  {isExpanded && hasAnswers && (
                    <View style={styles.answersPanel}>
                      {questions.map((q) => (
                        <View key={q.id} style={styles.answerItem}>
                          <Text style={styles.answerPrompt}>
                            {q.prompt}{q.scope === 'per_order' ? ' · once per purchase' : ''}
                          </Text>
                          <Text style={styles.answerValue}>{a.answers[q.id] || '—'}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      <RefundReasonModal
        key={`${reasonOrder.current ?? 'refund-reason'}:${reasonReview.current}`}
        visible={!!reasonModal}
        amountLabel={reasonModal?.amountLabel ?? ''}
        scopeLabel={reasonModal?.scopeLabel ?? ''}
        submitting={reasonSubmitting}
        problem={refundProblem}
        onCancel={() => {if(reasonModal)cancelAttempt(reasonModal.attempt);}}
        onSubmit={submitReasonRefund}
      />
    </SafeAreaView>
  );
}

function createStyles(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  refundNotice: { marginHorizontal: EventSpacing.md, marginBottom: EventSpacing.sm, padding: EventSpacing.sm, borderWidth: 1, borderColor: CreatorSurfaceColors.goldEdge, borderRadius: 14, backgroundColor: Colors.white, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: EventSpacing.sm },
  refundNoticeText: { flexBasis: 180, flexGrow: 1, flexShrink: 1, fontFamily: fonts.regular, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  readStatus: { marginHorizontal: EventSpacing.md, marginBottom: 6, fontFamily: fonts.regular, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  salesDisclosure: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 },
  readNotice: { marginHorizontal: EventSpacing.md, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 8 },
  readNoticeText: { flex: 1, fontFamily: fonts.regular, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  readRetry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  readRetryText: { fontFamily: fonts.semibold, fontSize: FontSizes.bodySM, color: Colors.terracotta },

  extrasNotice: {paddingHorizontal:20},
  extrasPanel: {paddingHorizontal:14,paddingBottom:12},
  accessCopy: {fontFamily:fonts.regular,fontSize:FontSizes.bodyMD},
  headerControl: {minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center'},
  container: { flex: 1, backgroundColor: Colors.parchment },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, gap: 4 },
  headerTitle: { flex: 1, fontFamily: fonts.semibold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  countsRow: { flexDirection: 'row', marginHorizontal: 20, marginBottom: 16, paddingVertical: 8, backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, borderTopColor: Colors.gold, gap: EventSpacing.sm },
  countCell: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  countN: { fontFamily: fonts.display, fontSize: FontSizes.displayMD, color: Colors.asphalt },
  countL: { fontFamily: fonts.medium, fontSize: FontSizes.caption, color: Colors.textMedium },
  search: {
    marginHorizontal: 20, marginBottom: EventSpacing.sm,
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 14, paddingVertical: 11,
    fontFamily: fonts.regular, fontSize: FontSizes.bodyMD, color: Colors.asphalt,
  },
  filterStrip: { flexGrow: 0, flexShrink: 0 },
  chipsRow: { alignItems: 'center', paddingHorizontal: 20, gap: 8, paddingBottom: EventSpacing.sm },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white, paddingHorizontal: 14, paddingVertical: 8, minHeight: 44, justifyContent: 'center' },
  chipOn: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  chipText: { fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: Colors.darkWarm },
  chipTextOn: { color: Colors.white },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: 20, paddingBottom: 40, gap: 8 },
  empty: { fontFamily: fonts.regular, fontSize: FontSizes.bodyMD, color: Colors.textMedium, textAlign: 'center', marginTop: EventSpacing.xl },
  exportRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 20, paddingBottom: EventSpacing.sm },
  exportLink: { fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  responsesLinkRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: 20, marginBottom: EventSpacing.sm,
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 14, minHeight: 44,
  },
  responsesLinkText: { fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  rowGroup: {
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: Colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 0, paddingTop: 14, paddingBottom: 4, minHeight: 44,
  },
  rowBody: { flex: 1, minWidth: 0, gap: 4 },
  rowFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, minHeight: 44, paddingBottom: 8 },
  answersPanel: {
    borderTopWidth: 1, borderTopColor: Colors.border,
    paddingHorizontal: 14, paddingVertical: 12, gap: 10,
  },
  answerItem: { gap: 2 },
  answerPrompt: {
    fontFamily: fonts.semibold, fontSize: FontSizes.caption, color: Colors.textMedium, letterSpacing: 0.3,
  },
  answerValue: { fontFamily: fonts.regular, fontSize: FontSizes.bodySM, color: Colors.asphalt },
  rowName: { fontFamily: fonts.medium, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  rowMeta: { fontFamily: fonts.regular, fontSize: FontSizes.bodySM, color: Colors.textMedium, letterSpacing: 0.3 },
  statusWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusText: { flexShrink: 1, fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  statusIn: { color: Colors.brandDeep },
  statusRefunded: { color: Colors.textMedium },
  refundPill: {
    // §8: real 44pt controls, no undersized tap targets
    minHeight: 44, minWidth: 64,
    paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center',
  },
  refundPillText: { fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: Colors.darkWarm },
}); }
function useStyles() { const {fonts}=useAfterglowFonts(true, 'creator'); return useMemo(()=>createStyles(fonts),[fonts]); }
