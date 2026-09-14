// Bridge between the plan composer and the root layout's push primer.
//
// The layout owns the primer modal and is the only caller of the OS
// permission prompt; the composer only signals that a plan was just posted,
// which is the one moment the ask carries obvious value ("know when someone
// joins"). Measured 2026-09-13: 17% of completed signups never register for
// push, and the archetype is a creator who posts a plan in their first
// session, never returns, and so never sees the launch-time primer again.
//
// A single-listener registry keeps this contract as small as it is: the
// layout subscribes once for its lifetime, the composer fires at most once
// per posted plan, and the layout re-checks permission state before showing
// anything, so a stale or duplicate signal can never cold-fire the OS prompt.

type Listener = () => void;

let listener: Listener | null = null;

export function onPostPlanPushPrimerRequest(fn: Listener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

export function requestPostPlanPushPrimer(): void {
  listener?.();
}
