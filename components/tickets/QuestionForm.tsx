/**
 * The organizer's buyer questions, rendered once and shared by both surfaces
 * that ask them: the checkout sheet (before payment, doc 118) and the
 * order-complete screen (after payment, the original C2 home).
 *
 * It used to live only in app/tickets/order/[id].tsx. Checkout needed the
 * same six types, the same per-seat scope rule and the same canonical value
 * shapes, and two copies of that would drift the moment one side changed.
 * The value shapes are canon in lib/ticketing (web's organizer reader and
 * the CSV export read the same rows), so they are built in exactly one place
 * here.
 *
 * Scope rule (Cowork 2026-07-26): a per_attendee question is asked once per
 * ticket in the order (attendee_index = the seat's position_index, 1..qty);
 * a per_order question is asked once (no attendee_index). The database
 * trigger enforces exactly that, so the builders below never guess.
 */

import React from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Check } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { EventAction, EventSpacing } from '../../constants/EventDesign';
import { hapticLight } from '../../lib/haptics';
import type { AnswerValue, CheckoutAnswer, TicketQuestion } from '../../lib/ticketing';

/** the raw per-(question, seat) draft; converted to an AnswerValue at send. */
export interface AnswerRaw {
  text?: string;
  choice?: string;
  choices?: string[];
  accepted?: boolean;
}

/** null seat = a per_order question; a number = a per_attendee seat (1..qty). */
export type Seat = number | null;

/** every draft cell, keyed by cellKey(questionId, seat). */
export type AnswerDraft = Record<string, AnswerRaw>;

/** one filled (question, seat) pair carrying a real value. */
export interface AnswerCell {
  q: TicketQuestion;
  seat: Seat;
  value: AnswerValue;
}

interface QuestionFormProps {
  questions: TicketQuestion[];
  /** the order's ticket count; drives how many seats a per_attendee question asks. */
  qty: number;
  draft: AnswerDraft;
  onCellChange: (questionId: string, seat: Seat, patch: AnswerRaw) => void;
}

export const cellKey = (questionId: string, seat: Seat): string =>
  `${questionId}:${seat ?? 'order'}`;

/** the seats a question is asked for: 1..qty when per_attendee, one null otherwise. */
export function seatsForQuestion(q: TicketQuestion, qty: number): Seat[] {
  return q.scope === 'per_attendee'
    ? Array.from({ length: Math.max(1, qty) }, (_, i) => i + 1)
    : [null];
}

/** build the canonical value shape, or null when the seat was left blank. */
export function toAnswerValue(q: TicketQuestion, raw: AnswerRaw | undefined): AnswerValue | null {
  if (!raw) return null;
  switch (q.qtype) {
    case 'short_text':
    case 'paragraph': {
      const t = (raw.text ?? '').trim();
      return t ? { text: t } : null;
    }
    case 'single_select':
    case 'dropdown': {
      const c = (raw.choice ?? '').trim();
      return c ? { choice: c } : null;
    }
    case 'multi_select': {
      const cs = (raw.choices ?? []).filter((x) => x.trim().length > 0);
      return cs.length ? { choices: cs } : null;
    }
    case 'terms':
      return raw.accepted ? { accepted: true, accepted_at: new Date().toISOString() } : null;
    default:
      return null;
  }
}

/**
 * Every (question, seat) pair that carries a real value, for the CURRENT qty.
 * Seats above qty are excluded rather than deleted, so a buyer who lowers the
 * count and raises it again still has their answers.
 */
export function collectCells(
  questions: TicketQuestion[],
  draft: AnswerDraft,
  qty: number,
): AnswerCell[] {
  const out: AnswerCell[] = [];
  for (const q of questions) {
    for (const seat of seatsForQuestion(q, qty)) {
      const value = toAnswerValue(q, draft[cellKey(q.id, seat)]);
      if (value) out.push({ q, seat, value });
    }
  }
  return out;
}

/**
 * The checkout body payload. attendee_index is OMITTED for a per_order
 * question rather than sent as null, per the doc 118 contract. Returns an
 * empty array when there is nothing to send, and the caller drops the key
 * entirely so a checkout without questions is byte-identical to today's.
 */
export function buildCheckoutAnswers(
  questions: TicketQuestion[],
  draft: AnswerDraft,
  qty: number,
): CheckoutAnswer[] {
  return collectCells(questions, draft, qty).map(({ q, seat, value }) =>
    seat === null
      ? { question_id: q.id, value }
      : { question_id: q.id, value, attendee_index: seat },
  );
}

