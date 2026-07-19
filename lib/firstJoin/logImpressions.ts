/**
 * Impression/choice logging for first-join surfaces (spec a2): each showing of
 * the three cards writes user_id + shown_event_ids + action (plus the fallback
 * tier and per-weight score breakdowns) to first_join_prompts, so conversion
 * per ranking weight is measurable.
 *
 * Schema: supabase/migrations/20260716000100_first_join_prompts_and_area_wishlists.sql,
 * applied to prod 2026-07-18 with Liz's approval.
 */
import { supabase } from '../supabase';
import type { FirstJoinScoreBreakdown, FirstJoinTier } from './types';

/** Migration applied to prod 2026-07-18 (Liz-approved); logging is live. */
export const FIRST_JOIN_PROMPTS_TABLE_READY = true;

export type FirstJoinPromptAction = 'shown' | 'card_tap' | 'wishlist' | 'later' | 'rebook_offer';

export interface FirstJoinScoreSnapshot {
  event_id: string;
  score: number;
  breakdown: FirstJoinScoreBreakdown;
}

export interface FirstJoinPromptLog {
  userId: string;
  shownEventIds: string[];
  action: FirstJoinPromptAction;
  /** The tapped plan, when the action is card_tap. */
  eventId?: string;
  /** Which fallback tier produced the card set. */
  tier?: FirstJoinTier;
  /** Per-weight contributions as computed at render time. */
  scoreBreakdowns?: FirstJoinScoreSnapshot[];
}

export async function logFirstJoinPrompt(entry: FirstJoinPromptLog): Promise<void> {
  if (!FIRST_JOIN_PROMPTS_TABLE_READY) {
    if (__DEV__) {
      console.log('[firstJoin] prompt log (stub, migration pending):', entry);
    }
    return;
  }
  const { error } = await supabase.from('first_join_prompts').insert({
    user_id: entry.userId,
    shown_event_ids: entry.shownEventIds,
    action: entry.action,
    event_id: entry.eventId ?? null,
    tier: entry.tier ?? null,
    score_breakdowns: entry.scoreBreakdowns ?? null,
  });
  if (error) console.warn('[firstJoin] prompt log failed:', error.message);
}
