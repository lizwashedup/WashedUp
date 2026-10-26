import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';

const mockGet=jest.fn(),mockPeek=jest.fn(),mockReplace=jest.fn(),mockStash=jest.fn();
let mockParams:any,mockScope:any,mockAccount:any;
jest.mock('../../lib/ticketing',()=>({getOrder:(...args:unknown[])=>mockGet(...args)}));
jest.mock('../../lib/pendingLink',()=>({peekPendingCheckout:(...args:unknown[])=>mockPeek(...args),stashPendingDestination:(...args:unknown[])=>mockStash(...args)}));
jest.mock('../../hooks/usePublicPageScope',()=>({usePublicPageScope:()=>({scope:mockScope,account:mockAccount})}));
jest.mock('expo-router',()=>({useLocalSearchParams:()=>mockParams,router:{replace:(...args:unknown[])=>mockReplace(...args)},Stack:{Screen:()=>null}}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View}));
import Screen from '../checkout-return';
const id='fe50d58b-0071-4818-bfbe-0b0e936650ea';let tree:ReactTestRenderer;
const content=()=>JSON.stringify(tree.toJSON());
const button=(text:string)=>tree.root.findAll(node=>node.props.accessibilityRole==='button' && typeof node.props.onPress==='function' && node.findAll(child=>child.props.children===text).length>0)[0];
async function mount(){await act(async()=>{tree=create(<Screen/>);});}
beforeEach(()=>{jest.clearAllMocks();mockParams={order:id,checkout:'cancelled'};mockScope={userId:'buyer-a',isCurrent:()=>true};mockAccount={viewerId:'buyer-a',isLoading:false,error:null};mockGet.mockResolvedValue({id,event_id:'event-a',status:'pending'});mockPeek.mockResolvedValue(null);mockStash.mockResolvedValue(undefined);});
afterEach(()=>act(()=>tree?.unmount()));
it('checks the signed-in buyer and never calls a pending cancellation an uncharged order',async()=>{
 await mount();expect(mockGet).toHaveBeenCalledWith(id,{buyerUserId:'buyer-a',strict:true});
 expect(content()).toContain('Checkout is still pending');expect(content()).not.toContain('nothing was charged');expect(mockReplace).not.toHaveBeenCalled();
 act(()=>button('View order').props.onPress());expect(mockReplace).toHaveBeenCalledWith('/tickets/order/'+id);
});
it('opens a confirmed paid order even when the return link says cancelled',async()=>{
 mockGet.mockResolvedValue({id,event_id:'event-a',status:'paid'});await mount();expect(mockReplace).toHaveBeenCalledWith('/tickets/order/'+id);
});
it('surfaces failed reads and retries the same order',async()=>{
 mockGet.mockRejectedValueOnce(new Error('offline'));await mount();expect(content()).toContain('We couldn’t load the latest status');expect(mockReplace).not.toHaveBeenCalled();
 await act(async()=>button('Try again').props.onPress());expect(mockGet).toHaveBeenCalledTimes(2);expect(content()).toContain('Checkout is still pending');
});
it('a malformed explicit ID cannot open a different saved checkout',async()=>{
 mockParams.order='not-an-id';mockPeek.mockResolvedValue(id);await mount();expect(mockPeek).not.toHaveBeenCalled();expect(mockGet).not.toHaveBeenCalled();expect(mockReplace).not.toHaveBeenCalled();
});
it('a failed durable read is not mistaken for no pending checkout',async()=>{
 mockParams={};mockPeek.mockRejectedValueOnce(new Error('storage unavailable'));await mount();expect(mockPeek).toHaveBeenCalledWith(true);expect(content()).toContain('Try again');expect(mockReplace).not.toHaveBeenCalled();
});
it('ignores an old account response after the return visit retires',async()=>{
 let resolve!:(v:any)=>void;mockGet.mockReturnValueOnce(new Promise(r=>{resolve=r;}));await mount();
 mockScope.isCurrent=()=>false;mockScope={userId:'buyer-b',isCurrent:()=>true};mockGet.mockResolvedValue(null);
 await act(async()=>tree.update(<Screen/>));await act(async()=>resolve({id,event_id:'event-a',status:'paid'}));
 expect(mockReplace).not.toHaveBeenCalled();expect(content()).toContain('This checkout isn’t available for this account');
});
it('signed-out return keeps its destination through the existing login gate',async()=>{
 mockScope={userId:null,isCurrent:()=>true};mockAccount={viewerId:null,isLoading:false,error:null};await mount();expect(mockGet).not.toHaveBeenCalled();
 await act(async()=>button('Sign in').props.onPress());expect(mockStash).toHaveBeenCalledWith('/checkout-return?order='+id+'&checkout=cancelled');expect(mockReplace).toHaveBeenCalledWith('/(auth)/phone-entry');
});
it('Back retires a pending order response before navigation focus changes',async()=>{
 let resolve!:(v:any)=>void;mockGet.mockReturnValueOnce(new Promise(r=>{resolve=r;}));await mount();
 act(()=>tree.root.findAll(node=>node.props.accessibilityLabel==='Back to Scene' && typeof node.props.onPress==='function')[0].props.onPress());
 await act(async()=>resolve({id,event_id:'event-a',status:'paid'}));
 expect(mockReplace.mock.calls).toEqual([['/(tabs)/explore']]);
});
it('only starts one sign-in handoff when pressed repeatedly before storage finishes',async()=>{
 mockScope={userId:null,isCurrent:()=>true};mockAccount={viewerId:null,isLoading:false,error:null};
 let resolve!:()=>void;mockStash.mockReturnValueOnce(new Promise<void>(r=>{resolve=r;}));await mount();
 const press=button('Sign in').props.onPress;act(()=>{press();press();});
 expect(mockStash).toHaveBeenCalledTimes(1);
 await act(async()=>resolve());expect(mockReplace.mock.calls).toEqual([['/(auth)/phone-entry']]);
});
it('leaving during a sign-in handoff prevents its late redirect',async()=>{
 mockScope={userId:null,isCurrent:()=>true};mockAccount={viewerId:null,isLoading:false,error:null};
 let resolve!:()=>void;mockStash.mockReturnValueOnce(new Promise<void>(r=>{resolve=r;}));await mount();
 act(()=>button('Sign in').props.onPress());
 act(()=>tree.root.findAll(node=>node.props.accessibilityLabel==='Back to Scene' && typeof node.props.onPress==='function')[0].props.onPress());
 await act(async()=>resolve());expect(mockReplace.mock.calls).toEqual([['/(tabs)/explore']]);
});
it('keeps a malformed explicit order through sign-in instead of falling back to another saved order',async()=>{
 mockParams.order='invalid/id?other=1';mockScope={userId:null,isCurrent:()=>true};mockAccount={viewerId:null,isLoading:false,error:null};
 await mount();await act(async()=>button('Sign in').props.onPress());
 expect(mockStash).toHaveBeenCalledWith('/checkout-return?order=invalid%2Fid%3Fother%3D1&checkout=cancelled');
});
it('does not fall back to a saved order when the explicit order is empty',async()=>{
 mockParams.order='';mockPeek.mockResolvedValue(id);await mount();
 expect(mockPeek).not.toHaveBeenCalled();expect(mockGet).not.toHaveBeenCalled();expect(content()).toContain('This checkout isn’t available for this account');
});
it('a fresh visit can open its order after the previous visit left',async()=>{
 await mount();act(()=>button('View order').props.onPress());
 mockScope={userId:'buyer-a',isCurrent:()=>true};await act(async()=>tree.update(<Screen/>));
 act(()=>button('View order').props.onPress());expect(mockReplace).toHaveBeenCalledTimes(2);
});
it('unmount retires sign-in completion even before the account observer changes',async()=>{
 mockScope={userId:null,isCurrent:()=>true};mockAccount={viewerId:null,isLoading:false,error:null};
 let resolve!:()=>void;mockStash.mockReturnValueOnce(new Promise<void>(r=>{resolve=r;}));await mount();
 act(()=>button('Sign in').props.onPress());act(()=>tree.unmount());
 await act(async()=>resolve());expect(mockReplace).not.toHaveBeenCalled();
});
it('repeated order and event actions consume only one navigation',async()=>{
 await mount();act(()=>{button('View order').props.onPress();button('Back to event').props.onPress();});
 expect(mockReplace.mock.calls).toEqual([['/tickets/order/'+id]]);
});
