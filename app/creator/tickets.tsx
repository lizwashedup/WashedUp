/**
 * The organizer's ticket setup for one event (doc 61 §5, launch sprint
 * 7-21): payout status up top (64's row, read-only; onboarding via the
 * declared edge contract), the tier list with the editor sheet, and the
 * FAQ editor - dormant until proposal 70's re-cut applies.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { useLocalSearchParams, router } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Ticket } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { EventAction, EventSpacing } from '../../constants/EventDesign';
import { hapticLight, hapticSuccess, hapticError } from '../../lib/haptics';
import { supabase } from '../../lib/supabase';
import { openUrl } from '../../lib/url';
import {
  createEventFaq,
  createTier,
  deleteTier,
  FAQ_ANSWER_MAX,
  FAQ_QUESTION_MAX,
  formatCents,
  getEventFaqs,
  getMyPayoutState,
  getQuestions,
  getTiers,
  isPayoutReady,
  createQuestion,
  updateQuestion,
  retireQuestion,
  questionTypeLabel,
  QUESTIONS_MAX,
  recommendedTierId,
  requestOnboardingLink,
  TIER_COUNT_MAX,
  updateEventFaq,
  updateTier,
  type TicketQuestion,
  type TicketTier,
  type TierDraft,
} from '../../lib/ticketing';
import {
  addonRemaining,
  createAddon,
  createPromoCode,
  deleteAddon,
  deletePromoCode,
  listAddons,
  listPromoCodes,
  setPromoActive,
  updateAddon,
  type AddonDraft,
  type EventAddon,
  type PromoCode,
  type PromoDraft,
} from '../../lib/ticketPromosAddons';
import { PayoutsCard } from '../../components/creator/PayoutsCard';
import { TierEditorSheet } from '../../components/creator/TierEditorSheet';
import { QuestionEditorSheet, type QuestionDraft } from '../../components/creator/QuestionEditorSheet';
import { PromotionEditorSheet } from '../../components/creator/PromotionEditorSheet';
import { AddonEditorSheet } from '../../components/creator/AddonEditorSheet';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';

export default function TicketSetupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingTier, setEditingTier] = useState<TicketTier | null>(null);
  const [questionEditorVisible, setQuestionEditorVisible] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<TicketQuestion | null>(null);
  const [onboardBusy, setOnboardBusy] = useState(false);
  const [faqQuestion, setFaqQuestion] = useState('');
  const [faqAnswer, setFaqAnswer] = useState('');
  // docs 113/114: both sections are invisible until their table probe
  // succeeds (the doc-111 join-gate pattern), self-flipping on schema apply
  const [promoEditorVisible, setPromoEditorVisible] = useState(false);
  const [addonEditorVisible, setAddonEditorVisible] = useState(false);
  const [editingAddon, setEditingAddon] = useState<EventAddon | null>(null);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null)).catch(() => {});
  }, []);

  const { data: event } = useQuery({
    queryKey: ['ticket-setup-event', id],
    queryFn: async () => {
      const { data } = await supabase
        .from('explore_events')
        .select('id, title, event_date')
        .eq('id', id!)
        .maybeSingle();
      return data ?? null;
    },
    enabled: !!id,
    staleTime: 60_000,
  });

  const { data: payout } = useQuery({
    queryKey: ['payout-state', userId],
    queryFn: () => getMyPayoutState(userId!),
    enabled: !!userId,
    staleTime: 30_000,
  });

  const { data: tiers = [], isLoading: tiersLoading } = useQuery({
    queryKey: ['ticket-tiers', id],
    queryFn: () => getTiers(id!),
    enabled: !!id,
    staleTime: 15_000,
  });

  const { data: faqState } = useQuery({
    queryKey: ['event-faqs', id],
    queryFn: () => getEventFaqs(id!),
    enabled: !!id,
    staleTime: 30_000,
  });

  const { data: questions = [], isLoading: questionsLoading } = useQuery({
    queryKey: ['ticket-questions', id],
    queryFn: () => getQuestions(id!),
    enabled: !!id,
    staleTime: 15_000,
  });

  const { data: promoCodes = [] } = useQuery({
    queryKey: ['ticket-promo-codes', id],
    queryFn: () => listPromoCodes(id!),
    enabled: !!id,
    staleTime: 15_000,
  });
  const { data: addons = [] } = useQuery({
    queryKey: ['event-add-ons', id],
    queryFn: () => listAddons(id!),
    enabled: !!id,
    staleTime: 15_000,
  });

  const invalidateTiers = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['ticket-tiers', id] });
  }, [queryClient, id]);

  const invalidateQuestions = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['ticket-questions', id] });
  }, [queryClient, id]);

  const saveQuestionMutation = useMutation({
    mutationFn: async (draft: QuestionDraft) => {
      const result = editingQuestion
        ? await updateQuestion(editingQuestion.id, draft)
        : await createQuestion(id!, draft, questions.length);
      if (!result.ok) throw new Error(result.message ?? 'save failed');
    },
    onSuccess: () => {
      hapticSuccess();
      setQuestionEditorVisible(false);
      setEditingQuestion(null);
      invalidateQuestions();
    },
    onError: (e: any) => {
      hapticError();
      setAlertInfo({ title: 'that did not save', message: e?.message ?? 'give it another try.' });
    },
  });

  const handleRemoveQuestion = useCallback((question: TicketQuestion) => {
    setAlertInfo({
      /* copy to the taste gate */
      title: 'remove this question?',
      message: question.prompt,
      buttons: [
        { text: 'keep it', style: 'cancel' },
        {
          text: 'remove it',
          onPress: async () => {
            const ok = await retireQuestion(question.id);
            if (ok) {
              hapticSuccess();
              invalidateQuestions();
            } else {
              hapticError();
            }
          },
        },
      ],
    });
  }, [invalidateQuestions]);

  const savePromoMutation = useMutation({
    mutationFn: async (draft: PromoDraft) => {
      const result = await createPromoCode(id!, draft);
      if (!result.ok) throw new Error(result.message ?? 'save failed');
    },
    onSuccess: () => {
      hapticSuccess();
      setPromoEditorVisible(false);
      queryClient.invalidateQueries({ queryKey: ['ticket-promo-codes', id] });
    },
    onError: (e: any) => {
      hapticError();
      setAlertInfo({ title: 'that did not save', message: e?.message ?? 'give it another try.' });
    },
  });

  const togglePromoMutation = useMutation({
    mutationFn: async (promo: PromoCode) => {
      const result = await setPromoActive(promo.id, !promo.active);
      if (!result.ok) throw new Error(result.message ?? 'save failed');
    },
    onSuccess: () => {
      hapticSuccess();
      queryClient.invalidateQueries({ queryKey: ['ticket-promo-codes', id] });
    },
    onError: (e: any) => {
      hapticError();
      setAlertInfo({ title: 'that did not save', message: e?.message ?? 'give it another try.' });
    },
  });

  const handleDeletePromo = useCallback((promo: PromoCode) => {
    setAlertInfo({
      /* copy to the taste gate */
      title: 'remove this code?',
      message: promo.code,
      buttons: [
        { text: 'keep it', style: 'cancel' },
        {
          text: 'remove it',
          style: 'destructive',
          onPress: async () => {
            const ok = await deletePromoCode(promo.id);
            if (ok) {
              hapticSuccess();
              queryClient.invalidateQueries({ queryKey: ['ticket-promo-codes', id] });
            } else {
              hapticError();
            }
          },
        },
      ],
    });
  }, [queryClient, id]);

  const saveAddonMutation = useMutation({
    mutationFn: async (draft: AddonDraft) => {
      const result = editingAddon
        ? await updateAddon(editingAddon.id, draft)
        : await createAddon(id!, draft);
      if (!result.ok) throw new Error(result.message ?? 'save failed');
    },
    onSuccess: () => {
      hapticSuccess();
      setAddonEditorVisible(false);
      setEditingAddon(null);
      queryClient.invalidateQueries({ queryKey: ['event-add-ons', id] });
    },
    onError: (e: any) => {
      hapticError();
      setAlertInfo({ title: 'that did not save', message: e?.message ?? 'give it another try.' });
    },
  });

  const toggleAddonSaleMutation = useMutation({
    mutationFn: async (addon: EventAddon) => {
      const next = addon.status === 'on_sale' ? 'draft' : 'on_sale';
      const result = await updateAddon(addon.id, { status: next });
      if (!result.ok) throw new Error(result.message ?? 'save failed');
    },
    onSuccess: () => {
      hapticSuccess();
      queryClient.invalidateQueries({ queryKey: ['event-add-ons', id] });
    },
    onError: (e: any) => {
      hapticError();
      setAlertInfo({ title: 'that did not save', message: e?.message ?? 'give it another try.' });
    },
  });

  const handleDeleteAddon = useCallback((addon: EventAddon) => {
    setAlertInfo({
      /* copy to the taste gate */
      title: 'remove this extra?',
      message: addon.name,
      buttons: [
        { text: 'keep it', style: 'cancel' },
        {
          text: 'remove it',
          style: 'destructive',
          onPress: async () => {
            const ok = await deleteAddon(addon.id);
            if (ok) {
              hapticSuccess();
              queryClient.invalidateQueries({ queryKey: ['event-add-ons', id] });
            } else {
              hapticError();
            }
          },
        },
      ],
    });
  }, [queryClient, id]);

  const saveTierMutation = useMutation({
    mutationFn: async (draft: TierDraft) => {
      const result = editingTier
        ? await updateTier(editingTier.id, draft)
        : await createTier(id!, draft, tiers.length);
      if (!result.ok) throw new Error(result.message ?? 'save failed');
    },
    onSuccess: () => {
      hapticSuccess();
      setEditorVisible(false);
      setEditingTier(null);
      invalidateTiers();
    },
    onError: (e: any) => {
      hapticError();
      setAlertInfo({ title: 'that did not save', message: e?.message ?? 'give it another try.' });
    },
  });

  // buyers only ever SEE a tier once it is on_sale on a Live event (RLS), so
  // this flip is how tickets become buyable at all. Going on sale with a PAID
  // tier requires both Stripe capabilities (the P3 selling gate); there is no
  // server-side gate until proposal 87 lands, so this client check is the law
  // for now. Free tiers flip freely: free checkout never touches Stripe.
  const toggleSaleMutation = useMutation({
    mutationFn: async (tier: TicketTier) => {
      const next = tier.status === 'on_sale' ? 'closed' : 'on_sale';
      const result = await updateTier(tier.id, { status: next });
      if (!result.ok) throw new Error(result.message ?? 'save failed');
    },
    onSuccess: () => {
      hapticSuccess();
      invalidateTiers();
    },
    onError: (e: any) => {
      hapticError();
      setAlertInfo({ title: 'that did not save', message: e?.message ?? 'give it another try.' });
    },
  });

  const handleToggleSale = useCallback((tier: TicketTier) => {
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
    toggleSaleMutation.mutate(tier);
  }, [payout, toggleSaleMutation]);

  const handleDeleteTier = useCallback((tier: TicketTier) => {
    setAlertInfo({
      /* copy to the taste gate */
      title: 'remove this ticket?',
      message: tier.name,
      buttons: [
        { text: 'keep it', style: 'cancel' },
        {
          text: 'remove it',
          onPress: async () => {
            const ok = await deleteTier(tier.id);
            if (ok) {
              hapticSuccess();
              invalidateTiers();
            } else {
              hapticError();
            }
          },
        },
      ],
    });
  }, [invalidateTiers]);

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

  const handleAddFaq = useCallback(async () => {
    if (!id || !faqQuestion.trim() || !faqAnswer.trim()) return;
    const ok = await createEventFaq(
      id,
      faqQuestion.trim().slice(0, FAQ_QUESTION_MAX),
      faqAnswer.trim().slice(0, FAQ_ANSWER_MAX),
      faqState?.faqs.length ?? 0,
    );
    if (ok) {
      hapticSuccess();
      setFaqQuestion('');
      setFaqAnswer('');
      queryClient.invalidateQueries({ queryKey: ['event-faqs', id] });
    } else {
      hapticError();
    }
  }, [id, faqQuestion, faqAnswer, faqState?.faqs.length, queryClient]);

  const handleRemoveFaq = useCallback(async (faqId: string) => {
    const ok = await updateEventFaq(faqId, { is_active: false });
    if (ok) queryClient.invalidateQueries({ queryKey: ['event-faqs', id] });
  }, [queryClient, id]);

  const payoutReady = isPayoutReady(payout);
  // law 11: three or four, one of them recommended
  const recommendedId = recommendedTierId(tiers);
  const tiersFull = tiers.length >= TIER_COUNT_MAX;
  // §3.8 house rule (also trigger-enforced): at most 11 active questions
  const questionsFull = questions.length >= QUESTIONS_MAX;
  const questionMeta = (q: TicketQuestion): string => {
    const parts = [questionTypeLabel(q.qtype), q.required ? 'required' : 'optional'];
    parts.push(q.scope === 'per_attendee' ? 'each ticket' : 'per order');
    return parts.join(' · ');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2} />
        </TouchableOpacity>
        {/* copy to the taste gate */}
        <Text style={styles.headerTitle}>tickets</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!!event && <Text style={styles.eventTitle}>{event.title}</Text>}

        {/* payouts (doc 61 §2): the SAME card as the standalone getting-paid
            front door, so the two never drift (7-27 item 4) */}
        <PayoutsCard payout={payout} onboardBusy={onboardBusy} onOnboard={handleOnboard} />

        {/* tiers */}
        <View style={styles.sectionHeader}>
          <Ticket size={18} color={Colors.asphalt} strokeWidth={2} />
          {/* copy to the taste gate */}
          <Text style={styles.sectionTitle}>the tickets</Text>
        </View>

        {tiersLoading ? (
          <ActivityIndicator size="small" color={Colors.terracotta} />
        ) : tiers.length === 0 ? (
          /* copy to the taste gate (the empty-state invitation rule) */
          <Text style={styles.emptyText}>no tickets yet. the first one takes a minute.</Text>
        ) : (
          tiers.map((tier) => (
            <TouchableOpacity
              key={tier.id}
              style={styles.tierCard}
              onPress={() => {
                hapticLight();
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
                </View>
                <Text style={styles.tierMeta}>
                  {tier.price_cents === 0 ? 'free' : formatCents(tier.price_cents)}
                  {tier.quantity_cap ? ` · ${tier.quantity_cap} exist` : ''}
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
                <TouchableOpacity
                  onPress={() => handleToggleSale(tier)}
                  disabled={toggleSaleMutation.isPending}
                  hitSlop={8}
                  accessibilityRole="button"
                >
                  {/* copy to the taste gate: the flip that makes a tier
                      buyable (RLS shows buyers on_sale tiers only) */}
                  <Text style={styles.tierSaleLink}>
                    {tier.status === 'on_sale' ? 'pause sales' : 'put it on sale'}
                  </Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity onPress={() => handleDeleteTier(tier)} hitSlop={10}>
                <Text style={styles.tierRemove}>remove</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          ))
        )}

        <TouchableOpacity
          style={[styles.addBtn, tiersFull && styles.addBtnDisabled]}
          onPress={() => {
            if (tiersFull) return;
            hapticLight();
            setEditingTier(null);
            setEditorVisible(true);
          }}
          disabled={tiersFull}
          activeOpacity={0.85}
        >
          <Plus size={18} color={EventAction.secondaryLabel} strokeWidth={2.5} />
          {/* copy to the taste gate */}
          <Text style={styles.addBtnText}>add a ticket</Text>
        </TouchableOpacity>

        {tiersFull && (
          /* copy to the taste gate: law 11's cap, framed as taste not a
             limit - more options measurably reduce sales */
          <Text style={styles.emptyText}>four is the most. fewer choices sell better.</Text>
        )}

        {/* codes (doc 113): ticket_promo_codes is live, so this ships now */}
        <View style={styles.sectionHeader}>
          {/* copy to the taste gate */}
          <Text style={styles.sectionTitle}>codes</Text>
        </View>
        {promoCodes.length === 0 ? (
          /* copy to the taste gate */
          <Text style={styles.emptyText}>no codes yet. early birds love one.</Text>
        ) : (
          promoCodes.map((p) => (
            <View key={p.id} style={styles.tierCard}>
              <View style={styles.tierCardBody}>
                <Text style={styles.tierName}>{p.code}</Text>
                <Text style={styles.tierMeta}>
                  {/* canon: percent is 1-100, flat is cents */}
                  {p.discount_type === 'percent' ? `${p.discount_value}% off` : `${formatCents(p.discount_value)} off`}
                  {p.max_uses != null ? ` · ${p.uses_count} of ${p.max_uses} used` : ` · ${p.uses_count} used`}
                  {p.unlocks_hidden ? ' · unlocks hidden' : ''}
                  {p.active ? '' : ' · paused'}
                </Text>
                <TouchableOpacity
                  onPress={() => { hapticLight(); togglePromoMutation.mutate(p); }}
                  disabled={togglePromoMutation.isPending}
                  hitSlop={8}
                  accessibilityRole="button"
                >
                  {/* copy to the taste gate */}
                  <Text style={styles.tierSaleLink}>{p.active ? 'pause it' : 'turn it back on'}</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity onPress={() => handleDeletePromo(p)} hitSlop={10}>
                <Text style={styles.tierRemove}>remove</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => { hapticLight(); setPromoEditorVisible(true); }}
          activeOpacity={0.85}
        >
          <Plus size={18} color={EventAction.secondaryLabel} strokeWidth={2.5} />
          {/* copy to the taste gate */}
          <Text style={styles.addBtnText}>add a code</Text>
        </TouchableOpacity>

        {/* extras (doc 114): event_add_ons is live, so this ships now */}
        <View style={styles.sectionHeader}>
          {/* copy to the taste gate */}
          <Text style={styles.sectionTitle}>extras</Text>
        </View>
        {addons.length === 0 ? (
          /* copy to the taste gate */
          <Text style={styles.emptyText}>no extras yet. parking, food, merch, whatever goes with the night.</Text>
        ) : (
          addons.map((a) => {
            const left = addonRemaining(a);
            return (
              <TouchableOpacity
                key={a.id}
                style={styles.tierCard}
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
                  <TouchableOpacity
                    onPress={() => { hapticLight(); toggleAddonSaleMutation.mutate(a); }}
                    disabled={toggleAddonSaleMutation.isPending}
                    hitSlop={8}
                    accessibilityRole="button"
                  >
                    {/* copy to the taste gate: buyers only ever see on_sale extras */}
                    <Text style={styles.tierSaleLink}>
                      {a.status === 'on_sale' ? 'pause sales' : 'put it on sale'}
                    </Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity onPress={() => handleDeleteAddon(a)} hitSlop={10}>
                  <Text style={styles.tierRemove}>remove</Text>
                </TouchableOpacity>
              </TouchableOpacity>
            );
          })
        )}
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => { hapticLight(); setEditingAddon(null); setAddonEditorVisible(true); }}
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
        {faqState?.available === false ? (
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
                <TouchableOpacity onPress={() => handleRemoveFaq(faq.id)} hitSlop={10}>
                  <Text style={styles.tierRemove}>remove</Text>
                </TouchableOpacity>
              </View>
            ))}
            <TextInput
              style={styles.faqInput}
              value={faqQuestion}
              onChangeText={setFaqQuestion}
              placeholder="is there parking?"
              placeholderTextColor={Colors.textLight}
              maxLength={FAQ_QUESTION_MAX}
            />
            <TextInput
              style={[styles.faqInput, styles.faqInputAnswer]}
              value={faqAnswer}
              onChangeText={setFaqAnswer}
              placeholder="your answer"
              placeholderTextColor={Colors.textLight}
              multiline
              maxLength={FAQ_ANSWER_MAX}
            />
            <TouchableOpacity
              style={[styles.faqAddBtn, (!faqQuestion.trim() || !faqAnswer.trim()) && styles.faqAddBtnDisabled]}
              onPress={handleAddFaq}
              disabled={!faqQuestion.trim() || !faqAnswer.trim()}
              activeOpacity={0.85}
            >
              {/* copy to the taste gate */}
              <Text style={styles.faqAddBtnText}>add it</Text>
            </TouchableOpacity>
          </>
        )}

        {/* buyer questions (§3.8): asked right after purchase, up to 11,
            never blocking the sale. Rendered like the tiers list. */}
        <View style={styles.sectionHeader}>
          {/* copy to the taste gate */}
          <Text style={styles.sectionTitle}>what you'll ask buyers</Text>
        </View>
        {/* copy to the taste gate (§3.8 timing) */}
        <Text style={styles.emptyText}>asked right after they buy, never in the way of the sale.</Text>

        {questionsLoading ? (
          <ActivityIndicator size="small" color={Colors.terracotta} />
        ) : questions.length === 0 ? (
          /* copy to the taste gate (empty-state invitation) */
          <Text style={styles.emptyText}>no questions yet. add one if you need something from buyers.</Text>
        ) : (
          questions.map((q) => (
            <TouchableOpacity
              key={q.id}
              style={styles.tierCard}
              onPress={() => {
                hapticLight();
                setEditingQuestion(q);
                setQuestionEditorVisible(true);
              }}
              activeOpacity={0.85}
            >
              <View style={styles.tierCardBody}>
                <Text style={styles.tierName} numberOfLines={2}>{q.prompt}</Text>
                <Text style={styles.tierMeta}>{questionMeta(q)}</Text>
              </View>
              <TouchableOpacity onPress={() => handleRemoveQuestion(q)} hitSlop={10}>
                <Text style={styles.tierRemove}>remove</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          ))
        )}

        <TouchableOpacity
          style={[styles.addBtn, questionsFull && styles.addBtnDisabled]}
          onPress={() => {
            if (questionsFull) return;
            hapticLight();
            setEditingQuestion(null);
            setQuestionEditorVisible(true);
          }}
          disabled={questionsFull}
          activeOpacity={0.85}
        >
          <Plus size={18} color={EventAction.secondaryLabel} strokeWidth={2.5} />
          {/* copy to the taste gate */}
          <Text style={styles.addBtnText}>add a question</Text>
        </TouchableOpacity>

        {questionsFull && (
          /* copy to the taste gate: the 11 house rule, framed as taste */
          <Text style={styles.emptyText}>eleven is the most. the shorter the list, the more people finish it.</Text>
        )}
      </ScrollView>

      <TierEditorSheet
        visible={editorVisible}
        tier={editingTier}
        commissionBps={payout?.commissionBps ?? 400}
        busy={saveTierMutation.isPending}
        onSave={(draft) => saveTierMutation.mutate(draft)}
        onClose={() => {
          setEditorVisible(false);
          setEditingTier(null);
        }}
      />

      <QuestionEditorSheet
        visible={questionEditorVisible}
        question={editingQuestion}
        busy={saveQuestionMutation.isPending}
        onSave={(draft) => saveQuestionMutation.mutate(draft)}
        onClose={() => {
          setQuestionEditorVisible(false);
          setEditingQuestion(null);
        }}
      />

      <PromotionEditorSheet
        visible={promoEditorVisible}
        busy={savePromoMutation.isPending}
        onSave={(draft) => savePromoMutation.mutate(draft)}
        onClose={() => setPromoEditorVisible(false)}
      />

      <AddonEditorSheet
        visible={addonEditorVisible}
        addon={editingAddon}
        busy={saveAddonMutation.isPending}
        onSave={(draft) => saveAddonMutation.mutate(draft)}
        onClose={() => {
          setAddonEditorVisible(false);
          setEditingAddon(null);
        }}
      />

      <BrandedAlert
        visible={!!alertInfo}
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message}
        buttons={alertInfo?.buttons}
        onClose={() => setAlertInfo(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, gap: 12 },
  headerTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  headerSpacer: { flex: 1 },
  content: { padding: 20, paddingBottom: 40, gap: 10 },
  eventTitle: { fontFamily: Fonts.displayBold, fontSize: FontSizes.displayMD, color: Colors.asphalt, marginBottom: 4 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, marginBottom: 4 },
  sectionTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  emptyText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  tierCard: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  tierCardBody: { flex: 1, gap: 2 },
  tierNameRow: { flexDirection: 'row', alignItems: 'center', gap: EventSpacing.sm },
  tierName: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  // the recommended marker is the GOLD family, never a second accent
  stateOnSale: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.brandDeep },
  stateDraft: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.errorBrand },
  popularBadge: {
    backgroundColor: EventAction.successFill,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  popularBadgeText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.micro, color: Colors.brandDeep },
  addBtnDisabled: { opacity: 0.4 },
  tierMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  tierRemove: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: EventAction.error },
  // a ghost link, not a second filled button (law 1)
  tierSaleLink: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.terracotta, marginTop: 4 },
  // law 1: the payout CTA is this screen's single primary action, so
  // add-a-ticket takes the secondary treatment rather than competing
  addBtn: {
    borderWidth: 1.5,
    borderColor: EventAction.secondaryBorder,
    borderRadius: 999,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: EventSpacing.xs,
  },
  addBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: EventAction.secondaryLabel },
  faqCard: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  faqInput: {
    backgroundColor: Colors.inputBg,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  faqInputAnswer: { minHeight: 64, textAlignVertical: 'top' },
  faqAddBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  faqAddBtnDisabled: { opacity: 0.4 },
  faqAddBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
});
