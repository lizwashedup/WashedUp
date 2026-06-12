/**
 * nudgeArbiter - the single owner of "which gold line shows" in a composer.
 *
 * Policy (moments rules 2 & 3): at most ONE gold nudge is ever visible.
 *   - A Tier-4 recovery nudge suppresses every Tier-3 nudge while it shows.
 *   - Between the two eligible Tier-3 nudges (tonight + place-skip), the most
 *     recently triggered one shows and the other hides.
 *
 * One arbiter per composer decides for all of them, so no component carries its
 * own visibility flag. Recency is tracked with a plain monotonic ref counter
 * (no Date.now(), so it stays deterministic/resume-safe): each Tier-3 nudge is
 * stamped when it transitions ineligible -> eligible, and reset to 0 when it
 * goes ineligible; among the currently-eligible Tier-3 nudges the larger stamp
 * wins.
 */
import { useRef } from 'react';

/** Place-skip nudge copy, shared by both composer surfaces. */
export const NUDGE_PLACE_BASE =
  'plans with a place get found more. you can always add one later.';
export const NUDGE_PLACE_WARM =
  'plans with a place get found more, and people are likelier to say yes. you can always add one later.';

export type ActiveNudge = 'recovery' | 'tonight' | 'placeSkip' | null;

interface NudgeArbiterInput {
  /** Tier-4: a post failed and the composer is recovering. */
  recoveryActive: boolean;
  /** Tier-3: "tonight" is the selected day. */
  tonightEligible: boolean;
  /** Tier-3: no place has been chosen yet. */
  placeSkipEligible: boolean;
}

export function useNudgeArbiter({
  recoveryActive,
  tonightEligible,
  placeSkipEligible,
}: NudgeArbiterInput): ActiveNudge {
  const seq = useRef(0);
  const tonightSeq = useRef(0);
  const placeSeq = useRef(0);
  const prevTonight = useRef(false);
  const prevPlace = useRef(false);

  if (tonightEligible && !prevTonight.current) tonightSeq.current = ++seq.current;
  else if (!tonightEligible) tonightSeq.current = 0;
  prevTonight.current = tonightEligible;

  if (placeSkipEligible && !prevPlace.current) placeSeq.current = ++seq.current;
  else if (!placeSkipEligible) placeSeq.current = 0;
  prevPlace.current = placeSkipEligible;

  if (recoveryActive) return 'recovery';
  if (tonightEligible && placeSkipEligible) {
    return tonightSeq.current >= placeSeq.current ? 'tonight' : 'placeSkip';
  }
  if (tonightEligible) return 'tonight';
  if (placeSkipEligible) return 'placeSkip';
  return null;
}
