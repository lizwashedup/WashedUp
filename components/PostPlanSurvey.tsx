import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import PostPlanSurveyV3 from './yours/survey/PostPlanSurveyV3';

// ─── Types ──────────────────────────────────────────────────────────────────
// My relationship to a plan attendee, decided SERVER-SIDE in
// get_pending_post_plan_survey (it includes block state, which must never be
// inferred client-side). Step 3 only ever offers 'incoming_pending' / 'none'.
export type KeepState =
  | 'mutual'
  | 'outgoing_pending'
  | 'incoming_pending'
  | 'blocked'
  | 'none';

export interface SurveyPlan {
  id: string;
  title: string;
  image_url: string | null;
  // Plan-type facts (get_pending_post_plan_survey) that drive the step flow.
  circle_id: string | null;
  is_featured: boolean;
  any_stranger_joined: boolean;
}

export interface SurveyMember {
  id: string;
  first_name_display: string | null;
  profile_photo_url: string | null;
  is_stranger: boolean;
  keep_state: KeepState;
}

export interface SurveyProps {
  visible: boolean;
  plan: SurveyPlan;
  members: SurveyMember[];
  userId: string;
  onComplete: () => void;
}

// ─── Local suppression (the lockout backstop) ────────────────────────────────
// The server RPC (get_pending_post_plan_survey) only stops re-prompting once a
// plan_feedback row exists. If that insert ever fails, the user is offline, or
// they skip, the survey would otherwise re-block them on every cold start
// (incident 2026-05-18, a fully locked-out, restart-proof state). This
// on-device list guarantees that once a user has dealt with a survey it can
// never re-block them, independent of the network.
export const POST_PLAN_SURVEY_HANDLED_KEY = 'postPlanSurvey.handledV1';

export async function isPostPlanSurveyHandled(eventId: string): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(POST_PLAN_SURVEY_HANDLED_KEY);
    if (!raw) return false;
    const ids = JSON.parse(raw) as unknown;
    return Array.isArray(ids) && ids.includes(eventId);
  } catch {
    return false;
  }
}

export async function markPostPlanSurveyHandled(eventId: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(POST_PLAN_SURVEY_HANDLED_KEY);
    let ids: string[] = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) ids = parsed as string[];
      } catch { ids = []; }
    }
    if (!ids.includes(eventId)) ids.push(eventId);
    if (ids.length > 100) ids = ids.slice(-100); // cap unbounded growth
    await AsyncStorage.setItem(POST_PLAN_SURVEY_HANDLED_KEY, JSON.stringify(ids));
  } catch {
    /* best-effort; a successful plan_feedback row also suppresses */
  }
}

// ─── Component ──────────────────────────────────────────────────────────────
// v3 replaces BOTH the legacy survey and SurveyV2. It is NOT gated as a whole
// (the crash fix + calmer flow reach prod on the next release); only Step 3
// ("Keep these people" + the handshake) is gated behind YOURS_PAGE_ENABLED,
// inside the v3 component.
export default function PostPlanSurvey(props: SurveyProps) {
  return <PostPlanSurveyV3 {...props} />;
}
