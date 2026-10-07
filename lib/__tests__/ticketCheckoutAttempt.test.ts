import AsyncStorage from '@react-native-async-storage/async-storage';
const mockRpc=jest.fn(),mockSingle=jest.fn(),mockEq=jest.fn(),mockSelect=jest.fn();
jest.mock('../supabase',()=>({supabase:{from:()=>({select:mockSelect}),rpc:(...args:unknown[])=>mockRpc(...args)}}));
jest.mock('expo-crypto',()=>({randomUUID:jest.fn(()=> 'attempt-key-1234'),CryptoDigestAlgorithm:{SHA256:'SHA256'},digestStringAsync:async (_:unknown,value:string)=>require('crypto').createHash('sha256').update(value).digest('hex')}));
import {readCheckoutAttempt,prepareCheckoutAttempt,findCheckoutAttemptOrder,finishCheckoutAttempt,stopCheckoutAttempt,CheckoutSelectionChanged} from '../ticketCheckoutAttempt';
import type {CheckoutSelection} from '../ticketCheckoutAttempt';
const owner={userId:'buyer-a',isCurrent:()=>true};
const selection:CheckoutSelection={eventId:'event-a',tierId:'tier-a',qty:2,promoCode:null,addons:[],answers:[{question_id:'dietary',value:{text:'Private answer'}}]};
const order={id:'order-a',event_id:'event-a',tier_id:'tier-a',qty:2,status:'paid' as const};
beforeEach(async()=>{jest.clearAllMocks();await AsyncStorage.clear();mockSelect.mockReturnValue({eq:mockEq});mockEq.mockReturnValue({eq:mockEq,maybeSingle:mockSingle});mockSingle.mockResolvedValue({data:null,error:null});});
it('persists before returning and survives a new read without storing answer text',async()=>{
 const attempt=await prepareCheckoutAttempt(selection,owner);expect(await readCheckoutAttempt(selection.eventId,owner)).toEqual(attempt);
 const stored=jest.mocked(AsyncStorage.setItem).mock.calls.at(-1)![1];expect(stored).not.toContain('Private answer');expect(stored).not.toContain('dietary');expect(attempt.hasAnswers).toBe(true);
});
it('concurrent preparations reuse one record rather than overwrite it',async()=>{
 const [a,b]=await Promise.all([prepareCheckoutAttempt(selection,owner),prepareCheckoutAttempt(selection,owner)]);
 expect(a.key).toBe(b.key);expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
});
it('cannot silently replace an unresolved selection or answers',async()=>{
 const a=await prepareCheckoutAttempt(selection,owner);
 await expect(prepareCheckoutAttempt({...selection,qty:3},owner)).rejects.toBeInstanceOf(CheckoutSelectionChanged);
 await expect(prepareCheckoutAttempt({...selection,answers:[]},owner)).rejects.toBeInstanceOf(CheckoutSelectionChanged);
 expect((await readCheckoutAttempt(selection.eventId,owner))?.key).toBe(a.key);
});
it('preserves the original on an empty or failed order read',async()=>{
 const a=await prepareCheckoutAttempt(selection,owner);expect(await findCheckoutAttemptOrder(a,owner)).toBeNull();
 mockSingle.mockResolvedValue({data:null,error:Error('Offline')});await expect(findCheckoutAttemptOrder(a,owner)).rejects.toThrow('Offline');
 expect(await readCheckoutAttempt(selection.eventId,owner)).toEqual(a);
 expect(mockEq.mock.calls).toContainEqual(['idempotency_key','ctc:buyer-a:attempt-key-1234']);expect(mockEq.mock.calls).toContainEqual(['buyer_user_id','buyer-a']);
});
it('refuses a storage failure before it returns a dispatchable attempt',async()=>{
 jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(Error('Disk full'));
 await expect(prepareCheckoutAttempt(selection,owner)).rejects.toThrow('Disk full');
});
it('retires a late storage receipt after account change',async()=>{
 let active=true;const scoped={...owner,isCurrent:()=>active};
 jest.mocked(AsyncStorage.setItem).mockImplementationOnce(async()=>{active=false;});
 await expect(prepareCheckoutAttempt(selection,scoped)).rejects.toThrow('no longer active');
});
it('another account cannot inspect or finish the original attempt',async()=>{
 const a=await prepareCheckoutAttempt(selection,owner);const other={...owner,userId:'buyer-b'};
 expect(await readCheckoutAttempt(selection.eventId,other)).toBeNull();
 await expect(findCheckoutAttemptOrder(a,other)).rejects.toThrow('another account');await expect(finishCheckoutAttempt(a,order,other)).rejects.toThrow('another account');
});
it('finishes only a matching terminal order, leaving pending or wrong orders intact',async()=>{
 const a=await prepareCheckoutAttempt(selection,owner);
 await expect(finishCheckoutAttempt(a,{...order,status:'pending'},owner)).rejects.toThrow('pending');
 await expect(finishCheckoutAttempt(a,{...order,qty:1},owner)).rejects.toThrow('pending');
 await finishCheckoutAttempt(a,order,owner);expect(await readCheckoutAttempt(selection.eventId,owner)).toBeNull();
});
it('rejects an unexpected order receipt instead of navigating to it',async()=>{
 const a=await prepareCheckoutAttempt(selection,owner);mockSingle.mockResolvedValue({data:{...order,event_id:'other'},error:null});
 await expect(findCheckoutAttemptOrder(a,owner)).rejects.toThrow('could not be confirmed');
});

