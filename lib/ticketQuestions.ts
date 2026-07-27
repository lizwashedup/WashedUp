/**
 * Buyer questions (92B §3.8), against the LIVE ticket_questions table (read
 * from prod 2026-07-26). The write door is the RLS policy itself: insert /
 * update / delete are gated by is_ticketing_organizer(event_id, auth.uid()),
 * so these are direct table calls, no RPC. A DB trigger caps an event at 11
 * ACTIVE questions and a CHECK binds the options shape; both are mirrored here
 * so the builder never sends a row the server will refuse.
 *
 * There is NO helper_text column on prod. §3.8 lists per-question helper text,
 * but the live schema omits it, so this build cannot store it. Flagged to
 * Cowork; adding it needs a column (a numbered proposal), not client code.
 */

import { supabase } from './supabase';
import { friendlyError } from './friendlyError';

// the DB trigger tg_ticket_questions_cap raises past this; mirror it so the
// builder disables "add" instead of surfacing a raw error
export const QUESTION_MAX = 11;
export const PROMPT_MAX = 500;
export const OPTION_MAX = 50;
export const OPTION_LABEL_MAX = 200;

export type QuestionType =
  | 'short_text'
  | 'paragraph'
  | 'multi_select'
  | 'single_select'
  | 'dropdown'
  | 'terms';

export type QuestionScope = 'per_order' | 'per_attendee';

/** the six types in §3.8 order. Labels are LIZ COPY (taste gate). */
export const QUESTION_TYPES: { value: QuestionType; label: string; needsOptions: boolean }[] = [
  { value: 'short_text', label: 'short answer', needsOptions: false },
  { value: 'paragraph', label: 'long answer', needsOptions: false },
  { value: 'single_select', label: 'pick one', needsOptions: true },
  { value: 'multi_select', label: 'pick many', needsOptions: true },
  { value: 'dropdown', label: 'dropdown', needsOptions: true },
  { value: 'terms', label: 'agree to terms', needsOptions: false },
];

/** the options-shape CHECK: only these three carry an options array. */
export function typeNeedsOptions(t: QuestionType): boolean {
  return t === 'multi_select' || t === 'single_select' || t === 'dropdown';
}

export function questionTypeLabel(t: QuestionType): string {
  return QUESTION_TYPES.find((x) => x.value === t)?.label ?? t;
}

export interface TicketQuestion {
  id: string;
  event_id: string;
  prompt: string;
  qtype: QuestionType;
  options: string[] | null;
  required: boolean;
  scope: QuestionScope;
  sort_order: number;
  is_active: boolean;
}

export interface QuestionDraft {
  prompt: string;
  qtype: QuestionType;
  options: string[] | null;
  required: boolean;
  scope: QuestionScope;
}

/** Active questions for an event, in display order. Organizer-visible via RLS. */
export async function getEventQuestions(eventId: string): Promise<TicketQuestion[]> {
  const { data, error } = await supabase
    .from('ticket_questions')
    .select('id, event_id, prompt, qtype, options, required, scope, sort_order, is_active')
    .eq('event_id', eventId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as TicketQuestion[];
}

/** null options for text/terms, a real array for choice types (the CHECK). */
function optionsForType(qtype: QuestionType, options: string[] | null): string[] | null {
  if (!typeNeedsOptions(qtype)) return null;
  return (options ?? [])
    .map((o) => o.trim().slice(0, OPTION_LABEL_MAX))
    .filter((o) => o.length > 0)
    .slice(0, OPTION_MAX);
}

export async function createQuestion(
  eventId: string,
  draft: QuestionDraft,
  sortOrder: number,
): Promise<{ ok: boolean; message?: string }> {
  const { error } = await supabase.from('ticket_questions').insert({
    event_id: eventId,
    prompt: draft.prompt.trim().slice(0, PROMPT_MAX),
    qtype: draft.qtype,
    options: optionsForType(draft.qtype, draft.options),
    required: draft.required,
    scope: draft.scope,
    sort_order: sortOrder,
  });
  if (error) return { ok: false, message: friendlyError(error, 'Give it another try.') };
  return { ok: true };
}

export async function updateQuestion(
  id: string,
  draft: QuestionDraft,
): Promise<{ ok: boolean; message?: string }> {
  const { error } = await supabase
    .from('ticket_questions')
    .update({
      prompt: draft.prompt.trim().slice(0, PROMPT_MAX),
      qtype: draft.qtype,
      options: optionsForType(draft.qtype, draft.options),
      required: draft.required,
      scope: draft.scope,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) return { ok: false, message: friendlyError(error, 'Give it another try.') };
  return { ok: true };
}

/**
 * Soft delete (is_active=false). The cap trigger counts only active rows, so
 * this frees a slot, and any answers already tied to the question survive
 * (§3.8: answers are retained). Mirrors the FAQ removal pattern.
 */
export async function deactivateQuestion(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('ticket_questions')
    .update({ is_active: false })
    .eq('id', id);
  return !error;
}
