import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { CommunityJoinInboxRow } from '../CommunityJoinInboxRow';
import { loadCommunityJoinNotice, markCommunityJoinNoticeRead, CommunityJoinNoticeIdentityError } from '../../../lib/communityJoinNotification';
const mockPush=jest.fn(),mockClose=jest.fn(),mockRead=jest.fn();
let mockIdentity=1;
const viewer=(id='viewer')=>{const captured=mockIdentity;return {viewerId:id,epoch:captured,isLoading:false,error:null,isCurrent:()=>captured===mockIdentity,retry:jest.fn()};};
let mockViewer=viewer();
jest.mock('../../../hooks/useObservedUser',()=>({useObservedUser:()=>mockViewer}));
jest.mock('expo-router',()=>({useRouter:()=>({push:mockPush})}));
jest.mock('../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:{regular:'System',semibold:'System'}})}));
jest.mock('../../../lib/communityJoinNotification',()=>({...jest.requireActual('../../../lib/communityJoinNotification'),loadCommunityJoinNotice:jest.fn(),markCommunityJoinNoticeRead:jest.fn()}));
jest.mock('../../../lib/supabase',()=>({supabase:{}}));
const n='11111111-1111-4111-8111-111111111111',p='22222222-2222-4222-8222-222222222222',m='33333333-3333-4333-8333-333333333333',other='44444444-4444-4444-8444-444444444444';
const target={notification_id:n,page_id:p,member_id:m,kind:'request' as const,eligible:true};
const notice={id:n,type:'community_join_request' as const,title:'A request',body:'Community name'};
const load=jest.mocked(loadCommunityJoinNotice),mark=jest.mocked(markCommunityJoinNoticeRead);
let tree:ReactTestRenderer;
const render=(extra:any={})=><CommunityJoinInboxRow notice={notice} userId="viewer" visible onClose={mockClose} onRead={mockRead} {...extra}/>;
const press=(label='Review requests')=>tree.root.findAll(node=>node.props.accessibilityRole==='button'&&node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0].props.onPress();
const held=()=>{let resolve!:(value:any)=>void;const promise=new Promise<any>(yes=>resolve=yes);return{promise,resolve};};
const flush=()=>act(async()=>{for(let i=0;i<12;i++)await Promise.resolve();});
beforeEach(()=>{jest.clearAllMocks();mockIdentity++;mockViewer=viewer();load.mockResolvedValue(target);mark.mockResolvedValue();act(()=>{tree=create(render());});});
afterEach(()=>act(()=>tree.unmount()));
it.each([p,other])('uses exact source page %s, not a last-selected community, and deduplicates a double press',async page=>{
 load.mockResolvedValue({...target,page_id:page});act(()=>{press();press();});await flush();
 expect(load).toHaveBeenCalledTimes(1);expect(mockPush).toHaveBeenCalledWith(`/creator/page-requests?id=${page}`);expect(mockRead).toHaveBeenCalledTimes(1);expect(mark.mock.calls[0][3]).toBe('acted');
});
it.each(['approved','declined'] as const)('opens exact community for %s',async kind=>{
 load.mockResolvedValue({...target,kind});act(()=>tree.update(render({notice:{...notice,type:`community_join_${kind}`}})));act(()=>press('View community'));await flush();expect(mockPush).toHaveBeenCalledWith(`/community/${p}`);expect(mark.mock.calls[0][3]).toBe('read');
});
it.each(['lookup error','unavailable'])('keeps %s notices available without mark-read or wrong fallback',async cause=>{
 if(cause==='lookup error')load.mockRejectedValueOnce(Error('Offline'));else load.mockResolvedValueOnce({...target,eligible:false});
 act(()=>press());await flush();expect(mockPush).not.toHaveBeenCalled();expect(mark).not.toHaveBeenCalled();
 act(()=>press('Check update'));await flush();expect(mockPush).toHaveBeenCalledTimes(1);
});
it('preserves legacy request route only after confirmed null source',async()=>{
 load.mockResolvedValue(null);act(()=>press());await flush();expect(mockPush).toHaveBeenCalledWith('/(creator)/members');
});
it('legacy decision remains read-only without inventing an exact community',async()=>{
 load.mockResolvedValue(null);act(()=>tree.update(render({notice:{...notice,type:'community_join_declined'}})));act(()=>press('View community'));await flush();expect(mockPush).not.toHaveBeenCalled();expect(mockClose).not.toHaveBeenCalled();expect(mockRead).toHaveBeenCalledTimes(1);
});
it('dismisses without target lookup or navigation',async()=>{
 act(()=>press('Dismiss notification'));await flush();expect(load).not.toHaveBeenCalled();expect(mark).toHaveBeenCalledTimes(1);expect(mockRead).toHaveBeenCalledTimes(1);expect(mockPush).not.toHaveBeenCalled();
});
it('optional failed read status cannot prevent opening a confirmed target',async()=>{
 mark.mockRejectedValue(Error('offline'));act(()=>press());await flush();expect(mockPush).toHaveBeenCalledWith(`/creator/page-requests?id=${p}`);expect(mockRead).not.toHaveBeenCalled();
});
it('identity failure during bookkeeping does prevent navigation',async()=>{
 mark.mockRejectedValue(new CommunityJoinNoticeIdentityError('Changed account'));act(()=>press());await flush();expect(mockPush).not.toHaveBeenCalled();expect(mockClose).not.toHaveBeenCalled();
});
it.each(['close','reopen','account ABA','unmount'])('retires a pending source after %s',async change=>{
 const pending=held();load.mockReturnValueOnce(pending.promise);act(()=>press());await flush();
 if(change==='unmount')act(()=>tree.unmount());
 else if(change==='account ABA'){mockIdentity++;mockViewer=viewer('other');act(()=>tree.update(render({userId:'other'})));mockIdentity++;mockViewer=viewer();act(()=>tree.update(render()));}
 else {act(()=>tree.update(render({visible:false})));if(change==='reopen')act(()=>tree.update(render()));}
 await act(async()=>pending.resolve(target));await flush();expect(mark).not.toHaveBeenCalled();expect(mockPush).not.toHaveBeenCalled();expect(mockRead).not.toHaveBeenCalled();
});
it('synchronous observed account retirement prevents old completion before props catch up',async()=>{
 const pending=held();load.mockReturnValueOnce(pending.promise);act(()=>press());await flush();mockIdentity++;
 await act(async()=>pending.resolve(target));await flush();expect(mockPush).not.toHaveBeenCalled();expect(mark).not.toHaveBeenCalled();
});
