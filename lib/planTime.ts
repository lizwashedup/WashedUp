// Mirrors the public._event_is_past() Postgres function so the client can
// hide the "I'd go next time" button before the user even taps it. A plan
// is "past" once the end_time has elapsed, or — if no end_time was set —
// 3 hours after start_time.

export function isPlanPast(
  startTime: string | Date,
  endTime: string | Date | null | undefined,
): boolean {
  const start = typeof startTime === 'string' ? new Date(startTime) : startTime;
  const cutoff = endTime
    ? typeof endTime === 'string' ? new Date(endTime) : endTime
    : new Date(start.getTime() + 3 * 60 * 60 * 1000);
  return cutoff <= new Date();
}
