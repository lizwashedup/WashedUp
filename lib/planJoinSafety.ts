export type JoinErrorSurface = 'inline' | 'alert';

export type PlanJoinRpc = 'join_event_atomic' | 'join_circle_plan_atomic';

export type PlanJoinDenial =
  | 'full'
  | 'not_found'
  | 'waitlist_priority'
  | 'not_eligible'
  | 'not_circle_plan';

export type PlanJoinReceipt =
  | { kind: 'joined' }
  | { kind: 'denied'; reason: PlanJoinDenial }
  | { kind: 'unknown' };

/**
 * Classify only the exact text receipts defined by the selected join RPC.
 * A joined receipt confirms membership, not whether the row was newly joined:
 * both RPCs also update existing membership and have no already-joined receipt.
 * Unknown results require reconciliation; a missing member row cannot rule out
 * a still-committing request. Never trigger greetings or a blind retry.
 * Callers must handle an RPC error before passing its data here.
 */
export function classifyPlanJoinReceipt(value: unknown, rpc: PlanJoinRpc): PlanJoinReceipt {
  if (value === 'joined') return { kind: 'joined' };
  if (value === 'full' || value === 'not_found') return { kind: 'denied', reason: value };

  if (rpc === 'join_event_atomic' && value === 'waitlist_priority') {
    return { kind: 'denied', reason: value };
  }
  if (rpc === 'join_circle_plan_atomic' && (value === 'not_eligible' || value === 'not_circle_plan')) {
    return { kind: 'denied', reason: value };
  }
  return { kind: 'unknown' };
}

/** Keep failures visible whether the greeting sheet is open or already closed. */
export function joinErrorSurface(joinSheetVisible: boolean): JoinErrorSurface {
  return joinSheetVisible ? 'inline' : 'alert';
}
