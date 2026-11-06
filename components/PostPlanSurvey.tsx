import React from 'react';
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
  creator_user_id: string | null;
}

export interface SurveyMember {
  id: string;
  first_name_display: string | null;
  profile_photo_url: string | null;
  is_stranger: boolean;
  // The plan creator is ALWAYS shown in the people steps, even when they are a
  // circle co-member (get_pending_post_plan_survey tags this).
  is_creator: boolean;
  keep_state: KeepState;
}

export interface SurveyProps {
  visible: boolean;
  plan: SurveyPlan;
  members: SurveyMember[];
  userId: string;
  // topRated is true when the user committed the TOP rating ("Really good").
  // The owner uses it to fire the native review ask AFTER this modal dismisses.
  onComplete: (topRated: boolean) => void;
}

// ─── Component ──────────────────────────────────────────────────────────────
// v3 replaces BOTH the legacy survey and SurveyV2. It is NOT gated as a whole
// (the crash fix + calmer flow reach prod on the next release); only Step 3
// ("Keep these people" + the handshake) is gated behind YOURS_PAGE_ENABLED,
// inside the v3 component.
export default function PostPlanSurvey(props: SurveyProps) {
  return <PostPlanSurveyV3 {...props} />;
}
