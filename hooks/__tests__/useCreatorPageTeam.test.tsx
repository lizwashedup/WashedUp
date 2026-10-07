import React from 'react';import { act, create } from 'react-test-renderer';import { AppState } from 'react-native';
import { useCreatorPageTeam } from '../useCreatorPageTeam';
import * as api from '../../lib/creatorPageTeam';
const mockStorage=new Map<string,string>(),mockGet=jest.fn(),mockSet=jest.fn(),mockListeners=new Set<(v:string)=>void>();let mockForeground='active';
let mockScope:{userId:string;isCurrent:()=>boolean};
jest.mock('../useCreatorPageScope',()=>({useCreatorPageScope:()=>({scope:mockScope,account:{viewerId:mockScope.userId,error:null,isLoading:false}})}));
jest.mock('@react-native-async-storage/async-storage',()=>({__esModule:true,default:{getItem:(...a:unknown[])=>mockGet(...a),setItem:(...a:unknown[])=>mockSet(...a)}}));
jest.mock('expo-crypto',()=>({randomUUID:()=> '0f710000-0000-4000-8000-000000000001'}));
jest.mock('../../lib/creatorPageTeam',()=>({...jest.requireActual('../../lib/creatorPageTeam'),changePageTeamAccess:jest.fn(),getPageTeamAccessChange:jest.fn(),createPageTeamInvitationWithPermissions:jest.fn(),findPageTeamRecipient:jest.fn(),getPageTeam:jest.fn(),getPageTeamInvitation:jest.fn(),getPageTeamInvitationAttempt:jest.fn(),getPageTeamRecipient:jest.fn(),resolvePageTeamInvitation:jest.fn()}));
const page='774c2329-e22e-4113-8a2a-67ca854dd2c9',owner='0e6e1827-0f87-4e03-b42b-7ade8219725b',recipient='753c5b17-ca8d-431f-ad8f-0d9b70c0dccb',id='0f710000-0000-4000-8000-000000000001';
const person={pageId:page,userId:recipient,name:'Cedar',photoUrl:null};const invitation={permissions:['page_content'],currentPermissions:null,accessRevokedAt:null,invitationId:id,pageId:page,pageKind:'community',pageName:'Community',inviterId:owner,recipientId:recipient,role:'co_creator',status:'pending',createdAt:'2026-09-15T00:00:00Z',expiresAt:'2026-09-18T00:00:00Z',resolvedAt:null,assignmentId:null,note:'Hello',inviterName:'Aster',recipientName:'Cedar'} as api.PageTeamInvitation;
const roster={pageId:page,pageKind:'community',pageName:'Community',ownerId:owner,ownerName:'Aster',canInvite:true,assignments:[],legacyMembers:[],invitations:[]} as api.PageTeamRoster;
const write=jest.mocked(api.createPageTeamInvitationWithPermissions),resolve=jest.mocked(api.resolvePageTeamInvitation),check=jest.mocked(api.getPageTeamInvitationAttempt),read=jest.mocked(api.getPageTeam);
const cleanup:Array<()=>void>=[];async function flush(){for(let n=0;n<5;n++)await act(async()=>{await new Promise(r=>setTimeout(r,0));});}
function nextScope(userId:string){const result={userId,isCurrent:()=>mockScope===result};mockScope=result;}
function mount(invitationId?:string){let value!:ReturnType<typeof useCreatorPageTeam>,tree!:ReturnType<typeof create>;function Harness(){value=useCreatorPageTeam(page,invitationId);return null;}act(()=>{tree=create(<Harness/>);});let closed=false;const close=()=>{if(!closed){act(()=>tree.unmount());closed=true;}};cleanup.push(close);return{get value(){return value;},close,account:(uid:string)=>{nextScope(uid);act(()=>tree.update(<Harness/>));}};}
async function reviewed(f:ReturnType<typeof mount>){await flush();act(()=>f.value.startInvite());act(()=>f.value.setHandle('cedar'));await act(async()=>{await f.value.lookup();});act(()=>f.value.setNote('Hello'));act(()=>f.value.togglePermission('page_content'));await act(async()=>{await f.value.review();});expect(f.value.step).toBe('review');}
beforeEach(()=>{jest.resetAllMocks();mockStorage.clear();mockListeners.clear();mockForeground='active';jest.spyOn(AppState,'addEventListener').mockImplementation((_e,fn)=>{mockListeners.add(fn as (v:string)=>void);return{remove:()=>mockListeners.delete(fn as (v:string)=>void)};});nextScope(owner);mockGet.mockImplementation(async k=>mockStorage.get(k)??null);mockSet.mockImplementation(async(k,v)=>{mockStorage.set(k,v);});read.mockResolvedValue(roster);jest.mocked(api.findPageTeamRecipient).mockResolvedValue(person);jest.mocked(api.getPageTeamRecipient).mockResolvedValue(person);jest.mocked(api.getPageTeamInvitation).mockResolvedValue(invitation);write.mockResolvedValue(invitation);resolve.mockResolvedValue({...invitation,status:'accepted',assignmentId:recipient,resolvedAt:'2026-09-15T01:00:00Z'});check.mockResolvedValue(null);});
afterEach(async()=>{cleanup.splice(0).forEach(f=>f());jest.useRealTimers();await flush();});
it('requires reviewed current recipient and persists before a single rapid-tap write',async()=>{const f=mount();await reviewed(f);await act(async()=>{await Promise.all([f.value.create(),f.value.create()]);});expect(write).toHaveBeenCalledTimes(1);expect(mockSet.mock.invocationCallOrder.some(n=>n<write.mock.invocationCallOrder[0])).toBe(true);expect(f.value.recoveryRequired).toBe(false);expect((f.value.result as api.PageTeamInvitation)?.status).toBe('pending');});
it('does not dispatch from the editable invitation form before review',async()=>{const f=mount();await flush();act(()=>f.value.startInvite());await act(async()=>{await f.value.create();});expect(write).not.toHaveBeenCalled();});
it('reopens unknown creation for read-only checking without replay',async()=>{write.mockRejectedValue(Error('Lost response'));const first=mount();await reviewed(first);await act(async()=>{await first.value.create();});expect(first.value.recoveryRequired).toBe(true);first.close();const second=mount();await flush();expect(second.value.recoveryRequired).toBe(true);expect(write).toHaveBeenCalledTimes(1);expect(check).not.toHaveBeenCalled();check.mockResolvedValue(invitation);await act(async()=>{await second.value.check();});expect(write).toHaveBeenCalledTimes(1);expect(second.value.recoveryRequired).toBe(false);});
it('checks absent creation before permitting one explicit retry of original note and ID',async()=>{write.mockRejectedValueOnce(Error('Offline'));const f=mount();await reviewed(f);await act(async()=>{await f.value.create();await f.value.retry();});expect(write).toHaveBeenCalledTimes(1);await act(async()=>{await f.value.check();});expect(f.value.retryReady).toBe(true);act(()=>f.value.setNote('Changed'));await act(async()=>{await f.value.retry();});expect(write).toHaveBeenCalledTimes(2);expect(write.mock.calls[1].slice(0,4)).toEqual([page,id,recipient,'Hello']);});
it('failed rechecking revokes previously offered retry',async()=>{write.mockRejectedValue(Error('Offline'));const f=mount();await reviewed(f);await act(async()=>{await f.value.create();await f.value.check();});expect(f.value.retryReady).toBe(true);check.mockRejectedValue(Error('Still offline'));await act(async()=>{await f.value.check();await f.value.retry();});expect(f.value.retryReady).toBe(false);expect(write).toHaveBeenCalledTimes(1);});
it('lost local preparation response enters recovery without dispatching or retargeting',async()=>{const f=mount();await reviewed(f);mockSet.mockImplementationOnce(async(k,v)=>{mockStorage.set(k,v);});mockSet.mockImplementationOnce(async(k,v)=>{mockStorage.set(k,v);throw Error('Storage response lost');});await act(async()=>{await f.value.create();});expect(f.value.recoveryRequired).toBe(true);expect(write).not.toHaveBeenCalled();await act(async()=>{await f.value.check();await f.value.retry();});expect(write).toHaveBeenCalledTimes(1);});
it('background return re-reads saved recovery and never resends automatically',async()=>{write.mockRejectedValue(Error('Lost'));const f=mount();await reviewed(f);await act(async()=>{await f.value.create();});act(()=>{mockForeground='background';mockListeners.forEach(fn=>fn(mockForeground));});await act(async()=>{await f.value.retry();await f.value.check();});expect(check).not.toHaveBeenCalled();act(()=>{mockForeground='active';mockListeners.forEach(fn=>fn(mockForeground));});await flush();expect(f.value.recoveryRequired).toBe(true);expect(write).toHaveBeenCalledTimes(1);});
it('late account-owned success preserves the original account’s recovery instead of clearing another visit',async()=>{let finish!:(v:api.PageTeamInvitation)=>void;write.mockReturnValue(new Promise(r=>{finish=r;}));const f=mount();await reviewed(f);let pending:unknown;act(()=>{pending=f.value.create();});await flush();f.account(recipient);await act(async()=>{finish(invitation);await pending;});expect(f.value.result).toBeNull();expect([...mockStorage.entries()].find(([k])=>k.includes(owner))?.[1]).toContain('"operationId"');});
it('recipient response survives reopening and resolves actual terminal outcome without replay',async()=>{nextScope(recipient);resolve.mockRejectedValue(Error('Lost'));const first=mount(id);await flush();await act(async()=>{await first.value.respond(invitation,'accept');});first.close();const second=mount(id);await flush();expect(resolve).toHaveBeenCalledTimes(1);jest.mocked(api.getPageTeamInvitation).mockResolvedValue({...invitation,status:'declined',resolvedAt:'2026-09-15T01:00:00Z'});await act(async()=>{await second.value.check();});expect((second.value.result as api.PageTeamInvitation)?.status).toBe('declined');expect(second.value.recoveryRequired).toBe(false);expect(resolve).toHaveBeenCalledTimes(1);});
it('unavailable refreshed team metadata is hidden rather than treated as an empty roster',async()=>{const f=mount();await flush();read.mockRejectedValue(Error('Unavailable'));await act(async()=>{await f.value.refresh();});expect(f.value.roster).toBeNull();expect(f.value.readError).toBeTruthy();expect(f.value.ready).toBe(false);});

