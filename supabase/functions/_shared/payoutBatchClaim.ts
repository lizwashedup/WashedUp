export type PayoutBatchEvent = { event_id: string; amount_cents: number };

type RpcResult = {
  data: unknown;
  error: { message?: string } | null;
};

type RpcCall = (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;

export async function claimPayoutBatch(
  rpc: RpcCall,
  row: { organizer_user_id: string; stripe_account_id: string },
  events: readonly PayoutBatchEvent[],
) {
  const requestedEvents = events.map((event) => ({
    event_id: event.event_id,
    amount_cents: event.amount_cents,
  }));
  const result = await rpc('claim_ticket_payout_batch', {
    p_organizer_user_id: row.organizer_user_id,
    p_stripe_account_id: row.stripe_account_id,
    p_events: requestedEvents,
  });
  return {
    claimed: !result.error && result.data === 'claimed',
    status: result.data,
    errorMessage: result.error?.message ?? null,
    eventIds: requestedEvents.map((event) => event.event_id),
  };
}
