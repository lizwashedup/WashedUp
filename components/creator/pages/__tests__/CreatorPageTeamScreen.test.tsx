import React from 'react';import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockTeam=jest.fn(),mockDismissTo=jest.fn(),mockPush=jest.fn(),mockFonts={regular:'System',medium:'System',semibold:'System',display:'System'};
jest.mock('../../../../hooks/useCreatorPageTeam',()=>({useCreatorPageTeam:(...a:unknown[])=>mockTeam(...a)}));
jest.mock('../../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:mockFonts})}));
jest.mock('expo-router',()=>({router:{dismissTo:(...a:unknown[])=>mockDismissTo(...a),push:(...a:unknown[])=>mockPush(...a),canGoBack:()=>true,back:()=>{}},Stack:{Screen:()=>null}}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View}));
jest.mock('../../../ProfileButton',()=>()=>null);
import Screen from '../CreatorPageTeamScreen';import { PageAction } from '../PageFrame';import { Dimensions, ScrollView, Text, TextInput, Pressable } from 'react-native';
let state:any,tree:ReactTestRenderer;const page='page',inv={permissions:['page_content'],currentPermissions:null,accessRevokedAt:null,invitationId:'invite',pageId:page,pageName:'Sunset Club',pageKind:'community',recipientId:'cedar',inviterId:'aster',recipientName:'Cedar',inviterName:'Aster',status:'pending',note:'Hello <friends> & neighbors.'};
const action=(title:string)=>tree.root.findAllByType(PageAction).find(a=>a.props.title===title);
const text=()=>JSON.stringify(tree.toJSON());
beforeEach(()=>{jest.clearAllMocks();mockDismissTo.mockReset();state={account:{viewerId:'aster',isLoading:false,error:null,retry:jest.fn()},ready:true,loaded:true,busy:false,step:'roster',recoveryRequired:false,retryReady:false,error:null,notice:null,readError:null,invitation:null,draft:{permissions:['page_content'],handle:'cedar',person:{name:'Cedar'},note:'Hello <friends> & neighbors.'},roster:{pageId:page,pageName:'Sunset Club',pageKind:'community',ownerId:'aster',ownerName:'Aster',canInvite:true,assignments:[],legacyMembers:[{memberId:'original',userId:'aster',role:'leader',name:'Aster'}],invitations:[]},togglePermission:jest.fn(),startAccessChange:jest.fn(),reviewAccess:jest.fn(),saveAccess:jest.fn(),startInvite:jest.fn(),backToForm:jest.fn(),setHandle:jest.fn(),setNote:jest.fn(),lookup:jest.fn(),review:jest.fn(),create:jest.fn(),respond:jest.fn(),check:jest.fn(),retry:jest.fn(),refresh:jest.fn()};mockTeam.mockImplementation(()=>state);});
afterEach(()=>{act(()=>tree?.unmount());});function mount(id?:string){act(()=>{tree=create(<Screen pageId={page} invitationId={id}/>);});}
it('shows the exact owner page and invitation entry through existing PageFrame controls',()=>{mount();expect(text()).toContain('Sunset Club');expect(text()).toContain('You’re the only creator here so far.');act(()=>action('Invite a co-creator')!.props.onPress());expect(state.startInvite).toHaveBeenCalledTimes(1);expect(mockTeam).toHaveBeenCalledWith(page,undefined);});
it('retains note and exact-handle input with a separate review action',()=>{state.step='invite';mount();const inputs=tree.root.findAllByType(TextInput);expect(inputs.map(i=>i.props.accessibilityLabel)).toEqual(['Their exact handle','Invitation note']);expect(inputs[1].props.maxLength).toBe(1000);act(()=>action('Review invitation')!.props.onPress());expect(state.review).toHaveBeenCalledTimes(1);expect(state.create).not.toHaveBeenCalled();});
it('owner review displays the literal note and only explicit Send invitation can create',()=>{state.step='review';mount();expect(text()).toContain('Hello <friends> & neighbors.');expect(state.create).not.toHaveBeenCalled();act(()=>action('Send invitation')!.props.onPress());expect(state.create).toHaveBeenCalledTimes(1);});
it('unknown action disables new writes and offers separate check and permitted retry',()=>{state.step='review';state.recoveryRequired=true;state.retryReady=true;mount();expect(action('Send invitation')!.props.disabled).toBe(true);expect(action('Check saved status')).toBeDefined();expect(action('Retry original action')).toBeDefined();});
it('recipient sees exact page note with explicit Accept and Decline',()=>{state.account.viewerId='cedar';state.invitation=inv;state.roster=null;mount('invite');expect(text()).toContain('Aster invited you');act(()=>action('Accept invitation')!.props.onPress());expect(state.respond).toHaveBeenCalledWith(inv,'accept');expect(action('Decline invitation')).toBeDefined();expect(action('Cancel invitation')).toBeUndefined();});
it('owner pending detail cancels the invitation and does not present recipient actions',()=>{state.invitation=inv;state.roster=null;mount('invite');expect(text()).toContain('Cedar can choose whether to accept');expect(action('Accept invitation')).toBeUndefined();act(()=>action('Cancel invitation')!.props.onPress());expect(state.respond).toHaveBeenCalledWith(inv,'cancel');});
it('organization review omits community membership-request authority',()=>{state.roster.pageKind='organization';state.step='review';mount();expect(text()).not.toContain('Review community membership requests');expect(text()).toContain('bank settings');});
it('failed eligibility reads hide cached names and notes with reachable recovery',()=>{state.readError='Page unavailable';state.invitation=inv;mount('invite');expect(text()).not.toContain('Sunset Club');expect(text()).not.toContain('Hello <friends>');expect(action('Check page team')).toBeDefined();});
it('preserves current roster names and stable member/assignment identities',()=>{state.roster.legacyMembers.push({memberId:'legacy',userId:'juniper',role:'co_leader',name:'Juniper'});state.roster.assignments=[{permissions:['page_content'],revision:1,revokedAt:null,assignmentId:'new',userId:'cedar',name:'Cedar',available:true}];mount();expect(text()).toContain('Juniper');expect(text()).toContain('Cedar');expect(text()).not.toContain('only creator here');});

