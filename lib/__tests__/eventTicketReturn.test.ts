const mockSession=jest.fn(),mockFrom=jest.fn();
jest.mock('../supabase',()=>({supabase:{auth:{getSession:()=>mockSession()},from:(...args:any[])=>mockFrom(...args)}}));
import {readEventTicketReturn} from '../eventTicketReturn';
const scope={userId:'buyer',isCurrent:()=>true};
function request(data:any,error:any=null){const q:any={then:(ok:any,bad:any)=>Promise.resolve({data,error}).then(ok,bad)};for(const name of ['select','eq','order','abortSignal','setHeader'])q[name]=jest.fn(()=>q);return q;}
beforeEach(()=>{jest.clearAllMocks();mockSession.mockResolvedValue({data:{session:{user:{id:'buyer'},access_token:'original-token'}},error:null});});
it('reads only the current buyer paid orders for this event using captured authorization',async()=>{
 const q=request([{id:'order',ticket_order_positions:[{id:'seat',voided_at:null}]}]);mockFrom.mockReturnValue(q);expect(await readEventTicketReturn('event',scope)).toEqual({orderId:'order',quantity:1});
 expect(q.eq.mock.calls).toEqual([['event_id','event'],['buyer_user_id','buyer'],['status','paid']]);expect(q.setHeader).toHaveBeenCalledWith('Authorization','Bearer original-token');
});
it('skips voided and transferred-away seats and returns the next original active order',async()=>{
 mockFrom.mockReturnValue(request([{id:'voided',ticket_order_positions:[{id:'s',voided_at:'2026-09-17',current_holder_user_id:null}]},{id:'transferred',ticket_order_positions:[{id:'s',voided_at:null,current_holder_user_id:'other'}]},{id:'older',ticket_order_positions:[{id:'s',voided_at:null,current_holder_user_id:'buyer'}]}]));expect(await readEventTicketReturn('event',scope)).toEqual({orderId:'older',quantity:1});
});
it('keeps confirmed absence separate from read failure and malformed replies',async()=>{
 for(const rows of [[],[{id:'order',ticket_order_positions:[]}]]){mockFrom.mockReturnValue(request(rows));expect(await readEventTicketReturn('event',scope)).toBeNull();}
 for(const q of [request(null,Error('offline')),request(null),request([{id:'order'}])]){mockFrom.mockReturnValue(q);await expect(readEventTicketReturn('event',scope)).rejects.toThrow('could not be checked');}
});
it('refuses retired or changed-account requests before dispatch',async()=>{
 await expect(readEventTicketReturn('event',{...scope,isCurrent:()=>false})).rejects.toThrow();mockSession.mockResolvedValue({data:{session:{user:{id:'other'},access_token:'other'}}});await expect(readEventTicketReturn('event',scope)).rejects.toThrow();expect(mockFrom).not.toHaveBeenCalled();
});
it('discards a late response after the original buyer visit retires',async()=>{
 let current=true;const q=request([]);q.then=(ok:any)=>{current=false;return Promise.resolve({data:[],error:null}).then(ok);};mockFrom.mockReturnValue(q);await expect(readEventTicketReturn('event',{...scope,isCurrent:()=>current})).rejects.toThrow('no longer active');
});
it('reads tickets with React Native’s actual abort implementation',async()=>{
 const originalController=global.AbortController,originalSignal=global.AbortSignal;
 const nativeAbort=require('abort-controller/dist/abort-controller');
 global.AbortController=nativeAbort.AbortController;global.AbortSignal=nativeAbort.AbortSignal;
 try {
  const q=request([{id:'order',ticket_order_positions:[{id:'seat',voided_at:null}]}]);mockFrom.mockReturnValue(q);
  expect(typeof (AbortSignal as any).timeout).toBe('undefined');
  await expect(readEventTicketReturn('event',scope)).resolves.toEqual({orderId:'order',quantity:1});
  expect(q.abortSignal).toHaveBeenCalledWith(expect.objectContaining({aborted:false}));
 } finally {global.AbortController=originalController;global.AbortSignal=originalSignal;}
});
