import { eventPageIdentity, eventPageByline } from '../eventPageIdentity';
import type { PublishedPageIdentity } from '../publishedPageIdentity';
const page = { pageId: 'page-a', kind: 'organization', name: 'Sunday Table', ownerId: 'same-owner' } as PublishedPageIdentity;
it('keeps an exact page name ahead of old event overrides and owner names', () => {
  const identity = eventPageIdentity({community_id:null},{pageId:'page-a',page});
  expect(eventPageByline({published_page:identity,public_name:'Old override',organizer_name:'Owner account'})).toBe('Sunday Table');
});
it('distinguishes missing legacy linkage from known unavailable publication', () => {
  expect(eventPageIdentity({community_id:null},undefined)).toBeUndefined();
  expect(eventPageByline({public_name:'Old override',organizer_name:'Old profile'})).toBe('Old override');
  const identity = eventPageIdentity({community_id:null},{pageId:'page-a',page:null});
  expect(identity).toBeNull();
  expect(eventPageByline({published_page:identity,public_name:'Old override',organizer_name:'Old profile'})).toBeNull();
});
it('rejects cross-page or community/organization misattribution', () => {
  expect(()=>eventPageIdentity({community_id:null},{pageId:'other',page})).toThrow();
  expect(()=>eventPageIdentity({community_id:'community'},{pageId:'page-a',page})).toThrow();
  expect(()=>eventPageIdentity({community_id:'other'},{pageId:'page-a',page:{...page,kind:'community'}})).toThrow();
  expect(eventPageIdentity({community_id:'page-a'},{pageId:'page-a',page:{...page,kind:'community'}})?.kind).toBe('community');
});
