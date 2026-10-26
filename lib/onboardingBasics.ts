import { supabase } from './supabase';
import { withTimeout } from './withTimeout';

export type OnboardingBasicsUpdate = {
  birthday: string;
  gender: string;
  onboarding_status: 'la_check';
  first_name_display: string;
  last_name: string;
  email: string | null;
  marketing_opt_in: boolean;
};

export async function readOnboardingStatus(userId: string) {
  const result = await withTimeout(
    supabase.from('profiles').select('onboarding_status').eq('id', userId).maybeSingle(),
    4000,
    null,
  );
  if (!result || result.error || !result.data) {
    throw new Error("couldn’t load your account. your details are still here. try again.");
  }
  return result.data.onboarding_status;
}

/** Require a receipt and exclude completed accounts at the write itself:
 * another device can finish onboarding after the caller's preflight read. */
export function saveOnboardingBasics(userId: string, updates: OnboardingBasicsUpdate) {
  return withTimeout(
    supabase.from('profiles').update(updates).eq('id', userId)
      .or('onboarding_status.is.null,onboarding_status.neq.complete')
      .select('id').maybeSingle(),
    4000,
    null,
  );
}
