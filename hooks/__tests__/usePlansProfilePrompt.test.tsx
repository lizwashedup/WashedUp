import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Platform } from 'react-native';
import { usePlansProfilePrompt } from '../usePlansProfilePrompt';

let mockFocused = true;
const mockPush = jest.fn(), mockGetItem = jest.fn(), mockSetItem = jest.fn(), mockReadProfile = jest.fn();
jest.mock('@react-navigation/native', () => ({useIsFocused: () => mockFocused}));
jest.mock('expo-router', () => ({
  router: {push: (...args:unknown[]) => mockPush(...args)},
  useFocusEffect: (callback: () => (() => void) | undefined) => {
    require('react').useEffect(() => mockFocused ? callback() : undefined, [callback, mockFocused]);
  },
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem:(...args:unknown[]) => mockGetItem(...args), setItem:(...args:unknown[]) => mockSetItem(...args),
}));
jest.mock('../../lib/supabase', () => ({supabase:{from:()=>({select:()=>({
  eq:(_column:string,id:string)=>({single:()=>mockReadProfile(id)}),
})})}}));

let currentUser: string;
const ownsA = () => currentUser === 'a', ownsB = () => currentUser === 'b';
let prompt: ReturnType<typeof usePlansProfilePrompt>, tree: ReactTestRenderer;
function Screen(){prompt=usePlansProfilePrompt(currentUser,true,currentUser==='a'?ownsA:ownsB);return null;}
const missing={data:{onboarding_status:'complete',handle:'a',fun_fact:null,neighborhood:null}};
const complete={data:{...missing.data,fun_fact:'Hikes',neighborhood:'Venice'}};
const refresh=()=>act(async()=>{tree.update(<Screen/>);});
const delay=()=>act(async()=>{jest.advanceTimersByTime(2100);});
const originalOS=Platform.OS;
beforeEach(async()=>{
  jest.useFakeTimers({doNotFake:['queueMicrotask']});jest.resetAllMocks();
  mockFocused=true;currentUser='a';mockGetItem.mockResolvedValue(null);mockSetItem.mockResolvedValue(null);
  mockReadProfile.mockResolvedValue(missing);await act(async()=>{tree=create(<Screen/>);});
});
afterEach(()=>{act(()=>tree.unmount());jest.useRealTimers();Platform.OS=originalOS;});
it('checks again after returning and skips a profile completed while away',async()=>{
  mockFocused=false;await refresh();await delay();expect(prompt.presenting).toBe(false);
  mockReadProfile.mockResolvedValue(complete);mockFocused=true;await refresh();await delay();
  expect(mockReadProfile).toHaveBeenCalledTimes(2);expect(prompt.presenting).toBe(false);
  expect(mockSetItem).not.toHaveBeenCalled();
});
it('offers the prompt after a fresh delay on return and remembers Later during a slow preference write',async()=>{
  mockFocused=false;await refresh();mockFocused=true;await refresh();expect(prompt.visible).toBe(false);
  await delay();expect(prompt.visible).toBe(true);mockSetItem.mockImplementation(()=>new Promise(()=>{}));
  act(prompt.dismiss);mockFocused=false;await refresh();mockFocused=true;await refresh();await delay();
  expect(prompt.visible).toBe(false);expect(mockPush).not.toHaveBeenCalled();
});
it('ignores a retained prompt and never attributes the old answer to the next account',async()=>{
  await delay();const old=prompt;currentUser='b';act(old.openEditor);mockReadProfile.mockResolvedValue(complete);
  await refresh();await delay();expect(prompt.visible).toBe(false);expect(mockSetItem).not.toHaveBeenCalled();
});
it('opens the original editor once after iOS dismissal even if preference storage stalls',async()=>{
  Platform.OS='ios';await delay();mockSetItem.mockImplementation(()=>new Promise(()=>{}));
  const press=prompt.openEditor;act(()=>{press();press();});expect(prompt.presenting).toBe(true);
  expect(prompt.visible).toBe(false);expect(mockPush).not.toHaveBeenCalled();
  const done=prompt.onDismiss;act(()=>{done();done();});expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith('/(tabs)/profile?openEdit=true');
});
it('retires a pending editor destination on blur',async()=>{
  Platform.OS='ios';await delay();act(prompt.openEditor);const done=prompt.onDismiss;
  mockFocused=false;await refresh();act(done);expect(mockPush).not.toHaveBeenCalled();
});
it('opens the editor on Android without waiting for iOS dismissal',async()=>{
  Platform.OS='android';await delay();act(prompt.openEditor);expect(mockPush).toHaveBeenCalledTimes(1);
});
