import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { PageInvitationInboxRow } from '../PageInvitationInboxRow';
import { supabase } from '../../../lib/supabase';
const mockPush = jest.fn(), mockClose = jest.fn(), mockRead = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: (...args: any[]) => mockPush(...args) }) }));
jest.mock('../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: { regular: 'System', semibold: 'System' } }) }));
jest.mock('../../creator/CreatorActionFill', () => ({ CreatorActionFill: () => null }));
jest.mock('../../../lib/supabase', () => ({ supabase: { auth: { getSession: jest.fn() }, from: jest.fn() } }));
const noticeId='11111111-1111-4111-8111-111111111111', pageId='22222222-2222-4222-8222-222222222222', invitationId='33333333-3333-4333-8333-333333333333';
const target={ notification_id: noticeId, page_id:pageId, invitation_id:invitationId, user_id:'viewer' };
let tree: ReactTestRenderer;
let sessionCount: number, replacementAt: number;
const readTarget=jest.fn(), readReceipt=jest.fn();
const notice={ id:noticeId, title:'Jamie invited you to be a co-creator', body:'Help shape Our Sunday Table.' };
const render=(extra:any={})=><PageInvitationInboxRow notice={notice} userId="viewer" visible enabled onClose={mockClose} onRead={mockRead} {...extra}/>;
const button=()=>tree.root.findAll(node=>node.props.accessibilityRole==='button'&&typeof node.props.onPress==='function')[0];
const never=new Promise<any>(()=>{});
function deferred(){let resolve!:(value:any)=>void;const promise=new Promise<any>(yes=>{resolve=yes;});return{promise,resolve};}
async function flush(){await act(async()=>{for(let i=0;i<20;i++)await Promise.resolve();});}
beforeEach(()=>{
 jest.useFakeTimers();jest.clearAllMocks();sessionCount=0;replacementAt=Infinity;
 readTarget.mockReset().mockResolvedValue({data:target,error:null});readReceipt.mockReset().mockResolvedValue({data:{id:noticeId},error:null});
 jest.mocked(supabase.auth.getSession).mockImplementation(async()=>({data:{session:{user:{id:++sessionCount>=replacementAt?'other-account':'viewer'},access_token:'local-test-token'}},error:null}) as any);
 jest.mocked(supabase.from).mockImplementation((table:string)=>{
  const chain:any={};for(const method of ['select','eq','update','setHeader'])chain[method]=jest.fn(()=>chain);
  chain.maybeSingle=jest.fn(()=>table==='page_team_invitation_notifications'?readTarget():readReceipt());return chain;
 });
});
afterEach(()=>{act(()=>tree?.unmount());jest.clearAllTimers();jest.useRealTimers();});
it('does not navigate if receipt authorization detects an account change before props update',async()=>{
 replacementAt=3;await act(async()=>{tree=create(render());});act(()=>button().props.onPress());await flush();
 expect(mockPush).not.toHaveBeenCalled();expect(mockClose).not.toHaveBeenCalled();
 expect(tree.root.findAll(node=>node.props.accessibilityRole==='alert').length).toBeGreaterThan(0);
});
it('a stalled optional receipt cannot leave the confirmed invitation stuck in Checking',async()=>{
 readReceipt.mockReturnValue(never);await act(async()=>{tree=create(render());});act(()=>button().props.onPress());await flush();
 await act(async()=>{jest.advanceTimersByTime(12001);});await flush();
 expect(mockPush).toHaveBeenCalledWith(`/creator/page-team?id=${pageId}&invitationId=${invitationId}`);
 expect(mockClose).toHaveBeenCalledTimes(1);
 expect(mockRead).not.toHaveBeenCalled();
});
it('opens one exact invitation and refreshes unread state after a confirmed receipt',async()=>{
 await act(async()=>{tree=create(render());});const press=button().props.onPress;act(()=>{press();press();});await flush();
 expect(readTarget).toHaveBeenCalledTimes(1);expect(readReceipt).toHaveBeenCalledTimes(1);
 expect(mockPush).toHaveBeenCalledTimes(1);expect(mockRead).toHaveBeenCalledTimes(1);
 expect(mockPush).toHaveBeenCalledWith(`/creator/page-team?id=${pageId}&invitationId=${invitationId}`);
});
it.each(['failed','missing'])('retains a %s invitation for explicit retry without writing read status',async state=>{
 readTarget.mockResolvedValueOnce(state==='missing'?{data:null,error:null}:{data:null,error:Error('offline')});
 await act(async()=>{tree=create(render());});act(()=>button().props.onPress());await flush();
 expect(mockPush).not.toHaveBeenCalled();expect(readReceipt).not.toHaveBeenCalled();expect(button().props.accessibilityLabel).toBe('Check invitation');
 act(()=>button().props.onPress());await flush();expect(mockPush).toHaveBeenCalledTimes(1);
});
it('releases a stalled target lookup for retry and ignores its eventual result',async()=>{
 const late=deferred();readTarget.mockReturnValueOnce(late.promise);
 await act(async()=>{tree=create(render());});act(()=>button().props.onPress());await flush();
 await act(async()=>jest.advanceTimersByTime(12001));await flush();
 expect(button().props.disabled).toBe(false);expect(button().props.accessibilityLabel).toBe('Check invitation');
 act(()=>button().props.onPress());await flush();expect(mockPush).toHaveBeenCalledTimes(1);
 await act(async()=>late.resolve({data:target,error:null}));await flush();expect(mockPush).toHaveBeenCalledTimes(1);
});
it.each([{visible:false},{userId:'another'},{notice:{...notice,id:pageId}},{enabled:false}])('retires a target after entry changes %p',async extra=>{
 const pending=deferred();readTarget.mockReturnValueOnce(pending.promise);
 await act(async()=>{tree=create(render());});act(()=>button().props.onPress());await flush();
 await act(async()=>tree.update(render(extra)));await act(async()=>pending.resolve({data:target,error:null}));await flush();
 expect(mockPush).not.toHaveBeenCalled();expect(readReceipt).not.toHaveBeenCalled();expect(mockRead).not.toHaveBeenCalled();
});
it('does not reuse a closed visit when the same invitation reopens',async()=>{
 const old=deferred();readTarget.mockReturnValueOnce(old.promise);
 await act(async()=>{tree=create(render());});act(()=>button().props.onPress());await flush();
 await act(async()=>tree.update(render({visible:false})));await act(async()=>tree.update(render()));
 await act(async()=>old.resolve({data:target,error:null}));await flush();expect(mockPush).not.toHaveBeenCalled();
 act(()=>button().props.onPress());await flush();expect(mockPush).toHaveBeenCalledTimes(1);
});
it.each(['changed','stalled'])('does not swallow %s identity after a failed optional receipt',async cause=>{
 readReceipt.mockRejectedValueOnce(Error('offline'));
 if(cause==='changed')replacementAt=4;
 else jest.mocked(supabase.auth.getSession).mockImplementation(()=>{sessionCount++;return sessionCount===4?never:Promise.resolve({data:{session:{user:{id:'viewer'},access_token:'local'}},error:null});});
 await act(async()=>{tree=create(render());});act(()=>button().props.onPress());await flush();
 if(cause==='stalled'){await act(async()=>jest.advanceTimersByTime(12001));await flush();}
 expect(mockPush).not.toHaveBeenCalled();expect(mockRead).not.toHaveBeenCalled();expect(mockClose).not.toHaveBeenCalled();expect(button().props.disabled).toBe(false);
});
it('a disabled feature keeps the existing Yours fallback without querying',async()=>{
 await act(async()=>{tree=create(render({enabled:false}));});act(()=>button().props.onPress());await flush();
 expect(readTarget).not.toHaveBeenCalled();expect(readReceipt).not.toHaveBeenCalled();expect(mockPush).toHaveBeenCalledWith('/(tabs)/friends');
});
it('does not navigate after dismissal during optional bookkeeping',async()=>{
 const pending=deferred();readReceipt.mockReturnValueOnce(pending.promise);
 await act(async()=>{tree=create(render());});act(()=>button().props.onPress());await flush();
 await act(async()=>tree.update(render({visible:false})));await act(async()=>pending.resolve({data:{id:noticeId},error:null}));await flush();
 expect(mockPush).not.toHaveBeenCalled();expect(mockRead).not.toHaveBeenCalled();
});
