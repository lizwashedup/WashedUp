import type { SceneEvent, DiscoverableCommunity } from './sceneDiscovery';
import { matchesSceneEvent, matchesSceneCommunity } from './sceneSearch';
import { getLADayParts } from './laDate';
import { matchesCommunityFilters, type CommunityDiscoveryMetadata } from './communityDiscoveryFilters';

export type SceneFilters = { query: string; area: string; from: string; through: string; category?: string };
export const emptySceneFilters = (): SceneFilters => ({ query: '', area: '', from: '', through: '' });
export function validSceneDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function sceneFilterError(filters: SceneFilters): string | null {
  if ((filters.from && !validSceneDate(filters.from)) || (filters.through && !validSceneDate(filters.through))) return 'Choose valid dates.';
  if (filters.from && filters.through && filters.through < filters.from) return 'Through must be on or after From.';
  return null;
}
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en-US').trim();
function eventDay(event: SceneEvent): string | null {
  if (event.event_date && validSceneDate(event.event_date)) return event.event_date;
  if (!event.start_time || !Number.isFinite(Date.parse(event.start_time))) return null;
  const { y, m, d } = getLADayParts(event.start_time);
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
export function sceneEventMatches(event: SceneEvent, filters: SceneFilters) {
  const area = [event.venue, event.venue_address, event.published_page?.city].filter(Boolean).join(' ');
  if (!fold(area).includes(fold(filters.area)) || !matchesSceneEvent(event, filters.query)) return false;
  if (!filters.from && !filters.through) return true;
  const day = eventDay(event);
  return !!day && (!filters.from || day >= filters.from) && (!filters.through || day <= filters.through);
}
export function compareSceneEventDates(a: SceneEvent, b: SceneEvent) {
  const first = eventDay(a), second = eventDay(b);
  if (!first) return second ? 1 : 0;
  if (!second) return -1;
  return first.localeCompare(second);
}
export function sceneCommunityMatches(community: DiscoverableCommunity & CommunityDiscoveryMetadata, filters: SceneFilters) {
  return matchesCommunityFilters(community, filters) && matchesSceneCommunity(community, filters.query);
}
export function sceneFilterCount(filters: SceneFilters) {
  return Number(!!filters.query) + Number(!!filters.area) + Number(!!filters.category) + Number(!!(filters.from || filters.through));
}
