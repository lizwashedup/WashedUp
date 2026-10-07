jest.mock('../supabase',()=>({supabase:{from:jest.fn()}}));
import {supabase} from '../supabase';
import {getQuestions,getOrder} from '../ticketing';
import {listBuyerAddons,getAddonVariationsMap} from '../ticketPromosAddons';
const mockFrom=supabase.from as jest.Mock;
function respond(result:unknown){const chain:any={select:()=>chain,eq:()=>chain,order:async()=>result,in:async()=>result,maybeSingle:async()=>result};mockFrom.mockReturnValue(chain);}
afterEach(()=>jest.clearAllMocks());
it('strict checkout questions reject failure while existing callers retain their fallback',async()=>{
 const error={code:'08006',message:'offline'};respond({data:null,error});
 await expect(getQuestions('event',true)).rejects.toBe(error);await expect(getQuestions('event')).resolves.toEqual([]);
});
it('strict questions distinguish an invalid receipt from confirmed empty',async()=>{
 respond({data:null,error:null});await expect(getQuestions('event',true)).rejects.toThrow('could not be loaded');
 respond({data:[],error:null});await expect(getQuestions('event',true)).resolves.toEqual([]);
});
it('buyer extras propagate the strict read failure without changing old callers',async()=>{
 const error={code:'08006',message:'offline'};respond({data:null,error});
 await expect(listBuyerAddons('event',true)).rejects.toBe(error);await expect(listBuyerAddons('event')).resolves.toEqual([]);
});
it('missing optional variations column retains its established compatibility behavior',async()=>{
 respond({data:null,error:{code:'42703'}});await expect(getAddonVariationsMap(['extra'],true)).resolves.toEqual(new Map());
});
it('other variations failures are visible in strict checkout reads',async()=>{
 const error={code:'08006'};respond({data:null,error});await expect(getAddonVariationsMap(['extra'],true)).rejects.toBe(error);
 await expect(getAddonVariationsMap(['extra'])).resolves.toEqual(new Map());
});
it('readable extra options retain their IDs and labels',async()=>{
 const options=[{id:'small',label:'Small'}];respond({data:[{id:'extra',variations:options}],error:null});
 await expect(getAddonVariationsMap(['extra'],true)).resolves.toEqual(new Map([['extra',options]]));
});

it('strict own-order reads reject failures instead of treating them as absent orders',async()=>{
 const error={code:'08006'};respond({data:null,error});
 await expect(getOrder('order',{buyerUserId:'buyer',strict:true})).rejects.toBe(error);
 await expect(getOrder('order')).resolves.toBeNull();
});
it('the return read scopes both the order and buyer IDs',async()=>{
 const chain:any={select:jest.fn(()=>chain),eq:jest.fn(()=>chain),maybeSingle:async()=>({data:null,error:null})};mockFrom.mockReturnValue(chain);
 await expect(getOrder('order',{buyerUserId:'buyer',strict:true})).resolves.toBeNull();
 expect(chain.eq.mock.calls).toEqual([['id','order'],['buyer_user_id','buyer']]);
});