/**
 * Required prompts still unanswered, for the courtesy gate in the sheet.
 * The server is the real enforcement (doc 118); this only spares the buyer a
 * round trip and names what is missing instead of disabling in silence.
 */
export function missingRequiredPrompts(
  questions: TicketQuestion[],
  draft: AnswerDraft,
  qty: number,
): string[] {
  const missing: string[] = [];
  for (const q of questions) {
    if (!q.required) continue;
    for (const seat of seatsForQuestion(q, qty)) {
      if (!toAnswerValue(q, draft[cellKey(q.id, seat)])) {
        missing.push(seat === null ? q.prompt : `${q.prompt} (ticket ${seat})`);
      }
    }
  }
  return missing;
}

export function QuestionForm({ questions, qty, draft, onCellChange }: QuestionFormProps) {
  const renderInput = (q: TicketQuestion, seat: Seat) => {
    const raw = draft[cellKey(q.id, seat)] ?? {};
    const opts = q.options ?? [];

    if (q.qtype === 'short_text' || q.qtype === 'paragraph') {
      return (
        <TextInput
          style={[styles.qInput, q.qtype === 'paragraph' && styles.qInputMultiline]}
          value={raw.text ?? ''}
          onChangeText={(v) => onCellChange(q.id, seat, { text: v })}
          placeholder="your answer"
          placeholderTextColor={Colors.textLight}
          multiline={q.qtype === 'paragraph'}
          accessibilityLabel={q.prompt}
        />
      );
    }

    if (q.qtype === 'single_select' || q.qtype === 'dropdown') {
      return (
        <View style={styles.chipWrap}>
          {opts.map((opt) => {
            const on = raw.choice === opt;
            return (
              <TouchableOpacity
                key={opt}
                style={[styles.chip, on && styles.chipOn]}
                onPress={() => { hapticLight(); onCellChange(q.id, seat, { choice: on ? '' : opt }); }}
                activeOpacity={0.85}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={opt}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{opt}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      );
    }

    if (q.qtype === 'multi_select') {
      const chosen = raw.choices ?? [];
      return (
        <View style={styles.chipWrap}>
          {opts.map((opt) => {
            const on = chosen.includes(opt);
            return (
              <TouchableOpacity
                key={opt}
                style={[styles.chip, on && styles.chipOn]}
                onPress={() => {
                  hapticLight();
                  onCellChange(q.id, seat, {
                    choices: on ? chosen.filter((c) => c !== opt) : [...chosen, opt],
                  });
                }}
                activeOpacity={0.85}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={opt}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{opt}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      );
    }

    // terms: the prompt IS the agreement text; a single accept toggle
    const accepted = !!raw.accepted;
    return (
      <TouchableOpacity
        style={styles.termsRow}
        onPress={() => { hapticLight(); onCellChange(q.id, seat, { accepted: !accepted }); }}
        activeOpacity={0.85}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: accepted }}
        accessibilityLabel={`I agree: ${q.prompt}`}
      >
        <View style={[styles.checkbox, accepted && styles.checkboxOn]}>
          {accepted && <Check size={14} color={EventAction.onPrimary} strokeWidth={3} />}
        </View>
        {/* copy to the taste gate */}
        <Text style={styles.termsLabel}>I agree</Text>
      </TouchableOpacity>
    );
  };

  return (
    <>
      {questions.map((q) => (
        <View key={q.id} style={styles.qGroup}>
          <Text style={styles.qPrompt}>
            {q.prompt}
            {/* copy to the taste gate */}
            {q.required ? '' : '  (optional)'}
          </Text>
          {seatsForQuestion(q, qty).map((seat) => (
            <View key={cellKey(q.id, seat)} style={styles.qCell}>
              {seat !== null && (
                /* copy to the taste gate: per-seat label for per_attendee */
                <Text style={styles.seatLabel}>ticket {seat}</Text>
              )}
              {renderInput(q, seat)}
            </View>
          ))}
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  qGroup: { gap: EventSpacing.sm },
  qPrompt: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  qCell: { gap: EventSpacing.xs },
  seatLabel: {
    fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.tertiary,
    letterSpacing: 0.5, textTransform: 'uppercase',
  },
  qInput: {
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 14, paddingVertical: 12,
    fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.asphalt,
  },
  qInputMultiline: { minHeight: 72, textAlignVertical: 'top' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderRadius: 999, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white,
    paddingHorizontal: 14, paddingVertical: 9, minHeight: 44, justifyContent: 'center',
  },
  chipOn: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  chipText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.darkWarm },
  chipTextOn: { color: Colors.white },
  termsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, minHeight: 44 },
  checkbox: {
    width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.white,
  },
  checkboxOn: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  termsLabel: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
});
