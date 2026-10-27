import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { usePlanEditDraft, type PlanEditSource } from '../usePlanEditDraft';
import { preparePlanEdit } from '../../lib/planEditDraft';

const source: PlanEditSource = {
  title: 'Coffee walk', description: null, host_message: null, location_text: 'Ocean Park',
  location_lat: 34, location_lng: -118, tickets_url: null, image_url: null,
  primary_vibe: 'outdoors', gender_rule: 'mixed', target_age_min: 25, target_age_max: 35,
  max_invites: 7, is_featured: false, featured_type: null,
  start_time: '2040-11-04T09:37:17.123Z', end_time: '2040-11-04T11:37:17.123Z',
};
let tree: ReactTestRenderer;
let editor: ReturnType<typeof usePlanEditDraft>;
beforeEach(() => {
  function Harness() { editor = usePlanEditDraft(); return null; }
  act(() => { tree = create(<Harness />); });
  act(() => { editor.reset(source); });
});
afterEach(() => act(() => tree.unmount()));

it('seeds exact minutes and custom ages without marking them changed', () => {
  expect(editor.draft).toMatchObject({ hour: 1, minute: '37', period: 'AM', ageRanges: [], timeChanged: false, ageChanged: false });
  act(() => editor.setField('title', 'New title'));
  const result = preparePlanEdit(editor.original!, editor.draft, { circlePlan: false, officialCreator: false });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('Expected prepared edit');
  for (const key of ['start_time', 'end_time', 'target_age_min', 'target_age_max', 'max_invites']) {
    expect(result.patch).not.toHaveProperty(key);
  }
  expect(editor.original).toEqual(source);
  expect(editor.original).not.toBe(source);
});

it('discards temporary time entry on dismissal and seeds it from the draft when reopened', () => {
  act(() => editor.openTimePicker());
  act(() => { editor.setTimeField('hour', 12); editor.setTimeField('minute', '07'); editor.setTimeField('period', 'PM'); });
  act(() => editor.closeTimePicker());
  expect(editor.draft).toMatchObject({ hour: 1, minute: '37', period: 'AM', timeChanged: false });
  act(() => editor.openTimePicker());
  expect(editor.timeSelection).toEqual({ hour: 1, minute: '37', period: 'AM' });
});

it('blocks invalid temporary time and commits padded minutes only on confirmation', () => {
  act(() => editor.openTimePicker());
  act(() => editor.setTimeField('minute', '99'));
  act(() => editor.confirmTime());
  expect(editor.timePickerVisible).toBe(true);
  expect(editor.draft.timeChanged).toBe(false);
  act(() => editor.setTimeField('minute', '7'));
  act(() => editor.confirmTime());
  expect(editor.timePickerVisible).toBe(false);
  expect(editor.draft).toMatchObject({ minute: '07', timeChanged: true });
});

it('keeps date opening unchanged and marks a selected date for duration-preserving preparation', () => {
  act(() => editor.openDatePicker());
  expect(editor.dateSelection).toEqual({ year: 2040, month: 10, day: 4 });
  expect(editor.draft.timeChanged).toBe(false);
  act(() => editor.selectDate({ year: 2040, month: 10, day: 5 }));
  expect(editor.datePickerVisible).toBe(false);
  const result = preparePlanEdit(editor.original!, editor.draft, { circlePlan: false, officialCreator: false });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('Expected prepared edit');
  expect(Date.parse(result.patch.end_time as string) - Date.parse(result.patch.start_time as string)).toBe(7_200_000);
});

it('retains the two-range limit and All Ages exclusivity across batched updates', () => {
  act(() => { editor.toggleAgeRange('20s'); editor.toggleAgeRange('30s'); editor.toggleAgeRange('40s'); });
  expect(editor.draft.ageRanges).toEqual(['20s', '30s']);
  act(() => editor.toggleAgeRange('20s'));
  expect(editor.draft.ageRanges).toEqual(['30s']);
  act(() => editor.toggleAgeRange('All Ages'));
  expect(editor.draft.ageRanges).toEqual(['All Ages']);
  act(() => editor.toggleAgeRange('21+'));
  expect(editor.draft).toMatchObject({ ageRanges: ['21+'], ageChanged: true });
});

it('starts a fresh draft from the latest plan and clears prior change flags', () => {
  act(() => {
    editor.setField('title', 'Discard me'); editor.setField('imageUrl', 'file://discard.jpg');
    editor.setField('groupSize', n => n - 1); editor.setField('groupChanged', true);
    editor.setField('featuredChanged', true); editor.toggleAgeRange('20s');
    editor.openDatePicker(); editor.openTimePicker();
  });
  act(() => editor.closePickers());
  act(() => { editor.reset({ ...source, title: 'Latest plan', is_featured: true, featured_type: 'birthday_party', max_invites: 149 }); });
  expect(editor.draft).toMatchObject({ title: 'Latest plan', imageUrl: null, groupSize: 149,
    featured: true, featuredType: 'birthday_party', featuredCapacity: 150,
    ageChanged: false, timeChanged: false, groupChanged: false, featuredChanged: false });
  expect(editor.datePickerVisible || editor.timePickerVisible).toBe(false);
});
