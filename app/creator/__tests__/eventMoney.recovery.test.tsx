import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {Text} from 'react-native';
const mockLoad=jest.fn(),mockPush=jest.fn(),mockAccountRetry=jest.fn(),mockBack=jest.fn(),mockReplace=jest.fn();
let mockCanBack=true;
const event='22222222-2222-4222-8222-222222222222',page='33333333-3333-4333-8333-333333333333';
let mockParams:{id?:string;pageId?:string}={id:event,pageId:page},mockScope:{userId:string;isCurrent:()=>boolean}|null={userId:'creator',isCurrent:()=>true};
let mockAccount={isLoading:false,error:null as Error|null,isCurrent:()=>true,retry:mockAccountRetry};
jest.mock('../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:()=>({scope:mockScope,account:mockAccount})}));
jest.mock('../../../lib/eventEarnings',()=>({loadEventEarnings:(...args:any[])=>mockLoad(...args)}));
jest.mock('../../../components/creator/pages/PageFrame',()=>({PageFrame:({children}:any)=>children,PageAction:()=>null,pageStyles:{body:{},notice:{}}}));
jest.mock('../../../lib/ticketing',()=>({formatCents:(c:number)=>`$${(c/100).toFixed(2)}`,isPayoutReady:(p:any)=>!!p?.chargesEnabled&&!!p?.payoutsEnabled}));
jest.mock('expo-linear-gradient',()=>({LinearGradient:require('react-native').View}));
jest.mock('expo-router',()=>({useLocalSearchParams:()=>mockParams,router:{push:(...args:any[])=>mockPush(...args),canGoBack:()=>mockCanBack,back:()=>mockBack(),replace:(...args:any[])=>mockReplace(...args)}}));
import Screen from '../event-money';
import {PageAction,PageFrame} from '../../../components/creator/pages/PageFrame';
import {EventEarningsView} from '../../../components/creator/EventEarningsView';
let tree:ReactTestRenderer,alive=false;
const data:any={event:{id:event,title:'Sunday table',event_date:'2026-09-20',start_time:null},money:{grossFaceCents:10000,commissionCents:400,processingCents:500,payoutStatus:null,payoutPaidAt:null,payoutReleasedAt:null},ticketsSold:3,refundedCents:0,isPayee:true,setupError:false,payout:{exists:false,requirementsDue:[],detailsSubmitted:false,chargesEnabled:false,payoutsEnabled:false}};
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(value:any)=>void;const promise=new Promise<T>((r,j)=>{resolve=r;reject=j;});return{promise,resolve,reject};}
function mount(){act(()=>{tree=create(<Screen/>);alive=true;});}
function update(){act(()=>tree.update(<Screen/>));}
function unmount(){if(alive)act(()=>{tree.unmount();alive=false;});}
function text(n:any):string{return Array.isArray(n)?n.map(text).join(''):String(n??'');}
function words(){return tree.root.findAllByType(Text).map(n=>text(n.props.children)).join(' ');}
const view=()=>tree.root.findByType(EventEarningsView);
const views=()=>tree.root.findAllByType(EventEarningsView);
const refresh=()=>tree.root.findByType(PageFrame).props.onRefresh;
const retry=()=>tree.root.findAllByType(PageAction).find(n=>['Try again','Retrying…'].includes(n.props.title))!;
async function flush(){await act(async()=>{for(let i=0;i<30;i++)await Promise.resolve();});}
beforeEach(()=>{jest.useFakeTimers();jest.clearAllMocks();mockParams={id:event,pageId:page};mockScope={userId:'creator',isCurrent:()=>true};mockAccount={isLoading:false,error:null,isCurrent:()=>true,retry:mockAccountRetry};mockLoad.mockReset().mockResolvedValue(data);mockAccountRetry.mockReset().mockResolvedValue(undefined);});
afterEach(()=>{unmount();jest.clearAllTimers();jest.useRealTimers();});
it('keeps normal Back and restores exact event/page context on cold Back',async()=>{
 mockCanBack=true;mount();await flush();const back=tree.root.findByType(PageFrame).props.onBack;
 act(()=>back());expect(mockBack).toHaveBeenCalledTimes(1);
 mockCanBack=false;act(()=>back());expect(mockReplace).toHaveBeenCalledWith({pathname:'/creator/event-summary',params:{id:event,pageId:page}});
 mockReplace.mockClear();unmount();act(()=>back());expect(mockReplace).not.toHaveBeenCalled();mockCanBack=true;
});
it('bounds the complete initial read at 12s and only retries explicitly; late payload stays retired',async()=>{
 const pending=deferred<any>();mockLoad.mockReturnValue(pending.promise);mount();await flush();expect(views()).toHaveLength(0);await act(async()=>{jest.advanceTimersByTime(12000);});await flush();expect(words()).toContain('We couldn’t load');expect(mockLoad).toHaveBeenCalledTimes(1);expect(mockLoad.mock.calls[0][2].isCurrent()).toBe(false);mockLoad.mockResolvedValue(data);const again=retry().props.onPress;act(()=>{again();again();});await flush();expect(mockLoad).toHaveBeenCalledTimes(2);expect(words()).toContain('$96.00');pending.resolve({...data,event:{...data.event,title:'Stale event'}});await flush();expect(words()).not.toContain('Stale event');
});
it('retains real earnings during refresh/failure/busy retry and guards previously retained setup/help closures',async()=>{
 mount();await flush();const setup=view().props.onSetup,help=view().props.onSupport;const pending=deferred<any>();mockLoad.mockReturnValue(pending.promise);const again=refresh();act(()=>{again();again();setup();help();});expect(mockPush).not.toHaveBeenCalled();await flush();expect(views()).toHaveLength(1);expect(view().props.disabled).toBe(true);expect(words()).toContain('$96.00');expect(words()).toContain('Showing the last confirmed figures');pending.reject(Error('offline'));await flush();expect(view().props.disabled).toBe(true);expect(words()).toContain('couldn’t be refreshed');act(()=>{setup();help();});expect(mockPush).not.toHaveBeenCalled();const next=deferred<any>();mockLoad.mockReturnValue(next.promise);const retryFn=retry().props.onPress;act(()=>{retryFn();retryFn();});await flush();expect(mockLoad).toHaveBeenCalledTimes(3);expect(retry().props.disabled).toBe(true);expect(words()).toContain('$96.00');next.resolve({...data,ticketsSold:4});await flush();expect(view().props.disabled).toBe(false);expect(words()).toContain('4 tickets sold');expect(words()).not.toContain('Showing the last');
});
it('an authoritative null hides all financial data and refuses old setup/help callbacks',async()=>{
 mount();await flush();const setup=view().props.onSetup,help=view().props.onSupport;mockLoad.mockResolvedValue(null);act(()=>refresh()());await flush();expect(views()).toHaveLength(0);expect(words()).not.toContain('$96.00');expect(words()).toContain('owner and finance team');act(()=>{setup();help();});expect(mockPush).not.toHaveBeenCalled();
});
it.each(['account','event','page','focus','unmount'])('retires pending refresh data, retry and navigation on %s change',async reason=>{
 mount();await flush();const setup=view().props.onSetup,help=view().props.onSupport,again=refresh();const pending=deferred<any>();mockLoad.mockReturnValue(pending.promise);act(()=>again());await flush();if(reason==='unmount')unmount();else{if(reason==='event')mockParams={id:'44444444-4444-4444-8444-444444444444',pageId:page};if(reason==='page')mockParams={id:event,pageId:'55555555-5555-4555-8555-555555555555'};mockScope={userId:reason==='account'?'other':'creator',isCurrent:()=>reason!=='focus'};mockLoad.mockResolvedValue(null);update();await flush();expect(views()).toHaveLength(0);}const calls=mockLoad.mock.calls.length;act(()=>{setup();help();again();});pending.resolve(data);await flush();expect(mockPush).not.toHaveBeenCalled();expect(mockLoad).toHaveBeenCalledTimes(calls);if(reason!=='unmount')expect(views()).toHaveLength(0);
});
it('an old busy retry does not block a new visit’s recovery',async()=>{
 mount();await flush();const pending=deferred<any>();mockLoad.mockReturnValue(pending.promise);act(()=>refresh()());await flush();mockScope={userId:'other',isCurrent:()=>true};mockLoad.mockRejectedValue(Error('offline'));update();await flush();mockLoad.mockResolvedValue({...data,event:{...data.event,title:'Other account event'}});act(()=>retry().props.onPress());await flush();expect(words()).toContain('Other account event');pending.resolve(null);await flush();expect(words()).toContain('Other account event');
});
it('preserves payee-only payout setup and exact existing help/setup routes',async()=>{
 mount();await flush();expect(mockLoad).toHaveBeenCalledWith(event,page,expect.objectContaining({userId:'creator',isCurrent:expect.any(Function)}));const oldSetup=view().props.onSetup;act(()=>{oldSetup();view().props.onSupport();});expect(mockPush.mock.calls).toEqual([['/creator/payouts'],['/creator/help']]);mockPush.mockClear();mockLoad.mockResolvedValue({...data,isPayee:false,payout:undefined});act(()=>refresh()());await flush();act(()=>{oldSetup();view().props.onSetup();view().props.onSupport();});expect(mockPush.mock.calls).toEqual([['/creator/help']]);expect(words()).toContain('The payout recipient manages');
});
it('retries account lookup explicitly and never shows earnings while identity is unavailable',async()=>{
 mockScope=null;mockAccount.error=Error('identity unavailable');mount();await flush();expect(mockLoad).not.toHaveBeenCalled();expect(views()).toHaveLength(0);const pending=deferred<void>();mockAccountRetry.mockReturnValue(pending.promise);const again=retry().props.onPress;act(()=>{again();again();});await flush();expect(mockAccountRetry).toHaveBeenCalledTimes(1);pending.resolve();await flush();
});
it('does not load a missing event or invent zero earnings',async()=>{
 mockParams={};mount();await flush();expect(mockLoad).not.toHaveBeenCalled();expect(words()).toContain('Choose an event');expect(views()).toHaveLength(0);
});
