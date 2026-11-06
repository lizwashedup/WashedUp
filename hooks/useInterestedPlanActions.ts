import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { nextPlanReviewId, planReviewDestination } from '../lib/planCopyReview';
import { requestWithDeadline } from '../lib/requestWithDeadline';
import { canMakeSimilarPlan, fetchSimilarPlanParams, removeInterestedPlan } from '../lib/interestedPlanActions';
import type { Plan } from '../lib/fetchPlans';

type Action = 'remove' | 'similar';
type Feedback = { pending: Action | null; error: string | null; retry: Action };


export function useInterestedPlanActions(userId: string) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const ownerRef = useRef({ userId });
  if (ownerRef.current.userId !== userId) ownerRef.current = { userId };
  const owner = ownerRef.current;
  const visitRef = useRef<object | null>(null);
  const locks = useRef(new Map<string, object>());
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
  useFocusEffect(useCallback(() => {
    const visit = {}; visitRef.current = visit;
    locks.current.clear(); setFeedback({});
    return () => { if (visitRef.current === visit) visitRef.current = null; };
  }, [userId]));

  const run = async (plan: Plan, action: Action) => {
    const visit = visitRef.current;
    const isCurrent = () => !!visit && visitRef.current === visit && ownerRef.current === owner;
    if (!userId || !isCurrent() || locks.current.has(plan.id)) return;
    if (action === 'similar' && !canMakeSimilarPlan(plan)) return;
    const attempt = {}; locks.current.set(plan.id, attempt);
    setFeedback(current => ({ ...current, [plan.id]: { pending: action, error: null, retry: action } }));
    try {
      const auth = await requestWithDeadline(supabase.auth.getUser(), 8000);
      if (!isCurrent()) return;
      if (auth.error || auth.data.user?.id !== userId) throw new Error('Please check your account and try again.');
      if (action === 'remove') {
        const confirmed = await removeInterestedPlan(plan.id, isCurrent);
        if (!confirmed) return;
        const queryKey = ['plans.myInterested', userId];
        if (!isCurrent()) {
          // A later visit may have signalled interest again. Refresh the owner's
          // list without removing that newer card or reading as a different user.
          void queryClient.invalidateQueries({ queryKey, refetchType: ownerRef.current === owner ? 'active' : 'none' });
          return;
        }
        // Keep the card until a server response confirms removal. A rejected
        // or timed-out request leaves it in place with a retry action.
        queryClient.setQueryData<Plan[]>(queryKey, old => old?.filter(item => item.id !== plan.id));
        void queryClient.invalidateQueries({ queryKey });
      } else {
        const reviewId = nextPlanReviewId();
        const params = await fetchSimilarPlanParams(plan.id, reviewId);
        if (!isCurrent()) return;
        router.push(planReviewDestination(queryClient, userId, params, reviewId));
      }
    } catch {
      if (isCurrent()) setFeedback(current => ({ ...current, [plan.id]: {
        pending: null, retry: action,
        error: action === 'remove' ? 'Couldn’t remove this interest. Try again.' : 'Couldn’t open a similar plan. It may no longer be available. Try again.',
      } }));
    } finally {
      if (locks.current.get(plan.id) === attempt) locks.current.delete(plan.id);
      if (isCurrent()) setFeedback(current => {
        const item = current[plan.id];
        return item ? { ...current, [plan.id]: { ...item, pending: null } } : current;
      });
    }
  };
  return { feedback, run };
}
