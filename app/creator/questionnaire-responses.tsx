/**
 * Event questionnaire responses (Build 35 Screen 54, a sub-destination of
 * Attendees -- delta matrix route: creator/attendees -> Event -> Attendees
 * -> Questionnaire responses). attendees.tsx already reads per-seat answers
 * inline (expand a row to see them) and exports the same CSV web has; the
 * one piece the matrix names as still missing is this: an event-wide view
 * with per-question filters and aggregate counts for choice questions.
 *
 * Choice-type questions (single_select/dropdown/multi_select --
 * lib/ticketing.ts's QUESTION_TYPES_WITH_OPTIONS) get a tappable breakdown
 * (value + count, including a "blank" bucket) that doubles as the answer
 * filter -- tap a bucket to narrow the list to it, tap again to clear.
 * Free-text questions have no natural bucket, so they only show inside the
 * per-attendee expanded panel, same as attendees.tsx.
 *
 * Read-only: refund and check-in actions live only on attendees.tsx. Reuses
 * that screen's exact data reads (getEventAttendees/getEventQuestions/
 * getEventAnswers/attachAnswers) and its CSV export -- no new tables, no new
 * RPCs, per the delta matrix's own "do not scope this as new work end to
 * end."
 */

import React, { useCallback, useMemo, useState } from 'react';
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
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { EventSpacing } from '../../constants/EventDesign';
import { hapticLight } from '../../lib/haptics';
import { attendeesToCsv } from '../../lib/ticketing';
import {
  aggregateChoiceAnswers,
  attachAnswers,
  choicesFromRawAnswer,
  getEventAnswers,
  getEventAttendees,
  getEventQuestions,
} from '../../lib/ticketAttendees';

type SortMode = 'name' | 'recent';
/** value === null means "blank" (unanswered) */
type AnswerFilter = { questionId: string; value: string | null } | null;

