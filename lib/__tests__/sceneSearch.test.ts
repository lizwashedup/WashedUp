import { matchesSceneCommunity, matchesSceneEvent } from '../sceneSearch';
import type { SceneEvent, DiscoverableCommunity } from '../sceneDiscovery';

it('matches public event details and exact published owner across accents and word order', () => {
  const event = { title: 'Café by the sea', venue: 'Santa Monica', description: 'Bring a friend', published_page: { name: 'Sunday Table' }, public_name: 'Old attribution' } as SceneEvent;
  expect(matchesSceneEvent(event, 'table cafe')).toBe(true);
  expect(matchesSceneEvent(event, 'monica friend')).toBe(true);
  expect(matchesSceneEvent(event, 'old attribution')).toBe(false);
});
it('does not search an unavailable page through a legacy attribution fallback', () => {
  expect(matchesSceneEvent({ title: 'Dinner', published_page: null, public_name: 'Private name', organizer_name: 'Account name' } as SceneEvent, 'private')).toBe(false);
});
it('searches community interests and descriptions, never handles', () => {
  const community = { name: 'Sunset Club', description: 'Time outside', tagline: 'New friends', handle: 'private-handle' } as DiscoverableCommunity;
  expect(matchesSceneCommunity(community, 'outside friends')).toBe(true);
  expect(matchesSceneCommunity(community, 'private-handle')).toBe(false);
  expect(matchesSceneCommunity(community, '   ')).toBe(true);
});


it.each(['outdoors', 'business & networking', 'just for fun', 'other'])('finds the second public category %s', category => {
 const event = {title: 'An evening together', category: 'music', categories: ['music', category]} as SceneEvent;
 expect(matchesSceneEvent(event, category)).toBe(true);
 expect(matchesSceneEvent(event, `evening ${category}`)).toBe(true);
 expect(matchesSceneEvent(event, 'music')).toBe(true);
});
it('uses the same normalized category words as the displayed labels', () => {
 const event = {title: 'Fresh air', category: 'old category', categories: [' Fitness ', ' OUTDOORS ']} as SceneEvent;
 expect(matchesSceneEvent(event, 'outdoors FITNESS')).toBe(true);
 expect(matchesSceneEvent(event, 'old category')).toBe(false);
});
it.each([undefined, null, []].map(categories => ({categories})))('retains singular category search when categories are $categories', ({categories}) => {
 const event = {title: 'Morning together', category: 'Fitness and outdoors', categories} as SceneEvent;
 expect(matchesSceneEvent(event, 'fitness')).toBe(true);
 expect(matchesSceneEvent(event, 'outdoors')).toBe(true);
 expect(matchesSceneEvent(event, 'morning fitness')).toBe(true);
});
it('searches the Community tag derived from the public community relationship', () => {
 const event = {title: 'Sunday walk', category: 'outdoors', categories: ['outdoors'], community_id: 'public-community-id'} as SceneEvent;
 expect(matchesSceneEvent(event, 'community outdoors')).toBe(true);
 expect(matchesSceneEvent(event, 'public-community-id')).toBe(false);
 expect(matchesSceneEvent({...event, community_id: null}, 'community')).toBe(false);
});
it('category matching does not expose private event or page attributes', () => {
 const event = {title: 'Sunday walk', category: 'community', categories: ['community', 'outdoors'],
  published_page: {name: 'Sunday Table', handle: 'private-page-handle', owner_id: 'private-owner-id', draft: {name: 'Unpublished page'}},
  public_name: 'Superseded attribution', organizer_name: 'Private account name', handle: 'private-member-handle', private_notes: 'Hidden details'} as unknown as SceneEvent;
 expect(matchesSceneEvent(event, 'table outdoors')).toBe(true);
 for (const query of ['private-page-handle', 'private-owner-id', 'unpublished', 'superseded', 'private account', 'private-member-handle', 'hidden details']) {
  expect(matchesSceneEvent(event, query)).toBe(false);
 }
});
it('keeps unavailable published owners private while matching their public event categories', () => {
 const event = {title: 'Evening plans', category: 'music', categories: ['music', 'other'], published_page: null,
  public_name: 'Private page', organizer_name: 'Private account'} as SceneEvent;
 expect(matchesSceneEvent(event, 'other')).toBe(true);
 expect(matchesSceneEvent(event, 'private')).toBe(false);
});
it('retains existing legacy public attribution without searching arbitrary profile data', () => {
 const event = {title: 'Sunday dinner', category: 'food and drink', public_name: 'Public supper club',
  organizer_name: 'Superseded account', profile: {handle: 'not-public'}} as unknown as SceneEvent;
 expect(matchesSceneEvent(event, 'supper food')).toBe(true);
 expect(matchesSceneEvent(event, 'superseded')).toBe(false);
 expect(matchesSceneEvent(event, 'not-public')).toBe(false);
});
