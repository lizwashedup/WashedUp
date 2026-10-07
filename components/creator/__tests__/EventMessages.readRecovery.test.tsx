import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {Text} from 'react-native';
const mockEvent=jest.fn(),mockAudience=jest.fn(),mockPush=jest.fn(),mockBack=jest.fn(),mockReplace=jest.fn(),mockAccountRetry=jest.fn();
let mockParams:{id?:string;pageId?:string}={id:'event',pageId:'page'},mockScope:{userId:string;isCurrent:()=>boolean}|null={userId:'owner',isCurrent:()=>true},mockCanBack=true,mockSend=false,mockInvite=true;
let mockAccount={isLoading:false,error:null as Error|null,isCurrent:()=>true,retry:mockAccountRetry};
jest.mock('../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:()=>({scope:mockScope,account:mockAccount})}));
jest.mock('../../../lib/creatorCommunications',()=>({CommunicationAudienceDenied:class extends Error{},getCommunicationEvent:(...a:any[])=>mockEvent(...a),getCommunicationAudience:(...a:any[])=>mockAudience(...a)}));
jest.mock('../../../constants/FeatureFlags',()=>({get ATTENDEE_MESSAGE_SEND_ENABLED(){return mockSend;},get INVITE_AUDIENCE_ENABLED(){return mockInvite;}}));
jest.mock('../AttendeeMessageHistory',()=>({AttendeeMessageHistory:()=>null}));
jest.mock('../../events/EventMediaImage',()=>({EventMediaImage:()=>null}));
jest.mock('expo-linear-gradient',()=>({LinearGradient:require('react-native').View}));
jest.mock('../../../lib/haptics',()=>({hapticLight:jest.fn()}));
jest.mock('../pages/PageFrame',()=>({PageFrame:({children}:any)=>children,PageAction:()=>null}));
jest.mock('expo-router',()=>({useLocalSearchParams:()=>mockParams,router:{push:(...a:any[])=>mockPush(...a),back:()=>mockBack(),canGoBack:()=>mockCanBack,replace:(...a:any[])=>mockReplace(...a)}}));
import Screen from '../../../app/creator/event-messages';
import {PageFrame,PageAction} from '../pages/PageFrame';
import {AttendeeMessageHistory} from '../AttendeeMessageHistory';
let tree:ReactTestRenderer,alive=false;
const event={id:'event',title:'Sunday Table',image:null,venue:'Los Angeles'},audience={purchases:2,rsvps:3};
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(value:any)=>void;const promise=new Promise<T>((r,j)=>{resolve=r;reject=j;});return{promise,resolve,reject};}
function mount(){act(()=>{tree=create(<Screen/>);alive=true;});}
function update(){act(()=>tree.update(<Screen/>));}
function unmount(){if(alive)act(()=>{tree.unmount();alive=false;});}
function text(n:any):string{return Array.isArray(n)?n.map(text).join(''):String(n??'');}
function words(){return tree.root.findAllByType(Text).map(n=>text(n.props.children)).join(' ');}
const frame=()=>tree.root.findByType(PageFrame);
const action=(label:string)=>tree.root.findAllByType(PageAction).find(n=>(n.props.accessibilityLabel??n.props.title)===label)!;
const reminder=()=>tree.root.findAll(n=>n.props.accessibilityLabel==='Edit reminders'&&typeof n.props.onPress==='function')[0]!;
const invite=()=>tree.root.findAll(n=>n.props.accessibilityLabel==='Invite people'&&typeof n.props.onPress==='function')[0]!;
const retry=()=>tree.root.findAllByType(PageAction).find(n=>['Try again','Retrying…'].includes(n.props.title))!;
async function flush(){await act(async()=>{for(let i=0;i<45;i++)await Promise.resolve();});}
beforeEach(()=>{jest.useFakeTimers();jest.clearAllMocks();mockParams={id:'event',pageId:'page'};mockScope={userId:'owner',isCurrent:()=>true};mockAccount={isLoading:false,error:null,isCurrent:()=>true,retry:mockAccountRetry};mockCanBack=true;mockSend=false;mockInvite=true;mockEvent.mockReset().mockResolvedValue(event);mockAudience.mockReset().mockResolvedValue(audience);mockAccountRetry.mockReset().mockResolvedValue(undefined);});
afterEach(()=>{unmount();jest.clearAllTimers();jest.useRealTimers();});
it('bounds initial event read and explicit retry; late permission response cannot overwrite recovery',async()=>{
 const pending=deferred<any>();mockEvent.mockReturnValue(pending.promise);mount();await flush();expect(mockAudience).not.toHaveBeenCalled();await act(async()=>{jest.advanceTimersByTime(12000);});await flush();expect(words()).toContain('Couldn’t load messages');expect(mockEvent).toHaveBeenCalledTimes(1);expect(mockEvent.mock.calls[0][1].isCurrent()).toBe(false);mockEvent.mockResolvedValue(event);const again=retry().props.onPress;act(()=>{again();again();});await flush();expect(mockEvent).toHaveBeenCalledTimes(2);expect(mockAudience).toHaveBeenCalledTimes(1);expect(words()).toContain('2 ticket purchases · 3 RSVPs');pending.resolve(null);await flush();expect(words()).toContain('Sunday Table');
});
it('bounds initial audience read without false zero, then rechecks access before explicit audience retry',async()=>{
 const pending=deferred<any>();mockAudience.mockReturnValue(pending.promise);mount();await flush();expect(words()).toContain('Sunday Table');expect(action('New attendee message').props.disabled).toBe(true);expect(words()).not.toContain('0 ticket');await act(async()=>{jest.advanceTimersByTime(12000);});await flush();expect(words()).toContain('Couldn’t load the registration audience');expect(mockAudience.mock.calls[0][1].isCurrent()).toBe(false);const next=deferred<any>();mockAudience.mockReturnValue(next.promise);const again=retry().props.onPress;act(()=>{again();again();});await flush();expect(mockEvent).toHaveBeenCalledTimes(2);expect(mockAudience).toHaveBeenCalledTimes(2);expect(retry().props.disabled).toBe(true);next.resolve(audience);await flush();expect(words()).toContain('2 ticket purchases · 3 RSVPs');expect(action('New attendee message').props.disabled).toBe(false);pending.resolve({purchases:0,rsvps:0});await flush();expect(words()).toContain('2 ticket purchases · 3 RSVPs');
});
it.each(['event','audience'])('retains identity and separate counts during cached %s failure and busy retry',async stage=>{
 mount();await flush();const oldOpen=action('New attendee message').props.onPress,oldReminder=reminder().props.onPress,oldInvite=invite().props.onPress;const pending=deferred<any>();(stage==='event'?mockEvent:mockAudience).mockReturnValue(pending.promise);const again=frame().props.onRefresh;act(()=>{again();again();oldOpen();oldReminder();oldInvite();});expect(mockPush).not.toHaveBeenCalled();await flush();expect(words()).toContain('Sunday Table');expect(words()).toContain('2 ticket purchases · 3 RSVPs');expect(action('New attendee message').props.disabled).toBe(true);pending.reject(Error('offline'));await flush();expect(words()).toContain('last confirmed');expect(words()).toContain('2 ticket purchases · 3 RSVPs');act(()=>{oldOpen();oldReminder();oldInvite();});expect(mockPush).not.toHaveBeenCalled();mockEvent.mockResolvedValue(event);mockAudience.mockResolvedValue({purchases:4,rsvps:7});act(()=>retry().props.onPress());await flush();expect(words()).toContain('4 ticket purchases · 7 RSVPs');expect(words()).not.toContain('11 people');expect(action('New attendee message').props.disabled).toBe(false);
});
it('hides all private data and destinations on authoritative null, including retained callbacks',async()=>{
 mockSend=true;mount();await flush();expect(tree.root.findAllByType(AttendeeMessageHistory)).toHaveLength(1);const open=action('New attendee message').props.onPress,go=invite().props.onPress;mockEvent.mockResolvedValue(null);act(()=>frame().props.onRefresh());await flush();expect(words()).not.toContain('Sunday Table');expect(words()).not.toContain('ticket purchases');expect(tree.root.findAllByType(AttendeeMessageHistory)).toHaveLength(0);act(()=>{open();go();});expect(mockPush).not.toHaveBeenCalled();
});
it.each(['account','event','page','focus','unmount'])('retires deferred audience/read/retry/navigation callbacks on %s change',async reason=>{
 mount();await flush();const open=action('New attendee message').props.onPress,go=reminder().props.onPress,back=frame().props.onBack,again=frame().props.onRefresh;const pending=deferred<any>();mockAudience.mockReturnValue(pending.promise);act(()=>again());await flush();if(reason==='unmount')unmount();else{if(reason==='event')mockParams={id:'other',pageId:'page'};if(reason==='page')mockParams={id:'event',pageId:'otherpage'};mockScope={userId:reason==='account'?'other':'owner',isCurrent:()=>reason!=='focus'};mockEvent.mockResolvedValue(null);update();await flush();expect(words()).not.toContain('Sunday Table');}const events=mockEvent.mock.calls.length,reads=mockAudience.mock.calls.length;act(()=>{open();go();back();again();});pending.resolve(audience);await flush();expect(mockPush).not.toHaveBeenCalled();expect(mockBack).not.toHaveBeenCalled();expect(mockReplace).not.toHaveBeenCalled();expect(mockEvent).toHaveBeenCalledTimes(events);expect(mockAudience).toHaveBeenCalledTimes(reads);
});
it('keeps exact message/reminder/invite routes and both contextual Back behaviors',async()=>{
 mount();await flush();act(()=>{action('New attendee message').props.onPress();reminder().props.onPress();invite().props.onPress();frame().props.onBack();});expect(mockPush.mock.calls).toEqual([['/creator/attendee-message?id=event'],['/creator/event-reminders?id=event'],['/creator/invite-audience?id=event']]);expect(mockBack).toHaveBeenCalledTimes(1);mockCanBack=false;act(()=>frame().props.onBack());expect(mockReplace).toHaveBeenLastCalledWith('/creator/event-summary?id=event&pageId=page');mockParams={id:'event'};update();await flush();act(()=>frame().props.onBack());expect(mockReplace).toHaveBeenLastCalledWith('/creator/event-summary?id=event');
});
it('preserves disabled-send explanation and invite/history feature gates',async()=>{
 mockInvite=false;mount();await flush();expect(invite()).toBeUndefined();expect(tree.root.findAllByType(AttendeeMessageHistory)).toHaveLength(0);expect(words()).toContain('nothing is sent or scheduled');mockSend=true;update();await flush();expect(tree.root.findAllByType(AttendeeMessageHistory)).toHaveLength(1);const pending=deferred<any>();mockEvent.mockReturnValue(pending.promise);act(()=>frame().props.onRefresh());await flush();expect(tree.root.findAllByType(AttendeeMessageHistory)).toHaveLength(0);pending.resolve(event);await flush();expect(tree.root.findAllByType(AttendeeMessageHistory)).toHaveLength(1);
});
it('does not read without an event and can retry a failed account lookup once',async()=>{
 mockParams={};mount();await flush();expect(mockEvent).not.toHaveBeenCalled();expect(mockAudience).not.toHaveBeenCalled();expect(words()).toContain('Event unavailable');unmount();mockParams={id:'event'};mockScope=null;mockAccount.error=Error('identity failed');mount();await flush();const pending=deferred<void>();mockAccountRetry.mockReturnValue(pending.promise);const again=retry().props.onPress;act(()=>{again();again();});await flush();expect(mockAccountRetry).toHaveBeenCalledTimes(1);expect(mockEvent).not.toHaveBeenCalled();pending.resolve();await flush();
});
it('does not let a retired retry lock block another account’s recovery',async()=>{
 mount();await flush();const pending=deferred<any>();mockEvent.mockReturnValue(pending.promise);act(()=>frame().props.onRefresh());await flush();mockScope={userId:'other',isCurrent:()=>true};mockEvent.mockRejectedValue(Error('offline'));update();await flush();mockEvent.mockResolvedValue({...event,title:'Other event'});act(()=>retry().props.onPress());await flush();expect(words()).toContain('Other event');pending.resolve(null);await flush();expect(words()).toContain('Other event');expect(action('New attendee message').props.disabled).toBe(false);
});

