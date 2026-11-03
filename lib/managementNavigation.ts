import type { CreatorAccess, LedCommunity } from './creatorMode';
import type { Workspace } from './workspaceContext';

export const MANAGEMENT_HOME = '/(tabs)/friends/manage' as const;
export const MANAGEMENT_SCREENS = ['today', 'organizer-home', 'events', 'members', 'community', 'updates', 'menu', 'organizer-broadcast'] as const;
export type ManagementScreen = typeof MANAGEMENT_SCREENS[number];
export const managementRoute = (screen: ManagementScreen) => `${MANAGEMENT_HOME}/(tools)/${screen}` as const;

/** Old links remain valid, but there is only one visible app navigation. */
export function legacyManagementDestination(segments: readonly string[], params: Record<string, string | string[] | undefined>) {
  const screen = segments[segments.length - 1];
  const pathname = MANAGEMENT_SCREENS.includes(screen as ManagementScreen) ? managementRoute(screen as ManagementScreen) : MANAGEMENT_HOME;
  return { pathname, params };
}

/** Evaluate the selected identity only; roles in other communities do not carry over. */
export function managementAccess(access: CreatorAccess, workspace: Workspace | null, community: LedCommunity | null) {
  if (workspace === 'organization' && access.hasEventHostGrant) {
    return { home: managementRoute('organizer-home'), screens: ['organizer-home', 'events', 'menu', 'organizer-broadcast'] as ManagementScreen[] };
  }
  const role = community?.role;
  if (workspace === 'community' && (role === 'leader' || role === 'co_leader' || role === 'admin')) {
    return { home: managementRoute('today'), screens: ['today', 'events', 'members', 'community', 'updates', 'menu'] as ManagementScreen[] };
  }
  if (workspace === 'community' && !community && access.hasLeaderGrant) {
    return { home: managementRoute('today'), screens: ['today'] as ManagementScreen[] };
  }
  if (workspace === 'community' && role === 'events') return { home: managementRoute('events'), screens: ['events', 'menu'] as ManagementScreen[] };
  if (workspace === 'community' && role === 'member_care') return { home: managementRoute('members'), screens: ['members', 'menu'] as ManagementScreen[] };
  if (workspace === 'community' && role === 'finance') return { home: managementRoute('menu'), screens: ['menu'] as ManagementScreen[] };
  return { home: MANAGEMENT_HOME, screens: [] as ManagementScreen[] };
}
