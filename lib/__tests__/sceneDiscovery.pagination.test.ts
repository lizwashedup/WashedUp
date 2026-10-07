const mockFrom=jest.fn(),mockCheck=jest.fn(),mockLinks=jest.fn();
let mockEnabled=false;
jest.mock('../supabase',()=>({supabase:{from:(...args:unknown[])=>mockFrom(...args)}}));
jest.mock('../../constants/FeatureFlags',()=>({get CREATOR_PAGES_ENABLED(){return mockEnabled;}}));
jest.mock('../publishedPageIdentity',()=>({checkPublishedPageScope:(...a:unknown[])=>mockCheck(...a),loadPublishedEventPageIdentities:(...a:unknown[])=>mockLinks(...a)}));
jest.mock('../organizerProfile',()=>({getOrganizerProfiles:jest.fn()}));
jest.mock('../communityLeader',()=>({getLeaderCards:jest.fn()}));
import { getSceneEvents, sceneUpcomingFilter } from '../sceneDiscovery';
const rows=Array.from({length:225},(_,i)=>({id:String(i+1).padStart(4,'0'),title:`Event ${i+1}`,event_date:null,start_time:null,end_time:null,community_id:null,host_user_id:null,public_name:'Public page'}));
let cap:number,failAt:number,repeat:boolean,calls:any[];
beforeEach(()=>{
 jest.clearAllMocks();mockEnabled=false;cap=200;failAt=-1;repeat=false;calls=[];
 mockLinks.mockResolvedValue(new Map());mockCheck.mockImplementation(async(scope:any)=>{if(!scope.isCurrent())throw Error('Retired');});
 mockFrom.mockImplementation(()=>{
  const call:any={cursor:''};calls.push(call);const q:any={};
  for(const method of ['select','eq','or','order','limit','is'])q[method]=(...args:unknown[])=>{call[method]=args;return q;};
  q.gt=(_key:string,value:string)=>{call.cursor=value;return q;};
  q.then=(resolve:any)=>Promise.resolve(calls.length===failAt?{data:null,error:Error('Offline')}:{data:rows.filter(r=>repeat||r.id>call.cursor).slice(0,cap),error:null}).then(resolve);
  return q;
 });
});
it('loads beyond both the former60-row limit and the200-row page boundary in stable order',async()=>{
 const result=await getSceneEvents();expect(result).toHaveLength(225);expect(result[224].id).toBe('0225');
 expect(calls.map(c=>c.cursor)).toEqual(['','0200','0225']);
 expect(calls.every(c=>c.eq[0]==='status'&&c.eq[1]==='Live'&&c.is[0]==='community_id'&&c.is[1]===null)).toBe(true);
 expect(calls.every(c=>c.order[0]==='id'&&c.order[1].ascending&&c.limit[0]===200)).toBe(true);
 expect(new Set(calls.map(c=>c.or[0])).size).toBe(1);
});
it('continues after a short server-capped page and preserves the community release gate',async()=>{
 cap=50;expect(await getSceneEvents(true)).toHaveLength(225);expect(calls).toHaveLength(6);expect(calls.every(c=>!c.is)).toBe(true);
});
it('rejects a later-page failure instead of returning an incomplete successful feed',async()=>{
 failAt=2;await expect(getSceneEvents()).rejects.toThrow('Offline');expect(calls).toHaveLength(2);
});
it('stops a non-advancing cursor instead of looping or duplicating events',async()=>{
 repeat=true;await expect(getSceneEvents()).rejects.toThrow('Could not finish loading events');expect(calls).toHaveLength(2);
});
it('rejects a retired account during pagination before identity enrichment',async()=>{
 mockEnabled=true;const scope={userId:'member',isCurrent:()=>calls.length<1};
 await expect(getSceneEvents(true,scope)).rejects.toThrow('Retired');expect(calls).toHaveLength(1);expect(mockLinks).not.toHaveBeenCalled();
});
it('uses the LA day around midnight instead of the UTC date for undated-time fallbacks',()=>{
 expect(sceneUpcomingFilter(Date.parse('2026-09-17T06:59:59Z'))).toContain('event_date.gte.2026-09-16');
 expect(sceneUpcomingFilter(Date.parse('2026-09-17T07:00:00Z'))).toContain('event_date.gte.2026-09-17');
 expect(sceneUpcomingFilter(Date.parse('2026-03-09T06:59:59Z'))).toContain('event_date.gte.2026-03-08');
});
