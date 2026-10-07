import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockGate=jest.fn(),mockMembership=jest.fn(),mockAttempt=jest.fn(),mockCheck=jest.fn(),mockSend=jest.fn(),mockCancel=jest.fn(),mockFinish=jest.fn(),mockClose=jest.fn(),mockConfirmed=jest.fn();
let mockScope:any,mockLive=true,mockLegacy:any=null;
let mockScopesByPage:Record<string,any>|undefined;
jest.mock('../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:(pageId:string)=>({scope:mockScopesByPage?.[pageId] ?? mockScope,account:{isLoading:false,error:null,retry:jest.fn()}})}));
jest.mock('../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:require('../../../constants/Typography').AfterglowFonts})}));
jest.mock('../../../lib/creatorCommunityJoin',()=>({readCreatorCommunityJoinGate:(...a:any[])=>mockGate(...a),readOwnCommunityMembership:(...a:any[])=>mockMembership(...a),readCommunityJoinAttempt:(...a:any[])=>mockAttempt(...a),checkCommunityJoinRequest:(...a:any[])=>mockCheck(...a),sendCommunityJoinRequest:(...a:any[])=>mockSend(...a),cancelCommunityJoinRequest:(...a:any[])=>mockCancel(...a),finishCommunityJoinRequest:(...a:any[])=>mockFinish(...a)}));
jest.mock('../../../lib/communityJoin',()=>({getJoinGate:async()=>mockLegacy}));
jest.mock('../JoinCommunityPopup',()=>({JoinCommunityPopup:(p:any)=>require('react').createElement(require('react-native').View,null,p.flow?.footer)}));
jest.mock('expo-router',()=>({Stack:{Screen:()=>null}}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View}));
import { CommunityJoinEntry } from '../CommunityJoinEntry';
import { JoinCommunityPopup } from '../JoinCommunityPopup';
import { PageAction } from '../../creator/pages/PageFrame';
let tree:ReactTestRenderer,pending:any,receipt:any,membership:any;
const gate={communityId:'page',name:'Sunday Table',creatorPageVersion:2,creatorPagePolicy:'open',askReason:true};
const answer={first_name:'Juniper',last_name:'Test',email:'private@example.invalid',zip:'90026',intro_answer:'Hello',guidelines_accepted:true,reason_answer:'A reason'};
const props={communityId:'page',visible:true,legacyJoinsInstantly:false,onClose:mockClose,onConfirmed:mockConfirmed};
const form=()=>tree.root.findByType(JoinCommunityPopup), action=(title:string)=>tree.root.findAllByType(PageAction).find(n=>n.props.title===title);
const text=()=>JSON.stringify(tree.toJSON());
async function mount(p=props){await act(async()=>{tree=create(<CommunityJoinEntry {...p}/>);});}
async function press(title:string){await act(async()=>{action(title)!.props.onPress();});}
async function submit(){await act(async()=>{await form().props.flow.submit(answer);});}
beforeEach(()=>{jest.clearAllMocks();mockScopesByPage=undefined;mockLive=true;mockScope={userId:'member',isCurrent:()=>mockLive};mockLegacy=null;pending=null;receipt=null;membership=null;
 mockGate.mockImplementation(async()=>gate);mockMembership.mockImplementation(async()=>membership);mockAttempt.mockImplementation(async()=>pending);mockCheck.mockImplementation(async()=>receipt);
 mockSend.mockImplementation(async()=>{pending={id:'request'};receipt={outcome:'submitted',current_status:'active'};return receipt;});
 mockCancel.mockImplementation(async()=>{receipt={outcome:'cancelled',current_status:null};return receipt;});mockFinish.mockImplementation(async()=>{pending=null;return receipt;});});
afterEach(async()=>{if(tree)await act(async()=>tree.unmount());jest.useRealTimers();});
it('loads the exact page questions and enables the shared form controller',async()=>{await mount();expect(form().props.gate).toEqual(gate);expect(form().props.joinsInstantly).toBe(true);expect(form().props.flow.locked).toBe(false);expect(mockSend).not.toHaveBeenCalled();});
it('a failed questions read shows retry instead of a form with missing required inputs',async()=>{mockGate.mockRejectedValueOnce(Error('Questions unavailable'));await mount();expect(tree.root.findAllByType(JoinCommunityPopup)).toHaveLength(0);expect(text()).toContain('Questions unavailable');await press('Try again');expect(form().props.gate).toEqual(gate);});
it('successful admission stays confirmed until explicit Continue refreshes the community',async()=>{await mount();await submit();expect(form().props.flow.locked).toBe(true);expect(form().props.flow.message).toContain('confirmed');expect(mockConfirmed).not.toHaveBeenCalled();await press('Continue');expect(mockFinish).toHaveBeenCalled();expect(mockConfirmed).toHaveBeenCalledTimes(1);});
it('lost response preserves the same-request recovery controls and does not claim joining',async()=>{mockSend.mockImplementationOnce(async()=>{pending={id:'request'};throw Error('Unconfirmed');});await mount();await submit();expect(form().props.flow.locked).toBe(true);expect(form().props.flow.message).toContain('Unconfirmed');expect(action('Check request status')).toBeDefined();expect(action('Retry same request')).toBeDefined();expect(mockConfirmed).not.toHaveBeenCalled();});
it('cold return offers check/cancel without retaining private contact or sending automatically',async()=>{pending={id:'request'};await mount();expect(form().props.flow.locked).toBe(true);expect(action('Check request status')).toBeDefined();expect(action('Retry same request')).toBeUndefined();expect(mockSend).not.toHaveBeenCalled();});
it('read-only recovery displays the actual pending result',async()=>{pending={id:'request'};await mount();receipt={outcome:'submitted',current_status:'pending'};await press('Check request status');expect(mockCheck).toHaveBeenCalledTimes(2);expect(mockSend).not.toHaveBeenCalled();expect(form().props.flow.message).toContain('waiting for review');});
it('cancelled request requires explicit review before returning to editable questions',async()=>{pending={id:'request'};receipt={outcome:'cancelled',current_status:null};await mount();expect(form().props.flow.locked).toBe(true);await press('Review questions');expect(mockFinish).toHaveBeenCalled();expect(form().props.flow.locked).toBe(false);expect(mockGate).toHaveBeenCalledTimes(2);expect(mockSend).not.toHaveBeenCalled();});
it('another account cannot inherit old questions, pending recovery or private form values',async()=>{pending={id:'request'};await mount();mockScope={userId:'other',isCurrent:()=>true};mockGate.mockRejectedValue(Error('Unavailable for this account'));await act(async()=>{tree.update(<CommunityJoinEntry {...props}/>);});expect(tree.root.findAllByType(JoinCommunityPopup)).toHaveLength(0);expect(text()).not.toContain('Sunday Table');});
it('closing during dispatch leaves the receipt recoverable without a stale completion callback',async()=>{let resolve:any;mockSend.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));await mount();let send:Promise<void>;await act(async()=>{send=form().props.flow.submit(answer);});await act(async()=>{tree.update(<CommunityJoinEntry {...props} visible={false}/>);});await act(async()=>{pending={id:'request'};resolve({outcome:'submitted',current_status:'active'});await send!;});expect(mockConfirmed).not.toHaveBeenCalled();expect(mockFinish).not.toHaveBeenCalled();});
it('legacy communities reuse the existing form without enabling the new request protocol',async()=>{mockGate.mockResolvedValue(null);mockLegacy={communityId:'page',name:'Existing community'};await mount();expect(form().props.flow).toBeUndefined();expect(form().props.gate).toEqual(mockLegacy);expect(mockSend).not.toHaveBeenCalled();});

