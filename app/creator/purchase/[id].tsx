import {useAfterglowFonts} from '../../../hooks/useAfterglowFonts';
/**
 * Purchase detail (Build 35 Screen 45): the per-purchase drill-down the
 * matrix names as the real remaining gap once Screens 10/44 exist -- both of
 * those already leave their purchase rows tappable/inert pointing here (see
 * app/creator/payouts.tsx and app/creator/ticket-sales.tsx's own headers).
 * Route: creator/payouts + creator/ticket-sales -> select purchase.
 *
 * Reuses existing, already-shipped reads/writes only -- no new table, no new
 * RPC, no new edge-function call:
 *   - order-level facts: getPurchaseDetail (lib/ticketing.ts)
 *   - seat-level facts: getEventAttendees, filtered to this order (the SAME
 *     query the Attendees screen/check-in screen already run and cache
 *     under ['event-attendees', eventId, scope.userId] -- this screen invalidates that
 *     exact key on refund so Attendees never goes stale behind it)
 *   - answers: getEventQuestions/getEventAnswers/attachAnswers (Screen 54's
 *     own reader), scoped to just this order's rows
 *   - refund: previewRefund/executeRefund/getRefundAccess, the
 *     exact functions attendees.tsx already calls -- this screen does not
 *     touch the ticket-refund edge function or refund_authority in any way.
 *
 * Consequence disclosure (the named gap: "cannot sit behind generic 'are you
 * sure' copy"): every fact stated below is one this codebase already proves
 * elsewhere, not invented for this screen -- the amount and seat count come
 * from the server's own previewRefund answer (never client math), the
 * processing-fee line is REFUND_DISCLOSURE (Liz-ruled copy, verbatim,
 * already shown to buyers), and "this ticket can no longer check in" mirrors
 * check-in.tsx's own outcomeToVerdict, which already renders a refunded/
 * voided seat as a hard fail at the door.
 *
 * Audit trail -- NOT built here, flagged rather than faked: ticket_orders
 * carries no refunded_at/refunded_by column and there is no ticket_orders
 * change-log table anywhere in this repo's tracked migrations (grepped
 * clean), so there is nothing truthful to show beyond "refunded_cents is
 * currently > 0". A real action-level trail (who refunded how much, when)
 * needs its own additive migration -- event-money.tsx's own header already
 * names this as separate, unbuilt scope. Writing that migration blind, with
 * no live Supabase connection this session to confirm ticket_orders' full
 * column set, any existing trigger, or grants on a new table, is exactly the
 * unverified-schema-change shape this project's Release Discipline rule
 * exists to prevent (the 2026-08-31 OTP regression). Left for a session with
 * real DB access. What IS shown below is every real, already-tracked fact:
 * purchase time and each seat's own check-in time.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Clock, TriangleAlert } from 'lucide-react-native';
import Colors, { AfterglowColors as C, CreatorSurfaceColors } from '../../../constants/Colors';
import { LinearGradient } from 'expo-linear-gradient';
import ProfileButton from '../../../components/ProfileButton';
import { CreatorActionFill } from '../../../components/creator/CreatorActionFill';
import { requestWithDeadline } from '../../../lib/requestWithDeadline';
import { type AfterglowFontFamilies, FontSizes } from '../../../constants/Typography';
import { EventAction } from '../../../constants/EventDesign';
import { hapticLight } from '../../../lib/haptics';
import { formatTimestampLA } from '../../../lib/laDate';
import {
  executeRefund,
  checkRefundAttempt,
  formatCents,
  getPurchaseDetail,
  getRefundAccess,
  previewRefund,
  purchaseStatusLabel,
  REFUND_DISCLOSURE,
  type RefundTarget,
  type RefundPreview,
  type OrganizationPurchase,
} from '../../../lib/ticketing';
import { RefundReasonModal } from '../../../components/creator/RefundReasonModal';
import {
  attachAnswers,
  getEventAnswers,
  getEventAttendees,
  getEventQuestions,
  isLiveSeat,
  type DoorAttendee,
} from '../../../lib/ticketAttendees';
import { BrandedAlert, type BrandedAlertButton } from '../../../components/BrandedAlert';

import {useCreatorPageScope} from '../../../hooks/useCreatorPageScope';
import {useCreatorPageRead} from '../../../hooks/useCreatorPageRead';
import {canReadCreatorTickets} from '../../../lib/creatorTicketRead';
import type {CreatorPageScope} from '../../../lib/creatorPageReview';
import {PageFrame,PageAction,pageStyles} from '../../../components/creator/pages/PageFrame';

let nextPurchaseVisit = 0;
class PurchaseAccessUnavailable extends Error {}
async function boundedRead<T>(scope: CreatorPageScope, read: (owned: CreatorPageScope) => Promise<T>, signal?: AbortSignal): Promise<T> {
  let reading = true;
  const owned = { userId: scope.userId, isCurrent: () => reading && !signal?.aborted && scope.isCurrent() };
  try {
    if (!owned.isCurrent()) throw new Error('This visit has ended.');
    const result = await requestWithDeadline(read(owned), 12_000);
    if (!owned.isCurrent()) throw new Error('This visit has ended.');
    return result;
  } finally { reading = false; }
}

export default function PurchaseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const {scope,account}=useCreatorPageScope(id??'');
  const visit=useMemo(()=>++nextPurchaseVisit,[scope,id]);
  const mounted=useRef(true),accessRetryLock=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const read=useCallback((scope:CreatorPageScope)=>boundedRead(scope,async owned=>{
    const purchase=await getPurchaseDetail(id!,owned);
    if(!purchase)return null;
    if(!await canReadCreatorTickets(purchase.eventId,owned))throw new Error('Purchase access unavailable.');
    return purchase;
  }),[id]);
  const result=useCreatorPageRead(id?scope:null,read);
  const retryAccess=()=>{
    if(!mounted.current||accessRetryLock.current||!(scope?.isCurrent()??account?.isCurrent()))return;
    accessRetryLock.current=true;
    void(account?.error?account.retry():result.refresh()).catch(()=>undefined).finally(()=>{accessRetryLock.current=false;});
  };
  if(scope?.isCurrent()&&result.data&&!result.error)return <PurchaseDetailContent key={visit} id={id!} scope={scope} visit={visit} initialPurchase={result.data}/>;
  return <PageFrame title="Purchase details">
    {account?.isLoading||result.loading?<ActivityIndicator accessibilityLabel="Loading purchase" color={Colors.terracotta}/>:<>
      <Text style={pageStyles.body}>{result.error||account?.error?'This purchase couldn’t be loaded.':'This purchase isn’t available for this account.'}</Text>
      <PageAction title="Try again" compact singleLine onPress={retryAccess}/>
    </>}
  </PageFrame>;
}
function PurchaseDetailContent({id,scope:incomingScope,initialPurchase,visit}:{id:string;scope:CreatorPageScope;initialPurchase:OrganizationPurchase;visit:number}) {
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const scope=useMemo(()=>({userId:incomingScope.userId,isCurrent:()=>mounted.current&&incomingScope.isCurrent()}),[incomingScope]);
  const {fonts}=useAfterglowFonts(true, 'creator');
  const styles=useMemo(()=>createStyles(fonts),[fonts]);
  const queryClient = useQueryClient();
  const [refunding, setRefunding] = useState(false);
  const refundLock=useRef(false),refundAttempt=useRef(0);
  const [refundProblem,setRefundProblem]=useState<string>();
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);

  const { data: purchase, isFetching:purchaseBusy, isError:purchaseError, error:purchaseFailure, refetch:retryPurchase } = useQuery({
    queryKey: ['purchase-detail', id, scope.userId, visit],
    queryFn: ({signal}) => boundedRead(scope,async owned=>{
      const latest=await getPurchaseDetail(id!,owned);
      if(!latest||latest.eventId!==initialPurchase.eventId||!await canReadCreatorTickets(latest.eventId,owned))throw new PurchaseAccessUnavailable('Purchase access is no longer available.');
      return latest;
    },signal),
    retry:false,
    enabled: !!id,
    staleTime: 10_000, initialData:initialPurchase,
  });
  const eventId = purchase?.eventId ?? null;
  const accessDenied=purchaseFailure instanceof PurchaseAccessUnavailable;

  const { data: attendeeData, isPending:attendeesLoading, isFetching:attendeesBusy, isError:attendeeError, refetch:retryAttendees } = useQuery({
    queryKey: ['event-attendees', eventId, scope.userId, visit],
    queryFn: ({signal}) => boundedRead(scope,owned=>getEventAttendees(eventId!,owned),signal),
    retry:false,
    enabled: !!eventId&&!accessDenied,
    staleTime: 10_000,
  });
  const attendees=attendeeData??[];
  const seats = useMemo(() => attendees.filter((a) => a.orderId === id), [attendees, id]);

  const { data: questionData, isPending:questionsLoading, isFetching:questionsBusy, isError:questionError, refetch:retryQuestions } = useQuery({
    queryKey: ['event-questions', eventId, scope.userId, visit],
    queryFn: ({signal}) => boundedRead(scope,owned=>getEventQuestions(eventId!,owned),signal),
    retry:false,
    enabled: !!eventId&&!accessDenied,
    staleTime: 30_000,
  });
  const questions=questionData??[];
  const { data: answerData, isFetching:answersBusy, isError:answerError, refetch:retryAnswers } = useQuery({
    queryKey: ['event-answers', eventId, id, scope.userId, visit],
    queryFn: ({signal}) => boundedRead(scope,owned=>getEventAnswers([id!],owned),signal),
    retry:false,
    enabled: !!eventId&&!accessDenied && !!id && questions.length > 0,
    staleTime: 10_000,
  });
  const answerRows=answerData??[];
  const seatsWithAnswers = useMemo(() => attachAnswers(seats, questions, answerRows), [seats, questions, answerRows]);

  const { data: refundAccess, isFetching:refundAccessBusy, isError:refundAccessError, refetch:retryRefundAccess } = useQuery({
    queryKey: ['event-refund-access', eventId, scope.userId, visit],
    queryFn: ({signal}) => boundedRead(scope,owned=>getRefundAccess(eventId!,owned),signal),
    retry:false,
    enabled: !!eventId&&!accessDenied,
    staleTime: 60_000,
  });
  const canRefund = !purchaseError&&!purchaseBusy&&attendeeData!==undefined&&!attendeesBusy&&!attendeeError&&!refundAccessError&&!refundAccessBusy&&(refundAccess?.canRefund ?? false);

  const actionReady=useRef(false);
  actionReady.current=canRefund;
  const retryLock=useRef(false);
  const [retrying,setRetrying]=useState(false);
  const readsBusy=purchaseBusy||attendeesBusy||questionsBusy||answersBusy||refundAccessBusy;
  const failures=[purchaseError&&'Purchase details couldn’t be refreshed.',attendeeError&&'Tickets couldn’t be refreshed.',questionError&&'Questions couldn’t be loaded.',answerError&&'Answers couldn’t be loaded.',refundAccessError&&'Refund access couldn’t be checked.'].filter(Boolean);
  const retryReads=()=>{
    if(!scope.isCurrent()||retryLock.current||readsBusy)return;
    retryLock.current=true;setRetrying(true);
    const attempts=[];
    if(purchaseError)attempts.push(retryPurchase({cancelRefetch:false}));
    if(!accessDenied){
      if(attendeeError)attempts.push(retryAttendees({cancelRefetch:false}));
      if(questionError)attempts.push(retryQuestions({cancelRefetch:false}));
      if(answerError)attempts.push(retryAnswers({cancelRefetch:false}));
      if(refundAccessError)attempts.push(retryRefundAccess({cancelRefetch:false}));
    }
    void Promise.allSettled(attempts).finally(()=>{retryLock.current=false;if(scope.isCurrent())setRetrying(false);});
  };

  const invalidateAfterRefund = () => {
    queryClient.invalidateQueries({ queryKey: ['purchase-detail', id, scope.userId] });
    if (eventId) {
      queryClient.invalidateQueries({ queryKey: ['event-attendees', eventId, scope.userId] });
      queryClient.invalidateQueries({ queryKey: ['event-money-summary', eventId, scope.userId] });
    }
    queryClient.invalidateQueries({ queryKey: ['ledger-purchases'] });
    queryClient.invalidateQueries({ queryKey: ['ledger-reconciliation'] });
  };

  type Review={positionIndexes:number[]|null;scopeLabel:string;preview:RefundPreview;attempt:number};
  type Recovery={review:Review;state:'unknown'|'refused'|'pending';message:string;originalTickets:Pick<DoorAttendee,'positionId'|'positionIndex'|'referenceCode'>[]};
  // A paid status or an eligible preview is not a receipt for an earlier dispatch.
  const recoveryRef=useRef<Recovery|null>(null);
  const [refundRecovery,setRefundRecovery]=useState<Recovery|null>(null);
  const retainRecovery=(recovery:Omit<Recovery,'originalTickets'>|null)=>{
    // Preserve the first identities even if a failed Check commits replacement
    // query rows; later checks must still verify the original purchase.
    const retained=recovery?{...recovery,originalTickets:recoveryRef.current?.originalTickets
      ??seats.map(({positionId,positionIndex,referenceCode})=>({positionId,positionIndex,referenceCode}))}:null;
    recoveryRef.current=retained;setRefundRecovery(retained);
  };
  const retainPendingReview=(review:Review)=>{
    const pending=(review.preview as RefundPreview & {pendingAttempt?:'unknown'|'confirmed'}).pendingAttempt;
    if(!pending)return false;
    retainRecovery({review,state:pending==='confirmed'?'pending':'unknown',message:pending==='confirmed'?'The refund went through and is finishing up. Check status refreshes this purchase and its tickets.':'The refund result isn’t confirmed. Check status refreshes this purchase and its tickets.'});
    setReasonModal(null);
    return true;
  };
  const [reasonModal,setReasonModal]=useState<(Review & {amountLabel:string;description:string})|null>(null);
  const reasonReview=useRef(0);
  const current=(attempt:number)=>scope.isCurrent()&&refundAttempt.current===attempt;
  const owned=(attempt:number):CreatorPageScope=>({userId:scope.userId,isCurrent:()=>current(attempt)});
  const cancel=(attempt:number)=>{if(current(attempt)&&!refundLock.current){refundAttempt.current++;setReasonModal(null);setRefundProblem(undefined);}};
  const showReview=(review:Review,delegate:boolean)=>{
    if(!current(review.attempt))return;
    const description=`${review.scopeLabel} ${review.preview.positionCount===1?'this ticket becomes':`these ${review.preview.positionCount} tickets become`} invalid immediately and can no longer check in. ${REFUND_DISCLOSURE}`;
    if(delegate){setReasonModal({...review,amountLabel:formatCents(review.preview.refundAmountCents),description});return;}
    Alert.alert(`refund ${formatCents(review.preview.refundAmountCents)}?`,description,[
      {text:'never mind',style:'cancel',onPress:()=>cancel(review.attempt)},
      {text:'refund it',style:'destructive',onPress:()=>runRefund(review)},
    ]);
  };
  const readReview=async(positionIndexes:number[]|null,attempt:number)=>{
    return boundedRead(owned(attempt),async visit=>{
    const latest=await getPurchaseDetail(id,visit);
    if(!visit.isCurrent())throw new Error('This review has ended.');
    if(!latest||latest.eventId!==eventId)throw new Error('This purchase changed.');
    const access=await getRefundAccess(latest.eventId,visit);
    if(!visit.isCurrent())throw new Error('This review has ended.');
    if(!access.canRefund)throw new Error('Refund access changed.');
    const preview=await previewRefund(id,{kind:'buyer_request',positionIndexes},visit);
    if(!preview)throw new Error('Refund preview unavailable.');
    return {access,preview};
    });
  };
  const runRefund=async(review:Review,reason?:string):Promise<boolean>=>{
    if(!current(review.attempt)||refundLock.current||recoveryRef.current)return false;
    // Consume this confirmation before any await; a changed preview gets a new one.
    const attempt=++refundAttempt.current;
    refundLock.current=true;setRefunding(true);setRefundProblem(undefined);
    let dispatched=false;
    try {
      const {access,preview}=await readReview(review.positionIndexes,attempt);
      if(!current(attempt))return false;
      if(retainPendingReview({...review,preview,attempt}))return false;
      if(!preview.allowed)throw new Error('Refund unavailable.');
      if(preview.refundAmountCents!==review.preview.refundAmountCents||preview.positionCount!==review.preview.positionCount||(access.isDelegate&&!reason?.trim())){
        setRefundProblem('The refund details changed. Review them before confirming again.');
        showReview({...review,preview,attempt},access.isDelegate);return false;
      }
      const target:RefundTarget={kind:'buyer_request',positionIndexes:review.positionIndexes,reviewedAmountCents:preview.refundAmountCents,reviewedPositionCount:preview.positionCount,...(reason?{reason}: {})};
      dispatched=true;
      retainRecovery({review,state:'unknown',message:'The refund result isn’t confirmed. Check status refreshes this purchase and its tickets.'});
      const outcome=await boundedRead(owned(attempt),visit=>executeRefund(id,target,visit));
      if(!current(attempt))return false;
      if(outcome.ok){
        retainRecovery(outcome.pending?{review,state:'pending',message:'The refund went through and is finishing up. Check status refreshes this purchase and its tickets.'}:null);
        refundAttempt.current++;invalidateAfterRefund();
        setAlertInfo({title:'refund sent',message:outcome.pending?'the refund went through and is finishing up. this page catches up in a minute.':`refunded ${formatCents(outcome.refundAmountCents)} to the buyer.`});return true;
      }
      if(outcome.notStarted===true)retainRecovery({review,state:'refused',message:'No refund was started. Review the latest refund details before confirming again.'});
      setReasonModal(null);setRefundProblem(outcome.message);return false;
    }catch{
      if(current(attempt)){
        setReasonModal(null);
        if(!dispatched)setAlertInfo({title:'Refund preview unavailable',message:'Couldn’t load the refund amount. Review it again before confirming.'});
      }
      return false;
    }finally{refundLock.current=false;if(scope.isCurrent())setRefunding(false);}
  };
  const submitReasonRefund=async(reason:string):Promise<boolean>=>{
    if(!reasonModal||refundLock.current||!current(reasonModal.attempt))return false;
    const succeeded=await runRefund(reasonModal,reason);
    if(scope.isCurrent()&&succeeded)setReasonModal(null);
    return succeeded;
  };
  const confirmRefund=async(positionIndexes:number[]|null,scopeLabel:string,recovery?:Recovery)=>{
    if(!scope.isCurrent()||refundLock.current||!actionReady.current)return;
    if(recoveryRef.current&&(recoveryRef.current!==recovery||recovery?.state!=='refused'))return;
    if(recovery&&recoveryRef.current!==recovery)return;
    const attempt=++refundAttempt.current;
    refundLock.current=true;setRefunding(true);setRefundProblem(undefined);
    try{
      const {access,preview}=await readReview(positionIndexes,attempt);
      if(!current(attempt))return;
      if(retainPendingReview({positionIndexes,scopeLabel,preview,attempt}))return;
      if(!preview.allowed){setAlertInfo({title:'about that refund',message:"that refund isn't available for this purchase."});refundAttempt.current++;return;}
      // A refusal retry keeps its draft; a new explicit review starts empty.
      if(!recovery)reasonReview.current++;
      retainRecovery(null);
      hapticLight();showReview({positionIndexes:positionIndexes?[...positionIndexes]:null,scopeLabel,preview,attempt},access.isDelegate);
    }catch{if(current(attempt))setAlertInfo({title:'Refund preview unavailable',message:'Couldn’t load the refund amount. Try again.'});}
    finally{refundLock.current=false;if(scope.isCurrent())setRefunding(false);}
  };
  const checkRefundStatus=async(recovery:Recovery)=>{
    if(!scope.isCurrent()||refundLock.current||recoveryRef.current!==recovery)return;
    const originalRows=recovery.originalTickets;
    const attempt=++refundAttempt.current;
    refundLock.current=true;setRefunding(true);
    let statusChecked=false;
    try{
      const {status,refreshedRows}=await boundedRead(owned(attempt),async visit=>{
        const receipt=await checkRefundAttempt(id,visit);
        if(!visit.isCurrent()||(receipt.isCurrent&&!receipt.isCurrent()))throw new Error('This status check has ended.');
        statusChecked=true;
        const [tickets]=await Promise.all([
          retryAttendees({cancelRefetch:false,throwOnError:true}),
          retryPurchase({cancelRefetch:false,throwOnError:true}),
          retryRefundAccess({cancelRefetch:false,throwOnError:true}),
        ]);
        return {status:receipt,refreshedRows:(tickets.data??[]).filter(row=>row.orderId===id)};
      });
      if(!current(attempt)||recoveryRef.current!==recovery||(status.isCurrent&&!status.isCurrent()))return;
      const sameOriginalTickets=originalRows.length>0&&refreshedRows.length===originalRows.length
        &&originalRows.every(row=>refreshedRows.some(fresh=>fresh.positionId===row.positionId
          &&fresh.positionIndex===row.positionIndex&&fresh.referenceCode===row.referenceCode));
      if(status.state==='complete'){
        const fullyRefunded=sameOriginalTickets&&refreshedRows.every(row=>row.orderStatus==='refunded'&&(row.voided||row.refundedCents>0));
        const target=status.target;
        const indexes=target?target.positionIndexes:recovery.review.positionIndexes;
        const reviewedCount=target?target.reviewedPositionCount:recovery.review.preview.positionCount;
        // Another view may have saved request B while this screen remembers A.
        // Only B's exact saved target can reconcile B's completion.
        if(!sameOriginalTickets||(target&&!status.requestId)
          ||(reviewedCount>0?status.positionsVoided!==reviewedCount:!fullyRefunded)
          ||(indexes===null?!fullyRefunded:indexes.some(index=>!refreshedRows.some(row=>row.positionIndex===index&&(row.voided||row.refundedCents>0))))){
          retainRecovery({...recovery,message:'The saved refund result doesn’t match the tickets yet. Check status to refresh them.'});
          return;
        }
        retainRecovery(null);
      }else if(status.state==='not-started'){
        const indexes=status.target?status.target.positionIndexes:recovery.review.positionIndexes;
        const eligible=refreshedRows.filter(row=>isLiveSeat(row)&&row.refundedCents===0);
        const targets=indexes===null?eligible:eligible.filter(row=>indexes.includes(row.positionIndex));
        // A fresh review must still describe the exact original tickets. A
        // multi-ticket selection cannot become a wider whole-purchase refund.
        if(!sameOriginalTickets||(status.target&&!status.requestId)||targets.length===0
          ||(indexes!==null&&(targets.length!==indexes.length||(indexes.length>1&&targets.length!==eligible.length)))){
          retainRecovery({...recovery,state:'unknown',message:'No refund was started. These tickets could not be verified for a new review. Check status to refresh them.'});
          return;
        }
        const positionIndexes=indexes!==null&&indexes.length===1?[...indexes]:null;
        const oldIndexes=recovery.review.positionIndexes;
        if((oldIndexes===null)!==(positionIndexes===null)||oldIndexes?.join(',')!==positionIndexes?.join(','))reasonReview.current++;
        const review={...recovery.review,positionIndexes,scopeLabel:positionIndexes?`just ticket ${targets[0].referenceCode} --`:"the buyer's whole remaining purchase --"};
        retainRecovery({...recovery,review,state:'refused',message:'No refund was started. Review the latest refund details before confirming again.'});
      }else if(status.state==='confirmed')retainRecovery({...recovery,state:'pending',message:'The refund went through and is finishing up. Check status refreshes this purchase and its tickets.'});
      else retainRecovery({...recovery,message:recovery.state==='pending'?'The refund went through and is finishing up. Check status refreshes this purchase and its tickets.':'The refund result isn’t confirmed. Check status refreshes this purchase and its tickets.'});
    }catch{
      if(current(attempt))retainRecovery({...recovery,message:(recovery.state==='pending'?'The refund went through and is finishing up.':'The refund result isn’t confirmed.')+(statusChecked?' Tickets couldn’t be refreshed.':' Refund status couldn’t be checked.')+' Check status checks the saved request and refreshes this purchase and its tickets.'});
    }finally{refundLock.current=false;if(scope.isCurrent())setRefunding(false);}
  };

  if (!purchase || accessDenied) return <PageFrame title="Purchase details" onBack={()=>{if(scope.isCurrent())router.back();}}>
    <Text style={pageStyles.body}>This purchase is no longer available for this account.</Text>
    <PageAction compact singleLine title={readsBusy?'Retrying…':'Try again'} disabled={readsBusy} onPress={retryReads}/>
  </PageFrame>;

  const label = purchaseStatusLabel(purchase);
  const canOfferRefund = canRefund && purchase.status === 'paid' && purchase.refundedCents < purchase.totalCents;
  const liveSeats = seats.filter(isLiveSeat);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => { if(scope.isCurrent())router.back(); }} style={styles.headerControl} accessibilityRole="button" accessibilityLabel="back">
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2} />
        </TouchableOpacity>
        {/* copy to the taste gate */}
        <Text style={styles.headerTitle} numberOfLines={1}>Purchase</Text>
        <ProfileButton compact/>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {refundRecovery&&<View style={styles.recovery} accessibilityRole="alert">
          <Text style={styles.recoveryText}>{refundRecovery.message}</Text>
          <PageAction compact singleLine title={refunding?'Checking…':refundRecovery.state==='refused'?'Review refund':'Check status'} disabled={refunding} onPress={()=>refundRecovery.state==='refused'?confirmRefund(refundRecovery.review.positionIndexes,refundRecovery.review.scopeLabel,refundRecovery):checkRefundStatus(refundRecovery)}/>
        </View>}
        {(failures.length>0||retrying)&&<View style={styles.recovery} accessibilityRole="alert">
          <Text style={styles.recoveryText}>{readsBusy?'Checking the latest purchase details.':failures.join(' ')}</Text>
          <PageAction compact singleLine title={readsBusy?'Retrying…':'Try again'} disabled={readsBusy} onPress={retryReads}/>
        </View>}
        <View style={styles.buyerContext}>
          <LinearGradient pointerEvents="none" colors={[CreatorSurfaceColors.sunsetGoldLight,C.white]} start={{x:0,y:0}} end={{x:1,y:1}} style={StyleSheet.absoluteFill}/>
          <Text style={styles.contextLabel}>Buyer</Text>
          <Text accessibilityRole="header" style={styles.buyerName}>{purchase.buyerName}</Text>
          <Text style={styles.statusPill}>{label==='partial'?'Partially refunded':label.charAt(0).toUpperCase()+label.slice(1)}</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.eventTitle}>{purchase.eventTitle}</Text>
          <Text style={styles.metaLine}>
            {purchase.tierName ?? 'Ticket'} · {purchase.qty} {purchase.qty === 1 ? 'ticket' : 'tickets'}
          </Text>
          <Text style={styles.metaLine}>Purchased {formatTimestampLA(purchase.createdAt)}</Text>
          <View style={styles.amountRow}>
            <Text style={styles.amountLabel}>Total</Text>
            <Text style={styles.amountValue}>{formatCents(purchase.totalCents)}</Text>
          </View>
          {purchase.refundedCents > 0 && (
            <View style={styles.amountRow}>
              {/* copy to the taste gate */}
              <Text style={styles.amountLabel}>Refunded so far</Text>
              <Text style={styles.amountValueMuted}>{formatCents(purchase.refundedCents)}</Text>
            </View>
          )}
        </View>

        {(!attendeeError||seats.length>0)&&<View style={styles.section}>
          {/* copy to the taste gate */}
          <Text style={styles.sectionLabel}>Tickets</Text>
          {(questionsLoading||(questions.length>0&&answerData===undefined&&answersBusy))&&<Text style={styles.metaLine}>Loading answers…</Text>}
          {attendeeData!==undefined&&seats.length===0&&!attendeeError&&!attendeesBusy&&<Text style={styles.metaLine}>No tickets are available for this purchase.</Text>}
          {attendeesLoading&&<ActivityIndicator accessibilityLabel="Loading tickets" color={Colors.terracotta}/>}
          {seatsWithAnswers.map((seat) => (
            <View key={seat.positionId} style={styles.seatRow}>
              <View style={styles.seatIcon}>
                {seat.voided || seat.refundedCents > 0 ? (
                  <TriangleAlert size={16} color={EventAction.error} strokeWidth={2} />
                ) : seat.checkedIn ? (
                  <Check size={16} color={Colors.brandDeep} strokeWidth={2.5} />
                ) : (
                  <Clock size={16} color={Colors.textLight} strokeWidth={2} />
                )}
              </View>
              <View style={styles.seatBody}>
                <Text style={styles.seatCode}>{seat.referenceCode}</Text>
                <Text style={styles.seatState}>
                  {seat.voided || seat.refundedCents > 0
                    ? 'Refunded'
                    : seat.checkedIn
                      ? `Checked in ${seat.checkedInAt ? formatTimestampLA(seat.checkedInAt) : ''}`
                      : 'Not checked in yet'}
                </Text>
                {questions.map((q) => {
                  const raw = seat.answers[q.id];
                  if (!raw) return null;
                  return (
                    <View key={q.id} style={styles.answerBlock}>
                      <Text style={styles.answerPrompt}>{q.prompt}</Text>
                      <Text style={styles.answerLine}>{raw}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          ))}
        </View>}

        {(canOfferRefund || refundRecovery) && (
          <View style={styles.section}>
            {/* copy to the taste gate */}
            <Text style={styles.sectionLabel}>Refund</Text>
            <View style={styles.disclosureCard}>
              {/* every consequence named before any action is offered */}
              <Text style={styles.disclosureLine}>The ticket price goes back to the buyer&apos;s card.</Text>
              <Text style={styles.disclosureLine}>{REFUND_DISCLOSURE}</Text>
              <Text style={styles.disclosureLine}>A refunded ticket can no longer check in at the door.</Text>
            </View>
            {!refundRecovery && (liveSeats.length > 1 ? (
              <>
                <TouchableOpacity
                  style={[styles.refundBtn, refunding && styles.refundBtnOff]}
                  accessibilityRole="button" accessibilityLabel="Refund purchase" onPress={() => { if(!actionReady.current)return; return confirmRefund(null, "the buyer's whole remaining purchase --"); }}
                  disabled={refunding}
                  activeOpacity={0.85}
                >
                  {/* copy to the taste gate */}
                  <CreatorActionFill/><Text numberOfLines={1} style={styles.refundBtnText}>Refund purchase</Text>
                </TouchableOpacity>
                {liveSeats.map((s) => (
                  <TouchableOpacity
                    key={s.positionId}
                    style={[styles.refundBtnSecondary, refunding && styles.refundBtnOff]}
                    accessibilityRole="button" accessibilityLabel={`Refund ticket ${s.referenceCode}`} onPress={() => { if(!actionReady.current)return; return confirmRefund([s.positionIndex], `just ticket ${s.referenceCode} --`); }}
                    disabled={refunding}
                    activeOpacity={0.85}
                  >
                    <Text numberOfLines={1} style={styles.refundBtnSecondaryText}>Refund {s.referenceCode}</Text>
                  </TouchableOpacity>
                ))}
              </>
            ) : (
              <TouchableOpacity
                style={[styles.refundBtn, refunding && styles.refundBtnOff]}
                accessibilityRole="button" accessibilityLabel="Refund purchase" onPress={() => { if(!actionReady.current)return; return confirmRefund(null, 'this purchase --'); }}
                disabled={refunding}
                activeOpacity={0.85}
              >
                {refunding ? (
                  <ActivityIndicator size="small" color={Colors.white} />
                ) : (
                  /* copy to the taste gate */
                  <><CreatorActionFill/><Text numberOfLines={1} style={styles.refundBtnText}>Refund purchase</Text></>
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

      <BrandedAlert
        visible={!!alertInfo}
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message}
        buttons={alertInfo?.buttons}
        onClose={() => { if(scope.isCurrent())setAlertInfo(null); }}
      />
      <RefundReasonModal
        key={reasonReview.current}
        visible={!!reasonModal}
        amountLabel={reasonModal?.amountLabel ?? ''}
        scopeLabel={reasonModal?.description ?? ''}
        submitting={refunding}
        problem={refundProblem}
        onCancel={() => {if(reasonModal)cancel(reasonModal.attempt);}}
        onSubmit={submitReasonRefund}
      />
    </SafeAreaView>
  );
}

function createStyles(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  recovery:{padding:12,borderWidth:1,borderColor:CreatorSurfaceColors.goldEdge,borderRadius:14,backgroundColor:C.white,flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:12},
  recoveryText:{flexGrow:1,flexBasis:120,minWidth:0,fontFamily:fonts.regular,fontSize:FontSizes.bodySM,color:C.muted},
  buyerContext:{padding:16,borderWidth:1,borderColor:CreatorSurfaceColors.goldEdge,borderRadius:16,overflow:'hidden',gap:6},
  contextLabel:{fontFamily:fonts.medium,fontSize:FontSizes.caption,color:C.muted},
  container: { flex: 1, backgroundColor: C.paper },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, minHeight:56, gap:12 },
  headerControl:{minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center'},
  buyerName:{fontFamily:fonts.display,fontSize:FontSizes.displayMD,lineHeight:32,color:Colors.asphalt},
  headerTitle: { flex: 1, minWidth:0, fontFamily: fonts.semibold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { fontFamily: fonts.regular, fontSize: FontSizes.bodyMD, color: Colors.textMedium },
  body: { paddingHorizontal:20,paddingTop:12,paddingBottom:32,gap:16 },
  card: {
    backgroundColor: C.white, borderRadius: 16, borderWidth: 1, borderColor: C.subtleLine,
    padding: 16, gap: 8,
  },
  statusPill: {
    alignSelf: 'flex-start', fontFamily: fonts.medium, fontSize: FontSizes.caption,
    color: C.muted, marginTop:2,
  },
  eventTitle: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  metaLine: { lineHeight:20, fontFamily: fonts.regular, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  amountRow: { flexDirection: 'row', flexWrap:'wrap', gap:8, justifyContent: 'space-between', marginTop: 8 },
  amountLabel: { fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  amountValue: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  amountValueMuted: { fontFamily: fonts.medium, fontSize: FontSizes.bodyMD, color: EventAction.error },
  section: { gap: 8 },
  sectionLabel: {
    fontFamily: fonts.semibold, fontSize: FontSizes.bodyLG, color: C.ink,
  },
  seatRow: {
    flexDirection: 'row', gap: 10,
    backgroundColor: C.white, borderRadius: 16, borderWidth: 1, borderColor: C.subtleLine,
    padding: 16,
  },
  seatIcon: { width: 24, alignItems: 'center', paddingTop: 2 },
  seatBody: { flex: 1, minWidth:0, gap: 4 },
  seatCode: { fontFamily: fonts.semibold, fontSize: FontSizes.bodySM, letterSpacing: 1, color: Colors.asphalt },
  seatState: { fontFamily: fonts.regular, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  answerBlock: { borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:C.subtleLine,paddingTop:10,marginTop:6,gap:4 },
  answerPrompt: { fontFamily:fonts.medium,fontSize:FontSizes.caption,color:C.muted },
  answerLine: { lineHeight:20, fontFamily: fonts.regular, fontSize: FontSizes.bodySM, color: C.ink },
  disclosureCard: {
    backgroundColor: C.white, borderRadius: 16, borderWidth: 1, borderColor: C.subtleLine,
    borderLeftWidth: 2, borderLeftColor: EventAction.error,
    padding: 14, gap: 6,
  },
  disclosureLine: { fontFamily: fonts.regular, fontSize: FontSizes.bodySM, color: Colors.textMedium, lineHeight: 19 },
  refundBtn: {
    backgroundColor: Colors.terracotta, borderWidth:1,borderColor:CreatorSurfaceColors.goldEdge,borderRadius:24,paddingHorizontal:20,paddingVertical:12,
    alignItems: 'center', justifyContent: 'center', minHeight: 44, marginTop: 4,
  },
  refundBtnOff: { opacity: 0.5 },
  refundBtnText: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyMD, color: Colors.white },
  refundBtnSecondary: {
    borderWidth:1,borderColor:CreatorSurfaceColors.goldEdge,backgroundColor:C.white,borderRadius:24,paddingHorizontal:20,paddingVertical:12,
    alignItems: 'center', justifyContent: 'center', minHeight: 44, marginTop: 8,
  },
  refundBtnSecondaryText: { fontFamily: fonts.semibold, fontSize: FontSizes.bodySM, color: EventAction.error },
}); }