it('reopening a draft rechecks its recipient before labeling them eligible',async()=>{const first=mount();await reviewed(first);first.close();jest.mocked(api.getPageTeamRecipient).mockRejectedValue({code:'42501'});const second=mount();await flush();expect(second.value.draft.person).toBeNull();expect(second.value.draft.note).toBe('Hello');expect(write).not.toHaveBeenCalled();});
it('permission loss during review hides cached page metadata and retains entered text',async()=>{const f=mount();await reviewed(f);jest.mocked(api.getPageTeamRecipient).mockRejectedValue({code:'42501'});await act(async()=>{await f.value.create();});expect(f.value.roster).toBeNull();expect(f.value.readError).toContain('no longer available');expect(f.value.draft.note).toBe('Hello');expect(write).not.toHaveBeenCalled();});

const assignment:api.PageTeamAssignment={assignmentId:id,userId:recipient,invitationId:id,acceptedAt:'2026-09-15T01:00:00Z',role:'co_creator',available:true,name:'Cedar',permissions:['page_content'],revision:1,revokedAt:null};
const changed:api.PageTeamAccessChange={requestId:id,pageId:page,ownerId:owner,assignmentId:id,userId:recipient,expectedRevision:1,revision:2,action:'edit',permissions:['page_events'],revokedAt:null};
async function accessReviewed(f:ReturnType<typeof mount>){await flush();act(()=>f.value.startAccessChange(assignment,'edit'));act(()=>f.value.togglePermission('page_content'));act(()=>f.value.togglePermission('page_events'));act(()=>f.value.reviewAccess());expect(f.value.step).toBe('review_access');}
it('requires a permission selection before owner invitation review',async()=>{
 const f=mount();await flush();act(()=>f.value.startInvite());act(()=>f.value.setHandle('cedar'));await act(async()=>{await f.value.lookup();await f.value.review();});expect(f.value.draft.permissions).toEqual([]);expect(f.value.step).toBe('invite');expect(write).not.toHaveBeenCalled();
});
it('saves a versioned owner edit once after explicit review and rapid repeated taps',async()=>{
 read.mockResolvedValue({...roster,assignments:[assignment]});jest.mocked(api.changePageTeamAccess).mockResolvedValue(changed);const f=mount();await accessReviewed(f);
 expect(api.changePageTeamAccess).not.toHaveBeenCalled();await act(async()=>{await Promise.all([f.value.saveAccess(),f.value.saveAccess()]);});
 expect(api.changePageTeamAccess).toHaveBeenCalledTimes(1);expect(api.changePageTeamAccess).toHaveBeenCalledWith(page,id,assignment,'edit',['page_events'],expect.anything());expect(f.value.recoveryRequired).toBe(false);
});
it('reopens an unknown owner edit with read-only resolution and no replay',async()=>{
 read.mockResolvedValue({...roster,assignments:[assignment]});jest.mocked(api.changePageTeamAccess).mockRejectedValue(Error('Lost'));jest.mocked(api.getPageTeamAccessChange).mockResolvedValue(changed);
 const first=mount();await accessReviewed(first);await act(async()=>{await first.value.saveAccess();});first.close();const second=mount();await flush();expect(second.value.recoveryRequired).toBe(true);
 await act(async()=>{await second.value.check();});expect(api.changePageTeamAccess).toHaveBeenCalledTimes(1);expect(second.value.recoveryRequired).toBe(false);expect(second.value.result).toEqual(changed);
});
it('stale rejected owner edit is cleared only after fresh read proves the version changed',async()=>{
 read.mockResolvedValue({...roster,assignments:[assignment]});jest.mocked(api.changePageTeamAccess).mockRejectedValue(new api.PageTeamConflictError());jest.mocked(api.getPageTeamAccessChange).mockResolvedValue(null);
 const f=mount();await accessReviewed(f);await act(async()=>{await f.value.saveAccess();});read.mockResolvedValue({...roster,assignments:[{...assignment,revision:2}]});
 await act(async()=>{await f.value.check();});expect(f.value.recoveryRequired).toBe(false);expect(f.value.retryReady).toBe(false);expect(f.value.notice).toContain('changed elsewhere');expect(api.changePageTeamAccess).toHaveBeenCalledTimes(1);
});
it('failed owner-change recovery does not enable retry or erase the pending change',async()=>{
 read.mockResolvedValue({...roster,assignments:[assignment]});jest.mocked(api.changePageTeamAccess).mockRejectedValue(Error('Lost'));jest.mocked(api.getPageTeamAccessChange).mockRejectedValue(Error('Offline'));
 const f=mount();await accessReviewed(f);await act(async()=>{await f.value.saveAccess();await f.value.check();});expect(f.value.recoveryRequired).toBe(true);expect(f.value.retryReady).toBe(false);expect(f.value.operation?.kind).toBe('access');
});

