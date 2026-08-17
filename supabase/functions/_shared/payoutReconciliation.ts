export type PayoutReconciliationFilters = readonly [
  readonly ['stripe_payout_id', string],
  readonly ['stripe_account_id_snapshot', string],
];

export type PayoutReconciliationPlan =
  | {
      kind: 'update';
      patch: Record<string, unknown>;
      filters: PayoutReconciliationFilters;
    }
  | { kind: 'invalid'; reason: string };

export function planPayoutReconciliation(
  type: string,
  payload: any,
  nowIso: string,
): PayoutReconciliationPlan {
  const payout = payload?.data?.object;
  const payoutId = payout?.id;
  const connectedAccountId = payload?.account;
  if (
    (type !== 'payout.paid' && type !== 'payout.failed') ||
    typeof payoutId !== 'string' ||
    !payoutId.startsWith('po_') ||
    typeof connectedAccountId !== 'string' ||
    !connectedAccountId.startsWith('acct_')
  ) {
    return { kind: 'invalid', reason: 'payout event lacks payout/account identity' };
  }

  const patch = type === 'payout.paid'
    ? { status: 'paid', paid_at: nowIso }
    : {
        status: 'failed',
        failure_message:
          payout.failure_message ?? payout.failure_code ?? 'payout failed',
      };

  return {
    kind: 'update',
    patch,
    filters: [
      ['stripe_payout_id', payoutId],
      ['stripe_account_id_snapshot', connectedAccountId],
    ],
  };
}

export function applyPayoutReconciliationFilters<T>(
  query: T,
  filters: PayoutReconciliationFilters,
): T {
  let filtered: any = query;
  for (const [column, value] of filters) filtered = filtered.eq(column, value);
  return filtered as T;
}
