import React from 'react';
import {act,create,ReactTestRenderer} from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
jest.mock('../../lib/eventReminders',()=>({...jest.requireActual('../../lib/eventReminders'),loadEventReminders:jest.fn(),saveEventReminders:jest.fn()}));
jest.mock('../../lib/supabase',()=>({supabase:{auth:{getSession:jest.fn()},rpc:jest.fn()}}));
import {loadEventReminders,saveEventReminders,ReminderConflict,ReminderAccessDenied,type ReminderSettings} from '../../lib/eventReminders';
import {useEventReminderSettings} from '../useEventReminderSettings';
const event='8ecc2940-0000-4000-8000-000000000001',page='8ecc2940-0000-4000-8000-000000000002',revision='8ecc2940-0000-4000-8000-000000000003';
const remote:ReminderSettings={eventId:event,pageId:page,revision:null,updatedAt:null,startsAt:'2099-09-18T18:00:00Z',eventStatus:'Live',deliveryReady:false,dayBeforeOn:true,dayOfOn:true};
let scope={userId:'one',isCurrent:()=>true},authorized=true, result:ReturnType<typeof useEventReminderSettings>,tree:ReactTestRenderer;
function Screen(){result=useEventReminderSettings(event,scope,()=>authorized);return null;}
async function mount(){await act(async()=>{tree=create(<Screen/>);});}
function stored(value:unknown){return JSON.stringify({version:1,eventId:event,userId:scope.userId,kind:'reminders',value});}
beforeEach(()=>{jest.clearAllMocks();authorized=true;(saveEventReminders as jest.Mock).mockReset();scope={userId:'one',isCurrent:()=>true};(loadEventReminders as jest.Mock).mockResolvedValue(remote);(AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);(AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);});
afterEach(()=>{if(tree)act(()=>tree.unmount());jest.useRealTimers();});
it('keeps the original two choices but does not automatically save shared settings',async()=>{await mount();expect(result.draft?.dayBeforeOn).toBe(true);expect(result.saved).toBe(false);expect(saveEventReminders).not.toHaveBeenCalled();expect(AsyncStorage.setItem).not.toHaveBeenCalled();});
it('preserves old account-owned choices and explicitly saves against the current baseline',async()=>{(AsyncStorage.getItem as jest.Mock).mockResolvedValue(stored({dayBeforeOn:false,dayOfOn:true}));await mount();(saveEventReminders as jest.Mock).mockResolvedValue({...remote,dayBeforeOn:false,revision,updatedAt:'2026-09-17T04:00:00Z'});await act(async()=>{await result.save();});expect(saveEventReminders).toHaveBeenCalledWith(event,remote,expect.objectContaining({dayBeforeOn:false}),expect.objectContaining({userId:scope.userId,isCurrent:expect.any(Function)}));expect((saveEventReminders as jest.Mock).mock.calls[0][3].isCurrent()).toBe(false);expect(result.saved).toBe(true);expect(JSON.parse((AsyncStorage.setItem as jest.Mock).mock.calls[0][1]).value.baseRevision).toBe(revision);});
it('keeps draft edits when local storage fails and blocks shared saving until retry',async()=>{await mount();(AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(Error('disk'));await act(async()=>result.change('dayOfOn',false));expect(result.draft?.dayOfOn).toBe(false);expect(result.canSave).toBe(false);expect(result.localError).toBeTruthy();await act(async()=>{await result.retryLocal();});expect(result.canSave).toBe(true);});
it('requires an explicit conflict choice before replacing a teammate’s settings',async()=>{(AsyncStorage.getItem as jest.Mock).mockResolvedValue(stored({dayBeforeOn:false,dayOfOn:true,pageId:page,baseRevision:null}));(loadEventReminders as jest.Mock).mockResolvedValue({...remote,revision,updatedAt:'2026-09-17T04:00:00Z'});await mount();expect(result.conflict).toBe(true);await act(async()=>{await result.save();});expect(saveEventReminders).not.toHaveBeenCalled();await act(async()=>result.resolveConflict(false));expect(result.conflict).toBe(false);expect(result.draft?.dayBeforeOn).toBe(false);expect(result.draft?.baseRevision).toBe(revision);});
it('offers the saved version without mutating shared preferences',async()=>{(AsyncStorage.getItem as jest.Mock).mockResolvedValue(stored({dayBeforeOn:false,dayOfOn:true,pageId:page,baseRevision:null}));(loadEventReminders as jest.Mock).mockResolvedValue({...remote,revision,updatedAt:'2026-09-17T04:00:00Z'});await mount();await act(async()=>result.resolveConflict(true));expect(result.saved).toBe(true);expect(saveEventReminders).not.toHaveBeenCalled();});
it('an unknown save blocks repeat writes and a fresh matching read recovers confirmation',async()=>{await mount();(saveEventReminders as jest.Mock).mockRejectedValueOnce(Error('network'));await act(async()=>{await result.save();});expect(result.uncertain).toBe(true);await act(async()=>{await result.save();});expect(saveEventReminders).toHaveBeenCalledTimes(1);(loadEventReminders as jest.Mock).mockResolvedValue({...remote,revision,updatedAt:'2026-09-17T04:00:00Z'});await act(async()=>{await result.refresh();});expect(result.saved).toBe(true);expect(result.uncertain).toBe(false);});
it('a server conflict forces a read before the creator can choose either version',async()=>{await mount();(saveEventReminders as jest.Mock).mockRejectedValueOnce(new ReminderConflict('changed'));await act(async()=>{await result.save();});expect(result.uncertain).toBe(true);act(()=>result.resolveConflict(false));expect(result.uncertain).toBe(true);});
it('a lost acknowledgement can be recovered after remount from the persisted desired settings',async()=>{(AsyncStorage.getItem as jest.Mock).mockResolvedValue(stored({dayBeforeOn:false,dayOfOn:true,pageId:page,baseRevision:null}));(loadEventReminders as jest.Mock).mockResolvedValue({...remote,dayBeforeOn:false,revision,updatedAt:'2026-09-17T04:00:00Z'});await mount();expect(result.saved).toBe(true);expect(result.conflict).toBe(false);expect(saveEventReminders).not.toHaveBeenCalled();});
it('unread local drafts are not overwritten',async()=>{(AsyncStorage.getItem as jest.Mock).mockRejectedValue(Error('disk'));await mount();expect(result.loaded).toBe(false);act(()=>result.change('dayOfOn',false));expect(AsyncStorage.setItem).not.toHaveBeenCalled();expect(result.canSave).toBe(false);});
it('revoked access clears remote settings and disables editing',async()=>{await mount();(loadEventReminders as jest.Mock).mockRejectedValueOnce(new ReminderAccessDenied('denied'));await act(async()=>{await result.refresh();});expect(result.remote).toBeNull();expect(result.denied).toBe(true);expect(result.editable).toBe(false);});
it('old callbacks cannot change another account or issue overlapping saves',async()=>{await mount();const save=result.save,change=result.change;let resolve!:(v:unknown)=>void;(saveEventReminders as jest.Mock).mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));act(()=>{void save();void save();change('dayOfOn',false);});expect(saveEventReminders).toHaveBeenCalledTimes(1);expect(result.draft?.dayOfOn).toBe(true);scope.isCurrent=()=>false;scope={userId:'two',isCurrent:()=>true};await act(async()=>tree.update(<Screen/>));await act(async()=>resolve({...remote,revision,updatedAt:'2026-09-17T04:00:00Z'}));expect(result.saved).toBe(false);expect(AsyncStorage.setItem).not.toHaveBeenCalled();});
it('closed events remain readable without offering writes',async()=>{(loadEventReminders as jest.Mock).mockResolvedValue({...remote,eventStatus:'Cancelled'});await mount();expect(result.closed).toBe(true);expect(result.canSave).toBe(false);await act(async()=>{await result.save();});expect(saveEventReminders).not.toHaveBeenCalled();});

