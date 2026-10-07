/**
 * Pure helper for the Manage Plan photo field (screen: app/plan/[id].tsx).
 *
 * Bug (Liz, live report): opening Manage Plan on a posted plan showed
 * title/date/description as editable but had no way to change the plan's
 * photo at all -- it was never wired up, not merely hidden or broken.
 * This mirrors the same pick/upload/persist pattern already shipped for
 * plan creation in components/post/PlanComposerV2.tsx, reusing its exact
 * ImagePicker + uploadBase64ToStorage('event-images', ...) path rather
 * than inventing a new one.
 */

/**
 * Resolves what to persist for events.image_url from the manage-modal's
 * local photo state when Save is pressed.
 *
 * Only a real uploaded (http/https) URL is ever persisted. A local
 * file:// URI (still mid-upload, or left over from a cancelled/failed
 * upload), an empty string, or null all resolve to null -- clearing the
 * photo rather than writing a broken local reference into the shared
 * `events.image_url` column, which every other member's device would
 * then try (and fail) to load. Same guard already used at plan-creation
 * time in components/post/PlanComposerV2.tsx.
 */
export function resolveManagePlanImageUrl(editImageUrl: string | null): string | null {
  return editImageUrl && editImageUrl.startsWith('http') ? editImageUrl : null;
}
