// Device-local labels shared by plan detail, map cards and chat rows.
// LA-pinned full event times remain in their existing formatters.
function relativeLocalDay(date: Date): 'today' | 'tomorrow' | null {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // A local calendar day can be 23 or 25 hours across a clock change.
  const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (dateStart.getTime() === todayStart.getTime()) return 'today';
  if (dateStart.getTime() === tomorrowStart.getTime()) return 'tomorrow';
  return null;
}

export function formatLocalPlanDateTime(dateString: string): string {
  const d = new Date(dateString);
  const day = relativeLocalDay(d);

  const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  if (day === 'today') return `Today at ${timeStr}`;
  if (day === 'tomorrow') return `Tomorrow at ${timeStr}`;
  const dayStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return `${dayStr} at ${timeStr}`;
}

export function formatLocalPlanDay(dateString: string): string {
  const date = new Date(dateString);
  const day = relativeLocalDay(date);

  if (day === 'today') return date.getHours() >= 17 ? 'Tonight' : 'Today';
  if (day === 'tomorrow') return 'Tomorrow';
  return date.toLocaleDateString('en-US', { weekday: 'short' });
}