it('failed question refresh after cancellation keeps status recovery instead of reopening stale questions',async()=>{pending={id:'request'};receipt={outcome:'cancelled',current_status:null};await mount();mockGate.mockRejectedValueOnce(Error('Questions unavailable'));await press('Review questions');expect(form().props.flow.locked).toBe(true);expect(action('Review questions')).toBeDefined();expect(mockSend).not.toHaveBeenCalled();await press('Review questions');expect(form().props.flow.locked).toBe(false);});

it('returning to a community keeps retained request recovery reachable outside the modal',async()=>{pending={id:'request'};const open=jest.fn();await mount({...props,visible:false,onOpen:open} as typeof props);expect(action('Check joining request')).toBeDefined();await press('Check joining request');expect(open).toHaveBeenCalledTimes(1);expect(mockGate).not.toHaveBeenCalled();expect(mockSend).not.toHaveBeenCalled();});

it('stale question versions offer one safe review action instead of an impossible same-request retry',async()=>{mockSend.mockImplementationOnce(async()=>{pending={id:'request'};throw {code:'PT409',message:'Questions changed'};});await mount();await submit();expect(action('Retry same request')).toBeUndefined();expect(action('Review updated questions')).toBeDefined();await press('Review updated questions');expect(mockCancel).toHaveBeenCalled();expect(mockFinish).toHaveBeenCalled();expect(form().props.flow.locked).toBe(false);expect(mockGate).toHaveBeenCalledTimes(2);expect(mockSend).toHaveBeenCalledTimes(1);});
it('reviewing changed questions preserves admission if another request already committed',async()=>{mockSend.mockImplementationOnce(async()=>{pending={id:'request'};throw {code:'PT409',message:'Questions changed'};});mockCancel.mockResolvedValueOnce({outcome:'submitted',current_status:'active'});await mount();await submit();await press('Review updated questions');expect(form().props.flow.message).toContain('confirmed');expect(mockFinish).not.toHaveBeenCalled();expect(action('Continue')).toBeDefined();});


