// Service-role journal. No financial calculation, provider action or replay.
export const refundRequestIdIsValid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export type RefundRequestIdentity = { requestId: string; orderId: string; requesterId: string };
type Service = { from(name: string): any; rpc(name: string, args: Record<string, unknown>): PromiseLike<any> };
async function bounded<T>(work: PromiseLike<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([Promise.resolve(work), new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Refund receipt wait ended.')), ms);
  })]); } finally { clearTimeout(timer); }
}
export async function refundRequestTargetHash(target: {
  kind: string; positions: number[] | null; reason: string; reviewedAmount: number | null; reviewedCount: number | null;
}): Promise<string> {
  const stable = JSON.stringify({ ...target, positions: target.positions ? [...new Set(target.positions)].sort((a,b) => a-b) : null });
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable));
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}
export async function beginRefundRequest(service: Service, identity: RefundRequestIdentity, targetHash: string): Promise<'started'|'duplicate'|'conflict'|'unavailable'> {
  let inserted;
  try { inserted = await bounded(service.from('ticket_refund_requests').insert({
    request_id: identity.requestId, order_id: identity.orderId, requester_user_id: identity.requesterId,
    target_hash: targetHash, state: 'pending',
  }), 5_000); } catch { return 'unavailable'; }
  const { error } = inserted as any;
  if (!error) return 'started';
  if (error.code !== '23505') return 'unavailable';
  const { data, error: readError } = await service.from('ticket_refund_requests')
    .select('order_id,requester_user_id,target_hash').eq('request_id', identity.requestId).maybeSingle();
  if (readError || !data) return 'unavailable';
  return data.order_id === identity.orderId && data.requester_user_id === identity.requesterId && data.target_hash === targetHash
    ? 'duplicate' : 'conflict';
}
export async function recordRefundRequestOutcome(service: Service, identity: RefundRequestIdentity, providerDispatched: boolean, body: Record<string, unknown>): Promise<void> {
  const validCount = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
  let patch: Record<string, unknown>;
  let allowed: string[];
  if (body.ok === true && body.order_id === identity.orderId && validCount(body.refund_amount_cents) && validCount(body.positions_voided)) {
    patch = { state: 'complete', refund_amount_cents: body.refund_amount_cents, positions_voided: body.positions_voided,
      stripe_refund_id: body.stripe_refund_id };
    allowed = ['pending', 'confirmed'];
  } else if (providerDispatched && typeof body.stripe_refund_id === 'string' && body.stripe_refund_id) {
    patch = { state: 'confirmed', stripe_refund_id: body.stripe_refund_id };
    allowed = ['pending'];
  } else if (!providerDispatched) {
    patch = { state: 'not_started' }; allowed = ['pending'];
  } else return; // A provider timeout cannot prove that no money moved.
  // Journal progress must never stall the existing financial recording path.
  // Late updates remain conditional, so they cannot downgrade a terminal row.
  const { error } = await bounded<any>(service.from('ticket_refund_requests').update({ ...patch, updated_at: new Date().toISOString() })
    .eq('request_id', identity.requestId).eq('order_id', identity.orderId).eq('requester_user_id', identity.requesterId).in('state', allowed), 2_000);
  if (error) throw new Error('Refund request receipt could not be recorded.');
}

/** Checks current access and reads the exact saved result. No eligibility gate or mutation. */
export async function readRefundRequestStatus(service: Service, identity: RefundRequestIdentity): Promise<{status: number; body: Record<string, unknown>}> {
  const denied = { status: 403, body: { error: 'refund status unavailable for this account' } };
  const failed = { status: 503, body: { error: 'refund status could not be checked' } };
  const { data: order, error: orderError } = await service.from('ticket_orders')
    .select('id,buyer_user_id,event_id,explore_events!inner(host_user_id,community_id)').eq('id', identity.orderId).maybeSingle();
  if (orderError) return failed;
  if (!order) return denied;
  const event = order.explore_events;
  let creatorId = event?.host_user_id ?? null;
  if (!creatorId && event?.community_id) {
    const { data, error } = await service.from('communities').select('created_by').eq('id', event.community_id).maybeSingle();
    if (error) return failed;
    creatorId = data?.created_by ?? null;
  }
  if (order.buyer_user_id !== identity.requesterId && creatorId !== identity.requesterId) {
    const { data, error } = await service.rpc('has_refund_authority', { p_user_id: identity.requesterId, p_event_id: order.event_id });
    if (error) return failed;
    if (data !== true) return denied;
  }
  const { data: record, error } = await service.from('ticket_refund_requests')
    .select('request_id,order_id,requester_user_id,state,stripe_refund_id,refund_amount_cents,positions_voided')
    .eq('request_id', identity.requestId).eq('order_id', identity.orderId).eq('requester_user_id', identity.requesterId).maybeSingle();
  if (error) return failed;
  const reply = (state: string, detail: Record<string, unknown> = {}) => ({ status: 200, body: {
    ok: true, order_id: identity.orderId, client_request_id: identity.requestId, requester_user_id: identity.requesterId, state, ...detail,
  } });
  if (!record) return reply('unknown');
  if (record.state === 'not_started') return reply('not-started');
  if (record.state === 'complete') return reply('complete', { refund_amount_cents: record.refund_amount_cents, positions_voided: record.positions_voided });
  if (record.state !== 'confirmed' || !record.stripe_refund_id) return reply('unknown');
  // The existing reconciliation worker may have recorded this exact Stripe
  // refund after the original response. Read its ledger and voided seats only.
  const { data: ledger, error: ledgerError } = await service.from('ticket_refunds').select('total_refunded_cents')
    .eq('order_id', identity.orderId).eq('stripe_refund_id', record.stripe_refund_id).maybeSingle();
  if (ledgerError) return failed;
  if (!ledger) return reply('confirmed');
  const { count, error: positionsError } = await service.from('ticket_order_positions').select('id', { count: 'exact', head: true })
    .eq('order_id', identity.orderId).eq('stripe_refund_id', record.stripe_refund_id).not('voided_at', 'is', null);
  if (positionsError) return failed;
  if (!Number.isSafeInteger(ledger.total_refunded_cents) || ledger.total_refunded_cents < 0 || !Number.isSafeInteger(count) || count < 1) return reply('confirmed');
  return reply('complete', { refund_amount_cents: ledger.total_refunded_cents, positions_voided: count });
}
