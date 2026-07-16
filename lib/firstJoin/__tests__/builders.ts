/**
 * Shared test builders for the first-join suites. Defaults describe one
 * coherent happy path: an Echo Park viewer into Sports, and a mixed Tuesday
 * plan in Echo Park with open capacity.
 */
import type { FirstJoinCreator, FirstJoinEventRow, FirstJoinViewer } from '../types';

// Thursday 2026-07-16, noon PDT: the fixed "now" both suites rank against.
export const NOW = new Date('2026-07-16T19:00:00Z');
// Tuesday 2026-07-21, 7pm PDT: inside the window, not a weekend.
export const TUESDAY_START = '2026-07-22T02:00:00Z';
// Saturday 2026-07-18, 7pm PDT.
export const SATURDAY_START = '2026-07-19T02:00:00Z';

export function mkEvent(overrides: Partial<FirstJoinEventRow> = {}): FirstJoinEventRow {
  return {
    id: 'event-1',
    title: 'pickup soccer',
    start_time: TUESDAY_START,
    status: 'forming',
    neighborhood: 'Echo Park',
    primary_vibe: 'Sports',
    gender_rule: 'mixed',
    target_age_min: null,
    target_age_max: null,
    max_invites: 10,
    min_invites: 4,
    member_count: 1,
    drop_in: null,
    is_featured: null,
    waitlist_closed: false,
    invite_locked: false,
    creator_user_id: 'creator-1',
    image_url: null,
    location_text: null,
    slug: null,
    ...overrides,
  };
}

export function mkViewer(overrides: Partial<FirstJoinViewer> = {}): FirstJoinViewer {
  return {
    id: 'viewer-1',
    neighborhood: 'Echo Park',
    vibe_tags: ['Sports', 'Music'],
    gender: 'woman',
    birthday: '1998-03-14',
    ...overrides,
  };
}

export function mkCreator(overrides: Partial<FirstJoinCreator> = {}): FirstJoinCreator {
  return {
    id: 'creator-1',
    first_name_display: 'Sofia',
    profile_photo_url: null,
    is_official_host: false,
    suspended_until: null,
    ...overrides,
  };
}
