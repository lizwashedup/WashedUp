/**
 * Member-side join flow (doc 09): the join gate a visitor sees and the
 * request they submit. The server RPC re-validates everything; the client
 * checks mirror it so nobody round-trips to learn a field is missing.
 * Answers are stored leader-eyes-only (community_member_answers RLS); on
 * approval the system composes a warm third-person intro card into the main
 * community chat (name, area from zip, question and answer; never the zip).
 */

import { supabase } from './supabase';
import { getJoinQuestionsConfig } from './creatorMode';

export interface JoinGate {
  communityId: string;
  name: string;
  welcomeMessage: string | null;
  introQuestion: string | null;
  guidelinesUrl: string | null;
  /** Liz decision #11 (2026-09-03): up to 3 more leader-toggled questions, false/null until a leader opts in. */
  askReason: boolean;
  askSource: boolean;
  askRulesConfirm: boolean;
  openQuestion: string | null;
}

export interface JoinAnswers {
  first_name: string;
  last_name: string;
  email: string;
  zip: string;
  intro_answer: string;
  guidelines_accepted: boolean;
  reason_answer?: string;
  source_answer?: string;
  rules_confirmed?: boolean;
  open_answer?: string;
}

// LIZ COPY: fallbacks when a leader has not set their gate up yet
export const FALLBACK_INTRO_QUESTION = 'introduce yourself. what should this community know about you?';
// Liz decision #10 (2026-09-03): one v1.1 guidelines doc everywhere.
export const FALLBACK_GUIDELINES_URL = 'https://washedup.app/community-guidelines';

export async function getJoinGate(communityId: string): Promise<JoinGate | null> {
  const { data, error } = await supabase
    .from('communities')
    .select('id, name, join_welcome_message, join_intro_question, guidelines_url')
    .eq('id', communityId)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  // Liz decision #11 (2026-09-03): a second, separate self-flipping read
  // (same shape as getJoinPolicy/getCommunityDiscoverable in
  // lib/creatorMode.ts) so a column absent (migration not applied) can only
  // ever add to the gate above, never break the 5 fields that already ship
  // today.
  const config = await getJoinQuestionsConfig(communityId);

  return {
    communityId: data.id,
    name: data.name,
    welcomeMessage: data.join_welcome_message,
    introQuestion: data.join_intro_question,
    guidelinesUrl: data.guidelines_url,
    askReason: config?.askReason ?? false,
    askSource: config?.askSource ?? false,
    askRulesConfirm: config?.askRulesConfirm ?? false,
    openQuestion: config?.openQuestion ?? null,
  };
}

/**
 * Client-side mirror of the RPC validation. `config` is the community's
 * current join-questions configuration (its own askReason/askSource/
 * askRulesConfirm/openQuestion, already AND-ed against
 * CONFIGURABLE_JOIN_QUESTIONS_ENABLED by the caller -- see
 * JoinCommunityPopup's effectiveConfig) so a slot the leader never turned on
 * is never required here, matching the server's own conditional checks in
 * request_to_join_community(). Returns the first problem as a friendly
 * message, or null when everything is ready to send.
 */
export function validateJoinAnswers(
  a: JoinAnswers,
  config: Pick<JoinGate, 'askReason' | 'askSource' | 'askRulesConfirm' | 'openQuestion'>,
): string | null {
  if (!a.first_name.trim()) return 'First name is required.';
  if (!a.last_name.trim()) return 'Last name is required.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email.trim())) return 'A real email is required.';
  if (!/^[0-9]{5}$/.test(a.zip.trim())) return 'A 5 digit zip code is required.';
  if (!a.intro_answer.trim()) return 'Your introduction is required.';
  if (a.intro_answer.length > 1000) return 'Keep your introduction under 1000 characters.';
  if (config.askReason && !(a.reason_answer ?? '').trim()) return 'Tell us why you want to join.';
  if (config.askSource && !(a.source_answer ?? '').trim()) return 'Tell us how you heard about this community.';
  if (config.askRulesConfirm && a.rules_confirmed !== true) return 'Confirming you meet the membership requirement is required.';
  if (config.openQuestion && !(a.open_answer ?? '').trim()) return 'That answer is required.';
  if (!a.guidelines_accepted) return 'Accepting the community guidelines is required.';
  return null;
}

export async function requestToJoinCommunity(communityId: string, answers: JoinAnswers): Promise<void> {
  const { error } = await supabase.rpc('request_to_join_community', {
    p_community_id: communityId,
    p_answers: answers,
  });
  if (error) throw error;
}

/**
 * Leave a community. The prod RPC has a last-leader guard: the sole leader
 * cannot walk out on a community, so it raises there and the caller surfaces
 * that message. Anyone else leaves cleanly.
 */
export async function leaveCommunity(communityId: string): Promise<void> {
  const { error } = await supabase.rpc('leave_community', { p_community_id: communityId });
  if (error) throw error;
}

/** My own join answers (self-readable by RLS); the intro seeds the empty thread. */
export async function getMyIntroAnswer(communityId: string): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('community_member_answers')
    .select('answers')
    .eq('community_id', communityId)
    .eq('user_id', user.id)
    .maybeSingle();
  const intro = (data?.answers as Record<string, unknown> | null)?.intro_answer;
  return typeof intro === 'string' && intro.trim() ? intro : null;
}

export type MembershipStatus = 'pending' | 'active' | 'left' | 'removed' | 'banned' | 'declined';

/** The viewer's own membership row for a community, if any. */
export async function getMyMembership(
  communityId: string,
): Promise<{ id: string; status: MembershipStatus; role: string } | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('community_members')
    .select('id, status, role')
    .eq('community_id', communityId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  return (data as { id: string; status: MembershipStatus; role: string } | null) ?? null;
}
