import { useCallback, useRef, useState } from 'react';
import { router, useFocusEffect, type Href } from 'expo-router';
import { supabase } from '../lib/supabase';
import { getUserBounded } from '../lib/authGate';
import { readOnboardingStatus } from '../lib/onboardingBasics';
import { cancelPendingSave, clearAllDrafts, clearDraft } from '../lib/onboardingDraft';
import { withTimeout } from '../lib/withTimeout';

type StepUpdate =
  | { city: string; is_visitor?: boolean; onboarding_status: 'referral' | 'waitlisted' }
  | { referral_source: string; onboarding_status: 'photo' };
type Visit = { active: boolean; pending: boolean; userId: string | null; authRevision: number };

/** A save belongs to one focused signup step and account. Back retires it
 * synchronously; blur/unmount and auth changes retire external exits too. */
export function useOnboardingStepSave(screen: 'laCheck' | 'referral') {
  const visitRef = useRef<Visit | null>(null);
  const [loading, setLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const retire = useCallback(() => {
    if (visitRef.current) visitRef.current.active = false;
    cancelPendingSave(screen);
  }, [screen]);

  useFocusEffect(useCallback(() => {
    const visit: Visit = { active: true, pending: false, userId: null, authRevision: 0 };
    visitRef.current = visit;
    setLoading(false);
    setSaveError(null);
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!visit.active || visitRef.current !== visit) return;
      visit.authRevision += 1;
      if (event === 'SIGNED_OUT' || event === 'PASSWORD_RECOVERY'
        || (visit.userId && session?.user?.id !== visit.userId)) {
        retire();
      } else if (session?.user) {
        visit.userId = session.user.id;
      }
    });
    return () => {
      visit.active = false;
      cancelPendingSave(screen);
      subscription.unsubscribe();
    };
  }, [screen, retire]));

  const save = async (updates: StepUpdate, destination: Href) => {
    const visit = visitRef.current;
    if (!visit?.active || visit.pending) return;
    visit.pending = true;
    const isCurrent = () => visit.active && visitRef.current === visit;
    const advance = (route: Href) => {
      retire();
      router.replace(route);
    };
    setLoading(true);
    setSaveError(null);
    try {
      const revision = visit.authRevision;
      const { user, resolved } = await getUserBounded();
      if (!isCurrent()) return;
      if (!user) {
        // A refresh can make an older missing-user response obsolete.
        if (visit.authRevision !== revision) return;
        if (!resolved) throw new Error("couldn't reach the server. your answers are still here. try again.");
        setSaveError('session expired. please sign in again.');
        await clearAllDrafts();
        if (isCurrent() && visit.authRevision === revision) await supabase.auth.signOut();
        return;
      }
      if (visit.userId && visit.userId !== user.id) { retire(); return; }
      visit.userId = user.id;
      const status = await readOnboardingStatus(user.id);
      if (!isCurrent()) return;
      if (status === 'complete') { advance('/(tabs)/plans'); return; }

      const saved = await withTimeout(
        supabase.from('profiles').update(updates).eq('id', user.id)
          .or('onboarding_status.is.null,onboarding_status.neq.complete')
          .select('id').maybeSingle(),
        4000,
        null,
      );
      if (!isCurrent()) return;
      if (!saved || saved.error || saved.data?.id !== user.id) {
        // Another device may have completed signup between the read/write.
        const latest = await readOnboardingStatus(user.id);
        if (!isCurrent()) return;
        if (latest === 'complete') { advance('/(tabs)/plans'); return; }
        throw new Error("couldn't confirm your save. your answers are still here. try again.");
      }
      clearDraft(screen);
      advance(destination);
    } catch (error) {
      if (isCurrent()) setSaveError(error instanceof Error ? error.message : 'could not save. please try again.');
    } finally {
      visit.pending = false;
      if (isCurrent()) setLoading(false);
    }
  };

  return { loading, saveError, clearSaveError: () => setSaveError(null), save, retire };
}