export default function QuestionnaireResponsesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [query, setQuery] = useState('');
  const [tier, setTier] = useState<string | null>(null);
  const [answerFilter, setAnswerFilter] = useState<AnswerFilter>(null);
  const [sortMode, setSortMode] = useState<SortMode>('name');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const { data: attendees = [], isLoading } = useQuery({
    queryKey: ['event-attendees', id],
    queryFn: () => getEventAttendees(id!),
    enabled: !!id,
    staleTime: 10_000,
  });
  const { data: questions = [] } = useQuery({
    queryKey: ['event-questions', id],
    queryFn: () => getEventQuestions(id!),
    enabled: !!id,
    staleTime: 30_000,
  });
  const orderIds = useMemo(() => Array.from(new Set(attendees.map((a) => a.orderId))), [attendees]);
  const orderIdsKey = orderIds.join(',');
  const { data: answerRows = [] } = useQuery({
    queryKey: ['event-answers', id, orderIdsKey],
    queryFn: () => getEventAnswers(orderIds),
    enabled: !!id && questions.length > 0 && orderIds.length > 0,
    staleTime: 10_000,
  });

  const withAnswers = useMemo(
    () => attachAnswers(attendees, questions, answerRows),
    [attendees, questions, answerRows],
  );

  const tiers = useMemo(
    () => Array.from(new Set(attendees.map((a) => a.tierName).filter((t): t is string => !!t))),
    [attendees],
  );

  // Search + ticket-type only -- the base the aggregate panel counts
  // against, so selecting one answer bucket doesn't collapse every other
  // bucket's own count (faceted-search convention, see aggregateChoiceAnswers).
  const bySearchAndTier = useMemo(() => {
    const q = query.trim().toLowerCase();
    return withAnswers.filter((a) => {
      if (q && !a.buyerName.toLowerCase().includes(q) && !a.referenceCode.toLowerCase().includes(q)) return false;
      if (tier && a.tierName !== tier) return false;
      return true;
    });
  }, [withAnswers, query, tier]);

  const aggregates = useMemo(
    () => aggregateChoiceAnswers(bySearchAndTier, questions),
    [bySearchAndTier, questions],
  );

  const questionById = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions]);

  const filtered = useMemo(() => {
    if (!answerFilter) return bySearchAndTier;
    const q = questionById.get(answerFilter.questionId);
    return bySearchAndTier.filter((a) => {
      const raw = a.answers[answerFilter.questionId];
      if (answerFilter.value === null) return !raw;
      if (!raw) return false;
      if (q?.qtype === 'multi_select') {
        return choicesFromRawAnswer(a.rawAnswers[answerFilter.questionId]).includes(answerFilter.value as string);
      }
      return raw === answerFilter.value;
    });
  }, [bySearchAndTier, answerFilter, questionById]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    if (sortMode === 'name') list.sort((a, b) => a.buyerName.localeCompare(b.buyerName));
    else list.sort((a, b) => (b.purchasedAt ?? '').localeCompare(a.purchasedAt ?? ''));
    return list;
  }, [filtered, sortMode]);

  const toggleExpanded = (positionId: string) => {
    hapticLight();
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(positionId)) next.delete(positionId);
      else next.add(positionId);
      return next;
    });
  };

  const toggleAnswerFilter = (questionId: string, value: string | null) => {
    hapticLight();
    setAnswerFilter((prev) =>
      prev && prev.questionId === questionId && prev.value === value ? null : { questionId, value },
    );
  };

  // Same real share-sheet export and BR-6 filtered-not-full-set convention
  // as attendees.tsx's own handleExportAttendees.
  const handleExport = useCallback(async () => {
    if (sorted.length === 0) return;
    hapticLight();
    try {
      await Share.share({ message: attendeesToCsv(sorted, questions) });
    } catch {
      /* copy to the taste gate */
      Alert.alert('that did not share', 'give it another try in a moment.');
    }
  }, [sorted, questions]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="back">
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2} />
        </TouchableOpacity>
        {/* copy to the taste gate */}
        <Text style={styles.headerTitle}>responses</Text>
      </View>

      {isLoading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={Colors.terracotta} /></View>
      ) : questions.length === 0 ? (
        /* copy to the taste gate (empty-state) */
        <View style={styles.centered}><Text style={styles.empty}>this event has no questions set up.</Text></View>
      ) : (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <TextInput
            style={styles.search}
            value={query}
            onChangeText={setQuery}
            placeholder="search a name or code"
            placeholderTextColor={Colors.textLight}
            autoCorrect={false}
            accessibilityLabel="search attendees by name or reference code"
          />

          {tiers.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
              {tiers.map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.chip, tier === t && styles.chipOn]}
                  onPress={() => { hapticLight(); setTier(tier === t ? null : t); }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: tier === t }}
                >
                  <Text style={[styles.chipText, tier === t && styles.chipTextOn]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {aggregates.map((agg) => (
            <View key={agg.questionId} style={styles.aggCard}>
              <Text style={styles.aggPrompt} numberOfLines={2}>{agg.prompt}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
                {agg.values.map((v) => {
                  const on = answerFilter?.questionId === agg.questionId && answerFilter?.value === v.value;
                  return (
                    <TouchableOpacity
                      key={v.value}
                      style={[styles.chip, on && styles.chipOn]}
                      onPress={() => toggleAnswerFilter(agg.questionId, v.value)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{v.value} ({v.count})</Text>
                    </TouchableOpacity>
                  );
                })}
                {agg.blankCount > 0 && (
                  <TouchableOpacity
                    style={[
                      styles.chip,
                      answerFilter?.questionId === agg.questionId && answerFilter?.value === null && styles.chipOn,
                    ]}
                    onPress={() => toggleAnswerFilter(agg.questionId, null)}
                    accessibilityRole="button"
                    accessibilityState={{
                      selected: answerFilter?.questionId === agg.questionId && answerFilter?.value === null,
                    }}
                  >
                    {/* copy to the taste gate */}
                    <Text
                      style={[
                        styles.chipText,
                        answerFilter?.questionId === agg.questionId && answerFilter?.value === null && styles.chipTextOn,
                      ]}
                    >
                      blank ({agg.blankCount})
                    </Text>
                  </TouchableOpacity>
                )}
              </ScrollView>
            </View>
          ))}

          <View style={styles.toolRow}>
            <View style={styles.sortGroup}>
              {(['name', 'recent'] as SortMode[]).map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[styles.chip, sortMode === m && styles.chipOn]}
                  onPress={() => { hapticLight(); setSortMode(m); }}
                  accessibilityRole="button"
                  accessibilityLabel={m === 'name' ? 'sort a to z' : 'sort most recent first'}
                  accessibilityState={{ selected: sortMode === m }}
                >
                  {/* copy to the taste gate */}
                  <Text style={[styles.chipText, sortMode === m && styles.chipTextOn]}>
                    {m === 'name' ? 'a–z' : 'recent'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {sorted.length > 0 && (
              <TouchableOpacity onPress={handleExport} hitSlop={12} accessibilityRole="button" accessibilityLabel="export responses">
                {/* LIZ COPY */}
                <Text style={styles.exportLink}>export</Text>
              </TouchableOpacity>
            )}
          </View>

          {sorted.length === 0 ? (
            /* copy to the taste gate (empty-state) */
            <Text style={styles.empty}>no one matches that yet.</Text>
          ) : (
            sorted.map((a) => {
              const isExpanded = expandedIds.has(a.positionId);
              return (
                <View key={a.positionId} style={styles.rowGroup}>
                  <TouchableOpacity
                    style={styles.row}
                    onPress={() => toggleExpanded(a.positionId)}
                    accessibilityRole="button"
                    accessibilityLabel={isExpanded ? `hide answers for ${a.buyerName}` : `show answers for ${a.buyerName}`}
                    accessibilityState={{ expanded: isExpanded }}
                  >
                    {isExpanded ? (
                      <ChevronUp size={16} color={Colors.textMedium} strokeWidth={2} />
                    ) : (
                      <ChevronDown size={16} color={Colors.textMedium} strokeWidth={2} />
                    )}
                    <View style={styles.rowBody}>
                      <Text style={styles.rowName} numberOfLines={1}>{a.buyerName}</Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {a.referenceCode}{a.tierName ? ` · ${a.tierName}` : ''}
                      </Text>
                    </View>
                  </TouchableOpacity>
                  {isExpanded && (
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, gap: 12 },
  headerTitle: { flex: 1, fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium, textAlign: 'center', marginTop: EventSpacing.xl },
  body: { paddingHorizontal: 20, paddingBottom: 40, gap: EventSpacing.sm },
  search: {
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 14, paddingVertical: 11,
    fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.asphalt,
  },
  chipsRow: { gap: 8, paddingVertical: 2 },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white, paddingHorizontal: 14, paddingVertical: 8, minHeight: 36, justifyContent: 'center' },
  chipOn: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  chipText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.darkWarm },
  chipTextOn: { color: Colors.white },
  aggCard: {
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    padding: 14, gap: 8,
  },
  aggPrompt: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.asphalt },
  toolRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 2 },
  sortGroup: { flexDirection: 'row', gap: 8 },
  exportLink: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.textMedium },
  rowGroup: {
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 12, minHeight: 44,
  },
  rowBody: { flex: 1, gap: 2 },
  rowName: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  rowMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium, letterSpacing: 0.3 },
  answersPanel: {
    borderTopWidth: 1, borderTopColor: Colors.border,
    paddingHorizontal: 14, paddingVertical: 12, gap: 10,
  },
  answerItem: { gap: 2 },
  answerPrompt: { fontFamily: Fonts.sansBold, fontSize: FontSizes.caption, color: Colors.textMedium, letterSpacing: 0.3 },
  answerValue: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.asphalt },
});
