let mockRows:any[],mockLimit=37,mockReads=0,mockFail=false,mockRepeat=false,mockActive=true;
const mockCover=jest.fn(async(_ids:string[])=>new Map());
jest.mock('../../constants/FeatureFlags',()=>({CREATOR_PAGES_ENABLED:true}));
jest.mock('../publishedPageCover',()=>({getPublishedCoverMediaIds:(ids:string[])=>mockCover(ids)}));
jest.mock('../publishedPageIdentity',()=>({checkPublishedPageScope:async(s:any)=>{if(!s.isCurrent())throw Error('Retired');}}));
jest.mock('../supabase',()=>({supabase:{rpc:()=>{let after:string|null=null;const q:any={order:()=>q,limit:()=>q,gt:(_k:string,v:string)=>{after=v;return q;},then:(yes:any,no:any)=>Promise.resolve().then(()=>{mockReads++;if(mockFail&&after)return {data:null,error:Error('Offline')};return {data:mockRows.filter(r=>mockRepeat||!after||r.id>after).slice(0,mockLimit),error:null};}).then(yes,no)};return q;},from:()=>({select:()=>({in:(_k:string,ids:string[])=>Promise.resolve({data:mockRows.filter(r=>ids.includes(r.id)).map(r=>({id:r.id,city:'Los Angeles',created_at:r.created_at})),error:null})})})}}));
import { getDiscoverableCommunities } from '../sceneDiscovery';
const scope={userId:'member',isCurrent:()=>mockActive};
beforeEach(()=>{mockRows=Array.from({length:225},(_,i)=>({id:String(i).padStart(4,'0'),name:`Community ${i}`,member_count:i%3,created_at:`2026-01-${String(i%28+1).padStart(2,'0')}T00:00:00Z`}));mockReads=0;mockLimit=37;mockFail=false;mockRepeat=false;mockActive=true;mockCover.mockClear();mockCover.mockImplementation(async()=>new Map());});
it('reads beyond 100 through short server pages and retains popularity/date order',async()=>{
 const rows=await getDiscoverableCommunities(scope);expect(rows).toHaveLength(225);expect(new Set(rows.map(r=>r.id)).size).toBe(225);expect(mockReads).toBe(8);
 const expected=[...mockRows].sort((a,b)=>b.member_count-a.member_count||Date.parse(a.created_at)-Date.parse(b.created_at)||a.id.localeCompare(b.id));expect(rows.map(r=>r.id)).toEqual(expected.map(r=>r.id));expect(mockCover.mock.calls.every(c=>(c[0] as string[]).length<=37)).toBe(true);
});
it('rejects later-page failure rather than returning a partial directory',async()=>{mockFail=true;await expect(getDiscoverableCommunities(scope)).rejects.toThrow('Offline');});
it('rejects repeated cursor rows rather than looping or duplicating',async()=>{mockRepeat=true;await expect(getDiscoverableCommunities(scope)).rejects.toThrow('Could not finish');expect(mockReads).toBe(2);});
it('retires results if the initiating account changes during cover enrichment',async()=>{mockCover.mockImplementation(async()=>{mockActive=false;return new Map();});await expect(getDiscoverableCommunities(scope)).rejects.toThrow('Retired');expect(mockReads).toBe(1);});
