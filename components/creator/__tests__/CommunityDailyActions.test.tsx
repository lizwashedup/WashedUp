import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockAccess=jest.fn(),mockPrepare=jest.fn(),mockPush=jest.fn();let mockActive=true;
const mockScope={userId:'alice',isCurrent:()=>mockActive};
jest.mock('expo-router',()=>({router:{push:(...a:unknown[])=>mockPush(...a)}}));
jest.mock('../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:()=>({scope:mockScope,account:{isLoading:false,error:null}})}));
jest.mock('../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:require('../../../constants/Typography').AfterglowFallbackFonts})}));
jest.mock('../../../lib/creatorMode',()=>({getCreatorAccess:(...a:unknown[])=>mockAccess(...a),isAdminTierRole:(role:string)=>['leader','admin','co_leader'].includes(role)}));
jest.mock('../../../lib/creatorManagement',()=>({prepareCreatorSpace:(...a:unknown[])=>mockPrepare(...a)}));
jest.mock('lucide-react-native',()=>({ChevronRight:()=>null}));
import {CommunityDailyActions} from '../CommunityDailyActions';
let tree:ReactTestRenderer;
const button=(label:string)=>tree.root.findAll(n=>n.props.accessibilityLabel===label&&typeof n.props.onPress==='function')[0];
beforeEach(()=>{jest.clearAllMocks();mockActive=true;mockAccess.mockResolvedValue({ledCommunities:[{id:'sunset',name:'Sunset Club',status:'active',role:'leader'}]});act(()=>{tree=create(<CommunityDailyActions communityId="sunset"/>);});});
afterEach(()=>act(()=>tree.unmount()));
it.each([['Main chat','/community-thread/sunset'],['Members','/(tabs)/friends/manage/(tools)/members'],['Events','/(tabs)/friends/manage/(tools)/events'],['Settings','/(tabs)/friends/manage/(tools)/community']])('opens %s in the selected community',async(label,route)=>{
 await act(async()=>button(label).props.onPress());expect(mockAccess).toHaveBeenCalledWith('alice');expect(mockPrepare).toHaveBeenCalledWith(expect.objectContaining({legacy:expect.objectContaining({communityId:'sunset',workspace:'community'})}),mockScope);expect(mockPush).toHaveBeenCalledWith(route);
});
it('does not borrow a stronger role from another community',async()=>{
 mockAccess.mockResolvedValue({ledCommunities:[{id:'sunset',role:'finance'},{id:'other',role:'leader'}]});await act(async()=>button('Members').props.onPress());expect(mockPush).not.toHaveBeenCalled();expect(mockPrepare).not.toHaveBeenCalled();
});
it('rejects a late access result after leaving the screen',async()=>{
 mockAccess.mockImplementation(async()=>{mockActive=false;return {ledCommunities:[{id:'sunset',role:'leader'}]};});await act(async()=>button('Main chat').props.onPress());expect(mockPush).not.toHaveBeenCalled();
});
