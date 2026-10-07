const mockRpc=jest.fn(),mockIn=jest.fn(),mockSelect=jest.fn(()=>({in:mockIn})),mockFrom=jest.fn((..._args:unknown[])=>({select:mockSelect}));
let mockRows:any[],mockCursor:string|null;
jest.mock('../supabase',()=>({supabase:{rpc:()=>{mockCursor=null;const q:any={order:()=>q,limit:()=>q,gt:(_k:string,v:string)=>{mockCursor=v;return q;},then:(yes:any,no:any)=>mockRpc(mockCursor).then(yes,no)};return q;},from:(...a:unknown[])=>mockFrom(...a)}}));
jest.mock('../../constants/FeatureFlags',()=>({CREATOR_PAGES_ENABLED:false}));
import { getDiscoverableCommunities } from '../sceneDiscovery';
beforeEach(()=>{jest.clearAllMocks();mockRows=[{id:'public',name:'Public community',member_count:1}];mockRpc.mockImplementation(async(cursor:string|null)=>({data:mockRows.filter(r=>!cursor||r.id>cursor),error:null}));mockIn.mockResolvedValue({data:[{id:'public',city:'Santa Monica',created_at:'2026-01-01T00:00:00Z'}],error:null});});
it('enriches only IDs already returned by public discovery',async()=>{
 const rows=await getDiscoverableCommunities();expect(mockIn).toHaveBeenCalledWith('id',['public']);expect(rows).toMatchObject([{id:'public',city:'Santa Monica'}]);
});
it('does not read locations for an empty discovery result',async()=>{
 mockRows=[];expect(await getDiscoverableCommunities()).toEqual([]);expect(mockFrom).not.toHaveBeenCalled();
});
it('surfaces a failed location read instead of treating all areas as empty',async()=>{
 mockIn.mockResolvedValue({data:null,error:Error('Offline')});await expect(getDiscoverableCommunities()).rejects.toThrow('Offline');
});
it('rejects an unexpected location ID',async()=>{
 mockIn.mockResolvedValue({data:[{id:'private',city:'Secret'}],error:null});await expect(getDiscoverableCommunities()).rejects.toThrow('Could not read community locations');
});
it('omits a community that becomes unavailable during enrichment',async()=>{
 mockIn.mockResolvedValue({data:[],error:null});expect(await getDiscoverableCommunities()).toEqual([]);
});