async function tick(ms=0){await act(async()=>{await jest.advanceTimersByTimeAsync(ms);});}
it('releases a stalled first roster read, recovers explicitly and ignores its late result',async()=>{
 jest.useFakeTimers();let finish!:(v:api.PageTeamRoster)=>void;
 read.mockReturnValueOnce(new Promise(r=>{finish=r;}));const f=mount();await tick();
 expect(f.value.busy).toBe(true);await tick(12000);
 expect(f.value.busy).toBe(false);expect(f.value.readError).toBeTruthy();
 await act(async()=>{await f.value.refresh();});expect(f.value.roster).toEqual(roster);
 await act(async()=>finish({...roster,pageName:'Obsolete page response'}));expect(f.value.roster?.pageName).toBe('Community');
 f.close();jest.useRealTimers();
});
it('retires a stalled recipient preflight before it can prepare or send an invitation',async()=>{
 const f=mount();await reviewed(f);jest.useFakeTimers();let finish!:(v:typeof person)=>void;
 jest.mocked(api.getPageTeamRecipient).mockReturnValueOnce(new Promise(r=>{finish=r;}));
 let pending:unknown;act(()=>{pending=f.value.create();});await tick(25000);
 expect(f.value.busy).toBe(false);expect(f.value.draft.note).toBe('Hello');expect(write).not.toHaveBeenCalled();
 await act(async()=>{finish(person);await pending;});expect(write).not.toHaveBeenCalled();expect(f.value.operation).toBeNull();
 f.close();jest.useRealTimers();
});
it('keeps an unconfirmed invitation and makes a stalled status check retryable without another send',async()=>{
 const f=mount();await reviewed(f);jest.useFakeTimers();let finish!:(v:api.PageTeamInvitation)=>void;
 write.mockReturnValueOnce(new Promise(r=>{finish=r;}));act(()=>{void f.value.create();});await tick();await tick(25000);
 expect(f.value.busy).toBe(false);expect(f.value.recoveryRequired).toBe(true);expect(f.value.operation?.operationId).toBe(id);
 check.mockReturnValueOnce(new Promise(()=>{}));act(()=>{void f.value.check();});await tick(12000);
 expect(f.value.busy).toBe(false);expect(f.value.retryReady).toBe(false);expect(write).toHaveBeenCalledTimes(1);
 check.mockResolvedValue(invitation);await act(async()=>{await f.value.check();});expect(f.value.result).toEqual(invitation);expect(f.value.recoveryRequired).toBe(false);
 await act(async()=>finish({...invitation,status:'declined'}));expect(f.value.result).toEqual(invitation);expect(write).toHaveBeenCalledTimes(1);
 f.close();jest.useRealTimers();
});
it('keeps confirmed receipt wording if local cleanup stalls after the invitation saved',async()=>{
 const f=mount();await reviewed(f);jest.useFakeTimers();let finish!:()=>void;
 mockSet.mockImplementation(async(k,v)=>{if(JSON.parse(v).operation===null&&JSON.parse(v).draft.handle==='')await new Promise<void>(r=>{finish=r;});mockStorage.set(k,v);});
 act(()=>{void f.value.create();});await tick();await tick(25000);
 expect(f.value.busy).toBe(false);expect(f.value.result).toEqual(invitation);expect(f.value.notice).toContain('Invitation saved');expect(f.value.error).toContain('outcome is saved');
 expect(f.value.recoveryRequired).toBe(true);expect(write).toHaveBeenCalledTimes(1);
 await act(async()=>finish());f.close();jest.useRealTimers();
});
it('a backgrounded recipient check cannot resume an invitation after returning',async()=>{
 const f=mount();await reviewed(f);let finish!:(v:typeof person)=>void;
 jest.mocked(api.getPageTeamRecipient).mockReturnValueOnce(new Promise(r=>{finish=r;}));let pending:unknown;
 act(()=>{pending=f.value.create();});await flush();act(()=>mockListeners.forEach(fn=>fn('background')));act(()=>mockListeners.forEach(fn=>fn('active')));await flush();
 expect(f.value.busy).toBe(false);await act(async()=>{finish(person);await pending;});expect(write).not.toHaveBeenCalled();expect(f.value.operation).toBeNull();
});
it('retains a stalled access change and checks the exact revision receipt before another change',async()=>{
 read.mockResolvedValue({...roster,assignments:[assignment]});const f=mount();await accessReviewed(f);jest.useFakeTimers();
 jest.mocked(api.changePageTeamAccess).mockReturnValueOnce(new Promise(()=>{}));act(()=>{void f.value.saveAccess();});await tick();await tick(25000);
 expect(f.value.busy).toBe(false);expect(f.value.operation?.kind).toBe('access');expect(f.value.retryReady).toBe(false);
 jest.mocked(api.getPageTeamAccessChange).mockResolvedValue(changed);await act(async()=>{await f.value.check();});expect(f.value.result).toEqual(changed);expect(f.value.recoveryRequired).toBe(false);expect(api.changePageTeamAccess).toHaveBeenCalledTimes(1);
 f.close();jest.useRealTimers();
});
it('a stalled acceptance retains the original invitation and resolves its outcome without accepting twice',async()=>{
 nextScope(recipient);const f=mount(id);await flush();jest.useFakeTimers();resolve.mockReturnValueOnce(new Promise(()=>{}));
 act(()=>{void f.value.respond(invitation,'accept');});await tick();await tick(25000);expect(f.value.busy).toBe(false);expect(f.value.operation?.kind).toBe('respond');
 const accepted={...invitation,status:'accepted' as const,assignmentId:recipient,resolvedAt:'2026-09-15T01:00:00Z'};
 jest.mocked(api.getPageTeamInvitation).mockResolvedValue(accepted);await act(async()=>{await f.value.check();});expect(f.value.result).toEqual(accepted);expect(resolve).toHaveBeenCalledTimes(1);
 f.close();jest.useRealTimers();
});
