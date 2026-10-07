const mockResult: Record<string,any> = {};
jest.mock('../supabase',()=>({supabase:{from:(table:string)=>{const q:any={};for(const name of ['select','eq','gte','order','limit','maybeSingle'])q[name]=()=>q;q.then=(yes:any,no:any)=>Promise.resolve(mockResult[table]).then(yes,no);return q;},rpc:()=>Promise.resolve(mockResult.count)}}));
import {getCommunityPage} from '../communityPage';
beforeEach(()=>{mockResult.communities={data:{id:'community',name:'Sunset Club'},error:null};mockResult.community_blocks={data:[],error:null};mockResult.explore_events={data:[],error:null};mockResult.count={data:0,error:null};});
it.each(['community_blocks','explore_events','count'])('failed %s read does not produce a false empty page',async table=>{mockResult[table]={data:null,error:Error('Read interrupted')};await expect(getCommunityPage('community')).rejects.toThrow('Read interrupted');});
it('a confirmed empty page still returns empty blocks/events and zero members',async()=>{expect(await getCommunityPage('community')).toMatchObject({blocks:[],events:[],memberCount:0});});
