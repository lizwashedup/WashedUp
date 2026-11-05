import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockCreate=jest.fn(),mockRead=jest.fn(),mockCheck=jest.fn(),mockFinish=jest.fn(),mockCapability=jest.fn(),mockNavigate=jest.fn(),mockWorkspace=jest.fn();
const mockScope={userId:'creator',isCurrent:()=>mockCurrent};let mockCurrent=true;
jest.mock('../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:()=>({scope:mockScope,account:{isLoading:false,error:null,epoch:1}})}));
jest.mock('../../../hooks/useCreatorAccessRead',()=>({useCreatorAccessRead:()=>({data:{hasLeaderGrant:true},isLoading:false,isError:false,refetch:jest.fn()})}));
jest.mock('../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:{regular:'System',medium:'System',display:'System'}})}));
jest.mock('@tanstack/react-query',()=>({useQueryClient:()=>({invalidateQueries:jest.fn()})}));
jest.mock('../../../lib/creatorMode',()=>({isLeaderAccess:()=>true,suggestHandle:(s:string)=>s.toLowerCase().replace(/ /g,'-'),HANDLE_SHAPE:/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/}));
jest.mock('../../../lib/communityJoiningOptions',()=>({getCommunityJoiningOptions:()=>mockCapability()}));
jest.mock('../../../lib/communityCreation',()=>({createCommunityWithJoining:(...a:any[])=>mockCreate(...a),readCommunityCreationAttempt:()=>mockRead(),checkCommunityCreation:(...a:any[])=>mockCheck(...a),finishCommunityCreation:(...a:any[])=>mockFinish(...a)}));
jest.mock('../../../lib/supabase',()=>({supabase:{rpc:async()=>({data:true,error:null})}}));
jest.mock('../../../lib/selectedCommunity',()=>({setSelectedCommunityId:jest.fn()}));
jest.mock('../../../lib/workspaceContext',()=>({setWorkspace:(...a:any[])=>mockWorkspace(...a)}));
jest.mock('../../../lib/haptics',()=>({hapticSuccess:jest.fn()}));
jest.mock('expo-router',()=>({router:{dismissTo:(...a:any[])=>mockNavigate(...a),back:jest.fn()},Stack:{Screen:()=>null}}));
jest.mock('../../../components/creator/pages/PageFrame',()=>({PageFrame:({children}:any)=>require('react').createElement('Frame',{},children),PageAction:(p:any)=>require('react').createElement('Action',p),pageStyles:{}}));
jest.mock('../../../components/creator/ApplyFormKit',()=>({Field:(p:any)=>require('react').createElement('Field',p)}));
import Screen from '../setup-community';
import { PageAction } from '../../../components/creator/pages/PageFrame';
import { Field } from '../../../components/creator/ApplyFormKit';
import { CommunityJoiningChoice } from '../../../components/creator/CommunityJoiningChoice';
let tree:ReactTestRenderer;
const action=(title:string)=>tree.root.findAllByType(PageAction).find(n=>n.props.title===title)!;
const field=(label:string)=>tree.root.findAllByType(Field).find(n=>n.props.label===label)!;
const saved={userId:'creator',requestId:'request',details:{name:'Weekly Walks',handle:'weekly-walks',city:'Los Angeles',purpose:'Meet for weekly walks',method:'open'}};
async function mount(){await act(async()=>{tree=create(<Screen/>);});}
function fill(){act(()=>field('Community name').props.onChange('Weekly Walks'));act(()=>field('What brings people together?').props.onChange('Meet for weekly walks'));act(()=>action('Continue').props.onPress());}
beforeEach(()=>{jest.clearAllMocks();mockCurrent=true;mockCapability.mockResolvedValue({version:1});mockRead.mockResolvedValue(null);mockCreate.mockResolvedValue({id:'created',attempt:saved});mockCheck.mockResolvedValue(null);mockFinish.mockResolvedValue('created');});
afterEach(()=>act(()=>tree?.unmount()));
it('asks two short steps and does not preselect joining or create twice on repeated taps',async()=>{
 await mount();fill();expect(action('Create community').props.disabled).toBe(true);
 act(()=>tree.root.findByType(CommunityJoiningChoice).props.onChange('approval_required'));
 const submit=action('Create community').props.onPress;await act(async()=>{submit();submit();});
 expect(mockCreate).toHaveBeenCalledTimes(1);expect(mockCreate.mock.calls[0][0].method).toBe('approval_required');expect(action('View community')).toBeDefined();
 await act(async()=>action('View community').props.onPress());expect(mockWorkspace).toHaveBeenCalledWith('community');expect(mockNavigate).toHaveBeenCalledTimes(1);
});
it('recovers an unknown request after reopening and offers only that same request',async()=>{
 mockRead.mockResolvedValue(saved);await mount();expect(action('Retry same request')).toBeDefined();expect(action('Back to details')).toBeUndefined();expect(mockCreate).not.toHaveBeenCalled();
 expect(tree.root.findByType(CommunityJoiningChoice).props.disabled).toBe(true);
 await act(async()=>action('Retry same request').props.onPress());expect(mockCreate.mock.calls[0][0]).toEqual(saved.details);
});
it('loads a completed creation from its receipt without resending',async()=>{
 mockRead.mockResolvedValue(saved);mockCheck.mockResolvedValue('created');await mount();expect(action('View community')).toBeDefined();expect(mockCreate).not.toHaveBeenCalled();
 expect(JSON.stringify(tree.toJSON())).toContain('current status and next steps');
 expect(JSON.stringify(tree.toJSON())).not.toContain('Your page is a private draft');
});
it('fails closed on a missing capability or retired visit',async()=>{
 mockCapability.mockResolvedValue(null);await mount();expect(action('Continue').props.disabled).toBe(true);expect(mockCreate).not.toHaveBeenCalled();
 mockCapability.mockResolvedValue({version:1});await act(async()=>action('Try again').props.onPress());fill();act(()=>tree.root.findByType(CommunityJoiningChoice).props.onChange('open'));mockCurrent=false;
 await act(async()=>action('Create community').props.onPress());expect(mockCreate).not.toHaveBeenCalled();
});
it('restores the exact request after a failed response instead of inviting another creation',async()=>{
 mockCreate.mockRejectedValue(Error('lost response'));await mount();fill();act(()=>tree.root.findByType(CommunityJoiningChoice).props.onChange('open'));mockRead.mockResolvedValue(saved);
 await act(async()=>action('Create community').props.onPress());expect(action('Check status')).toBeDefined();expect(action('Retry same request')).toBeDefined();expect(action('Back to details')).toBeUndefined();
});
