import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockPush=jest.fn(),mockRead=jest.fn(),mockPrepare=jest.fn();let mockActive=true,mockUser='alice';
const mockScope={userId:'alice',isCurrent:()=>mockActive};
jest.mock('expo-router',()=>({router:{push:(...a:unknown[])=>mockPush(...a)}}));
jest.mock('../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:()=>({scope:{...mockScope,userId:mockUser},account:{isLoading:false,error:null}})}));
jest.mock('../../../lib/creatorMode',()=>({getCreatorAccess:(...a:unknown[])=>mockRead(...a)}));
jest.mock('../../../lib/creatorManagement',()=>({prepareCreatorSpace:(...a:unknown[])=>mockPrepare(...a)}));
jest.mock('../pages/PageFrame',()=>({PageAction:()=>null,pageStyles:{small:{}}}));
import { OrganizationManageLink } from '../OrganizationManageLink';
import { PageAction } from '../pages/PageFrame';
let tree:ReactTestRenderer;
beforeEach(()=>{jest.clearAllMocks();mockActive=true;mockUser='alice';mockRead.mockResolvedValue({hasEventHostGrant:true});});
afterEach(()=>act(()=>tree?.unmount()));
function mount(){act(()=>{tree=create(<OrganizationManageLink organizationId="alice"/>);});}
it('rechecks the organization approval and selects its workspace before opening tools',async()=>{
 mount();await act(async()=>tree.root.findByType(PageAction).props.onPress());expect(mockRead).toHaveBeenCalledWith('alice');expect(mockPrepare).toHaveBeenCalledWith(expect.objectContaining({legacy:{workspace:'organization',status:'approved'}}),expect.objectContaining({userId:'alice'}));expect(mockPush).toHaveBeenCalledWith('/(creator)/organizer-home');
});
it('does not show management on another person’s public organization',()=>{mockUser='bob';mount();expect(tree.toJSON()).toBeNull();});
it('does not navigate after the approval is revoked',async()=>{mockRead.mockResolvedValue({hasEventHostGrant:false});mount();await act(async()=>tree.root.findByType(PageAction).props.onPress());expect(mockPush).not.toHaveBeenCalled();expect(mockPrepare).not.toHaveBeenCalled();});
it('ignores an access result received after leaving the organization page',async()=>{mockRead.mockImplementation(async()=>{mockActive=false;return {hasEventHostGrant:true};});mount();await act(async()=>tree.root.findByType(PageAction).props.onPress());expect(mockPush).not.toHaveBeenCalled();});