it('no permissions are preselected and accessible checkboxes are explicit',()=>{
 state.step='invite';state.draft.permissions=[];mount();
 const checks=tree.root.findAll(n=>n.props.accessibilityRole==='checkbox'&&typeof n.props.onPress==='function').filter((n,i,list)=>list.findIndex(a=>a.props.accessibilityLabel===n.props.accessibilityLabel)===i);
 expect(checks).toHaveLength(3);expect(checks.every(n=>n.props.accessibilityState.checked===false)).toBe(true);
 expect(action('Review invitation')!.props.disabled).toBe(true);
 act(()=>checks[1].props.onPress());expect(state.togglePermission).toHaveBeenCalledWith('page_events');
});
it('recipient review shows only selected categories before acceptance',()=>{
 state.account.viewerId='cedar';state.invitation=inv;state.roster=null;mount('invite');
 expect(text()).toContain('Page content');expect(action('Events')).toBeUndefined();expect(text()).not.toContain('Community membership requests');
});
it('returns to the existing same-page Events screen instead of pushing another copy',()=>{
 let stack=['/creator/pages',`/creator/page-team?id=${page}`,`/creator/page-events?id=${page}`,`/creator/page-team?id=${page}`];
 mockDismissTo.mockImplementation(path=>{stack=stack.slice(0,stack.lastIndexOf(path)+1);});
 mount();act(()=>action('Events')!.props.onPress());
 expect(mockDismissTo).toHaveBeenCalledWith(`/creator/page-events?id=${page}`);expect(mockPush).not.toHaveBeenCalled();
 expect(stack).toEqual(['/creator/pages',`/creator/page-team?id=${page}`,`/creator/page-events?id=${page}`]);
 expect(state.create).not.toHaveBeenCalled();expect(state.respond).not.toHaveBeenCalled();
});
it('accepted invitation returns to the existing roster without leaving another invitation behind Back',()=>{
 state.account.viewerId='cedar';state.invitation={...inv,status:'accepted',currentPermissions:['page_content']};state.roster=null;
 let stack=['/creator/pages',`/creator/page-team?id=${page}`,`/creator/page-team?id=${page}&invitationId=invite`];
 mockDismissTo.mockImplementation(path=>{stack=stack.slice(0,stack.lastIndexOf(path)+1);});
 mount('invite');act(()=>action('View page team')!.props.onPress());
 expect(stack).toEqual(['/creator/pages',`/creator/page-team?id=${page}`]);expect(mockPush).not.toHaveBeenCalled();expect(state.respond).not.toHaveBeenCalled();
});
it('unready or unresolved team actions cannot switch workspaces',()=>{
 state.ready=false;mount();act(()=>action('Events')!.props.onPress());expect(mockDismissTo).not.toHaveBeenCalled();
 act(()=>tree.unmount());state.ready=true;state.recoveryRequired=true;mount();act(()=>action('Events')!.props.onPress());expect(mockDismissTo).not.toHaveBeenCalled();
});
it('organization chooser omits community membership requests',()=>{
 state.step='invite';state.roster.pageKind='organization';mount();
 expect(text()).not.toContain('Community membership requests');
});
it('owner edits and revocation have a separate confirmation before a write',()=>{
 state.editing={name:'Cedar'};state.step='edit_access';state.accessAction='edit';state.accessPermissions=['page_events'];mount();
 expect(action('Save page permissions')).toBeUndefined();act(()=>action('Review permissions')!.props.onPress());expect(state.reviewAccess).toHaveBeenCalled();expect(state.saveAccess).not.toHaveBeenCalled();
 act(()=>tree.unmount());state.step='review_access';state.accessAction='revoke';state.accessPermissions=[];mount();
 expect(text()).toContain('invitation and participation history');expect(state.saveAccess).not.toHaveBeenCalled();act(()=>action('Revoke page access')!.props.onPress());expect(state.saveAccess).toHaveBeenCalledTimes(1);
});
it('revoked invitation never presents an active team destination',()=>{
 state.invitation={...inv,status:'accepted',accessRevokedAt:'2026-09-15T02:00:00Z',currentPermissions:[]};state.roster=null;mount('invite');
 expect(text()).toContain('Page access revoked');expect(action('View page team')).toBeUndefined();expect(action('Accept invitation')).toBeUndefined();
});

