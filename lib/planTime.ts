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

// Format a plan's start as "Fri, Jun 10, 3:45 PM", pinned to LA time rather
// than the viewer's device timezone. Plans are physical LA events, so a user
// whose phone is set to another zone (travelling, or just wrong) must still see
// the real local start time. Returns '' on a bad value so a card never crashes.
export function formatPlanWhenLA(iso: string): string {
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      timeZone: 'America/Los_Angeles',
    });
    const time = d.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true,
      timeZone: 'America/Los_Angeles',
    });
    return `${date}, ${time}`;
  } catch {
    return '';
  }
}
