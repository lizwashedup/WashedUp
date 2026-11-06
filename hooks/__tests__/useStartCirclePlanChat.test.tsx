import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { useStartCirclePlanChat } from '../useStartCirclePlanChat';

const mockRpc = jest.fn(), mockSession = jest.fn(), mockInvalidate = jest.fn(), mockHeader = jest.fn();
let mockBlur: () => void;
jest.mock('expo-router', () => ({ useFocusEffect: (cb: any) => require('react').useEffect(() => { mockBlur = cb(); return mockBlur; }, [cb]) }));
jest.mock('@tanstack/react-query', () => ({useQueryClient: () => ({ invalidateQueries: mockInvalidate })}));
jest.mock('../../lib/supabase', () => ({supabase: { auth: {getSession: () => mockSession()}, rpc: (...args: any[]) => mockRpc(...args) }}));

let current: ReturnType<typeof useStartCirclePlanChat>, tree: ReactTestRenderer;
const refetch = jest.fn();
let active = true;
function View() {
  current = useStartCirclePlanChat({eventId:'plan',viewerId:'member',epoch:1,eligible:true,isCurrent:()=>active,refetch});
  return null;
}
beforeEach(() => {
  jest.resetAllMocks(); active = true;
  mockSession.mockResolvedValue({data:{session:{user:{id:'member'},access_token:'fictional'}}});
  mockRpc.mockReturnValue({setHeader:mockHeader});
  refetch.mockResolvedValue({isSuccess:true,data:{has_own_chat:true}});
  act(() => {tree = create(<View/>);});
});
afterEach(() => {act(() => tree.unmount());});
it.each(['normal','lost','thrown'])('checks current context after a %s receipt, with one write for repeated taps', async mode => {
  if (mode === 'thrown') mockHeader.mockRejectedValue(Error('lost'));
  else mockHeader.mockResolvedValue(mode === 'lost' ? {error:{message:'network'}} : {data:null,error:null});
  await act(async () => {await Promise.all([current.start(),current.start()]);});
  expect(mockRpc).toHaveBeenCalledTimes(1);expect(mockRpc).toHaveBeenCalledWith('spawn_plan_chat',{p_event_id:'plan'});
  expect(mockHeader).toHaveBeenCalledWith('Authorization','Bearer fictional');
  expect(refetch).toHaveBeenCalledTimes(1);expect(current.error).toBe('');expect(current.busy).toBe(false);
});
it('offers another deliberate attempt only after context confirms shared chat',async()=>{
  refetch.mockResolvedValue({isSuccess:true,data:{has_own_chat:false}});
  await act(async()=>{await current.start();});
  expect(current.error).toMatch(/still uses the circle chat/);expect(mockRpc).toHaveBeenCalledTimes(1);
});
it('leaves an unreadable context to detail Retry without another write',async()=>{
  refetch.mockResolvedValue({isSuccess:false,data:{has_own_chat:false}});
  await act(async()=>{await current.start();});
  expect(current.error).toBe('');expect(mockRpc).toHaveBeenCalledTimes(1);
});
it('does not dispatch after a blur while checking the account',async()=>{
  let resolve!: (v:any)=>void;mockSession.mockReturnValue(new Promise(r=>{resolve=r;}));
  await act(async()=>{const call=current.start();mockBlur();resolve({data:{session:{user:{id:'member'},access_token:'fictional'}}});await call;});
  expect(mockRpc).not.toHaveBeenCalled();
});
it('refreshes only original context if the write settles after the account changes',async()=>{
  mockHeader.mockImplementation(async()=>{active=false;throw Error('lost');});
  await act(async()=>{await current.start();});
  expect(mockInvalidate.mock.calls).toEqual([[{queryKey:['circle-plan-context','plan','member',1]}]]);
  expect(refetch).not.toHaveBeenCalled();
});
