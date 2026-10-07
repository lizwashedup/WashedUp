import React from 'react';
import { act,create,type ReactTestRenderer } from 'react-test-renderer';
import { Modal,FlatList } from 'react-native';
import { ReactionDetailsSheet,type ReactionDetailsRequest } from '../ReactionDetailsSheet';
const mockLoad=jest.fn(),mockRemove=jest.fn(),mockCheck=jest.fn();
jest.mock('../../../lib/messageReactionDetails',()=>({loadMessageReactionDetails:(...args:any[])=>mockLoad(...args),removeMessageReaction:(...args:any[])=>mockRemove(...args),isMessageReactionRemoved:(...args:any[])=>mockCheck(...args)}));
jest.mock('react-native-safe-area-context',()=>({useSafeAreaInsets:()=>({bottom:0})}));
const mine={userId:'me',storageKey:'heart',emoji:'❤️',name:'Liz',photo:null,mine:true};
let tree:ReactTestRenderer;let current=true,canRemove=true;let request:ReactionDetailsRequest;const close=jest.fn(),changed=jest.fn();
const button=(label:string)=>tree.root.findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0];
const people=()=>tree.root.findByType(FlatList).props.data;
async function mount(){await act(async()=>{tree=create(<ReactionDetailsSheet request={request} onClose={close}/>);});}
beforeEach(()=>{jest.clearAllMocks();current=true;canRemove=true;mockLoad.mockReset().mockResolvedValue({people:[mine],nextOffset:null});mockRemove.mockReset().mockResolvedValue(undefined);mockCheck.mockReset().mockResolvedValue(true);request={source:'chat',messageId:'a',scope:{userId:'me',isCurrent:()=>current},canRemove:()=>canRemove,onChanged:changed};});
afterEach(()=>{act(()=>tree?.unmount());});
it('shows who reacted and removes an own reaction once while busy',async()=>{
 let finish!:()=>void;mockRemove.mockReturnValue(new Promise<void>(yes=>finish=yes));await mount();expect(people()).toEqual([mine]);
 const remove=button('Remove your ❤️ reaction').props.onPress;act(()=>{remove();remove();});expect(mockRemove).toHaveBeenCalledTimes(1);
 mockLoad.mockResolvedValue({people:[],nextOffset:null});await act(async()=>finish());expect(changed).toHaveBeenCalledTimes(1);expect(people()).toEqual([]);
});
it('reconciles an unknown removal before permitting another write',async()=>{
 mockRemove.mockRejectedValue(Error('offline'));await mount();await act(async()=>button('Remove your ❤️ reaction').props.onPress());
 expect(button('Check your ❤️ reaction')).toBeDefined();mockCheck.mockResolvedValue(false);
 await act(async()=>button('Check your ❤️ reaction').props.onPress());expect(mockRemove).toHaveBeenCalledTimes(1);expect(button('Remove your ❤️ reaction')).toBeDefined();
});
it('offers a read-only retry when loading fails',async()=>{
 mockLoad.mockRejectedValueOnce(Error('offline'));await mount();expect(button('Retry loading reactions')).toBeDefined();
 await act(async()=>button('Retry loading reactions').props.onPress());expect(people()).toEqual([mine]);expect(mockRemove).not.toHaveBeenCalled();
});
it('keeps earlier people when loading the next page fails',async()=>{
 mockLoad.mockResolvedValueOnce({people:[mine],nextOffset:40}).mockRejectedValueOnce(Error('offline'));
 await mount();await act(async()=>button('Show more reactions').props.onPress());expect(people()).toEqual([mine]);
 await act(async()=>button('Retry loading reactions').props.onPress());expect(mockLoad.mock.calls[2][2]).toBe(40);
});
it('does not revive an old message sheet after a late read',async()=>{
 let resolve!:(v:any)=>void;mockLoad.mockReturnValueOnce(new Promise(yes=>resolve=yes));await mount();
 const next={...request,messageId:'b'};mockLoad.mockResolvedValue({people:[],nextOffset:null});await act(async()=>tree.update(<ReactionDetailsSheet request={next} onClose={close}/>));
 await act(async()=>resolve({people:[mine],nextOffset:null}));expect(people()).toEqual([]);
});
it('retiring the sheet prevents a saved removal callback from dispatching',async()=>{
 await mount();const remove=button('Remove your ❤️ reaction').props.onPress;act(()=>button('Close reaction details').props.onPress());act(()=>remove());expect(mockRemove).not.toHaveBeenCalled();
});
it('allows reading reactions in a read-only chat without offering removal',async()=>{
 canRemove=false;await mount();expect(people()).toEqual([mine]);expect(button('Remove your ❤️ reaction')).toBeUndefined();
});
it('hides the sheet when its parent permission or message is no longer current',async()=>{
 await mount();current=false;await act(async()=>tree.update(<ReactionDetailsSheet request={request} onClose={()=>close()}/>));expect(tree.root.findByType(Modal).props.visible).toBe(false);
});
