import { formatLocalPlanDateTime, formatLocalPlanDay } from '../planDateLabels';
import { execFileSync } from 'child_process';

// Give Node its timezone before startup: assigning process.env.TZ inside a
// Jest worker does not reliably change the worker's Date implementation.
it.each([2, 10])('handles LA clock changes even on a UTC CI runner (month %s)', month => {
  const output = execFileSync(process.execPath, ['-e', `
    const ts = require('typescript');
    const source = require('fs').readFileSync(process.argv[1], 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const NativeDate = Date;
    const now = new NativeDate(2026, ${month}, ${month === 2 ? 8 : 1}, 12).getTime();
    global.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [now])); }
      static now() { return now; }
    };
    const api = {};
    new Function('exports', code)(api);
    const next = new Date(2026, ${month}, ${month === 2 ? 9 : 2}, 18, 30).toISOString();
    process.stdout.write(JSON.stringify([api.formatLocalPlanDay(next), api.formatLocalPlanDateTime(next)]));
  `, require.resolve('../planDateLabels')], {
    cwd: process.cwd(), env: { ...process.env, TZ: 'America/Los_Angeles' }, encoding: 'utf8',
  });
  const [day, dateTime] = JSON.parse(output);
  expect(day).toBe('Tomorrow');
  expect(dateTime).toMatch(/^Tomorrow at 6:30/);
});

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it.each([
  ['spring clock change', 2026, 2, 8],
  ['fall clock change', 2026, 10, 1],
  ['month boundary', 2026, 0, 31],
  ['year boundary', 2026, 11, 31],
  ['leap day', 2028, 1, 28],
] as const)('labels the next calendar day Tomorrow across %s', (_label, year, month, day) => {
  jest.setSystemTime(new Date(year, month, day, 12));
  const next = new Date(year, month, day + 1, 18, 30).toISOString();
  expect(formatLocalPlanDay(next)).toBe('Tomorrow');
  expect(formatLocalPlanDateTime(next)).toMatch(/^Tomorrow at /);
  expect(formatLocalPlanDateTime(next)).toContain('6:30');
});

it('keeps the existing Today/Tonight distinction without shifting the event time', () => {
  jest.setSystemTime(new Date(2026, 10, 1, 12));
  const afternoon = new Date(2026, 10, 1, 16, 59).toISOString();
  const evening = new Date(2026, 10, 1, 17).toISOString();
  expect(formatLocalPlanDay(afternoon)).toBe('Today');
  expect(formatLocalPlanDay(evening)).toBe('Tonight');
  expect(formatLocalPlanDateTime(evening)).toMatch(/^Today at /);
  expect(formatLocalPlanDateTime(evening)).toContain('5:00');
});

it('uses the existing weekday/date fallback for yesterday and later dates', () => {
  jest.setSystemTime(new Date(2026, 10, 1, 12));
  for (const date of [new Date(2026, 9, 31, 17), new Date(2026, 10, 3, 17)]) {
    expect(formatLocalPlanDay(date.toISOString())).toBe(date.toLocaleDateString('en-US', { weekday: 'short' }));
    expect(formatLocalPlanDateTime(date.toISOString())).not.toMatch(/^(Today|Tomorrow)/);
  }
});

it('updates relative labels when midnight passes', () => {
  const event = new Date(2026, 10, 2, 18).toISOString();
  jest.setSystemTime(new Date(2026, 10, 1, 23, 59));
  expect(formatLocalPlanDay(event)).toBe('Tomorrow');
  jest.setSystemTime(new Date(2026, 10, 2));
  expect(formatLocalPlanDay(event)).toBe('Tonight');
});
