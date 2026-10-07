import React from 'react';import {act,create,type ReactTestRenderer} from 'react-test-renderer';import {Pressable} from 'react-native';
const mockState=jest.fn(),mockScope={userId:'actor',isCurrent:()=>true},mockAccount={isLoading:false,error:null as Error|null,retry:jest.fn()},mockBack=jest.fn(),mockReplace=jest.fn(),mockCanGoBack=jest.fn(),mockFonts={regular:'System',semibold:'System',medium:'System',display:'System'};
jest.mock('../../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:()=>({scope:mockScope,account:mockAccount})}));
jest.mock('../../../../hooks/usePageMembershipRequests',()=>({usePageMembershipRequests:()=>mockState()}));
jest.mock('../../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:mockFonts})}));
jest.mock('expo-router',()=>({router:{canGoBack:()=>mockCanGoBack(),back:()=>mockBack(),replace:(path:string)=>mockReplace(path)},Stack:{Screen:()=>null}}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View}));
jest.mock('../../../ProfileButton',()=>()=>null);
import Screen from '../CreatorPageRequestsScreen';import {PageAction,PageFrame} from '../PageFrame';
let tree:ReactTestRenderer,state:any;const request={memberId:'one',firstName:'Juniper',lastName:'Example',introduction:'Hello neighbors',reason:'A private answer',status:'pending',createdAt:'2026-09-17T00:00:00Z',updatedAt:'2026-09-17T00:00:00Z',rulesConfirmed:null};
const action=(name:string)=>tree.root.findAllByType(PageAction).find(n=>n.props.title===name);
beforeEach(()=>{jest.clearAllMocks();mockAccount.error=null;mockAccount.isLoading=false;mockCanGoBack.mockReturnValue(true);state={ready:true,inbox:{pageName:'Sunset walks',requests:[request],nextCursor:null},decide:jest.fn(),choose:jest.fn((r,approve)=>({memberId:r.memberId,approve})),load:jest.fn(),clearMessage:jest.fn(()=>{state.message=undefined;})};mockState.mockImplementation(()=>state);act(()=>{tree=create(<Screen pageId="page"/>);});});
afterEach(()=>act(()=>tree.unmount()));
it('keeps private answers collapsed and requires explicit decision confirmation',()=>{expect(JSON.stringify(tree.toJSON())).not.toContain('A private answer');const review=tree.root.findAll(n=>n.props.accessibilityLabel==='Review Juniper Example'&&typeof n.props.onPress==='function')[0];act(()=>review.props.onPress());expect(JSON.stringify(tree.toJSON())).toContain('A private answer');act(()=>action('Approve')!.props.onPress());expect(state.decide).not.toHaveBeenCalled();act(()=>action('Approve')!.props.onPress());expect(state.decide).toHaveBeenCalledWith({memberId:'one',approve:true});});
it('error hides cached private requests and exposes recovery without treating them as empty',()=>{state.error='Could not check requests';state.ready=false;act(()=>tree.update(<Screen pageId="page"/>));expect(JSON.stringify(tree.toJSON())).not.toContain('Hello neighbors');expect(JSON.stringify(tree.toJSON())).not.toContain('caught up');expect(action('Check status')).toBeDefined();});
it('empty success is distinct from failure and never shows an admission control',()=>{state.inbox.requests=[];act(()=>tree.update(<Screen pageId="page"/>));expect(JSON.stringify(tree.toJSON())).toContain('caught up');expect(action('Approve')).toBeUndefined();});

it('does not claim all requests are reviewed when another page is available',()=>{
 state.inbox={...state.inbox,requests:[],nextCursor:'next-page'};act(()=>tree.update(<Screen pageId="page"/>));
 expect(JSON.stringify(tree.toJSON())).not.toContain('caught up');expect(action('Load more')).toBeDefined();
});
it.each(['error','loading'])('hides private answers and decision recovery during account %s',kind=>{
 const review=tree.root.findAll(n=>n.props.accessibilityLabel==='Review Juniper Example'&&typeof n.props.onPress==='function')[0];act(()=>review.props.onPress());act(()=>action('Approve')!.props.onPress());
 if(kind==='error')mockAccount.error=Error('Check account');else mockAccount.isLoading=true;
 state.pending={memberId:'one',approve:true};state.retry=true;state.message='Saved decision';
 act(()=>tree.update(<Screen pageId="page"/>));
 expect(JSON.stringify(tree.toJSON())).not.toContain('A private answer');expect(action('Approve')).toBeUndefined();expect(action('Retry approval')).toBeUndefined();
 mockAccount.error=null;mockAccount.isLoading=false;state.pending=undefined;state.retry=false;act(()=>tree.update(<Screen pageId="page"/>));
 expect(action('Approve')).toBeUndefined();expect(state.decide).not.toHaveBeenCalled();
});
it('returns to the existing source screen without stacking another workspace',()=>{
 act(()=>tree.root.findByType(PageFrame).props.onBack());expect(mockBack).toHaveBeenCalledTimes(1);expect(mockReplace).not.toHaveBeenCalled();
});
it('keeps a cold-entry Back in the exact page team workspace for owners and delegates',()=>{
 mockCanGoBack.mockReturnValue(false);act(()=>tree.root.findByType(PageFrame).props.onBack());expect(mockReplace).toHaveBeenCalledWith('/creator/page-team?id=page');expect(mockBack).not.toHaveBeenCalled();
});

it('removes the previous completed decision feedback when opening the next applicant',()=>{
 state.message='This person is now a member.';state.inbox={...state.inbox,requests:[{...request,memberId:'cedar',firstName:'Cedar'}]};
 act(()=>tree.update(<Screen pageId="page"/>));expect(JSON.stringify(tree.toJSON())).toContain('now a member');
 const review=tree.root.findAll(n=>n.props.accessibilityLabel==='Review Cedar Example'&&typeof n.props.onPress==='function')[0];act(()=>review.props.onPress());
 expect(state.clearMessage).toHaveBeenCalledTimes(1);expect(JSON.stringify(tree.toJSON())).not.toContain('now a member');
 act(()=>action('Decline')!.props.onPress());expect(JSON.stringify(tree.toJSON())).not.toContain('now a member');expect(state.decide).not.toHaveBeenCalled();
});

it('prevents switching to another request while its predecessor decision is still saving',()=>{
 state.busy=true;state.ready=false;act(()=>tree.update(<Screen pageId="page"/>));
 const review=tree.root.findAll(n=>n.props.accessibilityLabel==='Review Juniper Example'&&typeof n.props.onPress==='function')[0];
 expect(review.props.disabled).toBe(true);expect(review.props.accessibilityState.disabled).toBe(true);
});
