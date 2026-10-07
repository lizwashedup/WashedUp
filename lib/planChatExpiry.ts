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
