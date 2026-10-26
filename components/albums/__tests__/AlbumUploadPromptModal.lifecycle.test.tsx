import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Modal, Platform, Text, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AlbumUploadPromptModal } from '../AlbumUploadPromptModal';
const mockPush = jest.fn(), mockRead = jest.fn(), mockWrite = jest.fn();
const mockListeners = new Set<(event: string, session: any) => void>();
let mockViewer = 'alice';
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('../../../lib/supabase', () => ({ supabase: {
 auth: { getUser: async () => ({data:{user:mockViewer?{id:mockViewer}:null},error:null}), onAuthStateChange: (fn:any) => { mockListeners.add(fn); return {data:{subscription:{unsubscribe:()=>mockListeners.delete(fn)}}}; } },
 from: () => { let write = false; const chain: any = {
  select: () => chain, update: () => {write=true;return chain;}, eq: () => chain, order: () => chain, limit: () => chain,
  then: (yes:any,no:any) => (write?mockWrite():mockRead()).then(yes,no),
 };return chain;},
} }));
const notice = {id:'notice',event_id:'plan',title:'Share your memories',body:null,created_at:'2026-10-01T00:00:00Z'};
const held = () => { let resolve!:(value:any)=>void; const promise=new Promise<any>(r=>{resolve=r;});return {promise,resolve}; };
let tree:ReactTestRenderer;
const button = (text:string) => tree.root.findAllByType(TouchableOpacity).find(n=>n.findAllByType(Text).some(t=>t.props.children===text))!;
const upload = () => button('Upload photos + videos') || button('Upload memories');
const visible = () => tree.root.findAllByType(Modal).some(n=>n.props.visible);
async function flush(){await act(async()=>{for(let i=0;i<15;i++)await Promise.resolve();});}
beforeEach(async()=>{jest.clearAllMocks();mockListeners.clear();mockViewer='alice';Platform.OS='ios';(AsyncStorage.getItem as jest.Mock).mockResolvedValue('[]');(AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);mockRead.mockResolvedValue({data:[notice],error:null});mockWrite.mockResolvedValue({data:null,error:null});await act(async()=>{tree=create(<AlbumUploadPromptModal userId="alice"/>);});await flush();});
afterEach(()=>act(()=>tree.unmount()));
it('waits for native dismissal before uploading and completes once',async()=>{
 await act(async()=>upload().props.onPress());expect(mockPush).not.toHaveBeenCalled();
 const dismiss=tree.root.findByType(Modal).props.onDismiss;act(()=>{dismiss();dismiss();});expect(mockPush).toHaveBeenCalledTimes(1);expect(mockPush).toHaveBeenCalledWith('/album/upload/plan');
});
it('coalesces repeated upload presses',async()=>{
 const pending=held();mockWrite.mockReturnValue(pending.promise);const press=upload().props.onPress;
 let first:any,second:any;act(()=>{first=press();second=press();});await flush();expect(mockWrite).toHaveBeenCalledTimes(1);
 await act(async()=>{pending.resolve({error:null});await Promise.all([first,second]);});
});
it('retires a prompt read that completes after sign-out',async()=>{
 const pending=held();mockRead.mockReturnValue(pending.promise);
 act(()=>{mockViewer="bob";for(const fn of mockListeners)fn("SIGNED_IN",{user:{id:"bob"}});tree.update(<AlbumUploadPromptModal userId="bob"/>);});await flush();
 act(()=>tree.update(<AlbumUploadPromptModal userId={null}/>));await flush();
 await act(async()=>pending.resolve({data:[{...notice,id:'bob-notice'}],error:null}));
 expect(visible()).toBe(false);
});
it('does not reopen upload after unmount during its write',async()=>{
 const pending=held();mockWrite.mockReturnValueOnce(pending.promise);let done:any;act(()=>{done=upload().props.onPress();});await flush();act(()=>tree.unmount());
 await act(async()=>{pending.resolve({error:null});await done;});expect(mockPush).not.toHaveBeenCalled();
});
it('dismisses even when local reminder storage is unavailable',async()=>{
 (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(Error('storage unavailable'));
 await act(async()=>{await expect(button('Maybe later').props.onPress()).resolves.toBeUndefined();});expect(visible()).toBe(false);expect(mockPush).not.toHaveBeenCalled();
});

it('opens after native dismissal even while optional network and storage never settle', async () => {
  mockWrite.mockReturnValueOnce(new Promise(() => {}));
  (AsyncStorage.setItem as jest.Mock).mockReturnValueOnce(new Promise(() => {}));
  await act(async () => upload().props.onPress());
  expect(visible()).toBe(false);
  act(() => tree.root.findByType(Modal).props.onDismiss());
  expect(mockPush).toHaveBeenCalledWith('/album/upload/plan');
});
it('does not dispatch a retained upload after an auth event before props update', async () => {
  const press = upload().props.onPress;
  act(() => {mockViewer='bob';for(const fn of mockListeners)fn('SIGNED_IN',{user:{id:'bob'}});});
  await act(async () => press());
  expect(mockWrite).not.toHaveBeenCalled();expect(mockPush).not.toHaveBeenCalled();expect(visible()).toBe(false);
});
it('does not revive queued navigation after an account roundtrip', async () => {
  await act(async () => upload().props.onPress());
  const dismiss=tree.root.findByType(Modal).props.onDismiss;
  act(() => {for(const fn of mockListeners){fn('SIGNED_IN',{user:{id:'bob'}});fn('SIGNED_IN',{user:{id:'alice'}});}});
  await flush();act(() => dismiss());expect(mockPush).not.toHaveBeenCalled();
});
it('uses the current destination on Android without a native onDismiss event', async () => {
  Platform.OS='android';await act(async () => upload().props.onPress());
  expect(mockPush).toHaveBeenCalledWith('/album/upload/plan');expect(visible()).toBe(false);
});
it('does not block reminder dismissal on a failed optional read receipt', async () => {
  mockWrite.mockRejectedValueOnce(Error('offline'));
  await act(async () => upload().props.onPress());
  act(() => tree.root.findByType(Modal).props.onDismiss());
  expect(mockPush).toHaveBeenCalledTimes(1);
});
it('does not show an old prompt after its account changes', async () => {
  expect(visible()).toBe(true);
  act(() => tree.update(<AlbumUploadPromptModal userId={null}/>));
  expect(visible()).toBe(false);
});
