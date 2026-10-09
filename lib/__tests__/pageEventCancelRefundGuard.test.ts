import AsyncStorage from '@react-native-async-storage/async-storage';
const mockInvoke=jest.fn(),mockAttendees=jest.fn(),mockSession=jest.fn();
jest.mock('../supabase',()=>({supabase:{auth:{getSession:()=>mockSession()},functions:{invoke:(...a:unknown[])=>mockInvoke(...a)}}}));
jest.mock('../ticketAttendees',()=>({getEventAttendees:(...a:unknown[])=>mockAttendees(...a),isLiveSeat:()=>true}));
jest.mock('expo-crypto',()=>({randomUUID:()=> '11111111-1111-4111-8111-111111111111'}));
import {refundLiveOrdersOnCancel} from '../ticketing';
beforeEach(async()=>{jest.clearAllMocks();await AsyncStorage.clear();mockAttendees.mockResolvedValue([{orderId:'one'},{orderId:'two'},{orderId:'one'}]);mockInvoke.mockResolvedValue({data:{ok:true,refund_amount_cents:1000,positions_voided:1}});});
it('existing callers retain one refund per distinct live order',async()=>{await expect(refundLiveOrdersOnCancel('event')).resolves.toEqual({refundedCount:2,failedCount:0});expect(mockInvoke).toHaveBeenCalledTimes(2);});
it('a failed page scope or financial guard prevents even the first attendee read',async()=>{await expect(refundLiveOrdersOnCancel('event',{beforeEach:async()=>{throw Error('Scope changed');}})).rejects.toThrow();expect(mockAttendees).not.toHaveBeenCalled();expect(mockInvoke).not.toHaveBeenCalled();});
it('authority loss after one order prevents dispatching the next refund',async()=>{const guard=jest.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error('Revoked'));await expect(refundLiveOrdersOnCancel('event',{beforeEach:guard})).rejects.toThrow('Revoked');expect(mockInvoke).toHaveBeenCalledTimes(1);expect(mockInvoke.mock.calls[0][1].body.order_id).toBe('one');});

it('a retired refund scope blocks dispatch after a delayed authorization read',async()=>{
 let active=true;const scope={userId:'creator',isCurrent:()=>active};
 mockSession.mockImplementation(async()=>{active=false;return {data:{session:{user:{id:'creator'},access_token:'fictional'}}};});
 await expect(refundLiveOrdersOnCancel('event',{scope})).rejects.toThrow();
 expect(mockInvoke).not.toHaveBeenCalled();expect(mockAttendees).toHaveBeenCalledWith('event',scope);
});
it('passes the initiating account to each refund and stops after an outstanding response retires',async()=>{
 let active=true;const scope={userId:'creator',isCurrent:()=>active};
 mockSession.mockResolvedValue({data:{session:{user:{id:'creator'},access_token:'fictional'}}});
 mockInvoke.mockImplementationOnce(async()=>{active=false;return {data:{ok:true,order_id:'one',refund_amount_cents:1000,positions_voided:1}};});
 await expect(refundLiveOrdersOnCancel('event',{scope})).rejects.toThrow();
 expect(mockInvoke).toHaveBeenCalledTimes(1);expect(mockInvoke.mock.calls[0][1].headers).toEqual({Authorization:'Bearer fictional'});
});
