import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
const mockRead=jest.fn(),mockPush=jest.fn();
jest.mock('../../../../hooks/useCreatorPageRead',()=>({useCreatorPageRead:(...a:unknown[])=>mockRead(...a)}));
jest.mock('../../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:{regular:'System',medium:'System',semibold:'System',display:'System'}})}));
jest.mock('../../../../lib/creatorPageTeam',()=>({listMyPageTeamInvitations:jest.fn()}));
jest.mock('expo-router',()=>({router:{push:(...a:unknown[])=>mockPush(...a)},Stack:{Screen:()=>null}}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View}));
jest.mock('expo-linear-gradient',()=>({LinearGradient:require('react-native').View}));
import {CreatorPageTeamInvitations} from '../CreatorPageTeamInvitations';
import {PageAction} from '../PageFrame';
let tree:ReactTestRenderer,active=true;
const scope={userId:'cedar',isCurrent:()=>active};
const invite={invitationId:'exact-invite',pageId:'exact-page',pageKind:'community',pageName:'Community',status:'pending'};
const accepted={...invite,status:'accepted',currentPermissions:['page_content']};
const refresh=jest.fn();
const result=(data:any[],extra={})=>({data,loading:false,error:null,refresh,...extra});
function mount(value:any=scope){act(()=>{tree=create(<CreatorPageTeamInvitations scope={value}/>);});}
function update(value:any=scope){act(()=>tree.update(<CreatorPageTeamInvitations scope={value}/>));}
const copy=()=>JSON.stringify(tree.toJSON());
const actions=(label:string)=>tree.root.findAll(n=>typeof n.type!=='string'&&(n.props.accessibilityLabel===label||n.props.accessibilityLabel?.startsWith(label+', '))&&typeof n.props.onPress==='function');
const action=(label:string)=>actions(label)[0];
function history(){act(()=>action('Invitation history').props.onPress());}
beforeEach(()=>{jest.clearAllMocks();active=true;refresh.mockResolvedValue(undefined);mockRead.mockReturnValue(result([invite]));});
afterEach(()=>{act(()=>tree?.unmount());});
it('separates direct active spaces from pending invitations and uses exact existing destinations',()=>{
 mockRead.mockReturnValue(result([accepted,{...invite,invitationId:'pending-id',pageId:'organization-id',pageKind:'organization',pageName:'Organization'}]));mount();expect(copy()).toContain('Co-creator spaces');expect(copy()).toContain('Invitations to review');expect(copy()).toContain('Community · Co-creator');expect(copy()).toContain('Organization · Co-creator invitation');expect(copy()).not.toContain('Page invitations');expect(copy()).not.toContain('Your pages');act(()=>action('Open co-creator space: Community').props.onPress());expect(mockPush).toHaveBeenLastCalledWith('/creator/page-team?id=exact-page');act(()=>action('Review invitation: Organization').props.onPress());expect(mockPush).toHaveBeenLastCalledWith('/creator/page-team?id=organization-id&invitationId=pending-id');
});
it('one active destination per page keeps every original invitation in explicit history',()=>{
 mockRead.mockReturnValue(result([accepted,{...accepted,invitationId:'accepted-again'},{...invite,invitationId:'older-declined',status:'declined'}]));mount();expect(actions('Open co-creator space: Community')).toHaveLength(1);expect(actions('View invitation: Community')).toHaveLength(0);history();const rows=actions('View invitation: Community');expect(rows).toHaveLength(3);rows.forEach(row=>act(()=>row.props.onPress()));expect(mockPush.mock.calls.map(c=>c[0])).toEqual(['/creator/page-team?id=exact-page&invitationId=exact-invite','/creator/page-team?id=exact-page&invitationId=accepted-again','/creator/page-team?id=exact-page&invitationId=older-declined']);expect(copy()).toContain('Invitation accepted');expect(copy()).toContain('Invitation declined');
});
it.each(['declined','canceled','expired'])('%s history never presents active team access',status=>{
 mockRead.mockReturnValue(result([{...invite,status}]));mount();expect(copy()).not.toContain('Co-creator spaces');expect(copy()).not.toContain('Invitations to review');history();expect(copy()).toContain(`Invitation ${status}`);act(()=>action('View invitation: Community').props.onPress());expect(mockPush).toHaveBeenCalledWith('/creator/page-team?id=exact-page&invitationId=exact-invite');
});
it.each([{...accepted,accessRevokedAt:'2026-09-15T02:00:00Z'},{...accepted,currentPermissions:[]},{...accepted,currentPermissions:null}])('revoked or permissionless acceptance stays truthful history',invitation=>{
 mockRead.mockReturnValue(result([invitation]));mount();expect(copy()).not.toContain('Co-creator spaces');history();expect(copy()).toContain('accessRevokedAt' in invitation?'Access revoked':'No current team permissions');act(()=>action('View invitation: Community').props.onPress());expect(mockPush).toHaveBeenCalledWith('/creator/page-team?id=exact-page&invitationId=exact-invite');
});
it('loading keeps confirmed rows disabled, and old callbacks cannot bypass fresh loading/error or revocation',()=>{
 mockRead.mockReturnValue(result([accepted]));mount();const open=action('Open co-creator space: Community').props.onPress;mockRead.mockReturnValue(result([accepted],{loading:true}));update();expect(action('Open co-creator space: Community').props.disabled).toBe(true);act(()=>open());expect(mockPush).not.toHaveBeenCalled();mockRead.mockReturnValue(result([accepted],{error:'Unavailable'}));update();expect(copy()).not.toContain('Community · Co-creator');act(()=>open());expect(mockPush).not.toHaveBeenCalled();mockRead.mockReturnValue(result([{...accepted,accessRevokedAt:'2026-09-22'}]));update();act(()=>open());expect(mockPush).not.toHaveBeenCalled();
});
it('initial wait does not invent an empty list, and errors offer duplicate-locked explicit recovery',async()=>{
 mockRead.mockReturnValue(result([],{data:undefined,loading:true}));mount();expect(copy()).toContain('Checking co-creator spaces and invitations');expect(copy()).not.toContain('Create together');mockRead.mockReturnValue(result([invite],{error:'Unavailable'}));update();expect(copy()).not.toContain('Community');const pending=new Promise<void>(()=>{});refresh.mockReturnValue(pending);const retry=tree.root.findByType(PageAction).props.onPress;act(()=>{retry();retry();});expect(refresh).toHaveBeenCalledTimes(1);
});
it.each(['retired','account','unmount'])('old row/history/retry callbacks stay inert after %s',reason=>{
 mockRead.mockReturnValue(result([accepted]));mount();const open=action('Open co-creator space: Community').props.onPress,toggle=action('Invitation history').props.onPress;mockRead.mockReturnValue(result([],{error:'Unavailable'}));update();const retry=tree.root.findByType(PageAction).props.onPress;if(reason==='retired')active=false;if(reason==='account')update({userId:'another',isCurrent:()=>true});if(reason==='unmount')act(()=>tree.unmount());act(()=>{open();toggle();retry();});expect(mockPush).not.toHaveBeenCalled();expect(refresh).not.toHaveBeenCalled();
});
it('confirmed empty and absent scope keep their independent meanings',()=>{
 mockRead.mockReturnValue(result([]));mount();expect(copy()).toContain('Create together');expect(copy()).not.toContain('Invitations to review');update(null);expect(tree.toJSON()).toBeNull();
});
it('long real names remain complete, kinds are not invented and action labels stay concise',()=>{
 const name='The very long community of Sunday walks and evenings by the sea';mockRead.mockReturnValue(result([{...accepted,pageName:name,pageKind:undefined}]));mount();expect(copy()).toContain(name);expect(copy()).not.toContain('undefined');expect(copy()).toContain('Open');expect(action(`Open co-creator space: ${name}`)).toBeTruthy();
});

it('announces exact kind and visible invitation/access status for matching page names',()=>{
 mockRead.mockReturnValue(result([{...accepted,pageName:'Same name'},{...invite,pageName:'Same name',pageKind:'organization',pageId:'org',invitationId:'org-invite'},{...accepted,pageName:'Same name',pageId:'revoked',invitationId:'revoked-invite',accessRevokedAt:'2026-09-28'}]));mount();
 expect(action('Open co-creator space: Same name, Community · Co-creator')).toBeDefined();
 expect(action('Review invitation: Same name, Organization · Co-creator invitation')).toBeDefined();history();
 const revoked=action('View invitation: Same name, Community · Access revoked');expect(revoked).toBeDefined();
 act(()=>revoked.props.onPress());expect(mockPush).toHaveBeenCalledWith('/creator/page-team?id=revoked&invitationId=revoked-invite');
});
