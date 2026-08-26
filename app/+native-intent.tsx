/**
 * Universal-link routing.
 *
 * iOS claims the WHOLE washedup.app domain (applinks in app.json has no
 * path filter), so EVERY washedup.app URL tapped on an iPhone opens this
 * app -- including web-only pages the app has no screen for. Before the
 * 2026-08-25 S-05 fix, any unrecognized path fell through expo-router to
 * +not-found, which silently bounced to the auth gate: the tap read as the
 * app hijacking the link and killing it (e.g. the /c/<handle>?manage=
 * membership cancel link in the contributor receipt email). Now:
 *
 *   1. Paths with a real native screen route there, WITH their query
 *      string (S-05: params used to be dropped in the handoff).
 *   2. /app/creator* keeps the app-door guarantee (7-21): the acceptance
 *      email sends washedup.app/app/creator/events; the native creator
 *      space is the (creator) shell, whose layout gates on the grant.
 *   3. /auth/callback passes through untouched -- password recovery is
 *      handled by parseSessionFromUrl in app/_layout.tsx and its tokens
 *      ride the fragment, which must not be rewritten here.
 *   4. Anything else on the domain goes to /web-fallback, which opens the
 *      ORIGINAL URL in an in-app browser (SFSafariViewController / Custom
 *      Tab -- universal links do not re-trigger there), so a web-only page
 *      is finally reachable from a phone tap instead of dead.
 *
 * Custom-scheme (washedupapp://) paths return unchanged: they are minted
 * by our own code against real native routes.
 */

/** Path shapes that have a real native screen (see app/e, app/plans, app/r). */
const NATIVE_PATH = /^\/(e|plans|r)\/[^/]+\/?$/;

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (!path.startsWith('http')) return path;
    const url = new URL(path);
    if (!/(^|\.)washedup\.app$/i.test(url.hostname)) return path;

    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    const search = url.search ?? '';

    if (pathname === '/' ) return '/(tabs)/plans';
    if (pathname === '/plans') return '/(tabs)/plans';
    if (pathname.startsWith('/auth/callback')) return path;
    if (pathname.startsWith('/app/creator')) return '/(creator)/events';

    const appPlan = pathname.match(/^\/app\/plan\/([A-Za-z0-9-]+)$/);
    if (appPlan) return `/plan/${appPlan[1]}${search}`;
    const appEvent = pathname.match(/^\/app\/event\/([A-Za-z0-9-]+)$/);
    if (appEvent) return `/event/${appEvent[1]}${search}`;

    if (NATIVE_PATH.test(pathname)) return `${pathname}${search}`;

    return `/web-fallback?url=${encodeURIComponent(path)}`;
  } catch {
    return path;
  }
}
