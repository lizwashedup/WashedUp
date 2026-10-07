import { getPlanLifecycle, getPlanTerminalStatus } from '../planLifecycle';

const now = '2026-09-14T20:00:00.000Z';
const future = { startTime: '2026-09-15T20:00:00.000Z', endTime: null };

it.each(['cancelled', 'completed'] as const)('recognizes future %s separately from elapsed time', status => {
  expect(getPlanLifecycle({ ...future, status }, now)).toEqual({ terminalStatus: status, isPast: false, isClosed: true });
});

it.each([['CANCELLED', 'cancelled'], ['Completed', 'completed'], ['cAnCeLlEd', 'cancelled']])('matches the saved SQL case folding for %s', (value, expected) => {
  expect(getPlanTerminalStatus(value)).toBe(expected);
});

it.each([undefined, null, false, 0, {}, [], ['cancelled'], { status: 'completed' }, 'future_state', 'canceled', ' cancelled ', 'completed\n', 'draft', 'forming', 'active', 'full'])('does not invent a terminal label for %p', status => {
  expect(getPlanTerminalStatus(status)).toBeNull();
  expect(getPlanLifecycle({ ...future, status }, now)).toEqual({ terminalStatus: null, isPast: false, isClosed: false });
});

it('still closes an elapsed plan without falsely labelling it completed', () => {
  expect(getPlanLifecycle({ status: 'active', startTime: '2026-09-14T17:00:00.000Z', endTime: null }, now))
    .toEqual({ terminalStatus: null, isPast: true, isClosed: true });
});

it('preserves explicit end time precedence even after the three-hour start window', () => {
  expect(getPlanLifecycle({ startTime: '2026-09-14T12:00:00.000Z', endTime: '2026-09-14T20:00:01.000Z' }, now).isClosed).toBe(false);
  expect(getPlanLifecycle({ startTime: '2026-09-14T12:00:00.000Z', endTime: now }, now).isClosed).toBe(true);
});

it('preserves the exact start-plus-three-hour cutoff with null or omitted end times', () => {
  expect(getPlanLifecycle({ startTime: '2026-09-14T17:00:01.000Z' }, now).isClosed).toBe(false);
  expect(getPlanLifecycle({ startTime: '2026-09-14T17:00:00.000Z', endTime: null }, now).isClosed).toBe(true);
});

it('uses absolute time across the LA fall-back transition and accepts Date/number inputs', () => {
  const startTime = new Date('2026-11-01T01:30:00-07:00');
  expect(getPlanLifecycle({ startTime }, Date.parse('2026-11-01T03:29:59-08:00')).isPast).toBe(false);
  expect(getPlanLifecycle({ startTime }, new Date('2026-11-01T03:30:00-08:00')).isPast).toBe(true);
});

it('keeps malformed time behavior distinct from an authoritative terminal status', () => {
  expect(getPlanLifecycle({ startTime: 'bad timestamp', status: 'unknown' }, now)).toEqual({ terminalStatus: null, isPast: false, isClosed: false });
  expect(getPlanLifecycle({ startTime: 'bad timestamp', status: 'cancelled' }, now)).toEqual({ terminalStatus: 'cancelled', isPast: false, isClosed: true });
});