it('accepted event permission exposes only the page event destination',()=>{
 state.account.viewerId='cedar';state.roster.canInvite=false;state.roster.assignments=[{userId:'cedar',available:true,revokedAt:null,permissions:['page_events'],assignmentId:'one',name:'Cedar'}];mount();expect(action('Events')).toBeDefined();
});
it('content-only and revoked event assignments do not expose event management',()=>{
 state.account.viewerId='cedar';state.roster.canInvite=false;state.roster.assignments=[{userId:'cedar',available:true,revokedAt:null,permissions:['page_content'],assignmentId:'one',name:'Cedar'}];mount();expect(action('Events')).toBeUndefined();
 act(()=>tree.unmount());state.roster.assignments[0]={...state.roster.assignments[0],permissions:['page_events'],revokedAt:'2026-09-15T01:00:00Z'};mount();expect(action('Events')).toBeUndefined();
});

it('request reviewers get the exact page inbox without event access',()=>{
 state.account.viewerId='cedar';state.roster.canInvite=false;state.roster.assignments=[{userId:'cedar',available:true,revokedAt:null,permissions:['membership_requests'],assignmentId:'one',name:'Cedar'}];mount();
 expect(action('Join requests')).toBeDefined();expect(action('Events')).toBeUndefined();act(()=>action('Join requests')!.props.onPress());expect(mockPush).toHaveBeenCalledWith('/creator/page-requests?id=page');
});
it('organization and revoked assignments have no request inbox link',()=>{
 state.roster.pageKind='organization';mount();expect(action('Join requests')).toBeUndefined();
 act(()=>tree.unmount());state.roster.pageKind='community';state.roster.canInvite=false;state.account.viewerId='cedar';state.roster.assignments=[{userId:'cedar',available:true,revokedAt:'2026-09-17',permissions:['membership_requests'],assignmentId:'one',name:'Cedar'}];mount();expect(action('Join requests')).toBeUndefined();
});

