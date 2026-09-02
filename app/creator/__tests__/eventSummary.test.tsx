import { summaryStatusLine } from '../event-summary';

describe('summaryStatusLine', () => {
  const now = '2026-09-01T12:00:00.000Z';

  it('reads terminal/admin statuses verbatim, same vocabulary as deriveEventState', () => {
    expect(summaryStatusLine('Cancelled', '2026-09-10', now)).toBe('cancelled');
    expect(summaryStatusLine('Archived', '2026-09-10', now)).toBe('archived');
    expect(summaryStatusLine('Completed', '2026-08-10', now)).toBe('completed');
    expect(summaryStatusLine('Draft', '2026-09-10', now)).toBe('draft');
  });

  it('falls back to scheduled when there is no event date yet', () => {
    expect(summaryStatusLine('Live', '', now)).toBe('scheduled');
  });

  it('reads a future date as scheduled and a past date as ended', () => {
    expect(summaryStatusLine('Live', '2026-09-10', now)).toBe('scheduled');
    expect(summaryStatusLine('Live', '2026-08-10', now)).toBe('ended');
  });

  it("treats today's own date as not yet ended", () => {
    expect(summaryStatusLine('Live', '2026-09-01', now)).toBe('scheduled');
  });
});
