import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {usePlansEntry} from '../usePlansEntry';

const mockGetSession = jest.fn(), mockCache = jest.fn(), mockSet = jest.fn();
const mockUpdate = jest.fn(), mockProfile = jest.fn();
let mockAuth: (event: string, session: {user:{id:string}} | null) => void;
jest.mock('../../lib/supabase', () => ({supabase:{
  auth:{getSession:() => mockGetSession(), onAuthStateChange:(fn:typeof mockAuth) => {
    mockAuth=fn; return {data:{subscription:{unsubscribe:jest.fn()}}};
  }},
  from:() => ({
    select:(field:string) => ({eq:(_column:string,id:string) => ({maybeSingle:() => mockProfile(field,id)})}),
    update:() => ({eq:(_column:string,id:string) => mockUpdate(id)}),
  }),
}}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem:(key:string) => mockCache(key), setItem:(...args:unknown[]) => mockSet(...args),
}));
const session=(id:string) => ({user:{id}});
const result=(id:string) => ({data:{session:session(id)}});
const never=() => new Promise(()=>{});
function deferred<T>() {
  let finish!: (v:T)=>void;
  const promise = new Promise<T>(done=>{finish=done;});
  return {promise,finish};
}
let entry: ReturnType<typeof usePlansEntry>;
let tree: ReactTestRenderer;
function Screen(){entry=usePlansEntry(); return null;}
const mount=() => act(async()=>{tree=create(<Screen/>);});
beforeEach(()=>{
  jest.useFakeTimers({doNotFake:['queueMicrotask']}); jest.resetAllMocks();
  mockSet.mockResolvedValue(undefined); mockGetSession.mockResolvedValue(result('a'));
  mockCache.mockResolvedValue('1');
  mockProfile.mockImplementation(async(field:string)=>({data:{[field]:field==='first_name_display'?'Amelia':null}}));
});
afterEach(()=>{act(()=>tree.unmount());jest.useRealTimers();});
it('opens Plans for the signed-in account even if the optional local welcome read never returns',async()=>{
  mockCache.mockImplementation(never);await mount();
  expect(entry.userId).toBe('a');await act(async()=>{jest.advanceTimersByTime(6500);});
  expect(entry.accountUnavailable).toBe(false);expect(entry.showWelcome).toBe(false);
  expect(mockSet).not.toHaveBeenCalled();
});
it('allows retry after repeated session timeouts and accepts a later successful read',async()=>{
  mockGetSession.mockImplementation(never);await mount();
  for(let i=0;i<2;i++){
    await act(async()=>{jest.advanceTimersByTime(6100);});expect(entry.accountUnavailable).toBe(true);
    if(i===0)act(()=>entry.retry());
  }
  mockGetSession.mockResolvedValue(result('b'));await act(async()=>entry.retry());
  expect(entry.userId).toBe('b');expect(entry.accountUnavailable).toBe(false);
});
it('a newer sign-in wins even if the original session read finishes last',async()=>{
  const old=deferred<ReturnType<typeof result>>();mockGetSession.mockReturnValue(old.promise);await mount();
  await act(async()=>mockAuth('SIGNED_IN',session('b')));
  await act(async()=>old.finish(result('a')));expect(entry.userId).toBe('b');expect(mockCache).not.toHaveBeenCalledWith('has_seen_welcome_a');
});
it('does not show or mark a previous account’s late welcome profile',async()=>{
  const old=deferred<unknown>();mockCache.mockResolvedValueOnce(null);mockProfile.mockReturnValue(old.promise);
  await mount();expect(entry.userId).toBe('a');
  await act(async()=>mockAuth('SIGNED_IN',session('b')));
  await act(async()=>old.finish({data:{first_name_display:'Old'}}));
  expect(entry.userId).toBe('b');expect(entry.showWelcome).toBe(false);expect(mockUpdate).not.toHaveBeenCalled();
});
it('keeps the first welcome and its persistence for the right account only',async()=>{
  mockCache.mockResolvedValueOnce(null);await mount();expect(entry.showWelcome).toBe(true);
  expect(mockUpdate).toHaveBeenCalledWith('a');expect(mockSet).toHaveBeenCalledWith('has_seen_welcome_a','1');
  const oldDismiss=entry.dismissWelcome;await act(async()=>mockAuth('SIGNED_IN',session('b')));
  expect(entry.showWelcome).toBe(false);act(oldDismiss);expect(mockUpdate).toHaveBeenCalledTimes(1);
});

it('ignores an old Retry button once a sign-in event has already restored the feed',async()=>{
  mockGetSession.mockResolvedValueOnce({data:{session:null}});await mount();
  expect(entry.accountUnavailable).toBe(true);const retry=entry.retry;
  await act(async()=>mockAuth('SIGNED_IN',session('b')));act(retry);
  expect(mockGetSession).toHaveBeenCalledTimes(1);expect(entry.userId).toBe('b');
});
it('a slow welcome profile read cannot mark the welcome seen or delay the feed',async()=>{
  mockCache.mockResolvedValueOnce(null);mockProfile.mockImplementation(never);await mount();
  expect(entry.userId).toBe('a');await act(async()=>{jest.advanceTimersByTime(4500);});
  expect(entry.showWelcome).toBe(false);expect(entry.accountUnavailable).toBe(false);
  expect(mockSet).not.toHaveBeenCalled();expect(mockUpdate).not.toHaveBeenCalled();
});
