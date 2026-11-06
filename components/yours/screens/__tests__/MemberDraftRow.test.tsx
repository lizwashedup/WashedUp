import React from 'react';
import { TouchableOpacity, Text } from 'react-native';
import { create, act } from 'react-test-renderer';
import { MemberDraftRow } from '../MemberDraftRow';
import { BrandedAlert } from '../../../BrandedAlert';

let mockFocused = true;
jest.mock('expo-router', () => ({ useFocusEffect: (cb: () => void) =>
  require('react').useEffect(() => mockFocused ? cb() : undefined, [cb, mockFocused]) }));
const mockAuth = jest.fn(), mockRead = jest.fn(), mockDelete = jest.fn();
let filters: Record<string,string>;
jest.mock('../../../../lib/supabase', () => ({ supabase: {
  auth: { getUser: () => mockAuth() },
  from: () => {
    let write = false;
    const scope: Record<string,string> = {};
    const q = { select: () => q, delete: () => { write = true; return q; },
      eq: (key:string, val:string) => {scope[key] = val; return q;},
      maybeSingle: () => (write ? mockDelete : mockRead)(scope) };
    return q;
  },
} }));
const mockSet = jest.fn(), mockInvalidate = jest.fn();
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({setQueryData:mockSet, invalidateQueries:mockInvalidate}) }));
jest.mock('../../../BrandedAlert', () => ({ BrandedAlert: () => null }));
const draft = { id:'d', title:'Hills', start_time:'2030-01-03T00:00:00Z' } as any;
const row = { data:{id:'d'}, error:null }, missing = { data:null, error:null };
let tree: ReturnType<typeof create>, who = 'a';
const element = () => <MemberDraftRow key={who+':d'} userId={who} draft={draft} onOpen={jest.fn()} />;
function refresh() { act(() => tree.update(element())); }
function ask() { act(() => tree.root.findAllByType(TouchableOpacity).find(n => n.props.accessibilityLabel==='Remove draft: Hills')!.props.onPress()); }
function dialog() { return tree.root.findByType(BrandedAlert).props; }
function confirm() {const {buttons,onClose}=dialog();const go=buttons![1].onPress!;act(() => {go();onClose();});return go;}
function action(label:string) { const n=tree.root.findAllByType(TouchableOpacity).find(n=>n.findAllByType(Text).some(t=>t.props.children===label));act(()=>n!.props.onPress()); }
async function flush() {await act(async()=>{await Promise.resolve();});}
const wait = () => {let resolve!: (v:any)=>void;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
beforeEach(()=>{
  mockFocused=true;who='a';filters={id:'d',creator_user_id:'a',status:'draft'};
  jest.clearAllMocks();mockAuth.mockReset().mockResolvedValue({data:{user:{id:'a'}},error:null});
  mockRead.mockReset().mockResolvedValue(row);mockDelete.mockReset().mockResolvedValue(row);
  act(()=>{tree=create(element());});
});
afterEach(()=>act(()=>tree.unmount()));
it('leaves the draft alone on Keep it, including a late confirm tap', async()=>{
  ask();const props=dialog();act(()=>props.onClose());act(()=>props.buttons![1].onPress!());await flush();
  expect(mockRead).not.toHaveBeenCalled();expect(mockDelete).not.toHaveBeenCalled();
});
it('only removes the selected draft of the owner after a confirmed retry',async()=>{
  mockDelete.mockResolvedValueOnce({error:{code:'42501'}});ask();const go=confirm();act(()=>go());await flush();
  expect(mockSet).not.toHaveBeenCalled();expect(mockDelete.mock.calls).toEqual([[filters]]);
  action('Try again');confirm();await flush();expect(mockDelete.mock.calls).toEqual([[filters],[filters]]);
  expect(mockSet.mock.calls[0][0]).toEqual(['my-plan-drafts','a']);
  expect(mockSet.mock.calls[0][1]([{id:'d'},{id:'other'}])).toEqual([{id:'other'}]);
});
it.each(['lost','zero'])('checks status without repeating a %s receipt, even if the first read fails',async kind=>{
  if(kind==='lost')mockDelete.mockRejectedValueOnce(new Error('lost'));else mockDelete.mockResolvedValueOnce(missing);
  ask();confirm();await flush();mockRead.mockRejectedValueOnce(new Error('offline'));action('Check status');await flush();
  expect(mockSet).not.toHaveBeenCalled();mockRead.mockResolvedValueOnce(missing);action('Check status');await flush();
  expect(mockDelete).toHaveBeenCalledTimes(1);expect(mockSet).toHaveBeenCalledTimes(1);
});
it('requires a new confirmation when a status check finds the draft still present',async()=>{
  mockDelete.mockRejectedValueOnce(new Error('lost'));ask();confirm();await flush();action('Check status');await flush();
  expect(mockDelete).toHaveBeenCalledTimes(1);action('Try again');expect(dialog().visible).toBe(true);
});
it('removes a stale list entry without writing to a missing or already published draft',async()=>{
  mockRead.mockResolvedValue(missing);ask();confirm();await flush();expect(mockRead).toHaveBeenCalledWith(filters);
  expect(mockDelete).not.toHaveBeenCalled();expect(mockSet).toHaveBeenCalledTimes(1);
});
it.each(['leave','switch'])('prevents a write on %s while the ownership check is pending',async kind=>{
  const paused=wait();mockRead.mockReturnValueOnce(paused.promise);ask();const go=confirm();await flush();
  if(kind==='leave')mockFocused=false;else who='b';refresh();mockFocused=true;refresh();
  act(()=>go());paused.resolve(row);await flush();expect(mockDelete).not.toHaveBeenCalled();expect(mockSet).not.toHaveBeenCalled();
});
it('never applies a late delete receipt to a different account',async()=>{
  const paused=wait();mockDelete.mockReturnValueOnce(paused.promise);ask();confirm();await flush();who='b';refresh();paused.resolve(row);await flush();
  expect(mockSet).not.toHaveBeenCalled();expect(mockInvalidate.mock.calls.every(([o])=>o.queryKey[1]==='a' && o.refetchType==='none')).toBe(true);
});
it('refuses to write when the active session no longer matches',async()=>{
  mockAuth.mockResolvedValue({data:{user:{id:'b'}}});ask();confirm();await flush();expect(mockRead).not.toHaveBeenCalled();expect(mockDelete).not.toHaveBeenCalled();
});
