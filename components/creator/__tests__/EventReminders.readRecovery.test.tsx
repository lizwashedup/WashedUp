import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {Alert,Text} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
const mockEvent=jest.fn(),mockLoad=jest.fn(),mockSave=jest.fn(),mockBack=jest.fn(),mockReplace=jest.fn(),mockPrevent=jest.fn(),mockDispatch=jest.fn(),mockAccountRetry=jest.fn();
const eventId='8ecc2940-0000-4000-8000-000000000001',pageId='8ecc2940-0000-4000-8000-000000000002',revision='8ecc2940-0000-4000-8000-000000000003';
let mockParams:{id?:string;pageId?:string}={id:eventId,pageId},mockScope:{userId:string;isCurrent:()=>boolean}|null={userId:'owner',isCurrent:()=>true},mockCanBack=true;
let mockAccount={isLoading:false,error:null as Error|null,isCurrent:()=>true,retry:mockAccountRetry};
jest.mock('../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:()=>({scope:mockScope,account:mockAccount})}));
jest.mock('../../../lib/creatorCommunications',()=>({getCommunicationEvent:(...a:any[])=>mockEvent(...a)}));
jest.mock('../../../lib/eventReminders',()=>({...jest.requireActual('../../../lib/eventReminders'),loadEventReminders:(...a:any[])=>mockLoad(...a),saveEventReminders:(...a:any[])=>mockSave(...a)}));
jest.mock('../../../lib/supabase',()=>({supabase:{}}));
jest.mock('@react-navigation/native',()=>({useNavigation:()=>({dispatch:mockDispatch}),usePreventRemove:(...a:any[])=>mockPrevent(...a)}));
jest.mock('expo-linear-gradient',()=>({LinearGradient:require('react-native').View}));
jest.mock('../../../lib/haptics',()=>({hapticLight:jest.fn()}));
jest.mock('../pages/PageFrame',()=>({PageFrame:({children}:any)=>children,PageAction:()=>null}));
jest.mock('expo-router',()=>({useLocalSearchParams:()=>mockParams,router:{back:()=>mockBack(),canGoBack:()=>mockCanBack,replace:(...a:any[])=>mockReplace(...a)}}));
import Screen from '../../../app/creator/event-reminders';
import {PageFrame,PageAction} from '../pages/PageFrame';
let tree:ReactTestRenderer,alive=false;
const event={id:eventId,title:'Sunday Table',image:null,venue:'Los Angeles'};
const remote={eventId,pageId,revision:null,updatedAt:null,startsAt:'2099-09-18T18:00:00Z',eventStatus:'Live',deliveryReady:false,dayBeforeOn:true,dayOfOn:true};
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(value:any)=>void;const promise=new Promise<T>((r,j)=>{resolve=r;reject=j;});return{promise,resolve,reject};}
function mount(){act(()=>{tree=create(<Screen/>);alive=true;});}
function update(){act(()=>tree.update(<Screen/>));}
function unmount(){if(alive)act(()=>{tree.unmount();alive=false;});}
function text(n:any):string{return Array.isArray(n)?n.map(text).join(''):String(n??'');}
function words(){return tree.root.findAllByType(Text).map(n=>text(n.props.children)).join(' ');}
const frame=()=>tree.root.findByType(PageFrame);
const action=(title:string)=>tree.root.findAllByType(PageAction).find(n=>n.props.title===title)!;
const retry=()=>action('Try again')??action('Retrying…');
const toggle=(label='The day before reminder draft')=>tree.root.findAll(n=>n.props.accessibilityLabel===label&&typeof n.props.onValueChange==='function')[0];
function stored(value:unknown){return JSON.stringify({version:1,eventId,userId:'owner',kind:'reminders',value});}
async function flush(){await act(async()=>{for(let i=0;i<60;i++)await Promise.resolve();});}
beforeEach(()=>{jest.useFakeTimers();jest.clearAllMocks();mockParams={id:eventId,pageId};mockScope={userId:'owner',isCurrent:()=>true};mockAccount={isLoading:false,error:null,isCurrent:()=>true,retry:mockAccountRetry};mockCanBack=true;mockEvent.mockReset().mockResolvedValue(event);mockLoad.mockReset().mockResolvedValue(remote);mockSave.mockReset().mockResolvedValue({...remote,revision});mockAccountRetry.mockReset().mockResolvedValue(undefined);(AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);(AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);jest.spyOn(Alert,'alert').mockImplementation(()=>{});});
afterEach(()=>{unmount();jest.clearAllTimers();jest.useRealTimers();jest.restoreAllMocks();});
it('bounds initial event access, keeps settings unread until authorized, and retires late results',async()=>{
 const pending=deferred<any>();mockEvent.mockReturnValue(pending.promise);mount();await flush();expect(mockLoad).not.toHaveBeenCalled();await act(async()=>{jest.advanceTimersByTime(12000);});await flush();expect(words()).toContain('Couldn’t load reminders');expect(mockEvent.mock.calls[0][1].isCurrent()).toBe(false);expect(mockEvent).toHaveBeenCalledTimes(1);mockEvent.mockResolvedValue(event);const again=retry().props.onPress;act(()=>{again();again();});await flush();expect(mockEvent).toHaveBeenCalledTimes(2);expect(mockLoad).toHaveBeenCalledTimes(1);expect(toggle().props.value).toBe(true);pending.resolve(null);await flush();expect(words()).toContain('Sunday Table');
});
it('preserves mounted editor/local draft through access refresh/error and synchronously blocks old edit/save/status actions',async()=>{
 mount();await flush();act(()=>toggle().props.onValueChange(false));await flush();const edit=toggle().props.onValueChange,save=action('Save settings').props.onPress,refreshStatus=action('Refresh status').props.onPress;const writes=(AsyncStorage.setItem as jest.Mock).mock.calls.length,pending=deferred<any>();mockEvent.mockReturnValue(pending.promise);const again=frame().props.onRefresh;act(()=>{again();again();edit(true);save();refreshStatus();});await flush();expect(toggle().props.value).toBe(false);expect(toggle().props.disabled).toBe(true);expect(mockSave).not.toHaveBeenCalled();expect(mockLoad).toHaveBeenCalledTimes(1);expect(AsyncStorage.setItem).toHaveBeenCalledTimes(writes);expect(words()).toContain('Your draft stays here');pending.reject(Error('offline'));await flush();expect(toggle().props.value).toBe(false);expect(words()).toContain('Your draft is kept here');act(()=>{edit(true);save();refreshStatus();});expect(mockSave).not.toHaveBeenCalled();expect(mockLoad).toHaveBeenCalledTimes(1);mockEvent.mockResolvedValue(event);act(()=>retry().props.onPress());await flush();expect(mockLoad).toHaveBeenCalledTimes(1);expect(toggle().props.value).toBe(false);expect(toggle().props.disabled).toBe(false);expect(mockEvent).toHaveBeenCalledTimes(3);
});
it('keeps stale conflict-choice closures inert while event access is checked',async()=>{
 (AsyncStorage.getItem as jest.Mock).mockResolvedValue(stored({dayBeforeOn:false,dayOfOn:true,pageId,baseRevision:null}));mockLoad.mockResolvedValue({...remote,revision});mount();await flush();const saved=action('Use saved').props.onPress,keep=action('Keep my changes').props.onPress;const pending=deferred<any>();mockEvent.mockReturnValue(pending.promise);act(()=>{frame().props.onRefresh();saved();keep();});await flush();expect(words()).toContain('Your team’s saved settings changed');expect(toggle().props.value).toBe(false);expect(AsyncStorage.setItem).not.toHaveBeenCalled();pending.resolve(event);await flush();act(()=>action('Use saved').props.onPress());await flush();expect(toggle().props.value).toBe(true);expect(words()).toContain('Saved for this event');expect(mockSave).not.toHaveBeenCalled();
});
it('retains uncertain-save recovery without letting an old Check saved callback bypass current access',async()=>{
 mockSave.mockRejectedValue(Error('network'));mount();await flush();act(()=>action('Save settings').props.onPress());await flush();const check=action('Check saved').props.onPress,pending=deferred<any>();mockEvent.mockReturnValue(pending.promise);act(()=>{frame().props.onRefresh();check();});await flush();expect(mockLoad).toHaveBeenCalledTimes(1);expect(mockSave).toHaveBeenCalledTimes(1);pending.resolve(event);await flush();mockLoad.mockResolvedValue({...remote,revision});act(()=>action('Check saved').props.onPress());await flush();expect(words()).toContain('Saved for this event');expect(mockSave).toHaveBeenCalledTimes(1);
});
it('keeps draft-exit protection active while access is unverified and guards old Retry draft',async()=>{
 mount();await flush();(AsyncStorage.setItem as jest.Mock).mockRejectedValue(Error('disk'));act(()=>toggle().props.onValueChange(false));await flush();const retryDraft=action('Retry draft').props.onPress,pending=deferred<any>();mockEvent.mockReturnValue(pending.promise);const writes=(AsyncStorage.setItem as jest.Mock).mock.calls.length;act(()=>{frame().props.onRefresh();retryDraft();});await flush();expect(AsyncStorage.setItem).toHaveBeenCalledTimes(writes);const [blocked,prevent]=mockPrevent.mock.calls.at(-1);expect(blocked).toBe(true);act(()=>prevent({data:{action:{type:'GO_BACK'}}}));const buttons=(Alert.alert as jest.Mock).mock.calls[0][2];await act(async()=>buttons.find((b:any)=>b.text==='Save and leave').onPress());await flush();expect(mockDispatch).not.toHaveBeenCalled();expect(mockSave).not.toHaveBeenCalled();pending.resolve(event);await flush();
});
it('authoritative null hides editor and permanently retires its settings and exit callbacks',async()=>{
 mount();await flush();const edit=toggle().props.onValueChange,save=action('Save settings').props.onPress,refreshStatus=action('Refresh status').props.onPress,oldScope=mockLoad.mock.calls[0][1];mockEvent.mockResolvedValue(null);act(()=>frame().props.onRefresh());await flush();expect(words()).not.toContain('Sunday Table');expect(toggle()).toBeUndefined();expect(oldScope.isCurrent()).toBe(false);act(()=>{edit(false);save();refreshStatus();});expect(mockSave).not.toHaveBeenCalled();expect(AsyncStorage.setItem).not.toHaveBeenCalled();mockEvent.mockResolvedValue(event);act(()=>frame().props.onRefresh());await flush();expect(oldScope.isCurrent()).toBe(false);expect(mockLoad).toHaveBeenCalledTimes(2);act(()=>save());expect(mockSave).not.toHaveBeenCalled();
});
it.each(['account','event','page','focus','unmount'])('retires event refresh and retained editor/Back callbacks on %s change',async reason=>{
 mount();await flush();const edit=toggle().props.onValueChange,save=action('Save settings').props.onPress,status=action('Refresh status').props.onPress,back=frame().props.onBack,again=frame().props.onRefresh;const pending=deferred<any>();mockEvent.mockReturnValue(pending.promise);act(()=>again());await flush();if(reason==='unmount')unmount();else{if(reason==='event')mockParams={id:'other',pageId};if(reason==='page')mockParams={id:eventId,pageId:'other'};mockScope={userId:reason==='account'?'other':'owner',isCurrent:()=>reason!=='focus'};mockEvent.mockResolvedValue(null);update();await flush();expect(words()).not.toContain('Sunday Table');}const events=mockEvent.mock.calls.length,reads=mockLoad.mock.calls.length;act(()=>{edit(false);save();status();back();again();});pending.resolve(event);await flush();expect(mockSave).not.toHaveBeenCalled();expect(AsyncStorage.setItem).not.toHaveBeenCalled();expect(mockBack).not.toHaveBeenCalled();expect(mockReplace).not.toHaveBeenCalled();expect(mockEvent).toHaveBeenCalledTimes(events);expect(mockLoad).toHaveBeenCalledTimes(reads);
});
it('preserves real save arguments, local draft semantics and provider-off copy',async()=>{
 mount();await flush();act(()=>toggle().props.onValueChange(false));await flush();mockSave.mockResolvedValue({...remote,revision,dayBeforeOn:false});act(()=>action('Save settings').props.onPress());await flush();expect(mockSave).toHaveBeenCalledWith(eventId,remote,expect.objectContaining({dayBeforeOn:false,dayOfOn:true,pageId}),expect.objectContaining({userId:'owner',isCurrent:expect.any(Function)}));expect(words()).toContain('Saved for this event');expect(words()).toContain('Automatic reminders are paused. You can save your settings now; no new reminders will be queued while paused.');expect(JSON.parse((AsyncStorage.setItem as jest.Mock).mock.calls.at(-1)[1]).value.baseRevision).toBe(revision);
});
it('keeps normal and cold Messages Back with the original event/page context',async()=>{
 mount();await flush();act(()=>frame().props.onBack());expect(mockBack).toHaveBeenCalledTimes(1);mockCanBack=false;act(()=>frame().props.onBack());expect(mockReplace).toHaveBeenLastCalledWith(`/creator/event-messages?id=${eventId}&pageId=${pageId}`);mockParams={id:eventId};update();await flush();act(()=>frame().props.onBack());expect(mockReplace).toHaveBeenLastCalledWith(`/creator/event-messages?id=${eventId}`);
});
it('no event means no read, while account failure has a locked explicit retry',async()=>{
 mockParams={};mount();await flush();expect(mockEvent).not.toHaveBeenCalled();expect(mockLoad).not.toHaveBeenCalled();unmount();mockParams={id:eventId};mockScope=null;mockAccount.error=Error('identity');mount();await flush();const pending=deferred<void>();mockAccountRetry.mockReturnValue(pending.promise);const again=retry().props.onPress;act(()=>{again();again();});await flush();expect(mockAccountRetry).toHaveBeenCalledTimes(1);pending.resolve();await flush();
});
