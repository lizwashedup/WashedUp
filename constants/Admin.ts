/**
 * Admin access — gate Scene event management and other admin features.
 * Set EXPO_PUBLIC_ADMIN_USER_IDS in .env (comma-separated UUIDs).
 */

const ADMIN_IDS = (process.env.EXPO_PUBLIC_ADMIN_USER_IDS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export function isAdmin(userId: string | null): boolean {
  if (!userId) return false;
  return ADMIN_IDS.includes(userId);
}
