/** Keep a Plan chat for 48 hours after its actual end when one is supplied. */
export function getPlanChatExpiry(startTime: string, endTime?: string | null): Date | null {
  const start = new Date(startTime);
  if (!Number.isFinite(start.getTime())) return null;
  const end = endTime ? new Date(endTime) : null;
  const base = end && Number.isFinite(end.getTime()) && end.getTime() > start.getTime() ? end : start;
  return new Date(base.getTime() + 48 * 60 * 60 * 1000);
}

/** One lifecycle projection for the inbox's first paint, enriched rows and label. */
export function getPlanChatTiming(startTime: string, endTime?: string | null, status?: string | null, now = Date.now()) {
  const expiresAt = getPlanChatExpiry(startTime, endTime);
  const isPast = status === 'cancelled' || (expiresAt !== null && now >= expiresAt.getTime());
  const started = new Date(startTime).getTime() <= now;
  const remainingHours = !isPast && started && expiresAt
    ? Math.ceil((expiresAt.getTime() - now) / (60 * 60 * 1000)) : null;
  return { expiresAt, isPast, remainingHours };
}


/** Schedule the next change to a start label, hours left, or write access. */
export function nextPlanChatChange(start: number, expiry: number, now: number): number {
  if (!Number.isFinite(start) || !Number.isFinite(expiry) || now >= expiry) return Infinity;
  const hour = 3600000;
  if (now < start) {
    const untilStart = start - now;
    const unit = untilStart >= 24 * hour ? 24 * hour : hour;
    // The pinned card rounds down. Its label drops just after a whole day or hour.
    return Math.min(start, start - Math.floor(untilStart / unit) * unit + 1);
  }
  // The open chat rounds time remaining up. Its last change is the exact archive time.
  return expiry - (Math.ceil((expiry - now) / hour) - 1) * hour;
}
