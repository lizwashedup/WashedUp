/** Read only event setup/capability results; never returns bank or buyer data. */
import { supabase } from './supabase';
import { CreatorPageReceiptUnknown, CreatorPageScopeExpired, type CreatorPageScope } from './creatorPageReview';
export const pageEventPublishReasons = ['page_unpublished', 'event_closed', 'offer_setup_unavailable', 'offer_not_supported',
  'date_required', 'end_time_required', 'paid_ticket_required', 'payout_setup_required', 'course_setup_unavailable', 'course_dates_required'] as const;
export type PageEventPublishReason = typeof pageEventPublishReasons[number];
/** Setup guidance contains no financial account details and grants no authority. */
export const pageEventPublishGuidance: Record<PageEventPublishReason, { title: string; message: string }> = {
  page_unpublished: { title: 'Publish your page first', message: 'Your event is saved privately. Publish the approved page before publishing this event into Scene.' },
  event_closed: { title: 'This event is closed', message: 'A completed or cancelled event cannot be published again.' },
  offer_setup_unavailable: { title: 'Could not check the event format', message: 'Your event is saved. Check its format before trying to publish again.' },
  offer_not_supported: { title: 'Choose an available event format', message: 'This format is not available for publication yet. Your event stays a private draft.' },
  date_required: { title: 'Add an event date', message: 'Choose a date, then publish the saved event into Scene.' },
  end_time_required: { title: 'Add an end time', message: 'Events with paid tickets need an end time before publication.' },
  paid_ticket_required: { title: 'Finish ticket setup', message: 'This event needs a paid ticket on sale. The person with ticket access can finish setup before you publish.' },
  payout_setup_required: { title: 'Payout setup needs finishing', message: 'The person receiving this event’s ticket payments needs to finish payout setup. Your event stays a private draft.' },
  course_setup_unavailable: { title: 'Could not check course dates', message: 'Your course is saved privately. Its session dates must be checked before publication.' },
  course_dates_required: { title: 'Add the course dates', message: 'A course needs at least two saved session dates before publication. Your course stays a private draft.' },
};
export interface CreatorPageEventReadiness {
  pageId: string; eventId: string; status: 'Draft' | 'Live' | 'Completed' | 'Cancelled';
  offerType: string | null; publishReady: boolean; publishReason: PageEventPublishReason | null;
  hasPaidTiers: boolean; hasPaidTierOnSale: boolean; payoutReady: boolean; canManageTickets: boolean;
  cancellationRequiresRefunds: boolean; canCancelWithoutRefunds: boolean;
}
const current = (scope: CreatorPageScope) => { if (!scope.isCurrent()) throw new CreatorPageScopeExpired(); };
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export async function loadCreatorPageEventReadiness(pageId: string, eventId: string, scope: CreatorPageScope): Promise<CreatorPageEventReadiness> {
  current(scope);
  if (!uuid(pageId) || !uuid(eventId)) throw new CreatorPageReceiptUnknown();
  const { data: { user }, error: accountError } = await supabase.auth.getUser();
  current(scope);
  if (accountError) throw accountError;
  if (user?.id !== scope.userId) throw new CreatorPageScopeExpired();
  const { data: r, error } = await supabase.rpc('creator_page_event_readiness', { p_page_id: pageId, p_event_id: eventId });
  current(scope);
  if (error) throw error;
  if (!r || typeof r !== 'object' || Array.isArray(r) || r.page_id !== pageId || r.event_id !== eventId
    || !['Draft', 'Live', 'Completed', 'Cancelled'].includes(r.status)
    || !(r.offer_type === null || typeof r.offer_type === 'string')
    || !(r.publish_reason === null || pageEventPublishReasons.includes(r.publish_reason))
    || !['publish_ready', 'has_paid_tiers', 'has_paid_tier_on_sale', 'payout_ready', 'can_manage_tickets', 'cancellation_requires_refunds', 'can_cancel_without_refunds'].every(key => typeof r[key] === 'boolean')
    || r.publish_ready !== (r.publish_reason === null) || r.can_cancel_without_refunds === r.cancellation_requires_refunds
    || (r.has_paid_tier_on_sale && !r.has_paid_tiers)
    || (r.publish_ready && (r.offer_type === null || !['free_event', 'ticketed_event', 'course', 'drop_in'].includes(r.offer_type)
      || !['Draft', 'Live'].includes(r.status) || (r.has_paid_tiers && !r.payout_ready)
      || (r.offer_type === 'ticketed_event' && !r.has_paid_tier_on_sale)))) throw new CreatorPageReceiptUnknown();
  return { pageId, eventId, status: r.status, offerType: r.offer_type, publishReady: r.publish_ready, publishReason: r.publish_reason,
    hasPaidTiers: r.has_paid_tiers, hasPaidTierOnSale: r.has_paid_tier_on_sale, payoutReady: r.payout_ready,
    canManageTickets: r.can_manage_tickets, cancellationRequiresRefunds: r.cancellation_requires_refunds,
    canCancelWithoutRefunds: r.can_cancel_without_refunds };
}
