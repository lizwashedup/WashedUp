import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { EventSaleAlertPreference } from '../../components/creator/EventSaleAlertPreference';
import { saveCreatorPromo, saveCreatorFaq } from '../../lib/creatorTicketDetailsSave';
import { randomUUID } from 'expo-crypto';
import { saveCreatorTier } from '../../lib/creatorTierEditor';
import { useCreatorTicketAction } from '../../hooks/useCreatorTicketAction';
import type { TicketAction } from '../../lib/creatorTicketAction';
import { CREATOR_PAGES_ENABLED } from '../../constants/FeatureFlags';
import { resolveCreatorEventEntry } from '../../lib/creatorEventEntry';
import { getCreatorAccess, canManageEvents } from '../../lib/creatorMode';
/**
 * The organizer's ticket setup for one event (doc 61 §5, launch sprint
 * 7-21): payout status up top (64's row, read-only; onboarding via the
 * declared edge contract), the tier list with the editor sheet, and the
 * FAQ editor - dormant until proposal 70's re-cut applies.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useFocusEffect, router } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, Plus, Ticket } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { FontSizes, type AfterglowFontFamilies } from '../../constants/Typography';
import { EventAction, EventSpacing } from '../../constants/EventDesign';
import { hapticLight, hapticSuccess, hapticError } from '../../lib/haptics';
import { supabase } from '../../lib/supabase';
import { openUrl } from '../../lib/url';
import {
  FAQ_ANSWER_MAX,
  FAQ_QUESTION_MAX,
  formatCents,
  getConfirmationMessage,
  getEventFaqs,
  getMyPayoutState,
  getQuestions,
  getTierAvailability,
  getTiers,
  isLowInventory,
  isPayoutReady,
  questionTypeLabel,
  QUESTIONS_MAX,
  recommendedTierId,
  requestOnboardingLink,
  TIER_COUNT_MAX,
  type TicketQuestion,
  type TicketTier,
  type TierDraft,
} from '../../lib/ticketing';
import {
  addonRemaining,
  createAddon,
  listAddons,
  listPromoCodes,
  type AddonDraft,
  type EventAddon,
  type PromoCode,
  type PromoDraft,
} from '../../lib/ticketPromosAddons';
import { PayoutsCard } from '../../components/creator/PayoutsCard';
import { TierEditorSheet } from '../../components/creator/TierEditorSheet';
import { PromotionEditorSheet } from '../../components/creator/PromotionEditorSheet';
import { AddonEditorSheet } from '../../components/creator/AddonEditorSheet';
import { useCreatorPageRead } from '../../hooks/useCreatorPageRead';
import { canReadCreatorTickets, scopedTicketRequest } from '../../lib/creatorTicketRead';
import { PageAction, PageFrame } from '../../components/creator/pages/PageFrame';
import { useCreatorPageScope } from '../../hooks/useCreatorPageScope';
import { saveCreatorAddon, type CreatorAddon, type CreatorAddonDispatch } from '../../lib/creatorAddonEditor';
import type { CreatorPageScope } from '../../lib/creatorPageReview';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';

export default function TicketSetupRoute() {
  const styles = useStyles();
  const { id, setup } = useLocalSearchParams<{ id: string; setup?: string }>();
  const { scope, account } = useCreatorPageScope(id ?? '');
  const readAccess = useCallback(async (owned: CreatorPageScope) => {
    if (!await canReadCreatorTickets(id!, owned)) return false;
    // Page authority is explicit; ordinary events retain their original creator-grant gate.
    if (CREATOR_PAGES_ENABLED) {
      const entry = await resolveCreatorEventEntry({kind: 'edit', id: id!}, owned);
      if (!owned.isCurrent()) throw new Error('This event visit has ended.');
      if (entry.kind === 'page') return {pageId:entry.pageId};
    }
    const creator = await getCreatorAccess();
    if (!owned.isCurrent()) throw new Error('This event visit has ended.');
    return creator.hasEventHostGrant || canManageEvents(creator) ? {pageId:null} : false;
  }, [id]);
  const access = useCreatorPageRead(id ? scope : null, readAccess);
  const admitted = useRef<string | null>(null);
  const identity = `${account?.epoch ?? ''}:${scope?.userId ?? ''}:${id}`;
  if (access.data && !access.error) admitted.current = identity;
  if (access.data === false) admitted.current = null;
  const active = !!scope?.isCurrent() && !!access.data && !access.loading && !access.error;
  // Keep the same account/event editor mounted across the existing end-time round trip.
  // Reads and visible controls resume only after fresh event access is confirmed.
  return <>
    {scope && admitted.current === identity && <View style={{ flex: 1, display: active ? 'flex' : 'none' }}>
      <TicketSetupScreen key={identity} id={id!} setup={setup} scope={scope} active={active} pageId={access.data?access.data.pageId:null} />
    </View>}
    {!active && <PageFrame title="Tickets">
      {account?.isLoading || access.loading ? <ActivityIndicator accessibilityLabel="Checking event access" color={Colors.terracotta} /> : <>
        <Text style={styles.emptyText}>{access.error || account?.error ? 'Ticket setup couldn’t be loaded.' : 'Ticket setup isn’t available for this event and account.'}</Text>
        <PageAction title="Try again" compact onPress={() => { void (account?.error ? account.retry() : access.refresh()).catch(() => undefined); }} />
      </>}
    </PageFrame>}
  </>;
}
function SetupReadNotice({label,retry}:{label:string;retry():void}) {
  const styles = useStyles();
  return <View style={styles.readNotice} accessibilityRole="alert"><Text style={styles.readNoticeText}>{label}</Text>
    <TouchableOpacity style={styles.readRetry} accessibilityRole="button" accessibilityLabel={`Retry: ${label}`} onPress={retry}><Text style={styles.readRetryText}>Try again</Text></TouchableOpacity>
  </View>;
}
function TicketSetupScreen({id,setup,scope,active,pageId}:{id:string;setup?:string;scope:CreatorPageScope;active:boolean;pageId:string|null}) {
  const styles = useStyles();
  const queryClient = useQueryClient();
  const extraScope = scope;
  const userId = scope.userId;
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingTier, setEditingTier] = useState<TicketTier | null>(null);
  const [savedTierName, setSavedTierName] = useState<string | null>(null);
  // Build 35 guinea pig: pre-fills the name field when a creator taps "add a
  // free rsvp" instead of the generic "add a ticket" button. Reuses the
  // exact same createTier path a manually-typed $0 tier already goes
  // through (TierEditorSheet's own "price blank or 0 = free" field) -- this
  // only makes that already-shipped free path an explicit, named choice
  // instead of something a creator has to discover by leaving price blank.
  const [newTierPreset, setNewTierPreset] = useState<string | undefined>(undefined);
  const [tierRecordId, setTierRecordId] = useState(() => randomUUID());
  const [pendingTierDraft, setPendingTierDraft] = useState<TierDraft | null>(null);
  const resumeTierEditorRef = useRef(false);
  const [onboardBusy, setOnboardBusy] = useState(false);
  const [faqQuestion, setFaqQuestion] = useState('');
  const [faqAnswer, setFaqAnswer] = useState('');
  // docs 113/114: both sections are invisible until their table probe
  // succeeds (the doc-111 join-gate pattern), self-flipping on schema apply
  const [promoRecordId,setPromoRecordId] = useState(() => randomUUID());
  const [pendingPromo,setPendingPromo] = useState<PromoDraft|null>(null);
  const [faqSaving,setFaqSaving] = useState(false);
  const faqLock = useRef(false);
  const [faqProblem,setFaqProblem] = useState<string>();
  const [faqAttempt,setFaqAttempt] = useState<{id:string;question:string;answer:string;sortOrder:number}|null>(null);
  const [promoEditorVisible, setPromoEditorVisible] = useState(false);
  const [addonEditorVisible, setAddonEditorVisible] = useState(false);
  const [editingAddon, setEditingAddon] = useState<EventAddon | null>(null);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);

  useFocusEffect(useCallback(() => {
    if (resumeTierEditorRef.current) {
      resumeTierEditorRef.current = false;
      setEditorVisible(true);
    }
  }, []));

  const { data: event, isError: eventError, refetch: retryEvent } = useQuery({
    queryKey: ['ticket-setup-event', id, userId],
    queryFn: async () => {
      const { data, error } = await scopedTicketRequest(scope, () => supabase
        .from('explore_events')
        .select('id, title, event_date, end_time')
        .eq('id', id!)
        .maybeSingle());
      if(error || !data) throw error ?? new Error('This event could not be loaded.');
      return data;
    },
    enabled: active && !!id,
    staleTime: 60_000,
  });

  const { data: payout, isError: payoutError, refetch: retryPayout } = useQuery({
    queryKey: ['payout-state', userId],
    queryFn: () => getMyPayoutState(userId!,scope),
    enabled: active && !!userId,
    staleTime: 30_000,
  });

  const { data: tiers = [], isLoading: tiersLoading, isError: tiersError, refetch: retryTiers } = useQuery({
    queryKey: ['ticket-tiers', id, userId],
    queryFn: () => getTiers(id!,true,scope),
    enabled: active && !!id,
    staleTime: 15_000,
  });

  const { data: faqState, isError: faqError, isLoading: faqLoading, refetch: retryFaqs } = useQuery({
    queryKey: ['event-faqs', id, userId],
    queryFn: () => getEventFaqs(id!,scope),
    enabled: active && !!id,
    staleTime: 30_000,
  });

  const { data: questions = [], isLoading: questionsLoading, isError: questionsError, refetch: retryQuestions } = useQuery({
    queryKey: ['ticket-questions', id, userId],
    queryFn: () => getQuestions(id!,true,scope),
    enabled: active && !!id,
    staleTime: 15_000,
  });

  const { data: promoCodes = [], isError: promoError, isLoading: promoLoading, refetch: retryPromos } = useQuery({
    queryKey: ['ticket-promo-codes', id, userId],
    queryFn: () => listPromoCodes(id!,scope),
    enabled: active && !!id,
    staleTime: 15_000,
  });
  const { data: addons = [], isError: addonsError, isLoading: addonsLoading, refetch: retryAddons } = useQuery({
    queryKey: ['event-add-ons', id, userId],
    queryFn: () => listAddons(id!,true,scope),
    enabled: active && !!id,
    staleTime: 15_000,
  });

  // C-19: read-only preview of what buyers see on the confirmation screen
  // (doc 111's note). The message itself is set on the event details form,
  // never here.
  const { data: confirmationMessage = null, isError: noteError, isLoading: noteLoading, refetch: retryNote } = useQuery({
    queryKey: ['ticket-setup-confirmation', id, userId],
    queryFn: () => getConfirmationMessage(id!,true,scope),
    enabled: active && !!id,
    staleTime: 30_000,
  });

  // C-19/TK-07: real per-tier remaining counts, capped tiers only (an
  // uncapped tier can never be "low"). Refetches whenever the tier list's
  // own id set changes, same as every other tier-derived query here.
  const cappedTierIds = tiers.filter((t) => t.quantity_cap !== null).map((t) => t.id);
  const { data: availability = new Map<string, number>(), isError: availabilityError, refetch: retryAvailability } = useQuery({
    queryKey: ['ticket-tier-availability', cappedTierIds.join(','), userId],
    queryFn: () => getTierAvailability(cappedTierIds,scope),
    enabled: active && cappedTierIds.length > 0,
    staleTime: 15_000,
  });

  const invalidateTiers = useCallback(() => {
    return queryClient.invalidateQueries({ queryKey: ['ticket-tiers', id] });
  }, [queryClient, id]);

  const invalidateQuestions = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['ticket-questions', id] });
  }, [queryClient, id]);

  const management = useCreatorTicketAction(scope, (action: TicketAction) => {
    hapticSuccess();
    const key = action.kind.includes('tier') ? 'ticket-tiers' : action.kind.includes('extra') ? 'event-add-ons' : action.kind.includes('promo') ? 'ticket-promo-codes' : action.kind.includes('question') ? 'ticket-questions' : 'event-faqs';
    void queryClient.invalidateQueries({ queryKey: [key, action.eventId] });
  },pageId?id:undefined);
  const requestManagement = (action: TicketAction) => { if (active && !faqLock.current && !management.blocked && !saveTierMutation.isPending && !saveAddonMutation.isPending && !savePromoMutation.isPending) void management.run(action); };

  const handleRemoveQuestion = (question: TicketQuestion) => {
    if (!active || !scope.isCurrent() || management.blocked) return;
    setAlertInfo({
      /* copy to the taste gate */
      title: 'remove this question?',
      message: question.prompt,
      buttons: [
        { text: 'keep it', style: 'cancel' },
        {
          text: 'remove it',
          onPress: () => requestManagement({kind:'remove-question',eventId:id!,recordId:question.id,label:question.prompt}),
        },
      ],
    });
  };

  const savePromoMutation = useMutation({
    mutationFn: async (input:{draft:PromoDraft;id:string;eventId:string;scope:CreatorPageScope}) => {
      if (management.isBlocked()) throw Error('Check the previous change before saving.');
      return saveCreatorPromo(input.eventId,input.id,input.draft,input.scope);
    },
    onSuccess: (_row,input) => {
      void queryClient.invalidateQueries({queryKey:['ticket-promo-codes',input.eventId,input.scope.userId]});
      if(!input.scope.isCurrent())return;
      hapticSuccess();setPendingPromo(null);setPromoEditorVisible(false);
    },
  });

  const handleDeletePromo = (promo: PromoCode) => {
    if (!active || !scope.isCurrent() || management.blocked) return;
    setAlertInfo({
      /* copy to the taste gate */
      title: 'remove this code?',
      message: promo.code,
      buttons: [
        { text: 'keep it', style: 'cancel' },
        {
          text: 'remove it',
          style: 'destructive',
          onPress: () => requestManagement({kind:'remove-promo',eventId:id!,recordId:promo.id,label:promo.code}),
        },
      ],
    });
  };

  const saveAddonMutation = useMutation({
    mutationFn: async (input:{draft:AddonDraft;recordId:string;eventId:string;isNew:boolean;scope:CreatorPageScope;write:boolean;baseline:CreatorAddon|null;dispatch:CreatorAddonDispatch}) => { if (management.isBlocked()) throw Error("Check the previous change before saving."); return saveCreatorAddon(input.eventId,input.recordId,input.draft,input.isNew,input.scope,input.write,input.baseline,input.dispatch); },
    onSuccess: (_row,input) => {
      queryClient.invalidateQueries({ queryKey: ['event-add-ons',input.eventId] });
      if(!input.scope.isCurrent())return;
      hapticSuccess();
    },
  });

  const handleDeleteAddon = (addon: EventAddon) => {
    if (!active || !scope.isCurrent() || management.blocked) return;
    setAlertInfo({
      /* copy to the taste gate */
      title: 'remove this extra?',
      message: addon.name,
      buttons: [
        { text: 'keep it', style: 'cancel' },
        {
          text: 'remove it',
          style: 'destructive',
          onPress: () => requestManagement({kind:'remove-extra',eventId:id!,recordId:addon.id,label:addon.name,...(pageId?{pageId}:{})}),
        },
      ],
    });
  };

  const saveTierMutation = useMutation({
    mutationFn: async (input: {draft:TierDraft;recordId:string;eventId:string;baseline:TicketTier|null;scope:CreatorPageScope}) => {
      if (management.isBlocked()) throw Error("Check the previous change before saving.");
      const row = await saveCreatorTier(input.eventId,input.recordId,input.draft,input.baseline,input.scope);
      return {name:row.name,wasEditing:!!input.baseline};
    },
    onSuccess: async ({ name, wasEditing }, input) => {
      await invalidateTiers();
      if (!input.scope.isCurrent()) return;
      hapticSuccess(); setEditorVisible(false); setEditingTier(null);
      setNewTierPreset(undefined); setPendingTierDraft(null);
      setSavedTierName(wasEditing ? `${name} updated.` : `${name} added.`);
    },
    onError: (e: any, input) => {
      if (!input.scope.isCurrent()) return;
      const draft = input.draft;
      hapticError();
      if (e?.code === 'event_end_time_required') {
        setPendingTierDraft(draft);
        setAlertInfo({
          title: 'add the event end time',
          message: e?.message,
          buttons: [
            { text: 'not now', style: 'cancel' },
            {
              text: 'set end time',
              onPress: () => {
                resumeTierEditorRef.current = true;
                setEditorVisible(false);
                router.push(`/creator/event-form?id=${id}&returnToTickets=1` as never);
              },
            },
          ],
        });
        return;
      }
      // The editor keeps its draft and shows the save error inline.
    },
  });

  // buyers only ever SEE a tier once it is on_sale on a Live event (RLS), so
  // this flip is how tickets become buyable at all. Going on sale with a PAID
  // tier requires both Stripe capabilities (the P3 selling gate); there is no
  // server-side gate until proposal 87 lands, so this client check is the law
  // for now. Free tiers flip freely: free checkout never touches Stripe.
  const handleToggleSale = (tier: TicketTier) => {
    if (tier.status !== 'on_sale' && tier.price_cents > 0 && !isPayoutReady(payout)) {
      hapticError();
      setAlertInfo({
        /* copy to the taste gate */
        title: 'payouts first',
        message: 'a paid ticket can go on sale the moment stripe finishes your payout setup. the card up top takes you there.',
      });
      return;
    }
    hapticLight();
    requestManagement({kind:"tier-sale",eventId:id!,recordId:tier.id,label:tier.name,expected:tier.status});
  };

  const handleDeleteTier = (tier: TicketTier) => {
    if (!active || !scope.isCurrent() || management.blocked) return;
    setAlertInfo({
      /* copy to the taste gate */
      title: 'remove this ticket?',
      message: tier.name,
      buttons: [
        { text: 'keep it', style: 'cancel' },
        {
          text: 'remove it',
          onPress: () => requestManagement({kind:'remove-tier',eventId:id!,recordId:tier.id,label:tier.name}),
        },
      ],
    });
  };

  const handleOnboard = useCallback(async () => {
    if (onboardBusy) return;
    hapticLight();
    setOnboardBusy(true);
    const result = await requestOnboardingLink();
    setOnboardBusy(false);
    if (result.ok) {
      openUrl(result.url);
      return;
    }
    setAlertInfo({
      /* copy to the taste gate: the real reason, and a way to try again */
      title: 'that did not open',
      message: result.message,
      buttons: [
        { text: 'not now', style: 'cancel' },
        { text: 'try again', onPress: () => { handleOnboardRef.current?.(); } },
      ],
    });
  }, [onboardBusy]);

  // the retry button calls back into the latest handler without making the
  // callback depend on itself
  const handleOnboardRef = useRef<(() => void) | null>(null);
  handleOnboardRef.current = handleOnboard;

  const handleAddFaq = async () => {
    if (!id || !scope.isCurrent() || faqLock.current || faqLoading || faqError || !faqQuestion.trim() || !faqAnswer.trim() || management.isBlocked()) return;
    const owned=scope;
    const attempt=faqAttempt??{id:randomUUID(),question:faqQuestion.trim(),answer:faqAnswer.trim(),sortOrder:faqState?.faqs.length??0};
    faqLock.current=true;setFaqSaving(true);setFaqAttempt(attempt);setFaqProblem(undefined);
    try {
      await saveCreatorFaq(id,attempt.id,attempt.question,attempt.answer,attempt.sortOrder,owned);
      void queryClient.invalidateQueries({queryKey:['event-faqs',id,owned.userId]});
      if(!owned.isCurrent())return;
      hapticSuccess();setFaqAttempt(null);setFaqQuestion('');setFaqAnswer('');
    } catch {
      if(owned.isCurrent())setFaqProblem('The answer could not be saved yet. Your draft is kept.');
    } finally {faqLock.current=false;setFaqSaving(false);}
  };

  const handleRemoveFaq = (faqId: string) => {
    const faq = faqState?.faqs.find(row => row.id === faqId);
    if (faq) requestManagement({kind:'remove-faq',eventId:id!,recordId:faqId,label:faq.question});
  };

  const payoutReady = isPayoutReady(payout);
  const paidTiers = tiers.filter((tier) => tier.price_cents > 0);
  const paidOnSale = paidTiers.some((tier) => tier.status === 'on_sale');
  const ticketSetupReady = !tiersLoading && !tiersError && !payoutError && payout !== undefined && paidOnSale && payoutReady;
  const setupMessage = tiersError || payoutError ? 'Check ticket and payout setup below.' : tiersLoading
    ? 'checking your ticket setup.'
    : paidTiers.length === 0
      ? 'add a paid ticket and set its price below.'
      : payout === undefined
        ? 'checking payout setup.'
      : !payoutReady
        ? 'finish payout setup, then put your ticket on sale.'
        : !paidOnSale
          ? 'put your paid ticket on sale.'
          : 'your tickets are ready. return to review the event.';
  // law 11: three or four, one of them recommended
  const recommendedId = recommendedTierId(tiers);
  const tiersFull = tiersLoading || tiersError || tiers.length >= TIER_COUNT_MAX;
  // C-19: the confirmation preview's price line -- the cheapest tier
  // currently set up, regardless of on-sale state (this is the organizer's
  // own setup view, not the public buyer page).
  const cheapestTier = tiers.length > 0 ? tiers.reduce((lo, t) => (t.price_cents < lo.price_cents ? t : lo)) : null;
  const cheapestPriceLabel = cheapestTier ? (cheapestTier.price_cents === 0 ? 'free' : formatCents(cheapestTier.price_cents)) : null;
  // §3.8 house rule (also trigger-enforced): at most 11 active questions
  const questionsFull = questionsLoading || questionsError || questions.length >= QUESTIONS_MAX;
  const questionMeta = (q: TicketQuestion): string => {
    const parts = [questionTypeLabel(q.qtype), q.required ? 'required' : 'optional'];
    parts.push(q.scope === 'per_attendee' ? 'each ticket' : 'per order');
    return parts.join(' · ');
  };
  const returnToEvent = () => {
    if (!active || !scope.isCurrent()) return;
    if (router.canGoBack()) router.back();
    // The existing event entry gate resolves owner/team/ordinary provenance.
    else router.replace(`/creator/event-form?id=${id}` as never);
  };


  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={returnToEvent} style={styles.headerControl} accessibilityRole="button" accessibilityLabel="Back">
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2} />
        </TouchableOpacity>
        {/* copy to the taste gate */}
        <Text style={styles.headerTitle}>Tickets</Text>
        {/* Build 35 Screen 44: sales operations live on their own screen now
            rather than growing this one past 38K (matrix's own instruction) */}
        <TouchableOpacity
          onPress={() => { hapticLight(); router.push(`/creator/ticket-sales?id=${id}` as never); }}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="ticket sales"
          style={styles.headerControl}
        >
          {/* copy to the taste gate */}
          <Text style={styles.salesLink}>Sales</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {eventError && <SetupReadNotice label="Event details couldn’t be loaded." retry={() => { void retryEvent(); }} />}
        {!!event && <Text style={styles.eventTitle}>{event.title}</Text>}

        {setup === '1' && (
          <View style={styles.setupCard} accessibilityLabel="ticketed event setup">
            <Text style={styles.setupKicker}>ticketed event setup</Text>
            <Text style={styles.setupTitle}>{tiersError || payoutError ? 'check ticket setup' : ticketSetupReady ? 'tickets are ready' : 'finish making it sellable'}</Text>
            <Text style={styles.setupMeta}>{setupMessage}</Text>
            {ticketSetupReady && (
              <TouchableOpacity
                style={styles.setupBtn}
                onPress={() => { hapticLight(); returnToEvent(); }}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="review event"
              >
                <Text style={styles.setupBtnText}>review event</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* tiers */}
        <View style={styles.sectionHeader}>
          <Ticket size={18} color={Colors.asphalt} strokeWidth={2} />
          {/* copy to the taste gate */}
          <Text style={styles.sectionTitle}>the tickets</Text>
        </View>

        {!!savedTierName && (
          <View style={styles.savedNotice} accessibilityRole="alert">
            <Text style={styles.savedNoticeText}>{savedTierName} it is saved below.</Text>
          </View>
        )}

        {tiersError && <SetupReadNotice label="Tickets couldn’t be refreshed." retry={() => { void retryTiers(); }} />}
        {availabilityError && <SetupReadNotice label="Availability couldn’t be checked." retry={() => { void retryAvailability(); }} />}
        {tiersLoading ? (
          <ActivityIndicator size="small" color={Colors.terracotta} />
        ) : tiers.length === 0 ? (
          /* copy to the taste gate (the empty-state invitation rule) */
          tiersError ? null : <Text style={styles.emptyText}>Add your first ticket or free RSVP.</Text>
        ) : (
          tiers.map((tier) => (
            <View key={tier.id} style={[styles.tierCard, styles.managementCard]}>
            <TouchableOpacity
              style={styles.editRow}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${tier.name}`}
              disabled={management.blocked || !!pendingTierDraft}
              onPress={() => {
                if (pendingTierDraft || management.isBlocked() || !scope.isCurrent()) return;
                hapticLight();
                // Build 35 Screen 23/59: a free (rsvp) tier gets its own named
                // settings destination instead of the generic ticket editor.
                if (tier.price_cents === 0) {
                  router.push(`/creator/rsvp-settings?id=${id}&tierId=${tier.id}` as never);
                  return;
                }
                setSavedTierName(null);
                setTierRecordId(tier.id);
                setEditingTier(tier);
                setEditorVisible(true);
              }}
              activeOpacity={0.85}
            >
              <View style={styles.tierCardBody}>
                <View style={styles.tierNameRow}>
                  <Text style={styles.tierName}>{tier.name}</Text>
                  {tier.id === recommendedId && (
                    <View style={styles.popularBadge}>
                      {/* copy to the taste gate (law 11) */}
                      <Text style={styles.popularBadgeText}>most popular</Text>
                    </View>
                  )}
                  {tier.quantity_cap !== null && availability.has(tier.id) &&
                    isLowInventory(availability.get(tier.id)!, tier.quantity_cap) && (
                      <View style={styles.lowInventoryBadge}>
                        <Text style={styles.lowInventoryBadgeText}>{availability.get(tier.id)} left</Text>
                      </View>
                  )}
                </View>
                <Text style={styles.tierMeta}>
                  {tier.price_cents === 0 ? 'free' : formatCents(tier.price_cents)}
                  {tier.quantity_cap != null ? ` · ${tier.quantity_cap} total` : ''}
                  {tier.visibility === 'hidden' ? ' · hidden' : ''}
                </Text>
                {/* draft is the state that silently loses sales, so it says
                    what it MEANS instead of hiding in the meta line */}
                {tier.status === 'on_sale' ? (
                  /* copy to the taste gate */
                  <Text style={styles.stateOnSale}>on sale</Text>
                ) : (
                  /* copy to the taste gate */
                  <Text style={styles.stateDraft}>nobody can buy this yet</Text>
                )}
              </View>
              <ChevronRight size={18} color={Colors.textMedium} />
            </TouchableOpacity>
            <View style={styles.managementActions}>
                <TouchableOpacity
                  style={styles.managementAction}
                  accessibilityLabel={`${tier.status === 'on_sale' ? 'Pause sales for' : 'Start sales for'} ${tier.name}`}
                  onPress={() => handleToggleSale(tier)}
                  disabled={management.blocked}
                  accessibilityRole="button"
                >
                  {/* copy to the taste gate: the flip that makes a tier
                      buyable (RLS shows buyers on_sale tiers only) */}
                  <Text style={styles.tierSaleLink}>
                    {tier.status === 'on_sale' ? 'pause sales' : 'put it on sale'}
                  </Text>
                </TouchableOpacity>
              <TouchableOpacity style={styles.managementAction} accessibilityRole="button" accessibilityLabel={`Remove ${tier.name}`} disabled={management.blocked} onPress={() => handleDeleteTier(tier)}>
                <Text style={styles.tierRemove}>remove</Text>
              </TouchableOpacity>
            </View>
            </View>
          ))
        )}

        <View style={styles.ticketActions}>
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.addBtn, tiersFull && styles.addBtnDisabled]}
          onPress={() => {
            if (management.isBlocked()) return;
            if (pendingTierDraft) { setEditorVisible(true); return; }
            if (tiersFull) return;
            hapticLight();
            setSavedTierName(null);
            setTierRecordId(randomUUID());
            setEditingTier(null);
            setNewTierPreset(undefined);
            setEditorVisible(true);
          }}
          disabled={(tiersFull && !pendingTierDraft) || management.blocked}
          activeOpacity={0.85}
        >
          <Plus size={18} color={EventAction.secondaryLabel} strokeWidth={2.5} />
          {/* copy to the taste gate */}
          <Text style={styles.addBtnText}>{pendingTierDraft ? 'Continue ticket' : 'add a ticket'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.addBtn, tiersFull && styles.addBtnDisabled]}
          onPress={() => {
            if (management.isBlocked()) return;
            if (tiersFull) return;
            hapticLight();
            // Build 35 Screen 23/59: "Free RSVP" is now a named destination
            // (rsvp-settings) rather than the generic ticket editor sheet
            // with a pre-filled name -- see that screen's own header.
            router.push(`/creator/rsvp-settings?id=${id}&tierId=new` as never);
          }}
          disabled={tiersFull || management.blocked}
          activeOpacity={0.85}
        >
          <Plus size={18} color={EventAction.secondaryLabel} strokeWidth={2.5} />
          {/* copy to the taste gate */}
          <Text style={styles.addBtnText}>add an rsvp</Text>
        </TouchableOpacity>

        </View>

        {tiers.length >= TIER_COUNT_MAX && (
          /* copy to the taste gate: law 11's cap, framed as taste not a
             limit - more options measurably reduce sales */
          <Text style={styles.emptyText}>four is the most. fewer choices sell better.</Text>
        )}

        {/* codes (doc 113): ticket_promo_codes is live, so this ships now */}
        {/* payouts (doc 61 §2): the SAME card as the standalone getting-paid
            front door, so the two never drift (7-27 item 4) */}
        {payoutError ? <SetupReadNotice label="Payout setup couldn’t be checked." retry={() => { void retryPayout(); }} /> : <PayoutsCard compact payout={payout} onboardBusy={onboardBusy} onOnboard={handleOnboard} />}

        <View style={styles.sectionHeader}>
          {/* copy to the taste gate */}
          <Text style={styles.sectionTitle}>codes</Text>
        </View>
        {promoError && <SetupReadNotice label="Promo codes couldn’t be refreshed." retry={() => { void retryPromos(); } } />}
        {promoLoading ? <ActivityIndicator size="small" color={Colors.terracotta} /> : promoError && !promoCodes.length ? null : promoCodes.length === 0 ? (
          /* copy to the taste gate */
          <Text style={styles.emptyText}>Offer a discount with a code.</Text>
        ) : (
          promoCodes.map((p) => (
            <View key={p.id} style={[styles.tierCard, styles.managementCard]}>
              <View style={styles.tierCardBody}>
                <Text style={styles.tierName}>{p.code}</Text>
                <Text style={styles.tierMeta}>
                  {/* canon: percent is 1-100, flat is cents */}
                  {p.discount_type === 'percent' ? `${p.discount_value}% off` : `${formatCents(p.discount_value)} off`}
                  {p.max_uses != null ? ` · ${p.uses_count} of ${p.max_uses} used` : ` · ${p.uses_count} used`}
                  {p.unlocks_hidden ? ' · unlocks hidden' : ''}
                  {p.active ? '' : ' · paused'}
                </Text>
              </View>
              <View style={styles.managementActions}>
                <TouchableOpacity
                  style={styles.managementAction}
                  accessibilityLabel={`${p.active ? 'Pause' : 'Activate'} code ${p.code}`}
                  onPress={() => { hapticLight(); requestManagement({kind:"promo-active",eventId:id!,recordId:p.id,label:p.code,expected:p.active}); }}
                  disabled={management.blocked}
                  accessibilityRole="button"
                >
                  {/* copy to the taste gate */}
                  <Text style={styles.tierSaleLink}>{p.active ? 'pause it' : 'turn it back on'}</Text>
                </TouchableOpacity>
              <TouchableOpacity style={styles.managementAction} accessibilityRole="button" accessibilityLabel={`Remove code ${p.code}`} disabled={management.blocked} onPress={() => handleDeletePromo(p)}>
                <Text style={styles.tierRemove}>remove</Text>
              </TouchableOpacity>
              </View>
            </View>
          ))
        )}
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.addBtn}
          disabled={promoLoading || promoError || management.blocked}
          onPress={() => { if (promoLoading || promoError || management.isBlocked()) return; hapticLight(); if(!pendingPromo)setPromoRecordId(randomUUID()); setPromoEditorVisible(true); }}
          activeOpacity={0.85}
        >
          <Plus size={18} color={EventAction.secondaryLabel} strokeWidth={2.5} />
          {/* copy to the taste gate */}
          <Text style={styles.addBtnText}>{pendingPromo?'Continue code':'add a code'}</Text>
        </TouchableOpacity>

        {/* extras (doc 114): event_add_ons is live, so this ships now */}
        <View style={styles.sectionHeader}>
          {/* copy to the taste gate */}
          <Text style={styles.sectionTitle}>extras</Text>
        </View>
        {addonsError && <SetupReadNotice label="Extras couldn’t be refreshed." retry={() => { void retryAddons(); } } />}
        {addonsLoading ? <ActivityIndicator size="small" color={Colors.terracotta} /> : addonsError && !addons.length ? null : addons.length === 0 ? (
          /* copy to the taste gate */
          <Text style={styles.emptyText}>Add parking, food or something extra.</Text>
        ) : (
          addons.map((a) => {
            const left = addonRemaining(a);
            return (
              <View key={a.id} style={[styles.tierCard, styles.managementCard]}>
              <TouchableOpacity
                style={styles.editRow}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${a.name}`}
                disabled={management.blocked}
                onPress={() => { hapticLight(); setEditingAddon(a); setAddonEditorVisible(true); }}
                activeOpacity={0.85}
              >
                <View style={styles.tierCardBody}>
                  <Text style={styles.tierName}>{a.name}</Text>
                  <Text style={styles.tierMeta}>
                    {a.price_cents === 0 ? 'free' : formatCents(a.price_cents)}
                    {left != null ? ` · ${left} of ${a.quantity_cap} left` : ''}
                  </Text>
                  {a.status === 'on_sale' ? (
                    /* copy to the taste gate */
                    <Text style={styles.stateOnSale}>on sale</Text>
                  ) : (
                    /* copy to the taste gate */
                    <Text style={styles.stateDraft}>nobody can buy this yet</Text>
                  )}
                </View>
                <ChevronRight size={18} color={Colors.textMedium} />
              </TouchableOpacity>
              <View style={styles.managementActions}>
                  <TouchableOpacity
                    style={styles.managementAction}
                    accessibilityLabel={`${a.status === 'on_sale' ? 'Pause sales for' : 'Start sales for'} ${a.name}`}
                    onPress={() => { hapticLight(); requestManagement({kind:"extra-sale",eventId:id!,recordId:a.id,label:a.name,expected:a.status}); }}
                    disabled={management.blocked}
                    accessibilityRole="button"
                  >
                    {/* copy to the taste gate: buyers only ever see on_sale extras */}
                    <Text style={styles.tierSaleLink}>
                      {a.status === 'on_sale' ? 'pause sales' : 'put it on sale'}
                    </Text>
                  </TouchableOpacity>
                <TouchableOpacity style={styles.managementAction} accessibilityRole="button" accessibilityLabel={`Remove ${a.name}`} disabled={management.blocked} onPress={() => handleDeleteAddon(a)}>
                  <Text style={styles.tierRemove}>remove</Text>
                </TouchableOpacity>
              </View>
              </View>
            );
          })
        )}
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.addBtn}
          disabled={addonsLoading || addonsError || management.blocked}
          onPress={() => { if (addonsLoading || addonsError || management.isBlocked()) return; hapticLight(); setEditingAddon(null); setAddonEditorVisible(true); }}
          activeOpacity={0.85}
        >
          <Plus size={18} color={EventAction.secondaryLabel} strokeWidth={2.5} />
          {/* copy to the taste gate */}
          <Text style={styles.addBtnText}>add an extra</Text>
        </TouchableOpacity>

        {/* FAQs (proposal 70; doc 76 names the section) */}
        <View style={styles.sectionHeader}>
          {/* copy to the taste gate (doc 76 §2) */}
          <Text style={styles.sectionTitle}>good to know</Text>
        </View>
        {faqError ? <SetupReadNotice label="FAQs couldn’t be loaded." retry={() => { void retryFaqs(); }} /> : faqLoading ? <ActivityIndicator size="small" color={Colors.terracotta} /> : faqState?.available === false ? (
          /* copy to the taste gate */
          <Text style={styles.emptyText}>faq cards are almost ready. check back soon.</Text>
        ) : (
          <>
            {(faqState?.faqs ?? []).map((faq) => (
              <View key={faq.id} style={styles.faqCard}>
                <View style={styles.tierCardBody}>
                  <Text style={styles.tierName}>{faq.question}</Text>
                  <Text style={styles.tierMeta} numberOfLines={2}>{faq.answer}</Text>
                </View>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove FAQ: ${faq.question}`} disabled={management.blocked} onPress={() => handleRemoveFaq(faq.id)} hitSlop={10}>
                  <Text style={styles.tierRemove}>remove</Text>
                </TouchableOpacity>
              </View>
            ))}
            <TextInput
              style={styles.faqInput}
              editable={!faqSaving && !faqAttempt}
              value={faqQuestion}
              onChangeText={setFaqQuestion}
              accessibilityLabel="FAQ question"
              placeholder="is there parking?"
              placeholderTextColor={Colors.textLight}
              maxLength={FAQ_QUESTION_MAX}
            />
            <TextInput
              style={[styles.faqInput, styles.faqInputAnswer]}
              editable={!faqSaving && !faqAttempt}
              value={faqAnswer}
              onChangeText={setFaqAnswer}
              accessibilityLabel="FAQ answer"
              placeholder="your answer"
              placeholderTextColor={Colors.textLight}
              multiline
              maxLength={FAQ_ANSWER_MAX}
            />
            <TouchableOpacity
              style={[styles.faqAddBtn, (!faqQuestion.trim() || !faqAnswer.trim()) && styles.faqAddBtnDisabled]}
              onPress={handleAddFaq}
              accessibilityRole="button"
              accessibilityLabel={faqAttempt ? "Retry FAQ save" : "Save FAQ"}
              disabled={faqSaving || !faqQuestion.trim() || !faqAnswer.trim() || management.blocked}
              activeOpacity={0.85}
            >
              {/* copy to the taste gate */}
              <Text style={styles.faqAddBtnText}>{faqSaving?'Saving…':faqAttempt?'Retry save':'add it'}</Text>
            </TouchableOpacity>
            {faqProblem && <Text accessibilityRole="alert" style={styles.emptyText}>{faqProblem}</Text>}
            {faqAttempt && !faqSaving && <TouchableOpacity accessibilityRole="button" style={styles.managementAction} onPress={()=>{setFaqAttempt(null);setFaqProblem(undefined);setFaqQuestion('');setFaqAnswer('');void retryFaqs();}}><Text style={styles.tierMeta}>Discard draft</Text></TouchableOpacity>}
          </>
        )}

        {/* buyer questions (§3.8): up to 11. Rendered like the tiers list.
            2026-08-28 correction: the 2026-08-27 note here was stale --
            begin_ticket_checkout already enforces every active required
            question atomically before Stripe is ever involved (confirmed by
            reading the live function directly; closed per 75-threshold spec
            item 1d, specs/washedup-75-THRESHOLD-SPEC-v1-20260828.md). The
            cited live-function-correctness-audit-20260824.md finding is
            narrower and unrelated: the 11-question cap is raceable, not that
            required answers can be skipped. */}
        <View style={styles.sectionHeader}>
          {/* copy to the taste gate */}
          <Text style={styles.sectionTitle}>what you'll ask buyers</Text>
        </View>
        {/* copy to the taste gate */}
        {questions.length > 0 && <Text style={styles.emptyText}>Asked at checkout.</Text>}

        {questionsError && <SetupReadNotice label="Questions couldn’t be refreshed." retry={() => { void retryQuestions(); }} /> }
        {questionsLoading ? (
          <ActivityIndicator size="small" color={Colors.terracotta} />
        ) : questions.length === 0 ? (
          /* copy to the taste gate (empty-state invitation) */
          questionsError ? null : <Text style={styles.emptyText}>Add a question if you need something from buyers.</Text>
        ) : (
          questions.map((q) => (
            <TouchableOpacity
              key={q.id}
              style={styles.tierCard}
              onPress={() => {
                hapticLight();
                router.push(`/creator/question-editor?id=${id}&questionId=${q.id}` as never);
              }}
              activeOpacity={0.85}
            >
              <View style={styles.tierCardBody}>
                <Text style={styles.tierName} numberOfLines={2}>{q.prompt}</Text>
                <Text style={styles.tierMeta}>{questionMeta(q)}</Text>
              </View>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove question: ${q.prompt}`} disabled={management.blocked} onPress={() => handleRemoveQuestion(q)} hitSlop={10}>
                <Text style={styles.tierRemove}>remove</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          ))
        )}

        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.addBtn, questionsFull && styles.addBtnDisabled]}
          onPress={() => {
            if (questionsFull || management.isBlocked()) return;
            hapticLight();
            router.push(`/creator/question-editor?id=${id}&questionId=new` as never);
          }}
          disabled={questionsFull || management.blocked}
          activeOpacity={0.85}
        >
          <Plus size={18} color={EventAction.secondaryLabel} strokeWidth={2.5} />
          {/* copy to the taste gate */}
          <Text style={styles.addBtnText}>add a question</Text>
        </TouchableOpacity>

        {questions.length >= QUESTIONS_MAX && (
          /* copy to the taste gate: the 11 house rule, framed as taste */
          <Text style={styles.emptyText}>Keep questions brief. You can ask up to eleven.</Text>
        )}

        {/* C-19: read-only preview of doc 111's confirmation screen (the
            SAME organizerNote card app/tickets/order/[id].tsx renders). The
            message is set on the event details form, not here -- this
            section never collects new input. */}
        <View style={styles.sectionHeader}>
          {/* copy to the taste gate */}
          <Text style={styles.sectionTitle}>what buyers see after they pay</Text>
        </View>
        {!!cheapestPriceLabel && (
          /* copy to the taste gate */
          <Text style={styles.emptyText}>tickets from {cheapestPriceLabel}</Text>
        )}
        {noteError ? <SetupReadNotice label="The creator note couldn’t be loaded." retry={() => { void retryNote(); }} /> : noteLoading ? <ActivityIndicator size="small" color={Colors.terracotta} /> : confirmationMessage ? (
          <View style={styles.organizerNote}>
            {/* copy to the taste gate */}
            <Text style={styles.organizerNoteLabel}>from the organizer</Text>
            <Text style={styles.organizerNoteText}>{confirmationMessage}</Text>
          </View>
        ) : (
          /* copy to the taste gate (empty-state invitation rule) */
          <Text style={styles.emptyText}>nothing set yet. add a note in your event details and buyers will see it here.</Text>
        )}
        {CREATOR_PAGES_ENABLED && active && <EventSaleAlertPreference eventId={id} />}
      </ScrollView>
      {management.storageError&&<SetupReadNotice label={management.storageError} retry={()=>void management.reload()}/>}
      {management.notice&&<View style={styles.readNotice} accessibilityRole="alert"><Text style={styles.readNoticeText}>{management.notice}</Text></View>}
      {management.recovery && <View style={styles.actionRecovery} accessibilityRole="alert">
          <Text style={styles.tierName}>{management.busy ? 'Saving…' : 'Check saved status'}</Text>
          <Text numberOfLines={2} style={styles.tierMeta}>{management.recovery.action.label}</Text>
          {!management.busy && <>
            <Text style={styles.tierMeta}>{management.recovery.message ?? (management.recovery.state === 'unchanged' ? management.recovery.action.requestId?'The original removal is not confirmed. Check again or retry the same removal.':'The last check found no change. Retry the same action or leave it for now.' : management.recovery.state === 'changed' ? 'This item has changed. Reload it before choosing another action.' : 'The result could not be confirmed. Check before making another change.')}</Text>
            <View style={styles.managementActions}>
              <TouchableOpacity accessibilityRole="button" style={styles.managementAction} onPress={() => void management.check()}><Text style={styles.tierSaleLink}>Check status</Text></TouchableOpacity>
              {management.recovery.state === 'unchanged' && <TouchableOpacity accessibilityRole="button" style={styles.managementAction} onPress={() => void management.retry()}><Text style={styles.tierSaleLink}>Retry change</Text></TouchableOpacity>}
              {management.recovery.state === 'unchanged' && !management.recovery.action.requestId && <TouchableOpacity accessibilityRole="button" style={styles.managementAction} onPress={management.dismiss}><Text style={styles.tierMeta}>Not now</Text></TouchableOpacity>}
              {management.recovery.state === 'changed' && <TouchableOpacity accessibilityRole="button" style={styles.managementAction} onPress={() => { management.dismiss(); void retryTiers(); void retryAddons(); void retryPromos(); void retryQuestions(); void retryFaqs(); }}><Text style={styles.tierSaleLink}>Reload</Text></TouchableOpacity>}
            </View>
          </>}
        </View>}

      <TierEditorSheet
        visible={active && editorVisible}
        tier={editingTier}
        commissionBps={payout?.commissionBps ?? 400}
        busy={saveTierMutation.isPending}
        initialName={newTierPreset}
        initialDraft={pendingTierDraft}
        onDiscard={() => { setEditorVisible(false); setEditingTier(null); setPendingTierDraft(null); setNewTierPreset(undefined); void invalidateTiers(); }}
        draftKey={tierRecordId}
        scope={scope}
        onSave={async (draft) => {
          if (!scope.isCurrent()) throw Error('This event visit is no longer active.');
          setPendingTierDraft(draft);
          await saveTierMutation.mutateAsync({draft,recordId:tierRecordId,eventId:id!,baseline:editingTier,scope});
        }}
        onClose={() => {
          setEditorVisible(false);
          if (!pendingTierDraft) { setEditingTier(null); setNewTierPreset(undefined); }
        }}
      />

      <PromotionEditorSheet
        visible={active && promoEditorVisible}
        busy={savePromoMutation.isPending}
        draftKey={promoRecordId}
        scope={scope}
        onSave={async draft => {if(!scope.isCurrent())throw Error('This event visit is no longer active.');setPendingPromo(draft);await savePromoMutation.mutateAsync({draft,id:promoRecordId,eventId:id!,scope});}}
        onDiscard={()=>{setPendingPromo(null);setPromoEditorVisible(false);void retryPromos();}}
        onClose={() => setPromoEditorVisible(false)}
      />

      {extraScope && <AddonEditorSheet
        eventId={id!}
        scope={extraScope}
        visible={active && addonEditorVisible}
        addon={editingAddon}
        busy={saveAddonMutation.isPending}
        onSave={(draft,recordId,write,baseline,dispatch) => saveAddonMutation.mutateAsync({draft,recordId,eventId:id!,isNew:!editingAddon,scope:extraScope,write,baseline,dispatch})}
        onClose={() => {
          setAddonEditorVisible(false);
          setEditingAddon(null);
        }}
      />}

      <BrandedAlert
        visible={active && !!alertInfo}
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message}
        buttons={alertInfo?.buttons}
        onClose={() => setAlertInfo(null)}
      />
    </SafeAreaView>
  );
}