it('reuses consent and multi-select answers when only timestamp or choice order changes',async()=>{
 const first={...selection,answers:[{question_id:'terms',value:{accepted:true,accepted_at:'2026-09-16T01:00:00Z'}},{question_id:'choices',value:{choices:['a','b']}}]};
 const a=await prepareCheckoutAttempt(first,owner);
 const b=await prepareCheckoutAttempt({...first,answers:[{question_id:'choices',value:{choices:['b','a']}},{question_id:'terms',value:{accepted:true,accepted_at:'2026-09-16T01:30:00Z'}}]},owner);
 expect(a.key).toBe(b.key);expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
});

it('clears only after an explicit matching-account stop receipt',async()=>{
 const a=await prepareCheckoutAttempt(selection,owner);mockRpc.mockResolvedValue({data:[{state:'stopped',order_id:null}],error:null});
 expect(await stopCheckoutAttempt(a,owner)).toEqual({state:'stopped',orderId:null});
 expect(mockRpc).toHaveBeenCalledWith('stop_ticket_checkout_attempt',{p_event_id:'event-a',p_checkout_key:a.key,p_buyer_user_id:'buyer-a'});
 expect(await readCheckoutAttempt('event-a',owner)).toBeNull();
});
it('keeps the original record after a lost or malformed stop response',async()=>{
 const a=await prepareCheckoutAttempt(selection,owner);mockRpc.mockRejectedValueOnce(Error('Lost response'));
 await expect(stopCheckoutAttempt(a,owner)).rejects.toThrow('Lost response');expect(await readCheckoutAttempt('event-a',owner)).toEqual(a);
 mockRpc.mockResolvedValue({data:[{state:'stopped',order_id:'unexpected'}],error:null});await expect(stopCheckoutAttempt(a,owner)).rejects.toThrow('could not be confirmed');
 expect(await readCheckoutAttempt('event-a',owner)).toEqual(a);
});
it('returns an existing pending order without clearing its recovery record',async()=>{
 const a=await prepareCheckoutAttempt(selection,owner);mockRpc.mockResolvedValue({data:[{state:'pending',order_id:'order-a'}],error:null});
 expect(await stopCheckoutAttempt(a,owner)).toEqual({state:'pending',orderId:'order-a'});expect(await readCheckoutAttempt('event-a',owner)).toEqual(a);
});
it('does not clear a retired account after the stop returns late',async()=>{
 let active=true;const owned={...owner,isCurrent:()=>active};const a=await prepareCheckoutAttempt(selection,owned);
 mockRpc.mockImplementationOnce(async()=>{active=false;return {data:[{state:'stopped',order_id:null}],error:null};});
 await expect(stopCheckoutAttempt(a,owned)).rejects.toThrow('no longer active');expect(await readCheckoutAttempt('event-a',owner)).toEqual(a);
});
it('can retry a confirmed stop when device removal fails',async()=>{
 const a=await prepareCheckoutAttempt(selection,owner);mockRpc.mockResolvedValue({data:[{state:'stopped',order_id:null}],error:null});
 jest.mocked(AsyncStorage.removeItem).mockRejectedValueOnce(Error('Device write failed'));
 await expect(stopCheckoutAttempt(a,owner)).rejects.toThrow('Device write failed');expect(await readCheckoutAttempt('event-a',owner)).toEqual(a);
 await stopCheckoutAttempt(a,owner);expect(await readCheckoutAttempt('event-a',owner)).toBeNull();
});
it('serializes a new selection behind a confirmed stop',async()=>{
 jest.requireMock('expo-crypto').randomUUID.mockReturnValueOnce('first-attempt-key').mockReturnValueOnce('next-attempt-key');
 const a=await prepareCheckoutAttempt(selection,owner);let resolve!:(v:unknown)=>void;
 mockRpc.mockReturnValueOnce(new Promise(r=>{resolve=r;}));
 const stopping=stopCheckoutAttempt(a,owner);const next=prepareCheckoutAttempt({...selection,qty:3},owner);
 await Promise.resolve();await Promise.resolve();await Promise.resolve();
 expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
 resolve({data:[{state:'stopped',order_id:null}],error:null});await stopping;
 expect((await next).key).toBe('next-attempt-key');expect((await readCheckoutAttempt('event-a',owner))?.qty).toBe(3);
});

it('persists a selected extra option and refuses a changed option on the same unresolved checkout',async()=>{
 const withOption={...selection,addons:[{add_on_id:'extra',qty:1,variation_id:'vegan'}]};const saved=await prepareCheckoutAttempt(withOption,owner);
 expect((await readCheckoutAttempt(selection.eventId,owner))?.addons).toEqual(withOption.addons);
 await expect(prepareCheckoutAttempt({...withOption,addons:[{add_on_id:'extra',qty:1,variation_id:'vegetarian'}]},owner)).rejects.toBeInstanceOf(CheckoutSelectionChanged);
 expect((await readCheckoutAttempt(selection.eventId,owner))?.key).toBe(saved.key);
});