function deferred<T=any>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes});return{promise,resolve};}
async function clock(ms=12_001){await act(async()=>{jest.advanceTimersByTime(ms);for(let i=0;i<20;i++)await Promise.resolve();});}
it('ends a stalled opening questions read with Retry and ignores its late result',async()=>{
 jest.useFakeTimers();const waiting=deferred();mockGate.mockReturnValueOnce(waiting.promise);await mount();
 await clock();expect(text()).not.toContain('Loading joining questions');expect(text()).toContain('took too long');
 await press('Try again');expect(form().props.gate).toEqual(gate);const reads=mockAttempt.mock.calls.length;
 await act(async()=>waiting.resolve({...gate,name:'Old late gate'}));expect(form().props.gate.name).toBe('Sunday Table');expect(mockAttempt).toHaveBeenCalledTimes(reads);
});
it.each([null,{outcome:'submitted',current_status:'pending'}])('ends stalled final storage without erasing known receipt %j',async known=>{
 jest.useFakeTimers();pending={id:'request'};await mount();mockCheck.mockResolvedValueOnce(known);const storage=deferred();mockAttempt.mockReturnValueOnce(storage.promise);
 await press('Check request status');expect(form().props.flow.busy).toBe(true);await clock();
 expect(form().props.flow.busy).toBe(false);expect(form().props.flow.locked).toBe(true);
 if(known){expect(form().props.flow.message).toContain('waiting for review');expect(action('Continue')!.props.disabled).toBe(false);}
 else expect(action('Check request status')!.props.disabled).toBe(false);
 expect(mockSend).not.toHaveBeenCalled();expect(mockCancel).not.toHaveBeenCalled();
 await act(async()=>storage.resolve(null));expect(form().props.flow.locked).toBe(true);
});

