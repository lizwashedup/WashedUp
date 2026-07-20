/**
 * Meta-row format tests (founder ruling 7-19): real date in the meta row,
 * and the "Other" neighborhood segment is never printed.
 */
import { formatFirstJoinMeta, laDateLower, laTimeLower } from '../format';

// 2026-07-26 00:30 UTC = sat, jul 25 5:30 pm in LA.
const SAT_EVENING = '2026-07-26T00:30:00Z';
// 2026-07-25 14:00 UTC = sat, jul 25 7:00 am in LA.
const SAT_MORNING = '2026-07-25T14:00:00Z';

describe('formatFirstJoinMeta', () => {
  it('renders real date, LA time, and lowercase neighborhood', () => {
    expect(formatFirstJoinMeta(SAT_EVENING, 'Los Feliz')).toBe('sat, jul 25 · 5:30 pm · los feliz');
  });

  it('never prints "other": the segment drops entirely', () => {
    expect(formatFirstJoinMeta(SAT_MORNING, 'Other')).toBe('sat, jul 25 · 7:00 am');
  });

  it('drops the neighborhood segment when null', () => {
    expect(formatFirstJoinMeta(SAT_MORNING, null)).toBe('sat, jul 25 · 7:00 am');
  });

  it('helpers handle invalid dates without throwing', () => {
    expect(laDateLower('not-a-date')).toBe('');
    expect(laTimeLower('not-a-date')).toBe('');
  });
});
