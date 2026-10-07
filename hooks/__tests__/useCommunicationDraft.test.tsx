import React from 'react';
import {act,create,ReactTestRenderer} from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {useCommunicationDraft} from '../useCommunicationDraft';
import {saveCommunicationDraft} from '../../lib/communicationDraft';
const initial={on:true};const valid=(v:unknown):v is typeof initial=>typeof (v as any)?.on==='boolean';
let scope={userId:'one',isCurrent:()=>true};let result:ReturnType<typeof useCommunicationDraft<typeof initial>>;let tree:ReactTestRenderer;
function Screen(){result=useCommunicationDraft('event','reminders',scope,initial,valid);return null;}
async function mount(){await act(async()=>{tree=create(<Screen/>);});}
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return{promise,resolve};}
beforeEach(()=>{jest.clearAllMocks();(AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);(AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);scope={userId:'one',isCurrent:()=>true};});
afterEach(()=>{if(tree)act(()=>tree.unmount());});
it('surfaces a read failure and blocks overwriting the unread draft',async()=>{(AsyncStorage.getItem as jest.Mock).mockRejectedValue(Error('disk'));await mount();expect(result.loaded).toBe(false);expect(result.readError).toBe(true);act(()=>result.change({on:false}));expect(AsyncStorage.setItem).not.toHaveBeenCalled();(AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);await act(async()=>{await result.retry();});expect(result.ready).toBe(true);});
it('retains a failed edit and only claims saved after successful retry',async()=>{await mount();(AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(Error('disk'));await act(async()=>result.change({on:false}));expect(result.value.on).toBe(false);expect(result.saved).toBe(false);expect(result.error).toContain('Couldn’t save');await act(async()=>{await result.retry();});expect(result.saved).toBe(true);expect(result.error).toBe('');});
it('serializes rapid edits so the newest setting wins',async()=>{await mount();const first=deferred();(AsyncStorage.setItem as jest.Mock).mockImplementationOnce(()=>first.promise);act(()=>{result.change({on:false});result.change({on:true});});await act(async()=>{first.resolve();});expect(AsyncStorage.setItem).toHaveBeenCalledTimes(2);expect(JSON.parse((AsyncStorage.setItem as jest.Mock).mock.calls[1][1]).value.on).toBe(true);expect(result.saved).toBe(true);});
it('never exposes another account’s draft or loads the old event-only key',async()=>{await mount();await act(async()=>result.change({on:false}));scope={userId:'two',isCurrent:()=>true};await act(async()=>tree.update(<Screen/>));expect(result.value.on).toBe(true);expect((AsyncStorage.getItem as jest.Mock).mock.calls.map(c=>c[0])).toEqual(['creator-communication:v1:one:reminders:event','creator-communication:v1:two:reminders:event']);});
it('a retired callback cannot change or save a draft',async()=>{await mount();const change=result.change;scope.isCurrent=()=>false;act(()=>change({on:false}));expect(AsyncStorage.setItem).not.toHaveBeenCalled();expect(result.value.on).toBe(true);});
it('retains an accepted local write under the original account after leaving',async()=>{const pending=deferred();(AsyncStorage.setItem as jest.Mock).mockImplementationOnce(()=>pending.promise);await mount();act(()=>result.change({on:false}));scope.isCurrent=()=>false;act(()=>tree.unmount());await act(async()=>pending.resolve());expect((AsyncStorage.setItem as jest.Mock).mock.calls[0][0]).toBe('creator-communication:v1:one:reminders:event');});
it('rejects a mismatched persisted envelope without replacing it',async()=>{(AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify({version:1,userId:'other',eventId:'event',kind:'reminders',value:{on:false}}));await mount();expect(result.readError).toBe(true);expect(AsyncStorage.setItem).not.toHaveBeenCalled();});
it('a failed pending write is surfaced when returning before it finishes',async()=>{(AsyncStorage.setItem as jest.Mock).mockRejectedValue(Error('disk'));const save=saveCommunicationDraft('event','reminders',{on:false},scope).catch(()=>undefined);await mount();await save;expect(result.saved).toBe(false);});
it('bounds a stalled draft read, blocks editing and ignores its late result after retry',async()=>{
 jest.useFakeTimers();let resolve!:(v:string|null)=>void;(AsyncStorage.getItem as jest.Mock).mockReturnValueOnce(new Promise(r=>{resolve=r;}));await mount();
 await act(async()=>{await jest.advanceTimersByTimeAsync(12_000);});expect(result.loading).toBe(false);expect(result.readError).toBe(true);
 act(()=>result.change({on:false}));expect(AsyncStorage.setItem).not.toHaveBeenCalled();await act(async()=>{await result.retry();});
 await act(async()=>resolve(JSON.stringify({version:1,userId:'one',eventId:'event',kind:'reminders',value:{on:false}})));expect(result.value.on).toBe(true);expect(result.readError).toBe(false);jest.useRealTimers();
});
it('ends a stalled save without claiming saved; retry stays ordered behind the original write',async()=>{
 jest.useFakeTimers();await mount();const pending=deferred();(AsyncStorage.setItem as jest.Mock).mockImplementationOnce(()=>pending.promise);
 act(()=>result.change({on:false}));await act(async()=>{await jest.advanceTimersByTimeAsync(12_000);});expect(result.saving).toBe(false);expect(result.saved).toBe(false);expect(result.error).toContain('Couldn’t save');
 act(()=>result.change({on:true}));await act(async()=>pending.resolve());expect(JSON.parse((AsyncStorage.setItem as jest.Mock).mock.calls.at(-1)[1]).value.on).toBe(true);expect(result.saved).toBe(true);jest.useRealTimers();
});
it('an expired save does not let Save and leave continue later',async()=>{
 jest.useFakeTimers();await mount();const pending=deferred();(AsyncStorage.setItem as jest.Mock).mockImplementationOnce(()=>pending.promise);let save!:Promise<boolean>;
 act(()=>{save=result.save();});await act(async()=>{await jest.advanceTimersByTimeAsync(12_000);});expect(await save).toBe(false);
 await act(async()=>pending.resolve());expect(result.saved).toBe(false);expect(result.error).toContain('Couldn’t save');jest.useRealTimers();
});
it('a superseded save cannot authorize continuation with a different current draft',async()=>{
 await mount();const pending=deferred();(AsyncStorage.setItem as jest.Mock).mockImplementationOnce(()=>pending.promise);let save!:Promise<boolean>;
 act(()=>{save=result.save();result.change({on:false});});await act(async()=>pending.resolve());expect(await save).toBe(false);expect(result.value.on).toBe(false);expect(result.saved).toBe(true);
});
