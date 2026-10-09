import { emptySceneFilters, sceneFilterError, sceneEventMatches, sceneCommunityMatches, compareSceneEventDates } from '../sceneFilters';
import type { SceneEvent, DiscoverableCommunity } from '../sceneDiscovery';
const event=(fields:Partial<SceneEvent>)=>({title:'Dinner',public_name:null,event_date:null,start_time:null,...fields} as SceneEvent);
it('uses inclusive dates and excludes unknown dates only when a date constraint is applied',()=>{
 const f={...emptySceneFilters(),from:'2026-09-19',through:'2026-09-20'};
 expect(sceneEventMatches(event({event_date:'2026-09-19'}),f)).toBe(true);
 expect(sceneEventMatches(event({event_date:'2026-09-20'}),f)).toBe(true);
 expect(sceneEventMatches(event({event_date:'2026-09-21'}),f)).toBe(false);
 expect(sceneEventMatches(event({}),f)).toBe(false);
 expect(sceneEventMatches(event({}),emptySceneFilters())).toBe(true);
});
it('supports either open endpoint and anchors timestamp-only dates to LA',()=>{
 expect(sceneEventMatches(event({start_time:'2026-09-20T02:00:00Z'}),{...emptySceneFilters(),through:'2026-09-19'})).toBe(true);
 expect(sceneEventMatches(event({event_date:'2026-09-20'}),{...emptySceneFilters(),from:'2026-09-19'})).toBe(true);
});
it('rejects impossible calendar dates and backwards ranges',()=>{
 expect(sceneFilterError({...emptySceneFilters(),from:'2026-02-30'})).toBeTruthy();
 expect(sceneFilterError({...emptySceneFilters(),from:'2026-09-20',through:'2026-09-19'})).toBeTruthy();
 expect(sceneFilterError({...emptySceneFilters(),from:'2028-02-29'})).toBeNull();
});
it('matches published discovery areas and does not invent one from city text',()=>{
 expect(sceneEventMatches(event({venue_address:'Santa Monica, CA'}),{...emptySceneFilters(),area:'MONICA'})).toBe(true);
 expect(sceneCommunityMatches({name:'Club',city:null} as DiscoverableCommunity,{...emptySceneFilters(),area:'LA'})).toBe(false);
 expect(sceneCommunityMatches({name:'Club',city:'Los Ángeles'} as DiscoverableCommunity,{...emptySceneFilters(),area:'los angeles'})).toBe(false);
 expect(sceneCommunityMatches({name:'Club',discovery_area:'Los Ángeles'} as DiscoverableCommunity,{...emptySceneFilters(),area:'los angeles'})).toBe(true);
});
it('sorts discovery by event day, placing undated listings last without changing inclusion',()=>{
 const rows=[event({id:'unknown'}),event({id:'later',event_date:'2026-09-20'}),event({id:'earlier',event_date:'2026-09-19',end_time:'2026-09-21T02:00:00Z'})];
 expect(rows.sort(compareSceneEventDates).map(row=>row.id)).toEqual(['earlier','later','unknown']);
});
