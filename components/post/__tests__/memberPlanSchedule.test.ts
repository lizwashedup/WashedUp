import { resolveMemberPlanSchedule } from '../planComposerRules';

const saved = { start: '2040-11-04T09:30:17.123Z', end: '2040-11-06T17:45:29.456Z' };
it('moves a multi-day plan by LA calendar dates while honoring an edited end clock', () => {
  const result = resolveMemberPlanSchedule({ y: 2040, m: 10, d: 2, hour24: 1, minute: 30 }, { hour24: 10, minute: 15 }, saved);
  expect(result.startIso).toBe('2040-11-02T08:30:00.000Z');
  expect(result.endIso).toBe('2040-11-04T18:15:00.000Z');
});
it('preserves a same-day end in the repeated hour rather than rolling to tomorrow', () => {
  const start = '2040-11-04T08:45:00Z', end = '2040-11-04T09:20:00Z';
  expect(resolveMemberPlanSchedule({ y: 2040, m: 10, d: 4, hour24: 1, minute: 45 }, { hour24: 1, minute: 20 }, { start, end })).toMatchObject({ startIso: start, endIso: end });
});
it('rejects nonexistent LA times after moving a saved plan across spring forward', () => {
  const savedSpring = { start: '2027-03-06T20:00:00Z', end: '2027-03-07T10:15:00Z' };
  expect(resolveMemberPlanSchedule({ y: 2027, m: 2, d: 13, hour24: 12, minute: 0 }, { hour24: 2, minute: 15 }, savedSpring).endIso).toBeNull();
  expect(resolveMemberPlanSchedule({ y: 2027, m: 2, d: 14, hour24: 2, minute: 30 }, null, {}).startIso).toBeNull();
});
