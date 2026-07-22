/**
 * Member-side join flow (doc 09): the join gate a visitor sees and the
 * request they submit. The server RPC re-validates everything; the client
 * checks mirror it so nobody round-trips to learn a field is missing.
 * Answers are stored leader-eyes-only (community_member_answers RLS); on
 * approval the system composes a warm third-person intro card into the main
 * community chat (name, area from zip, question and answer; never the zip).
 */

import { supabase } from './supabase';

export interface JoinGate {
  communityId: string;
  name: string;
  welcomeMessage: string | null;
  introQuestion: string | null;
  guidelinesUrl: string | null;
}

export interface JoinAnswers {
  first_name: string;
  last_name: string;
  email: string;
  zip: string;
  intro_answer: string;
  guidelines_accepted: boolean;
}

// LIZ COPY: fallbacks when a leader has not set their gate up yet
export const FALLBACK_INTRO_QUESTION = 'introduce yourself. what should this community know about you?';
export const FALLBACK_GUIDELINES_URL = 'https://washedup.app/guidelines';

export async function getJoinGate(communityId: string): Promise<JoinGate | null> {
  const { data, error } = await supabase
    .from('communities')
    .select('id, name, join_welcome_message, join_intro_question, guidelines_url')
    .eq('id', communityId)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    communityId: data.id,
    name: data.name,
    welcomeMessage: data.join_welcome_message,
    introQuestion: data.join_intro_question,
    guidelinesUrl: data.guidelines_url,
  };
}

/**
 * Client-side mirror of the RPC validation. Returns the first problem as a
 * friendly message, or null when everything is ready to send.
 */
export function validateJoinAnswers(a: JoinAnswers): string | null {
  if (!a.first_name.trim()) return 'First name is required.';
  if (!a.last_name.trim()) return 'Last name is required.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email.trim())) return 'A real email is required.';
  if (!/^[0-9]{5}$/.test(a.zip.trim())) return 'A 5 digit zip code is required.';
  if (!a.intro_answer.trim()) return 'Your introduction is required.';
  if (a.intro_answer.length > 1000) return 'Keep your introduction under 1000 characters.';
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