it('current content permission opens the same page editor with a team return',()=>{
 state.account.viewerId='cedar';state.roster.canInvite=false;state.roster.assignments=[{userId:'cedar',available:true,revokedAt:null,permissions:['page_content'],assignmentId:'one',name:'Cedar'}];mount();
 expect(action('Edit page')).toBeDefined();expect(action('Events')).toBeUndefined();act(()=>action('Edit page')!.props.onPress());expect(mockPush).toHaveBeenCalledWith('/creator/page-edit?id=page&mode=approved&from=team');
});
it.each(['page_events','membership_requests'])('%s alone cannot open approved content editing',permission=>{
 state.account.viewerId='cedar';state.roster.canInvite=false;state.roster.assignments=[{userId:'cedar',available:true,revokedAt:null,permissions:[permission],assignmentId:'one',name:'Cedar'}];mount();expect(action('Edit page')).toBeUndefined();
});
it('revoked content permission and failed access checks hide the edit destination',()=>{
 state.account.viewerId='cedar';state.roster.canInvite=false;state.roster.assignments=[{userId:'cedar',available:true,revokedAt:'2026-09-23',permissions:['page_content'],assignmentId:'one',name:'Cedar'}];mount();expect(action('Edit page')).toBeUndefined();
 act(()=>tree.unmount());state.roster.canInvite=true;state.readError='Account could not be checked';mount();expect(action('Edit page')).toBeUndefined();
});

it('accepted invitation presents current permissions once with a clear next action',()=>{
 state.account.viewerId='cedar';state.invitation={...inv,status:'accepted',currentPermissions:['page_content']};state.roster=null;mount('invite');
 expect(text()).toContain('Current page access');expect(text()).not.toContain('Selected page permissions');expect(text()).not.toContain('Original invitation:');expect(action('View page team')!.props.primary).toBe(true);
});
it('changed accepted access distinguishes current permissions from the original invitation',()=>{
 state.account.viewerId='cedar';state.invitation={...inv,status:'accepted',currentPermissions:['page_events']};state.roster=null;mount('invite');
 expect(text()).toContain('Current page access');expect(text()).toContain('Original invitation:');expect(text()).toContain('Page content');expect(text()).toContain('Page events');expect(action('Accept invitation')).toBeUndefined();
});

it('remeasures mounted team identity and owner copy without replacing controls or dispatching invites',()=>{
 const previous=Dimensions.get('window');act(()=>Dimensions.set({window:{...previous,fontScale:1}}));
 try{state.roster.pageKind='organization';mount();const screen=tree.root.findByType(Screen),scroll=tree.root.findByType(ScrollView),inviteAction=action('Invite a co-creator');
 const values=['Sunset Club','You’re the only creator here so far.'];const leaf=(v:string)=>tree.root.findAllByType(Text).find(n=>n.props.children===v)!;let leaves=values.map(leaf);expect(leaves.every(Boolean)).toBe(true);
 for(const fontScale of [1.35,1]){act(()=>Dimensions.set({window:{...previous,fontScale}}));values.forEach((v,i)=>expect(leaf(v)).not.toBe(leaves[i]));leaves=values.map(leaf);expect(tree.root.findByType(Screen)).toBe(screen);expect(tree.root.findByType(ScrollView)).toBe(scroll);expect(action('Invite a co-creator')).toBe(inviteAction);}
 expect(state.create).not.toHaveBeenCalled();expect(state.startInvite).not.toHaveBeenCalled();expect(mockPush).not.toHaveBeenCalled();
 }finally{act(()=>Dimensions.set({window:previous}));}
});