function createStyles(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  ticketActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  readNotice: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  readNoticeText: { flex: 1, fontFamily: fonts.regular, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  readRetry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  readRetryText: { fontFamily: fonts.semibold, fontSize: FontSizes.bodySM, color: Colors.terracotta },

  container: { flex: 1, backgroundColor: Colors.parchment },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 4, gap: 8 },
  headerControl: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'left', fontFamily: fonts.semibold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  headerSpacer: { flex: 1 },
  salesLink: { fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  content: { padding: 20, paddingTop: 12, paddingBottom: 40, gap: 10 },
  eventTitle: { fontFamily: fonts.display, fontSize: FontSizes.displayMD, lineHeight: 34, color: Colors.asphalt, marginBottom: 6 },
  setupCard: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: EventAction.primary,
    padding: EventSpacing.md,
    gap: EventSpacing.xs,
  },
  setupKicker: {
    fontFamily: fonts.semibold,
    fontSize: FontSizes.caption,
    color: EventAction.primary,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  setupTitle: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  setupMeta: { fontFamily: fonts.regular, fontSize: FontSizes.bodySM, color: Colors.textMedium, lineHeight: 19 },
  setupBtn: {
    backgroundColor: EventAction.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: EventSpacing.xs,
  },
  setupBtnText: { fontFamily: fonts.semibold, fontSize: FontSizes.bodySM, color: EventAction.onPrimary },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 22, marginBottom: 2 },
  sectionTitle: { flexShrink: 1, fontFamily: fonts.medium, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  emptyText: { fontFamily: fonts.regular, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  savedNotice: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.gold,
    padding: 12,
  },
  savedNoticeText: { fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: Colors.asphalt },
  tierCard: {
    backgroundColor: 'transparent',
    borderRadius: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  tierCardBody: { flex: 1, gap: 2 },
  actionRecovery: { backgroundColor: Colors.white, paddingHorizontal: 20, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border, gap: 4 },
  managementCard: { flexDirection: 'column', alignItems: 'stretch', gap: 8, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 2, backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  managementActions: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', columnGap: 16 },
  managementAction: { minWidth: 44, minHeight: 44, justifyContent: 'center', flexShrink: 1 },
  tierNameRow: { flexWrap: 'wrap', flexDirection: 'row', alignItems: 'center', gap: EventSpacing.sm },
  tierName: { fontFamily: fonts.medium, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  // the recommended marker is the GOLD family, never a second accent
  stateOnSale: { fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: Colors.brandDeep },
  stateDraft: { fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: Colors.errorBrand },
  popularBadge: {
    backgroundColor: EventAction.successFill,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  popularBadgeText: { fontFamily: fonts.semibold, fontSize: FontSizes.micro, color: Colors.brandDeep },
  // C-19/TK-07: same terracotta urgency pill as PlanCard's spotsLeftBadge
  lowInventoryBadge: {
    backgroundColor: Colors.terracotta,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  lowInventoryBadgeText: {
    fontFamily: fonts.semibold,
    fontSize: 10,
    color: Colors.white,
    lineHeight: 14,
  },
  addBtnDisabled: { opacity: 0.4 },
  tierMeta: { lineHeight: 20, fontFamily: fonts.regular, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  tierRemove: { fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: EventAction.error },
  // a ghost link, not a second filled button (law 1)
  tierSaleLink: { fontFamily: fonts.semibold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  // law 1: the payout CTA is this screen's single primary action, so
  // add-a-ticket takes the secondary treatment rather than competing
  addBtn: {
    alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 0,
    paddingVertical: 10, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 6,
  },
  addBtnText: { fontFamily: fonts.semibold, fontSize: FontSizes.bodySM, color: EventAction.secondaryLabel },
  faqCard: {
    backgroundColor: 'transparent',
    borderRadius: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  faqInput: {
    backgroundColor: Colors.inputBg,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.regular,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  faqInputAnswer: { minHeight: 64, textAlignVertical: 'top' },
  faqAddBtn: {
    minHeight: 44, justifyContent: 'center',
    alignSelf: 'flex-start',
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  faqAddBtnDisabled: { opacity: 0.4 },
  faqAddBtnText: { fontFamily: fonts.semibold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  // C-19: same organizerNote card app/tickets/order/[id].tsx renders (doc
  // 111's documented gold-border quote treatment) -- token-identical, no
  // new accent invented for this screen.
  organizerNote: {
    alignSelf: 'stretch', backgroundColor: Colors.white, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    borderLeftWidth: 2, borderLeftColor: Colors.goldAccent,
    padding: 14, marginTop: EventSpacing.xs, gap: 4,
  },
  organizerNoteLabel: {
    fontFamily: fonts.medium, fontSize: FontSizes.caption, color: Colors.tertiary,
    letterSpacing: 0.5, textTransform: 'uppercase',
  },
  organizerNoteText: { fontFamily: fonts.regular, fontSize: FontSizes.bodyMD, color: Colors.quoteText, lineHeight: 20 },
}); }
function useStyles() { const {fonts}=useAfterglowFonts(true, 'creator'); return useMemo(()=>createStyles(fonts),[fonts]); }
