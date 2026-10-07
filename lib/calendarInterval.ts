export type CalendarInterval =
  | { ok: true; start: Date; end: Date; inferredEnd: boolean }
  | { ok: false; message: string };

export function resolveCalendarInterval(startTime: string, endTime?: string | null): CalendarInterval {
  const start = new Date(startTime);
  if (!Number.isFinite(start.getTime())) {
    return { ok: false, message: 'The start time needs fixing before this can be added to a calendar.' };
  }
  const inferredEnd = !endTime;
  const end = inferredEnd ? new Date(start.getTime() + 2 * 60 * 60 * 1000) : new Date(endTime);
  if (!Number.isFinite(end.getTime()) || end.getTime() <= start.getTime()) {
    return { ok: false, message: 'The end time must be after the start time before this can be added to a calendar.' };
  }
  return { ok: true, start, end, inferredEnd };
}
