import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * One-time "seen" bookkeeping for the Yours tabs education pop-ups
 * (WashedUp_Circles_Functional_Spec.md section 6, "Education and
 * onboarding"). Two independent variants, each shown at most once per
 * signed-in account:
 *
 *  - 'existingUser': returning users who already have people or plan
 *    history. Names what moved (Plans, now under Yours) and points at the
 *    new People/Circles tabs.
 *  - 'newUser': a brand-new user with nothing yet. Different emphasis per
 *    spec: encourage joining a plan first, framed as "go do something,
 *    then keep the people" rather than asking them to build a People graph
 *    from nothing.
 *
 * Keyed per-user (mirrors lib/onboardingDraft.ts's keyFor pattern) so a
 * shared device, or a second account signing in on the same phone, never
 * inherits another account's "already seen" state.
 */

export type YoursIntroVariant = 'existingUser' | 'newUser';

/** Mirrors YoursScreen's own state machine (loading/populated/fresh/empty). */
export type YoursScreenState = 'loading' | 'populated' | 'fresh' | 'empty';

/**
 * Which one-time intro pop-up (if any) applies to a given Yours screen
 * state. 'empty' (no people connections AND no plan-history backlog) is
 * that screen's own existing definition of a brand-new user (see
 * NewUserEmptyView's doc comment); anything else means real usage history
 * already exists, i.e. an existing user. 'loading' resolves to null so the
 * pop-up never fires against a guess before the real state is known.
 */
export function resolveYoursIntroVariant(state: YoursScreenState): YoursIntroVariant | null {
  if (state === 'loading') return null;
  return state === 'empty' ? 'newUser' : 'existingUser';
}

function keyFor(variant: YoursIntroVariant, userId: string): string {
  return `wu.yoursIntroSeen.${variant}.${userId}.v1`;
}

/**
 * Has this account already been shown this variant? Returns true (i.e.
 * "treat as already seen, don't show it") on a missing/empty userId or a
 * storage read failure, so a bad read can never cause the pop-up to nag on
 * every launch, only to under-show in a rare failure case.
 */
export async function hasSeenYoursIntro(
  variant: YoursIntroVariant,
  userId: string,
): Promise<boolean> {
  if (!userId) return true;
  try {
    return (await AsyncStorage.getItem(keyFor(variant, userId))) === 'true';
  } catch {
    return true;
  }
}

/** Stamp this variant "seen" for this account. Best-effort, like the rest of this codebase's local flags. */
export async function markYoursIntroSeen(
  variant: YoursIntroVariant,
  userId: string,
): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(keyFor(variant, userId), 'true');
  } catch {
    /* best-effort; worst case the pop-up shows again next launch */
  }
}
