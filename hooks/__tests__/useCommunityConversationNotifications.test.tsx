import React from 'react';
import { act, create } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCommunityConversationNotifications } from '../useCommunityConversationNotifications';
import { getCommunityTopicNotificationContext } from '../../lib/communityChatNotificationState';
import type { ObservedUser } from '../useObservedUser';
let mockParent:any, mockFocused=true;
jest.mock('expo-router',()=>({useFocusEffect:(callback:any)=>require('react').useEffect(()=>mockFocused?callback():undefined,[callback,mockFocused])}));
jest.mock('../useCommunityChatPreference',()=>({useCommunityChatPreference:()=>mockParent}));
jest.mock('../../lib/communityChatNotificationState',()=>({getCommunityTopicNotificationContext:jest.fn()}));
const context=jest.mocked(getCommunityTopicNotificationContext),toggle=jest.fn();
const cleanup:Array<()=>void>=[];
async function flush(){for(let i=0;i<4;i++)await act(async()=>{await new Promise(yes=>setTimeout(yes,0));});}
function mount(initial:any={kind:'persistent',communityId:'page'}){
 let selection=initial,user='a',epoch=1,result!:ReturnType<typeof useCommunityConversationNotifications>,tree!:ReturnType<typeof create>;
 const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});let individual={muted:false,ready:true,isChecking:false,toggle};
 function Harness(){const captured=user;const viewer={viewerId:user,epoch,isCurrent:()=>user===captured,isLoading:false,error:null,retry:async()=>{}} as ObservedUser;result=useCommunityConversationNotifications(selection,viewer,individual);return null;}
 const node=()=> <QueryClientProvider client={client}><Harness/></QueryClientProvider>;act(()=>{tree=create(node());});cleanup.push(()=>{act(()=>tree.unmount());client.clear();});
 return{get result(){return result;},update:()=>act(()=>tree.update(node())),individual:(next:any)=>{individual={...individual,...next};act(()=>tree.update(node()));},account:(next:string)=>{user=next;epoch++;act(()=>tree.update(node()));},topic:(id:string)=>{selection={kind:'topic',topicId:id};act(()=>tree.update(node()));}};
}
beforeEach(()=>{jest.clearAllMocks();mockFocused=true;mockParent={data:{communityId:'page',userId:'a',muted:false,version:0},ready:true,error:null,pending:null,busy:false,fetching:false,loading:false,change:jest.fn(),refresh:jest.fn(),check:jest.fn()};context.mockResolvedValue({communityId:'page',kind:'persistent'});toggle.mockResolvedValue({matched:true,value:true});});
afterEach(async()=>{cleanup.splice(0).forEach(fn=>fn());await flush();});
it('parent mute changes the effective bell and unmute action without rewriting individual choice',async()=>{mockParent.data.muted=true;const f=mount();await flush();expect(f.result.muted).toBe(true);expect(f.result.label).toBe('Unmute all community chats');await act(async()=>{await f.result.toggle();});expect(mockParent.change).toHaveBeenCalledWith(false);expect(toggle).not.toHaveBeenCalled();});
it('retains the individual controller when parent is unmuted',async()=>{const f=mount();await flush();f.individual({muted:true});expect(f.result.label).toBe('Unmute chat');await act(async()=>{await f.result.toggle();});expect(toggle).toHaveBeenCalledTimes(1);expect(mockParent.change).not.toHaveBeenCalled();});
it('parent mute is known even while the underlying individual preference is unknown',async()=>{mockParent.data.muted=true;const f=mount();await flush();f.individual({muted:undefined,ready:false,isChecking:true});expect(f.result.ready).toBe(true);expect(f.result.isChecking).toBe(false);});
it('event context never inherits parent mute or changes the parent preference',async()=>{context.mockResolvedValue({kind:'event',communityId:'page'});mockParent.data.muted=true;const f=mount({kind:'topic',topicId:'event'});await flush();expect(f.result.parent).toBeNull();expect(f.result.muted).toBe(false);await act(async()=>{await f.result.toggle();});expect(toggle).toHaveBeenCalledTimes(1);expect(mockParent.change).not.toHaveBeenCalled();});
it('failed context stays unknown and the bell retries only the read',async()=>{context.mockRejectedValue(Error('Offline'));const f=mount({kind:'topic',topicId:'unknown'});await flush();expect(f.result.ready).toBe(false);expect(f.result.label).toBe('Check chat notification setting');await act(async()=>{await f.result.toggle();});expect(context).toHaveBeenCalledTimes(2);expect(toggle).not.toHaveBeenCalled();expect(mockParent.change).not.toHaveBeenCalled();});
it('pending parent save routes the bell to checking, never another mutation',async()=>{mockParent.pending={desired:false,retryReady:false};const f=mount();await flush();expect(f.result.ready).toBe(false);await act(async()=>{await f.result.toggle();});expect(mockParent.check).toHaveBeenCalledTimes(1);expect(mockParent.change).not.toHaveBeenCalled();expect(toggle).not.toHaveBeenCalled();});
it('unknown parent setting does not fall back to an unmuted individual bell',async()=>{mockParent.data=undefined;mockParent.error=Error('Offline');const f=mount();await flush();expect(f.result.muted).toBeUndefined();await act(async()=>{await f.result.toggle();});expect(mockParent.refresh).toHaveBeenCalledTimes(1);expect(toggle).not.toHaveBeenCalled();});
it('retired topic scope cannot supply context to the next account',async()=>{let resolve!:any;context.mockReturnValueOnce(new Promise(yes=>{resolve=yes;}));const f=mount({kind:'topic',topicId:'a'});await flush();const scope=context.mock.calls[0][1];f.account('b');await flush();expect(scope.isCurrent()).toBe(false);await act(async()=>{resolve({kind:'persistent',communityId:'old'});});expect(f.result.parent?.data?.communityId).toBe('page');});
it('focus loss prevents pending parent actions from dispatching',async()=>{mockParent.data.muted=true;const f=mount();await flush();const old=f.result;mockFocused=false;f.update();await flush();await act(async()=>{await old.toggle();});expect(mockParent.change).not.toHaveBeenCalled();});
it('legacy presentation retains the original controller without context reads',async()=>{const f=mount({kind:'legacy'});await flush();await act(async()=>{await f.result.toggle();});expect(toggle).toHaveBeenCalledTimes(1);expect(context).not.toHaveBeenCalled();expect(f.result.parent).toBeNull();});
