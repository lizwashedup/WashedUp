/**
 * Circles — react-query key factory. Mirrors lib/yours/keys.ts so circle
 * queries invalidate predictably alongside the rest of the Yours surface.
 */
export const circleKeys = {
  all: ['circles'] as const,
  /** The caller's joined circles (directory). */
  mine: (userId: string) => ['circles', 'mine', userId] as const,
  /** A single circle's noticeboard payload. */
  detail: (circleId: string) => ['circles', 'detail', circleId] as const,
};
