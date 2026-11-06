import { interestSignalList, isInterestId } from './interestSignalList';
import { supabase } from './supabase';
import { buildDuplicatePostParams, type DuplicateSourceEvent } from './duplicatePlan';
import { requestWithDeadline } from './requestWithDeadline';

const TIMEOUT_MS = 8000;

type SimilarPlanSource = DuplicateSourceEvent & {
  id: string;
  status: string;
  circle_id?: string | null;
  circle_metadata_known?: boolean;
};

// A completed source is still useful for "next time". Circle plans retain
// their existing no-duplication boundary; unreadable sources fail the RLS read.
export function canMakeSimilarPlan(plan: SimilarPlanSource): boolean {
  return plan.allow_duplicate === true && !plan.circle_id &&
    plan.circle_metadata_known !== false &&
    ['forming', 'active', 'full', 'completed'].includes(plan.status);
}

export function buildSimilarPlanParams(source: DuplicateSourceEvent, requestId: string): Record<string, string> {
  return {
    ...buildDuplicatePostParams({
      ...source,
      start_time: null,
      end_time: null,
      tickets_url: null,
      explore_event_id: null,
    }, null),
    // The Post tab can already be mounted with another draft. This marks a
    // fresh prefill, including explicitly clearing prior people and dates.
    similarPlanRequest: requestId,
    draftId: '',
    prefillInvitePersonId: '',
    prefillInvitePersonName: '',
    prefillInvitePersonPhoto: '',
  };
}

export async function fetchSimilarPlanParams(eventId: string, requestId: string): Promise<Record<string, string>> {
  const { data, error } = await requestWithDeadline(
    supabase.from('events').select(
      'id, title, description, start_time, end_time, drop_in, allow_duplicate, location_text, location_lat, location_lng, image_url, primary_vibe, gender_rule, max_invites, target_age_min, target_age_max, tickets_url, neighborhood, explore_event_id, circle_id, status',
    ).eq('id', eventId).single(),
    TIMEOUT_MS,
  );
  if (error) throw error;
  if (!data || data.id !== eventId || data.circle_id !== null || !canMakeSimilarPlan(data)) {
    throw new Error('This plan is no longer available to copy.');
  }
  return buildSimilarPlanParams(data, requestId);
}

export async function removeInterestedPlan(eventId: string, isCurrent: () => boolean): Promise<boolean> {
  // Read the current account's active signal rather than trusting an old card
  // or using an event id where the existing RPC requires a signal id.
  const { data, error } = await requestWithDeadline(supabase.rpc('get_user_interest_signals'), TIMEOUT_MS);
  if (error) throw error;
  const list = interestSignalList(data);
  if (error !== null || !list) throw new Error('Could not check your interest. Please try again.');
  if (!isCurrent()) return false;
  const signal = list.find(row => row.event_id === eventId);
  if (!signal) return true; // A fresh read confirms it is already inactive.
  if (!isInterestId(signal.signal_id)) throw new Error('Could not check your interest. Please try again.');
  const result = await requestWithDeadline(
    supabase.rpc('remove_interest_signal', { p_signal_id: signal.signal_id }),
    TIMEOUT_MS,
  );
  // The deployed void RPC checks ownership and persists status=removed;
  // a successful response also covers an already-inactive signal on retry.
  if (result?.error !== null) throw result?.error ?? new Error('Could not confirm removal.');
  return true;
}
