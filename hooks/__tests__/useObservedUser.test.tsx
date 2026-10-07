import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
const mockGetUser=jest.fn(),mockUnsubscribe=jest.fn();let mockAuthChange:any;
jest.mock('../../lib/supabase',()=>({supabase:{auth:{getUser:()=>mockGetUser(),onAuthStateChange:(callback:any)=>{mockAuthChange=callback;return{data:{subscription:{unsubscribe:mockUnsubscribe}}};}}}}));
import {useObservedUser} from '../useObservedUser';
let tree:ReactTestRenderer,value:ReturnType<typeof useObservedUser>;
function Read({allowSignedOut=false}:{allowSignedOut?:boolean}){value=useObservedUser({allowSignedOut});return null;}
const missing=()=>({data:{user:null},error:Object.assign(new Error('Auth session missing'),{name:'AuthSessionMissingError'})});
beforeEach(()=>{jest.clearAllMocks();mockGetUser.mockResolvedValue(missing());});
afterEach(()=>act(()=>tree?.unmount()));
it('allows the public reader to initialize signed out even before INITIAL_SESSION is delivered',async()=>{await act(async()=>{tree=create(<Read allowSignedOut/>);});expect(value.viewerId).toBeNull();expect(value.error).toBeNull();expect(value.isCurrent()).toBe(true);});
it('preserves the default authenticated-reader error behavior',async()=>{await act(async()=>{tree=create(<Read/>);});expect(value.viewerId).toBeUndefined();expect(value.error?.name).toBe('AuthSessionMissingError');});
it('does not treat a network/authentication failure as confirmed signed-out access',async()=>{mockGetUser.mockResolvedValueOnce({data:{user:null},error:new Error('Network failure')});await act(async()=>{tree=create(<Read allowSignedOut/>);});expect(value.viewerId).toBeUndefined();expect(value.error?.message).toBe('Network failure');});
it('does not replace a newer signed-in account with a late missing-session result',async()=>{let resolve:any;mockGetUser.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));await act(async()=>{tree=create(<Read allowSignedOut/>);});act(()=>mockAuthChange('SIGNED_IN',{user:{id:'new-member'}}));const current=value;await act(async()=>resolve(missing()));expect(value.viewerId).toBe('new-member');expect(current.isCurrent()).toBe(true);});
it('ends a stalled identity check with an error and lets a retry recover',async()=>{
 jest.useFakeTimers();
 try {
  mockGetUser.mockImplementationOnce(()=>new Promise(()=>{}));
  await act(async()=>{tree=create(<Read/>);});
  await act(async()=>{jest.advanceTimersByTime(12000);});
  expect(value.isLoading).toBe(false);expect(value.error?.name).toBe('RequestDeadlineError');expect(value.viewerId).toBeUndefined();
  mockGetUser.mockResolvedValue({data:{user:{id:'recovered'}},error:null});
  await act(async()=>{await value.retry();});
  expect(value.error).toBeNull();expect(value.viewerId).toBe('recovered');
 }finally{jest.useRealTimers();}
});
