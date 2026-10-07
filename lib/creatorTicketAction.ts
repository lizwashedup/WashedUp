import { getMyPayoutState, isPayoutReady } from './ticketing';
import { supabase } from './supabase';
import { assertTicketVisit, ticketReadAuthorization } from './creatorTicketRead';
import type { CreatorPageScope } from './creatorPageReview';

export type TicketAction = { eventId: string; recordId: string; label: string; pageId?:string; requestId?:string } & (
  | { kind: 'tier-sale' | 'extra-sale'; expected: string }
  | { kind: 'promo-active'; expected: boolean }
  | { kind: 'remove-tier' | 'remove-extra' | 'remove-promo' | 'remove-question' | 'remove-faq' }
);
export type TicketActionState = 'confirmed' | 'unchanged' | 'changed' | 'unknown' | 'in_use';
function definition(action: TicketAction) {
  switch (action.kind) {
    case 'tier-sale': return { table: 'ticket_tiers', field: 'status', expected: action.expected, desired: action.expected === 'on_sale' ? 'closed' : 'on_sale' };
    case 'extra-sale': return { table: 'event_add_ons', field: 'status', expected: action.expected, desired: action.expected === 'on_sale' ? 'draft' : 'on_sale' };
    case 'promo-active': return { table: 'ticket_promo_codes', field: 'active', expected: action.expected, desired: !action.expected };
    case 'remove-tier': return { table: 'ticket_tiers' };
    case 'remove-extra': return { table: 'event_add_ons' };
    case 'remove-promo': return { table: 'ticket_promo_codes' };
    case 'remove-question': return { table: 'ticket_questions', field: 'is_active', expected: true, desired: false };
    case 'remove-faq': return { table: 'event_faqs', field: 'is_active', expected: true, desired: false };
  }
}
/** Existing operations and RLS, with a fixed desired state and an exact event/record receipt.
 * Recovery only reads; it never reverses a toggle or repeats an uncertain deletion. */
export async function performTicketAction(action: TicketAction, scope: CreatorPageScope, checkOnly = false): Promise<TicketActionState> {
  const authorization = (await ticketReadAuthorization(scope))!;
  const spec = definition(action);
  const columns = `id,event_id${spec.field ? `,${spec.field}` : ''}${action.kind === 'tier-sale' ? ',price_cents' : ''}`;
  const current = () => assertTicketVisit(scope);
  const authority = async () => {
    current();
    const result = await supabase.rpc('is_ticketing_organizer', { p_event_id: action.eventId, p_user: scope.userId }).setHeader('Authorization', authorization);
    current();
    if (result.error || result.data !== true) throw Error('Your access to manage this event could not be confirmed.');
  };
  const read = async () => {
    await authority();
    const result = await supabase.from(spec.table).select(columns).eq('event_id', action.eventId).eq('id', action.recordId).maybeSingle().setHeader('Authorization', authorization);
    current();
    if (result.error) throw result.error;
    const row = result.data as unknown as Record<string, unknown> | null;
    if (row && (row.id !== action.recordId || row.event_id !== action.eventId)) throw Error('The saved item could not be identified.');
    return row;
  };
  const state = (row: Record<string, unknown> | null): TicketActionState => {
    if (!spec.field) return row ? 'unchanged' : 'confirmed';
    if (!row) return action.kind.startsWith('remove-') ? 'confirmed' : 'changed';
    if (row[spec.field] === spec.desired) return 'confirmed';
    return row[spec.field] === spec.expected ? 'unchanged' : 'changed';
  };
  if(action.kind==='remove-extra'&&action.pageId){
    if(!action.requestId)throw Error('The original extra removal needs to be kept before continuing.');
    await authority();
    const result=await supabase.rpc('settle_creator_page_extra_removal',{
      p_page_id:action.pageId,p_event_id:action.eventId,p_request_id:action.requestId,p_extra_id:action.recordId,
    }).setHeader('Authorization',authorization);
    current();const receipt=result.data;
    if(result.error||!receipt||receipt.page_id!==action.pageId||receipt.event_id!==action.eventId
      ||receipt.user_id!==scope.userId||receipt.request_id!==action.requestId||receipt.extra_id!==action.recordId
      ||!['in_use','confirmed','unresolved'].includes(receipt.outcome))throw Error('The original removal could not be checked. Your action is kept.');
    if(receipt.outcome!=='unresolved')return receipt.outcome;
  }
  const original = await read();
  const before = state(original);
  if (checkOnly || before !== 'unchanged') return before;
  if (action.kind === 'tier-sale' && spec.desired === 'on_sale') {
    if (typeof original?.price_cents !== 'number') throw Error('Ticket price could not be checked.');
    if (original.price_cents > 0 && !isPayoutReady(await getMyPayoutState(scope.userId, scope))) throw Error('Finish payout setup before starting paid ticket sales.');
  }
  current();
  try {
    let query = spec.field ? supabase.from(spec.table).update({ [spec.field]: spec.desired }) : supabase.from(spec.table).delete();
    query = query.eq('event_id', action.eventId).eq('id', action.recordId);
    if (spec.field) query = query.eq(spec.field, spec.expected!);
    const result = await query.select(columns).maybeSingle().setHeader('Authorization', authorization);
    current();
    const row = result.data as Record<string, unknown> | null;
    if (!result.error && row?.id === action.recordId && row.event_id === action.eventId && (!spec.field || state(row) === 'confirmed')) return 'confirmed';
  } catch { current(); }
  // A zero-row response, refusal or lost acknowledgement is not a success receipt.
  try { return state(await read()); } catch { current(); return 'unknown'; }
}
