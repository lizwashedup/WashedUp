/**
 * The organizer's ticket setup for one event (doc 61 §5, launch sprint
 * 7-21): payout status up top (64's row, read-only; onboarding via the
 * declared edge contract), the tier list with the editor sheet, and the
 * FAQ editor - dormant until proposal 70's re-cut applies.
 */

import React, { useCallback, useEffect, useState } from 'react';
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
import { TierEditorSheet } from '../../components/creator/TierEditorSheet';
import { QuestionEditorSheet, type QuestionDraft } from '../../components/creator/QuestionEditorSheet';
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
    const url = await requestOnboardingLink();
    setOnboardBusy(false);
    if (url) {
      openUrl(url);
    } else {
      setAlertInfo({
        /* copy to the taste gate */
        title: 'payout setup is almost ready',
        message: 'the setup link is not live yet. your tickets save now and go on sale the moment it is.',
      });
    }
  }, [onboardBusy]);

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

  const payoutReady = !!payout?.payoutsEnabled && !!payout?.chargesEnabled;
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

        {/* payouts (doc 61 §2: Stripe Express hosts everything) */}
        <View style={styles.payoutCard}>
          {payoutReady ? (
            <>
              {/* copy to the taste gate */}
              <Text style={styles.payoutTitle}>payouts are set up</Text>
              <Text style={styles.payoutMeta}>
                your rate is locked at {((payout?.commissionBps ?? 0) / 100).toFixed(payout && payout.commissionBps % 100 === 0 ? 0 : 2)}% per paid ticket.
              </Text>
            </>
          ) : (
            <>
              {/* copy to the taste gate */}
              <Text style={styles.payoutTitle}>
                {payout?.exists ? 'finish setting up payouts' : 'set up payouts'}
              </Text>
              <Text style={styles.payoutMeta}>
                stripe handles your bank details and identity. washedup never sees them.
              </Text>
              <TouchableOpacity style={styles.payoutBtn} onPress={handleOnboard} activeOpacity={0.85}>
                {onboardBusy ? (
                  <ActivityIndicator size="small" color={Colors.white} />
                ) : (
                  <Text style={styles.payoutBtnText}>
                    {payout?.exists ? 'continue with stripe' : 'start with stripe'}
                  </Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>

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
                  {` · ${tier.status === 'on_sale' ? 'on sale' : tier.status}`}
                </Text>
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
  payoutCard: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    gap: 8,
    marginBottom: 8,
  },
  payoutTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  payoutMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium, lineHeight: 19 },
  payoutBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 6,
  },
  payoutBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.white },
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
