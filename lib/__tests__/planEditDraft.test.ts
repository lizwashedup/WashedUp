import { minMaxToAgeRanges, preparePlanEdit, type PlanEditDraft } from '../planEditDraft';

// The second occurrence of 1:30 AM on the LA fall-back day, with stored seconds.
const original = Object.freeze({
  start_time: '2026-11-01T09:30:17.123Z',
  end_time: '2026-11-01T11:30:17.123Z',
});
const context = { circlePlan: false, officialCreator: true };
const draft: PlanEditDraft = {
  title: '  Coffee by the park  ', description: '  Meet at the entrance.  ',
  creatorMessage: '  See you there  ', location: '  Ocean Park  ',
  locationLat: 34.01, locationLng: -118.49,
  ticketUrl: '  https://example.test/tickets  ', imageUrl: 'https://example.test/photo.jpg',
  category: 'Outdoors', genderRule: 'mixed',
  year: 2026, month: 10, day: 1, hour: 1, minute: '30', period: 'AM',
  timeChanged: false, ageRanges: [], ageChanged: false,
  groupSize: 7, groupChanged: false,
  featured: false, featuredChanged: false, featuredType: 'washedup_event', featuredCapacity: 100,
};

function patch(changes: Partial<PlanEditDraft> = {}, scope = context) {
  const result = preparePlanEdit(original, { ...draft, ...changes }, scope);
  if (!result.ok) throw new Error(result.message);
  return result.patch;
}

it('prepares a title-only edit without rewriting stored schedule, custom ages, or capacity', () => {
  expect(patch()).toEqual({
    title: 'Coffee by the park', description: 'Meet at the entrance.',
    host_message: 'See you there', location_text: 'Ocean Park',
    location_lat: 34.01, location_lng: -118.49,
    tickets_url: 'https://example.test/tickets', image_url: 'https://example.test/photo.jpg',
    primary_vibe: 'outdoors', gender_rule: 'mixed',
  });
});

it('preserves the exact fold instant when the creator reconfirms the same displayed minute', () => {
  const result = patch({ timeChanged: true });
  expect(result).not.toHaveProperty('start_time');
  expect(result).not.toHaveProperty('end_time');
});

it.each([
  [12, 'AM', '2026-11-02T08:07:00.000Z', '2026-11-02T10:07:00.000Z'],
  [12, 'PM', '2026-11-02T20:07:00.000Z', '2026-11-02T22:07:00.000Z'],
] as const)('keeps minute precision and duration when moving to %s %s', (hour, period, start, end) => {
  expect(patch({ day: 2, hour, period, minute: '07', timeChanged: true })).toMatchObject({
    start_time: start, end_time: end,
  });
});

it.each([
  { month: 2, day: 8, hour: 2, minute: '30', period: 'AM' as const }, // Spring gap.
  { month: 1, day: 30 },
  { minute: '60' },
])('rejects an impossible LA date/time before constructing a patch: %j', changes => {
  expect(preparePlanEdit(original, { ...draft, ...changes }, context)).toEqual({
    ok: false, title: 'Choose another time',
    message: 'That date or time does not exist in Los Angeles. Pick a different time.',
  });
});

it.each(['title', 'description', 'creatorMessage', 'location'] as const)(
  'keeps the existing content screening on %s', field => {
    expect(preparePlanEdit(original, { ...draft, [field]: 'hookup' }, context)).toEqual({
      ok: false, title: 'Content not allowed',
      message: 'Your message contains language that goes against our community guidelines.',
    });
  },
);

it('retains date-validation priority when content is also rejected', () => {
  expect(preparePlanEdit(original, { ...draft, minute: '60', title: 'hookup' }, context))
    .toMatchObject({ ok: false, title: 'Choose another time' });
});

it.each([
  [null, null, ['All Ages']], [21, 99, ['21+']], [20, 39, ['20s', '30s']],
  [25, 35, []], [21, null, []], [null, 35, []],
] as const)('keeps saved age bounds %s / %s representable without inventing a preset', (min, max, ranges) => {
  expect(minMaxToAgeRanges(min, max)).toEqual(ranges);
});

it('only replaces ages after an explicit choice, including clearing the restriction', () => {
  expect(patch({ ageChanged: true, ageRanges: ['20s', '30s'] }))
    .toMatchObject({ target_age_min: 20, target_age_max: 39 });
  expect(patch({ ageChanged: true, ageRanges: ['All Ages'] }))
    .toMatchObject({ target_age_min: null, target_age_max: null });
});

it('keeps Circle capacity and Featured fields out of the complete patch', () => {
  const result = patch({ groupChanged: true, groupSize: 15, featuredChanged: true, featured: true },
    { ...context, circlePlan: true });
  for (const field of ['max_invites', 'is_featured', 'featured_type']) expect(result).not.toHaveProperty(field);
});

it('keeps creator-inclusive Featured capacity when explicitly enabled', () => {
  expect(patch({ featuredChanged: true, featured: true, featuredType: 'special_event', featuredCapacity: 250 }))
    .toMatchObject({ is_featured: true, featured_type: 'special_event', max_invites: 249 });
});

it('retains blank-field and unuploaded-photo handling', () => {
  expect(patch({ description: ' ', creatorMessage: '', location: ' ', locationLat: null, locationLng: null,
    ticketUrl: ' ', imageUrl: 'file:///pending.jpg', category: null })).toMatchObject({
    description: null, host_message: null, location_text: null, location_lat: null, location_lng: null,
    tickets_url: null, image_url: null, primary_vibe: null,
  });
});

it('does not mutate the draft while normalizing an edit', () => {
  const ageRanges: PlanEditDraft['ageRanges'] = ['20s'];
  Object.freeze(ageRanges);
  const frozen = Object.freeze({ ...draft, ageRanges });
  preparePlanEdit(original, frozen, context);
  expect(frozen.title).toBe('  Coffee by the park  ');
  expect(frozen.ageRanges).toEqual(['20s']);
});
