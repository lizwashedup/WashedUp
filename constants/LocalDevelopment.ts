/** Production packaging copy only; isolated canonical source stays unchanged. */
export const LOCAL_DEVELOPMENT_ONLY = false;
export function requireLocalBackend(url: string): string {
  const parsed = new URL(url);
  if (parsed.origin !== 'https://upstjumasqblszevlgik.supabase.co' || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error('Release configuration does not match the verified WashedUp backend.');
  }
  return parsed.origin;
}
