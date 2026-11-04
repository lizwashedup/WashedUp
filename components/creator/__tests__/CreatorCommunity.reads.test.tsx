import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockRefetch=jest.fn(async()=>({})), mockPush=jest.fn(), mockPublish=jest.fn(), mockArchive=jest.fn();
let mockAccess: any, mockCommunity: any, mockPublicPage: boolean, mockFocused: boolean, mockPublication: any;
jest.mock('@react-navigation/native',()=>({useIsFocused:()=>mockFocused}));
jest.mock('@tanstack/react-query',()=>({useQueryClient:()=>({invalidateQueries:jest.fn()})}));
jest.mock('../../../hooks/useCreatorAccessRead',()=>({useCreatorAccessRead:()=>mockAccess}));
jest.mock('expo-router',()=>({useRouter:()=>({push:mockPush}),Redirect:()=>null}));
jest.mock('../../../lib/creatorMode',()=>({isAdminTierRole:(role:string)=>['leader','co_leader','admin'].includes(role),buildCommunityPublicLink:()=> 'https://example.test/community/sunday',publishCommunity:(...a:unknown[])=>mockPublish(...a),archiveCommunity:(...a:unknown[])=>mockArchive(...a)}));
jest.mock('../../../lib/selectedCommunity',()=>({useLedCommunity:()=>mockCommunity}));
jest.mock('../../../constants/FeatureFlags',()=>({get PUBLIC_PAGE_CONTROL_ENABLED(){return mockPublicPage;}}));
jest.mock('../../../lib/haptics',()=>({hapticSuccess:jest.fn(),hapticWarning:jest.fn()}));
jest.mock('../CreatorActionFill',()=>({CreatorActionFill:()=>null}));
jest.mock('../../BrandedAlert',()=>({BrandedAlert:()=>null}));
jest.mock('../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:require('../../../constants/Typography').CreatorFonts})}));
jest.mock('../../../hooks/useCommunityPublication',()=>({useCommunityPublication:()=>mockPublication}));
jest.mock('../CommunityPublicationFeedback',()=>({CommunityPublicationFeedback:()=>null}));
import Screen from '../../../app/(creator)/community';
import { BrandedAlert } from '../../BrandedAlert';
import { Redirect } from 'expo-router';
let tree:ReactTestRenderer;
const text=(node:any):string=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):(node?.children??[]).map(text).join('');
const control=(label:string)=>tree.root.findAll(n=>n.props.accessibilityLabel===label&&typeof n.props.onPress==='function')[0];
const render=async()=>{await act(async()=>{tree=create(<Screen/>);});return text(tree.toJSON());};
beforeEach(()=>{jest.clearAllMocks();mockPublicPage=true;mockFocused=true;mockAccess={data:{},isLoading:false,isError:false,isFetching:false,refetch:mockRefetch};mockCommunity={id:'community',name:'Our Sunday Table',status:'active',role:'leader'};mockPublication={state:undefined,ready:true,busy:false,run:jest.fn(async(action:string)=>{if(action==='publish')mockPublish();else mockArchive();return true;})};});
afterEach(()=>act(()=>tree?.unmount()));
it('waits for account-owned settings before showing any tools or publication actions',async()=>{
 mockAccess.isLoading=true;await render();expect(tree.root.findAll(n=>n.props.accessibilityLabel==='Loading community settings').length).toBeGreaterThan(0);expect(control('Edit community')).toBeUndefined();expect(control('Archive this community')).toBeUndefined();
});
it('exposes failed settings reads and retries without pretending the page is empty',async()=>{
 mockAccess.isError=true;const visible=await render();expect(visible).toContain('Couldn’t load community settings.');expect(visible).not.toContain('Draft community');expect(control('Edit community')).toBeUndefined();
 await act(async()=>control('Retry community settings').props.onPress());expect(mockRefetch).toHaveBeenCalledTimes(1);
 mockAccess.isError=false;await act(async()=>tree.update(<Screen/>));expect(control('Edit community')).toBeDefined();
});
it.each([['Edit community','/creator/edit-page'],['Joining settings','/creator/join-gate'],['Money and payouts','/creator/payouts'],['Help and permissions','/creator/help'],['Visibility and link','/creator/public-page']])('preserves the existing %s destination',async(label,route)=>{
 await render();act(()=>control(label).props.onPress());expect(mockPush).toHaveBeenCalledWith(route);
});
it('keeps daily actions out of Settings and retains configuration and support',async()=>{
 await render();for(const label of ['Members and join requests','Invite members','Main chat','Community update','Back to Yours'])expect(control(label)).toBeUndefined();
 expect(text(tree.toJSON())).toContain('Payments & support');expect(control('Money and payouts')).toBeDefined();expect(control('Help and permissions')).toBeDefined();
});
it('does not send people into a disabled page-control screen',async()=>{
 mockPublicPage=false;await render();expect(text(tree.toJSON())).toContain('Published community');expect(control('Visibility and link')).toBeUndefined();
});
it.each(['events','member_care','finance'])('does not borrow another community’s admin role for a selected %s collaborator',async(role)=>{
 mockCommunity.role=role;mockAccess.data={ledCommunities:[mockCommunity,{id:'other',role:'leader'}]};await render();expect(control('Edit community')).toBeUndefined();expect(control('Publish your page')).toBeUndefined();
});
it('keeps publication and archiving behind their existing explicit confirmations',async()=>{
 mockCommunity.status='draft';await render();act(()=>control('Publish your page').props.onPress());expect(tree.root.findByType(BrandedAlert).props.title).toBe('Publish this page?');expect(mockPublish).not.toHaveBeenCalled();
 act(()=>tree.root.findByType(BrandedAlert).props.onClose());act(()=>control('Archive this community').props.onPress());
 expect(tree.root.findByType(BrandedAlert).props.message).toContain('You can’t undo this from here.');expect(mockArchive).not.toHaveBeenCalled();
});
it('distinguishes an archived community from an unpublished draft',async()=>{
 mockCommunity.status='archived';const visible=await render();expect(visible).toContain('Archived community');expect(control('Publish your page')).toBeUndefined();expect(control('Archive this community')).toBeUndefined();expect(control('Edit community')).toBeDefined();
});
it('does not pull another app tab back into management after access changes',async()=>{
 mockCommunity.role='events';mockFocused=false;await render();expect(tree.root.findAllByType(Redirect)).toHaveLength(0);
 mockFocused=true;await act(async()=>tree.update(<Screen/>));expect(tree.root.findByType(Redirect).props.href).toBe('/(tabs)/friends/manage');
});

it('makes visibility settings reachable before a community is published',async()=>{mockCommunity.status='draft';await render();act(()=>control('Visibility and link').props.onPress());expect(mockPush).toHaveBeenCalledWith('/creator/public-page');});
it('disables publication and archive while an earlier change is unconfirmed',async()=>{mockCommunity.status='draft';mockPublication.ready=false;await render();expect(control('Publish your page').props.disabled).toBe(true);expect(control('Archive this community').props.disabled).toBe(true);act(()=>control('Publish your page').props.onPress());expect(tree.root.findByType(BrandedAlert).props.visible).toBe(false);});
it('explains the actual discovery choice in the publication confirmation',async()=>{mockCommunity.status='draft';mockPublication.state={status:'draft',discoverable:false};await render();act(()=>control('Publish your page').props.onPress());expect(tree.root.findByType(BrandedAlert).props.message).toContain('hidden from discovery');});
