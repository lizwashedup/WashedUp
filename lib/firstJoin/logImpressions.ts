/**
 * Impression/choice logging for first-join surfaces (spec a2): each showing of
 * the three cards should write user_id + shown_event_ids + action to a
 * `first_join_prompts` table so conversion per ranking weight is measurable.
 *
 * STUB: `first_join_prompts` does not exist on prod yet (verified 2026-07-16)
 * and migrations are gated. This no-ops until the table ships in step 2b with
 * an approved migration; the call sites are already wired so flipping this on
 * is a one-file change.
 */

export type FirstJoinPromptAction = 'shown' | 'card_tap' | 'wishlist' | 'later' | 'rebook_offer';

export interface FirstJoinPromptLog {
  userId: string;
  shownEventIds: string[];
  action: FirstJoinPromptAction;
  /** The tapped plan, when the action is card_tap. */
  eventId?: string;
}

export async function logFirstJoinPrompt(entry: FirstJoinPromptLog): Promise<void> {
  if (__DEV__) {
    console.log('[firstJoin] prompt log (stub, table pending migration):', entry);
  }
  // Intentionally a no-op in production until first_join_prompts exists.
}
