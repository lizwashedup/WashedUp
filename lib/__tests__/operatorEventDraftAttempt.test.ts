const mockStorage=new Map<string,string>(),mockSet=jest.fn(),mockGet=jest.fn(),mockRemove=jest.fn();let mockCounter=0;
jest.mock('@react-native-async-storage/async-storage',()=>({__esModule:true,default:{getItem:(k:string)=>mockGet(k),setItem:(k:string,v:string)=>mockSet(k,v),removeItem:(k:string)=>mockRemove(k)}}));
jest.mock('expo-crypto',()=>({randomUUID:()=>`20000000-0000-4000-8000-${String(++mockCounter).padStart(12,'0')}`}));
jest.mock('../supabase',()=>({supabase:{}}));
import {prepareOperatorDraftAttempt,readOperatorDraftAttempt,completeOperatorDraftAttempt} from '../operatorEventDraftAttempt';
import type {OperatorDraftInput,OperatorDraftReceipt} from '../operatorEventDraft';
const user='00000000-0000-4000-8000-000000000001',community='10000000-0000-4000-8000-000000000001';let current=true;
const scope={userId:user,isCurrent:()=>current};
const input:OperatorDraftInput={communityId:community,offerType:'free_event',ticketCapacity:24,latitude:null,longitude:null,
 fields:{title:'Picnic',description:'',image_url:'',event_date:'',start_time:null,end_time:null,venue:'',venue_address:'',category:'music',categories:['music'],external_url:'',ticket_price:'',public_name:'',pin_to_chat:true}};
beforeEach(()=>{jest.clearAllMocks();mockCounter=0;current=true;mockStorage.clear();mockGet.mockImplementation(async k=>mockStorage.get(k)??null);mockSet.mockImplementation(async(k,v)=>{mockStorage.set(k,v);});mockRemove.mockImplementation(async k=>{mockStorage.delete(k);});});
it('retains the complete original request for a later screen or app session',async()=>{
 const first=await prepareOperatorDraftAttempt(input,scope);expect(first.created).toBe(true);expect(mockStorage.size).toBe(1);
 const next=await prepareOperatorDraftAttempt({...input,ticketCapacity:50},scope);expect(next.created).toBe(false);expect(next.attempt).toEqual(first.attempt);expect(next.attempt.input.ticketCapacity).toBe(24);
});
it('serializes competing forms into one stored attempt',async()=>{
 const values=await Promise.all([prepareOperatorDraftAttempt(input,scope),prepareOperatorDraftAttempt({...input,ticketCapacity:30},scope)]);
 expect(values.filter(v=>v.created)).toHaveLength(1);expect(new Set(values.map(v=>v.attempt.requestId)).size).toBe(1);expect(mockSet).toHaveBeenCalledTimes(1);
});
it('pins the snapshot before storage awaits',async()=>{
 const edited=JSON.parse(JSON.stringify(input));const saving=prepareOperatorDraftAttempt(edited,scope);edited.fields.title='Changed';
 expect((await saving).attempt.input.fields.title).toBe('Picnic');
});
it('keeps different accounts and communities separate',async()=>{
 await prepareOperatorDraftAttempt(input,scope);expect(await readOperatorDraftAttempt(null,scope)).toBeNull();
 expect(await readOperatorDraftAttempt(community,{...scope,userId:community})).toBeNull();
});
it('stops rather than overwriting a corrupt stored attempt',async()=>{
 await prepareOperatorDraftAttempt(input,scope);mockStorage.set([...mockStorage.keys()][0],'{bad');
 await expect(prepareOperatorDraftAttempt(input,scope)).rejects.toThrow();expect(mockSet).toHaveBeenCalledTimes(1);
});
it('does not dispatch-ready a request whose persistence failed',async()=>{
 mockSet.mockRejectedValueOnce(Error('Storage full'));await expect(prepareOperatorDraftAttempt(input,scope)).rejects.toThrow('Storage full');expect(mockStorage.size).toBe(0);
});
it('retires a queued attempt when its account changes',async()=>{
 const saving=prepareOperatorDraftAttempt(input,scope);current=false;await expect(saving).rejects.toThrow();expect(mockSet).not.toHaveBeenCalled();
});
it('retains a late stored attempt when the visit ends during its write',async()=>{
 mockSet.mockImplementation(async(k,v)=>{mockStorage.set(k,v);current=false;});await expect(prepareOperatorDraftAttempt(input,scope)).rejects.toThrow();
 current=true;expect((await readOperatorDraftAttempt(community,scope))?.input.ticketCapacity).toBe(24);
});
it('clears only the matching confirmed receipt and leaves other scopes intact',async()=>{
 const {attempt}=await prepareOperatorDraftAttempt(input,scope);await prepareOperatorDraftAttempt({...input,communityId:null},scope);
 const saved:OperatorDraftReceipt={version:1,requestId:attempt.requestId,userId:user,eventId:community,communityId:community,status:'Draft',offerType:'free_event',ticketCapacity:24,latitude:null,longitude:null,createdAt:'2026-11-05T20:00:00Z'};
 expect(()=>completeOperatorDraftAttempt(attempt,{...saved,ticketCapacity:12},scope)).toThrow();expect(mockRemove).not.toHaveBeenCalled();
 expect(await completeOperatorDraftAttempt(attempt,saved,scope)).toBe(true);expect(await readOperatorDraftAttempt(community,scope)).toBeNull();expect(await readOperatorDraftAttempt(null,scope)).not.toBeNull();
});
it('keeps the attempt recoverable when local cleanup fails after confirmed creation',async()=>{
 const {attempt}=await prepareOperatorDraftAttempt(input,scope);mockRemove.mockRejectedValueOnce(Error('Storage unavailable'));
 const saved:OperatorDraftReceipt={version:1,requestId:attempt.requestId,userId:user,eventId:community,communityId:community,status:'Draft',offerType:'free_event',ticketCapacity:24,latitude:null,longitude:null,createdAt:'2026-11-05T20:00:00Z'};
 await expect(completeOperatorDraftAttempt(attempt,saved,scope)).rejects.toThrow('Storage unavailable');expect(await readOperatorDraftAttempt(community,scope)).toEqual(attempt);
});
