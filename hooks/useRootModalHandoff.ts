import { useCallback, useEffect, useRef, useState } from 'react';
import { maybeRequestReviewAfterTopRating } from '../lib/reviewAsk';
import { logError } from '../lib/logger';

export const ROOT_MODAL_HANDOFF_MS = 400;

/** Root presentation work belongs to one observed account generation. A native
 * sheet already presented cannot be recalled, but retired preflight work must
 * never present it or unlock another account's modal sequence. */
export function useRootModalHandoff(identity: object, isCurrent: () => boolean) {
  const [modalLocked, setModalLocked] = useState(false);
  const [reviewSheetPending, setReviewSheetPending] = useState(false);
  const current = useRef({ identity, isCurrent }); current.current = { identity, isCurrent };
  const live = useRef(true);
  const handoffTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reviewAttempt = useRef<object | null>(null);
  const retire = useCallback(() => {
    if (handoffTimer.current !== null) clearTimeout(handoffTimer.current);
    if (reviewTimer.current !== null) clearTimeout(reviewTimer.current);
    handoffTimer.current = null; reviewTimer.current = null; reviewAttempt.current = null;
  }, []);
  const reset = useCallback(() => {
    retire(); setModalLocked(false); setReviewSheetPending(false);
  }, [retire]);
  useEffect(() => {
    live.current = true; reset();
    return () => { live.current = false; retire(); };
  }, [identity, reset, retire]);

  const owns = () => live.current && current.current.identity === identity && current.current.isCurrent();
  const handoffModal = (close: () => void) => {
    if (!owns()) return;
    if (handoffTimer.current !== null) clearTimeout(handoffTimer.current);
    close(); setModalLocked(true);
    const timer = setTimeout(() => {
      if (handoffTimer.current !== timer || !owns()) return;
      handoffTimer.current = null; setModalLocked(false);
    }, ROOT_MODAL_HANDOFF_MS);
    handoffTimer.current = timer;
  };
  const requestReview = () => {
    if (!owns() || reviewAttempt.current !== null) return;
    const attempt = {}; reviewAttempt.current = attempt; setReviewSheetPending(true);
    const canPresent = () => owns() && reviewAttempt.current === attempt;
    reviewTimer.current = setTimeout(() => {
      reviewTimer.current = null;
      if (!canPresent()) return;
      void maybeRequestReviewAfterTopRating(canPresent)
        .catch(error => { if (canPresent()) logError(error, 'layout.reviewHandoff'); })
        .finally(() => {
          if (!canPresent()) return;
          reviewAttempt.current = null; setReviewSheetPending(false);
        });
    }, ROOT_MODAL_HANDOFF_MS + 60);
  };
  return { modalLocked, reviewSheetPending, handoffModal, requestReview, reset };
}
