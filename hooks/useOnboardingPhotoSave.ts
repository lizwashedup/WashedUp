import { useCallback, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { supabase } from '../lib/supabase';
import { getUserBounded } from '../lib/authGate';
import { readOnboardingStatus } from '../lib/onboardingBasics';
import { uploadBase64ToStorage } from '../lib/uploadPhoto';
import { withTimeout } from '../lib/withTimeout';
import { invalidateAuthProfile } from './useProfile';
import { PROFILE_PHOTO_KEY } from '../constants/QueryKeys';

type Attempt = { userId: string; base64: string; path: string; url: string | null };
type Visit = { active: boolean; pending: boolean; userId: string | null; authRevision: number; attempt: Attempt | null };

/** Uploads may finish after a timeout; only the active visit may attach their
 * result to a profile. A unique, immutable object path makes retry safe. */
export function useOnboardingPhotoSave() {
  const queryClient = useQueryClient();
  const visitRef = useRef<Visit | null>(null);
  const [loading, setLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const retire = useCallback(() => {
    if (visitRef.current) visitRef.current.active = false;
  }, []);

  useFocusEffect(useCallback(() => {
    const visit: Visit = { active: true, pending: false, userId: null, authRevision: 0, attempt: null };
    visitRef.current = visit;
    setLoading(false);
    setSaveError(null);
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!visit.active || visitRef.current !== visit) return;
      visit.authRevision++;
      if (event === 'SIGNED_OUT' || event === 'PASSWORD_RECOVERY'
        || (visit.userId && session?.user?.id !== visit.userId)) {
        retire();
        visit.attempt = null;
      } else if (session?.user) visit.userId = session.user.id;
    });
    return () => { visit.active = false; visit.attempt = null; subscription.unsubscribe(); };
  }, [retire]));

  const save = async (base64: string) => {
    const visit = visitRef.current;
    if (!visit?.active || visit.pending || !base64) return;
    visit.pending = true;
    setLoading(true);
    setSaveError(null);
    const isCurrent = () => visit.active && visitRef.current === visit;
    const complete = () => {
      invalidateAuthProfile(queryClient, visit.userId!);
      void queryClient.invalidateQueries({ queryKey: PROFILE_PHOTO_KEY });
      retire();
      router.replace('/(tabs)/plans');
    };
    try {
      const revision = visit.authRevision;
      const { user, resolved } = await getUserBounded();
      if (!isCurrent()) return;
      if (!user) {
        if (visit.authRevision !== revision) return;
        throw new Error(resolved ? 'session expired. please sign in again.' : "couldn’t reach your account. your photo is still here. try again.");
      }
      if (visit.userId && visit.userId !== user.id) { retire(); return; }
      visit.userId = user.id;
      const status = await readOnboardingStatus(user.id);
      if (!isCurrent()) return;
      if (status === 'complete') { complete(); return; }

      let attempt = visit.attempt;
      if (!attempt || attempt.userId !== user.id || attempt.base64 !== base64) {
        attempt = { userId: user.id, base64, path: `${user.id}/${Crypto.randomUUID()}.jpg`, url: null };
        visit.attempt = attempt;
      }
      if (!attempt.url) {
        const url = await withTimeout<string | null>(
          uploadBase64ToStorage('profile-photos', attempt.path, attempt.base64, { upsert: false, existingIsSuccess: true }),
          20000,
          null,
        );
        if (!isCurrent()) return;
        if (!url) throw new Error("couldn’t finish uploading. your photo is still here. try again.");
        attempt.url = url;
      }
      const saved = await withTimeout(
        supabase.from('profiles')
          .update({ profile_photo_url: attempt.url, onboarding_status: 'complete' })
          .eq('id', user.id)
          .or('onboarding_status.is.null,onboarding_status.neq.complete')
          .select('id').maybeSingle(),
        4000,
        null,
      );
      if (!isCurrent()) return;
      if (!saved || saved.error || saved.data?.id !== user.id) {
        // A lost response can follow a successful commit; read before retrying.
        const latest = await readOnboardingStatus(user.id);
        if (!isCurrent()) return;
        if (latest !== 'complete') throw new Error("couldn’t confirm your save. your photo is still here. try again.");
      }
      complete();
    } catch (error) {
      if (isCurrent()) setSaveError(error instanceof Error ? error.message : 'could not save your photo. try again.');
    } finally {
      visit.pending = false;
      if (isCurrent()) setLoading(false);
    }
  };

  return { loading, saveError, clearSaveError: () => setSaveError(null), save, retire };
}
