export interface CommunityUpdateAttempt { id: string; body: string }
export interface CommunityUpdateDraft { body: string; attempt: CommunityUpdateAttempt | null }
export const EMPTY_COMMUNITY_UPDATE: CommunityUpdateDraft = { body: '', attempt: null };
export function validCommunityUpdateDraft(value: unknown): value is CommunityUpdateDraft {
  const draft = value as CommunityUpdateDraft;
  return !!draft && typeof draft.body === 'string' && draft.body.length <= 4000 &&
    (draft.attempt === null || !!draft.attempt &&
      typeof draft.attempt.id === 'string' && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(draft.attempt.id) &&
      typeof draft.attempt.body === 'string' && !!draft.attempt.body.trim() &&
      draft.attempt.body === draft.body.trim() && draft.attempt.body.length <= 4000);
}