it('ends a stalled Check without a new send and ignores its late receipt after an explicit new Check',async()=>{
 jest.useFakeTimers();pending={id:'request'};await mount();const waiting=deferred();mockCheck.mockReturnValueOnce(waiting.promise);
 await press('Check request status');await clock();expect(form().props.flow.busy).toBe(false);expect(form().props.flow.locked).toBe(true);expect(action('Check request status')!.props.disabled).toBe(false);
 expect(mockCheck.mock.calls[1][1].isCurrent()).toBe(false);expect(mockSend).not.toHaveBeenCalled();
 mockCheck.mockResolvedValueOnce({outcome:'submitted',current_status:'pending'});await press('Check request status');expect(form().props.flow.message).toContain('waiting for review');
 await act(async()=>waiting.resolve({outcome:'submitted',current_status:'active'}));expect(form().props.flow.message).toContain('waiting for review');expect(mockConfirmed).not.toHaveBeenCalled();
});
it('retains the UI lock until final storage settles or times out',async()=>{
 jest.useFakeTimers();pending={id:'request'};await mount();const storage=deferred();mockAttempt.mockReturnValueOnce(storage.promise);const check=action('Check request status')!.props.onPress;
 await act(async()=>check());const reads=mockCheck.mock.calls.length;await act(async()=>check());expect(mockCheck).toHaveBeenCalledTimes(reads);
 await clock();await press('Check request status');expect(mockCheck).toHaveBeenCalledTimes(reads+1);
 await act(async()=>storage.resolve(null));expect(form().props.flow.locked).toBe(true);
});
it('a timed-out send with no readable marker remains unconfirmed until an explicit read resolves it',async()=>{
 jest.useFakeTimers();const sending=deferred();mockSend.mockReturnValueOnce(sending.promise);await mount();let work!:Promise<void>;
 await act(async()=>{work=form().props.flow.submit(answer)});await clock();await act(async()=>{await work});
 expect(form().props.flow.locked).toBe(true);expect(form().props.flow.busy).toBe(false);expect(action('Check request status')).toBeDefined();expect(mockSend).toHaveBeenCalledTimes(1);
 await act(async()=>sending.resolve({outcome:'submitted',current_status:'active'}));expect(form().props.flow.message).not.toContain('membership is confirmed');expect(mockConfirmed).not.toHaveBeenCalled();
 pending={id:'request'};mockCheck.mockResolvedValueOnce({outcome:'submitted',current_status:'pending'});await press('Check request status');expect(form().props.flow.message).toContain('waiting for review');expect(mockSend).toHaveBeenCalledTimes(1);
});
it('does not replace original retry answers through a retained duplicate Submit during a pending operation',async()=>{
 jest.useFakeTimers();const sending=deferred();mockSend.mockImplementationOnce(()=>{pending={id:'request'};return sending.promise});await mount();const submit=form().props.flow.submit;let first!:Promise<void>;
 await act(async()=>{first=submit(answer)});await act(async()=>submit({...answer,intro_answer:'Different duplicate'}));expect(mockSend).toHaveBeenCalledTimes(1);
 await clock();await act(async()=>{await first});await press('Retry same request');expect(mockSend.mock.calls[1][1]).toEqual(answer);
 await act(async()=>sending.resolve(null));
});
it('a final storage result cannot update a new account form',async()=>{
 pending={id:'request'};await mount();const storage=deferred();mockAttempt.mockReturnValueOnce(storage.promise);await press('Check request status');
 mockScope={userId:'other',isCurrent:()=>true};pending=null;await act(async()=>tree.update(<CommunityJoinEntry {...props}/>));expect(form().props.flow.locked).toBe(false);
 await act(async()=>storage.resolve({id:'old-request'}));expect(form().props.flow.locked).toBe(false);expect(action('Check request status')).toBeUndefined();
});
it('keeps retained request recovery reachable after its hidden local read times out',async()=>{
 jest.useFakeTimers();mockAttempt.mockReturnValueOnce(new Promise(()=>{}));const open=jest.fn();await mount({...props,visible:false,onOpen:open} as typeof props);
 await clock();expect(action('Check joining request')).toBeDefined();await press('Check joining request');expect(open).toHaveBeenCalledTimes(1);expect(mockSend).not.toHaveBeenCalled();
});