it('requires a fresh audience after authoritative denial instead of reviving prior counts',async()=>{
 mount();await flush();mockEvent.mockResolvedValue(null);act(()=>frame().props.onRefresh());await flush();expect(words()).not.toContain('ticket purchases');mockEvent.mockResolvedValue(event);const pending=deferred<any>();mockAudience.mockReturnValue(pending.promise);act(()=>frame().props.onRefresh());await flush();expect(words()).toContain('Sunday Table');expect(words()).not.toContain('2 ticket purchases');expect(action('New attendee message').props.disabled).toBe(true);pending.resolve({purchases:1,rsvps:1});await flush();expect(words()).toContain('1 ticket purchase · 1 RSVP');
});

it('hides retained private data when audience authority is revoked between event and audience reads',async()=>{
 mount();await flush();const oldOpen=action('New attendee message').props.onPress;
 const Denied=jest.requireMock('../../../lib/creatorCommunications').CommunicationAudienceDenied;
 mockAudience.mockRejectedValue(new Denied());act(()=>frame().props.onRefresh());await flush();
 expect(words()).toContain('Event unavailable');expect(words()).not.toContain('Sunday Table');expect(words()).not.toContain('ticket purchases');
 act(()=>oldOpen());expect(mockPush).not.toHaveBeenCalled();
 const pending=deferred<any>();mockAudience.mockReturnValue(pending.promise);act(()=>frame().props.onRefresh());await flush();
 expect(words()).not.toContain('2 ticket purchases');expect(action('New attendee message').props.disabled).toBe(true);
 pending.resolve({purchases:1,rsvps:0});await flush();expect(words()).toContain('1 ticket purchase · 0 RSVPs');
});
