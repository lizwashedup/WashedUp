import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { PageUpdateInboxRow } from '../PageUpdateInboxRow';
import { supabase } from '../../../lib/supabase';
const mockPush=jest.fn(),mockClose=jest.fn();
jest.mock('expo-router',()=>({useRouter:()=>({push:(...args:any[])=>mockPush(...args)})}));
jest.mock('../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:{regular:'System',semibold:'System'}})}));
jest.mock('../../creator/CreatorActionFill',()=>({CreatorActionFill:()=>null}));
jest.mock('../../../lib/supabase',()=>({supabase:{auth:{getSession:jest.fn()},from:jest.fn()}}));
const id='11111111-1111-4111-8111-111111111111',page='22222222-2222-4222-8222-222222222222',update='33333333-3333-4333-8333-333333333333';
const target={notification_id:id,page_id:page,broadcast_id:update,user_id:'viewer'};
const targetRead=jest.fn(),receiptRead=jest.fn();
let tree:ReactTestRenderer,sessions=0,changeAt=Infinity;
const render=(props:any={})=><PageUpdateInboxRow notice={{id,title:'A new gathering',body:'See you by the sea.'}} userId="viewer" visible enabled onClose={mockClose} {...props}/>;
const button=()=>tree.root.findAll(node=>node.props.accessibilityRole==='button'&&typeof node.props.onPress==='function')[0];
async function flush(){await act(async()=>{for(let i=0;i<20;i++)await Promise.resolve();});}
function deferred(){let resolve!:(result:any)=>void;const promise=new Promise<any>(yes=>{resolve=yes;});return{promise,resolve};}
beforeEach(()=>{
 jest.useFakeTimers();jest.clearAllMocks();sessions=0;changeAt=Infinity;
 targetRead.mockReset().mockResolvedValue({data:target,error:null});receiptRead.mockReset().mockResolvedValue({data:{id},error:null});
 jest.mocked(supabase.auth.getSession).mockImplementation(async()=>({data:{session:{user:{id:++sessions>=changeAt?'other':'viewer'},access_token:'fictional-test-token'}},error:null}) as any);
 jest.mocked(supabase.from).mockImplementation((table:string)=>{const chain:any={};for(const method of ['select','eq','update','setHeader'])chain[method]=()=>chain;chain.maybeSingle=()=>table==='creator_page_broadcast_notifications'?targetRead():receiptRead();return chain;});
});
afterEach(()=>{act(()=>tree?.unmount());jest.clearAllTimers();jest.useRealTimers();});
it('cannot open the prior account’s update when account ownership changes during bookkeeping',async()=>{
 changeAt=3;await act(async()=>{tree=create(render());});act(()=>button().props.onPress());await flush();
 expect(mockPush).not.toHaveBeenCalled();expect(mockClose).not.toHaveBeenCalled();
});
it('a stalled read receipt cannot leave the confirmed update stuck',async()=>{
 receiptRead.mockReturnValue(new Promise(()=>{}));await act(async()=>{tree=create(render());});act(()=>button().props.onPress());await flush();
 await act(async()=>jest.advanceTimersByTime(12001));await flush();
 expect(mockPush).toHaveBeenCalledWith(`/organization/${page}?identity=page&update=${update}`);
});
it('opens once and refreshes unread state only after a confirmed read receipt',async()=>{
 const onRead=jest.fn();await act(async()=>{tree=create(render({onRead}));});const press=button().props.onPress;act(()=>{press();press();});await flush();
 expect(targetRead).toHaveBeenCalledTimes(1);expect(mockPush).toHaveBeenCalledTimes(1);expect(onRead).toHaveBeenCalledTimes(1);
});
it('keeps receipt failure optional without claiming the notice was read',async()=>{
 const onRead=jest.fn();receiptRead.mockRejectedValueOnce(Error('offline'));await act(async()=>{tree=create(render({onRead}));});act(()=>button().props.onPress());await flush();
 expect(onRead).not.toHaveBeenCalled();expect(mockPush).toHaveBeenCalledWith(`/organization/${page}?identity=page&update=${update}`);
});
it.each(['failed','missing'])('retries a %s mapping without premature navigation or read writes',async state=>{
 targetRead.mockResolvedValueOnce(state==='missing'?{data:null,error:null}:{data:null,error:Error('offline')});await act(async()=>{tree=create(render());});act(()=>button().props.onPress());await flush();
 expect(receiptRead).not.toHaveBeenCalled();expect(mockPush).not.toHaveBeenCalled();expect(button().props.accessibilityLabel).toBe('Check update');
 act(()=>button().props.onPress());await flush();expect(mockPush).toHaveBeenCalledTimes(1);
});
it.each([{visible:false},{enabled:false},{userId:'other'}])('retires a pending mapping when the current entry changes %p',async change=>{
 const late=deferred();targetRead.mockReturnValueOnce(late.promise);await act(async()=>{tree=create(render());});act(()=>button().props.onPress());await flush();
 await act(async()=>tree.update(render(change)));await act(async()=>late.resolve({data:target,error:null}));await flush();expect(receiptRead).not.toHaveBeenCalled();expect(mockPush).not.toHaveBeenCalled();
});
it('releases a stalled target for retry and ignores the old result',async()=>{
 const late=deferred();targetRead.mockReturnValueOnce(late.promise);await act(async()=>{tree=create(render());});act(()=>button().props.onPress());await flush();
 await act(async()=>jest.advanceTimersByTime(12001));await flush();expect(button().props.disabled).toBe(false);
 act(()=>button().props.onPress());await flush();await act(async()=>late.resolve({data:target,error:null}));await flush();expect(mockPush).toHaveBeenCalledTimes(1);
});
it('does not navigate after account replacement following failed optional bookkeeping',async()=>{
 changeAt=4;receiptRead.mockRejectedValueOnce(Error('offline'));await act(async()=>{tree=create(render());});act(()=>button().props.onPress());await flush();expect(mockPush).not.toHaveBeenCalled();expect(button().props.disabled).toBe(false);
});
it('keeps the feature-disabled Scene fallback',async()=>{
 await act(async()=>{tree=create(render({enabled:false}));});act(()=>button().props.onPress());await flush();expect(mockPush).toHaveBeenCalledWith('/(tabs)/explore');expect(targetRead).not.toHaveBeenCalled();
});