it.each(['Close','Check request status','Retry same request'] as const)('keeps committed %s usable with exact original answers during a suspended alternate-page render',async mode=>{
 const never=new Promise(()=>{});function Suspended({pending}:{pending:boolean}){if(pending)throw never;return null;}
 const render=(other:boolean)=><React.Suspense fallback={null}><CommunityJoinEntry {...props} communityId={other?'other-page':'page'}/><Suspended pending={other}/></React.Suspense>;
 mockScopesByPage={'community-admission:page':mockScope,'community-admission:other-page':{userId:'member',isCurrent:()=>true}};
 if(mode==='Check request status')pending={id:'original-request'};
 if(mode==='Retry same request')mockSend.mockImplementationOnce(async()=>{pending={id:'original-request'};throw Error('Lost acknowledgement')});
 await act(async()=>{tree=create(render(false))});
 if(mode==='Retry same request')await submit();
 const originalForm=form(),callback=mode==='Close'?originalForm.props.onClose:action(mode)!.props.onPress;
 const checks=mockCheck.mock.calls.length;
 await act(async()=>{React.startTransition(()=>tree.update(render(true)))});
 expect(form()).toBe(originalForm);expect(mode==='Close'?form().props.onClose:action(mode)!.props.onPress).toBe(callback);
 await act(async()=>callback());
 if(mode==='Close')expect(mockClose).toHaveBeenCalledTimes(1);
 if(mode==='Check request status'){expect(mockCheck).toHaveBeenCalledTimes(checks+1);expect(mockCheck.mock.calls.at(-1)[0]).toBe('page');}
 if(mode==='Retry same request'){expect(mockSend).toHaveBeenCalledTimes(2);expect(mockSend.mock.calls[1][0]).toBe(gate);expect(mockSend.mock.calls[1][1]).toEqual(answer);expect(mockSend.mock.calls[1][2].userId).toBe('member');}
});


it.each(['Close','Check request status','Retry same request'] as const)('retires retained %s after a committed page/account/visibility round trip',async mode=>{
 if(mode==='Check request status')pending={id:'original-request'};
 if(mode==='Retry same request')mockSend.mockImplementationOnce(async()=>{pending={id:'original-request'};throw Error('Lost acknowledgement')});
 await mount();if(mode==='Retry same request')await submit();
 const originalScope=mockScope,callbacks=()=>mode==='Close'?form().props.onClose:action(mode)!.props.onPress;
 const old=callbacks(),checks=mockCheck.mock.calls.length,sends=mockSend.mock.calls.length;
 mockScope={userId:'other',isCurrent:()=>true};await act(async()=>tree.update(<CommunityJoinEntry {...props} communityId="other-page" visible={false}/>));
 mockScope=originalScope;await act(async()=>tree.update(<CommunityJoinEntry {...props}/>));
 const readChecks=mockCheck.mock.calls.length;
 await act(async()=>old());expect(mockClose).not.toHaveBeenCalled();expect(mockSend).toHaveBeenCalledTimes(sends);expect(mockCheck).toHaveBeenCalledTimes(readChecks);
 if(mode==='Retry same request'){expect(action('Retry same request')).toBeUndefined();expect(action('Check request status')).toBeDefined();}
 expect(readChecks).toBeGreaterThanOrEqual(checks);
});
it.each(['Close','Check request status','Retry same request'] as const)('immediately retires %s when the observed account scope expires before rerender',async mode=>{
 if(mode==='Check request status')pending={id:'original-request'};
 if(mode==='Retry same request')mockSend.mockImplementationOnce(async()=>{pending={id:'original-request'};throw Error('Lost acknowledgement')});
 await mount();if(mode==='Retry same request')await submit();const old=mode==='Close'?form().props.onClose:action(mode)!.props.onPress;
 const checks=mockCheck.mock.calls.length,sends=mockSend.mock.calls.length;mockLive=false;await act(async()=>old());
 expect(mockClose).not.toHaveBeenCalled();expect(mockCheck).toHaveBeenCalledTimes(checks);expect(mockSend).toHaveBeenCalledTimes(sends);
});
it('keeps same-request answers after a speculative hidden render is abandoned',async()=>{
 const never=new Promise(()=>{});function Suspended({pending}:{pending:boolean}){if(pending)throw never;return null;}
 const render=(hidden:boolean)=><React.Suspense fallback={null}><CommunityJoinEntry {...props} visible={!hidden}/><Suspended pending={hidden}/></React.Suspense>;
 mockSend.mockImplementationOnce(async()=>{pending={id:'original-request'};throw Error('Lost acknowledgement')});
 await act(async()=>{tree=create(render(false))});await submit();const original=form(),retry=action('Retry same request')!.props.onPress;
 await act(async()=>{React.startTransition(()=>tree.update(render(true)))});expect(form()).toBe(original);
 await act(async()=>retry());expect(mockSend).toHaveBeenCalledTimes(2);expect(mockSend.mock.calls[1][1]).toEqual(answer);expect(mockSend.mock.calls[1][0]).toBe(gate);
});
