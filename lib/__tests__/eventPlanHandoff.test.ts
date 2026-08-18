import {
  buildPlanPrefillFromEvent,
  canFindPeopleForEvent,
  getOpenLinkedPlans,
  type OrganizationEventForHandoff,
} from '../eventPlanHandoff';

const baseEvent: OrganizationEventForHandoff = {
  id: 'evt-1',
  title: 'Warehouse Market',
  description: 'a whole thing',
  image_url: 'https://example.com/poster.jpg',
  event_date: '2026-09-01',
  start_time: '19:00:00',
  venue: 'The Warehouse',
  venue_address: '123 Main St, LA',
  category: 'markets',
  community_id: null,
};

describe('canFindPeopleForEvent', () => {
  it('allows an organization event (no community_id)', () => {
    expect(canFindPeopleForEvent({ community_id: null })).toBe(true);
  });

  it('blocks a community event: its conversation is the event-room chat, not a Plan', () => {
    expect(canFindPeopleForEvent({ community_id: 'community-1' })).toBe(false);
  });
});

describe('buildPlanPrefillFromEvent', () => {
  it('carries every field the Plans composer prefill reads', () => {
    expect(buildPlanPrefillFromEvent(baseEvent)).toEqual({
      prefillTitle: 'Warehouse Market',
      prefillExploreEventId: 'evt-1',
      prefillStartTime: '19:00:00',
      prefillEventDate: '2026-09-01',
      prefillDescription: 'a whole thing',
      prefillImageUrl: 'https://example.com/poster.jpg',
      prefillLocation: '123 Main St, LA',
      prefillCategory: 'markets',
    });
  });

  it('prefers venue_address over venue when both exist', () => {
    const out = buildPlanPrefillFromEvent(baseEvent);
    expect(out.prefillLocation).toBe(baseEvent.venue_address);
  });

  it('falls back to venue when venue_address is null', () => {
    const out = buildPlanPrefillFromEvent({ ...baseEvent, venue_address: null });
    expect(out.prefillLocation).toBe('The Warehouse');
  });

  it('coalesces every nullable field to an empty string, never the literal "null"', () => {
    const out = buildPlanPrefillFromEvent({
      ...baseEvent,
      description: null,
      image_url: null,
      event_date: null,
      start_time: null,
      venue: null,
      venue_address: null,
      category: null,
    });
    expect(out).toEqual({
      prefillTitle: 'Warehouse Market',
      prefillExploreEventId: 'evt-1',
      prefillStartTime: '',
      prefillEventDate: '',
      prefillDescription: '',
      prefillImageUrl: '',
      prefillLocation: '',
      prefillCategory: '',
    });
  });
});

describe('getOpenLinkedPlans', () => {
  it('keeps a plan under its real capacity (creator + invitees, max 8) and drops a full one', () => {
    const plans = [
      { id: 'open', memberCount: 3, maxInvites: 7 }, // capacity 8, room
      { id: 'full', memberCount: 8, maxInvites: 7 }, // capacity 8, full
    ];
    expect(getOpenLinkedPlans(plans).map((p) => p.id)).toEqual(['open']);
  });

  it('defaults a null maxInvites to 7 invitees (8 total), matching the event page render', () => {
    const plans = [{ id: 'default-cap', memberCount: 7, maxInvites: null }];
    expect(getOpenLinkedPlans(plans).map((p) => p.id)).toEqual(['default-cap']);
    expect(getOpenLinkedPlans([{ id: 'x', memberCount: 8, maxInvites: null }])).toEqual([]);
  });

  it('never lets capacity exceed MAX_GROUP even if maxInvites is set absurdly high', () => {
    const plans = [{ id: 'huge', memberCount: 8, maxInvites: 500 }];
    expect(getOpenLinkedPlans(plans)).toEqual([]);
  });

  it('treats a negative or fractional member count defensively (bad data) rather than throwing', () => {
    expect(() => getOpenLinkedPlans([{ id: 'a', memberCount: -3, maxInvites: 7 }])).not.toThrow();
    expect(getOpenLinkedPlans([{ id: 'a', memberCount: -3, maxInvites: 7 }])).toEqual([
      { id: 'a', memberCount: -3, maxInvites: 7 },
    ]);
  });
});
