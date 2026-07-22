/**
 * Universal-link routing (the app-door guarantee, 7-21): the acceptance
 * email sends washedup.app/app/creator/events. On a phone the OS hands
 * that URL to the app (applinks claims the whole domain), and without a
 * matching native route expo-router fell through to the home feed. The
 * web creator space lives under /app/creator/*; the native creator
 * space is the (creator) shell, so the one link works on phone and
 * computer both. The (creator) layout itself gates on the approved
 * grant, so an un-granted tap bounces exactly like the in-app path.
 */

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const pathname = path.startsWith('http') ? new URL(path).pathname : path;
    if (pathname.startsWith('/app/creator')) {
      return '/(creator)/events';
    }
    return path;
  } catch {
    return path;
  }
}