function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
async function tick(ms:number){await act(async()=>{await jest.advanceTimersByTimeAsync(ms);});}
it('recovers a stalled first read and ignores its late result after retry',async()=>{
  jest.useFakeTimers();const pending=deferred<typeof remote>();(loadEventReminders as jest.Mock).mockReturnValueOnce(pending.promise);
  await mount();expect(result.loading).toBe(true);await tick(12000);expect(result.loading).toBe(false);expect(result.readError).toBe(true);
  const oldScope=(loadEventReminders as jest.Mock).mock.calls[0][1];expect(oldScope.isCurrent()).toBe(false);
  await act(async()=>{await result.refresh();});expect(result.loaded).toBe(true);
  await act(async()=>pending.resolve({...remote,dayOfOn:false}));expect(result.draft?.dayOfOn).toBe(true);expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
it('does not replace a stalled local draft read with empty defaults',async()=>{
  jest.useFakeTimers();const pending=deferred<string|null>();(AsyncStorage.getItem as jest.Mock).mockReturnValueOnce(pending.promise);
  await mount();await tick(12000);expect(result.loaded).toBe(false);expect(result.readError).toBe(true);
  act(()=>result.change('dayOfOn',false));expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(stored({dayBeforeOn:false,dayOfOn:true}));
  await act(async()=>{await result.refresh();});expect(result.draft?.dayBeforeOn).toBe(false);
  await act(async()=>pending.resolve(stored({dayBeforeOn:true,dayOfOn:false})));expect(result.draft?.dayBeforeOn).toBe(false);expect(result.draft?.dayOfOn).toBe(true);
});
it('a stalled shared save releases its controls and requires a read before any repeat write',async()=>{
  jest.useFakeTimers();await mount();const pending=deferred<typeof remote>();(saveEventReminders as jest.Mock).mockReturnValueOnce(pending.promise);
  act(()=>{void result.save();});await tick(25000);expect(result.busy).toBe(false);expect(result.uncertain).toBe(true);expect(result.editable).toBe(false);
  await act(async()=>{await result.save();});expect(saveEventReminders).toHaveBeenCalledTimes(1);
  await act(async()=>pending.resolve({...remote,revision,updatedAt:'2026-09-17T04:00:00Z'}));expect(result.uncertain).toBe(true);expect(result.saved).toBe(false);
  (loadEventReminders as jest.Mock).mockResolvedValue({...remote,revision,updatedAt:'2026-09-17T04:00:00Z'});
  await act(async()=>{await result.refresh();});expect(result.saved).toBe(true);expect(result.uncertain).toBe(false);expect(saveEventReminders).toHaveBeenCalledTimes(1);
});
it('stalled local writes release Save and leave without allowing a late success',async()=>{
  jest.useFakeTimers();await mount();const pending=deferred<void>();(AsyncStorage.setItem as jest.Mock).mockReturnValueOnce(pending.promise);
  act(()=>result.change('dayOfOn',false));await tick(12000);expect(result.localSaving).toBe(false);expect(result.localError).toBeTruthy();expect(result.draft?.dayOfOn).toBe(false);expect(result.canSave).toBe(false);
  let retried!:Promise<boolean>;act(()=>{retried=result.retryLocal();});await tick(12000);expect(await retried).toBe(false);
  await act(async()=>pending.resolve());expect(result.localError).toBeTruthy();expect(result.canSave).toBe(false);
  await act(async()=>{expect(await result.retryLocal()).toBe(true);});expect(result.localError).toBe('');expect(result.canSave).toBe(true);
});
it('a superseded draft retry cannot claim the newer choice is saved',async()=>{
  await mount();const pending=deferred<void>();(AsyncStorage.setItem as jest.Mock).mockReturnValueOnce(pending.promise);
  let retry!:Promise<boolean>;act(()=>{retry=result.retryLocal();});act(()=>result.change('dayOfOn',false));
  await act(async()=>pending.resolve());expect(await retry).toBe(false);expect(result.draft?.dayOfOn).toBe(false);
  const writes=(AsyncStorage.setItem as jest.Mock).mock.calls;expect(JSON.parse(writes.at(-1)[1]).value.dayOfOn).toBe(false);
});
it('keeps a confirmed server receipt when only its local persistence stalls',async()=>{
  jest.useFakeTimers();await mount();const pending=deferred<void>();(AsyncStorage.setItem as jest.Mock).mockReturnValueOnce(pending.promise);
  (saveEventReminders as jest.Mock).mockResolvedValue({...remote,revision,updatedAt:'2026-09-17T04:00:00Z'});
  act(()=>{void result.save();});await tick(1);expect(result.busy).toBe(false);expect(result.saved).toBe(true);expect(result.localSaving).toBe(true);
  await tick(12000);expect(result.localSaving).toBe(false);expect(result.localError).toBeTruthy();expect(result.uncertain).toBe(false);expect(result.saved).toBe(true);
  await act(async()=>pending.resolve());expect(result.localError).toBeTruthy();
});
it('a delayed session cannot submit after the save deadline',async()=>{
  jest.useFakeTimers();await mount();const session=deferred<unknown>(),supabase=require('../../lib/supabase').supabase;
  supabase.auth.getSession.mockReturnValueOnce(session.promise);(saveEventReminders as jest.Mock).mockImplementationOnce(jest.requireActual('../../lib/eventReminders').saveEventReminders);
  act(()=>{void result.save();});await tick(25000);expect(result.uncertain).toBe(true);
  await act(async()=>session.resolve({data:{session:{user:{id:'one'},access_token:'synthetic'}},error:null}));expect(supabase.rpc).not.toHaveBeenCalled();
});
it('live authority removal retires a pending save and blocks stale edit callbacks',async()=>{
  await mount();const session=deferred<unknown>(),supabase=require('../../lib/supabase').supabase;
  supabase.auth.getSession.mockReturnValueOnce(session.promise);(saveEventReminders as jest.Mock).mockImplementationOnce(jest.requireActual('../../lib/eventReminders').saveEventReminders);
  const change=result.change;act(()=>{void result.save();});authorized=false;
  await act(async()=>session.resolve({data:{session:{user:{id:'one'},access_token:'synthetic'}},error:null}));expect(supabase.rpc).not.toHaveBeenCalled();expect(result.uncertain).toBe(true);
  act(()=>change('dayOfOn',false));expect(result.draft?.dayOfOn).toBe(true);expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
