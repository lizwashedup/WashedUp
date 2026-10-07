import type { DiscoverableCommunity, SceneEvent } from './sceneDiscovery';
import { eventPageByline } from './eventPageIdentity';
import { eventCategories } from './eventCategories';

const fold = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en-US').trim();
function matches(query: string, values: Array<string | null | undefined>) {
  const text = fold(values.filter(Boolean).join(' '));
  return fold(query).split(/\s+/).every(term => text.includes(term));
}

/** Search only fields already available through public discovery; never handles or private page drafts. */
export function matchesSceneEvent(event: SceneEvent, query: string) {
  return matches(query, [event.title, event.description, event.venue, eventCategories(event).join(' · '), eventPageByline(event)]);
}

export function matchesSceneCommunity(community: DiscoverableCommunity, query: string) {
  return matches(query, [community.name, community.tagline, community.description]);
}
