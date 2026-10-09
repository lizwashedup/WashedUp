import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Alert } from 'react-native';
import CircleDetailScreen from '../../../app/circle/[id]';
import CircleNoticeboard from '../CircleNoticeboard';
import AddPeopleSheet from '../AddPeopleSheet';
import NameCircleSheet from '../NameCircleSheet';
import CirclePlanComposer from '../plan/CirclePlanComposer';
import { BrandedAlert } from '../../BrandedAlert';
import { COPY } from '../../yours/state/constants';
let mockCircle='circle-a',mockUser:string|null='alice',mockEpoch=1,mockError=false,mockLoading=false,mockEnabled=true,mockName='Friends',mockRole='admin',mockCount=3,mockPending=false,mockFocused=true;
const mockDismissTo=jest.fn(),mockPush=jest.fn(),mockBack=jest.fn(),mockDismiss=jest.fn(),mockRefetch=jest.fn(),mockLeave=jest.fn();
const mockMember=(id:string,name:string)=>({user_id:id,first_name_display:name,profile_photo_url:null,role:id===mockUser?mockRole:'member'});
jest.mock('expo-router',()=>({Redirect:()=>null,useLocalSearchParams:()=>({id:mockCircle}),useRouter:()=>({push:mockPush,dismissTo:mockDismissTo,back:mockBack,dismissAll:mockDismiss})}));
jest.mock('@react-navigation/native',()=>({useIsFocused:()=>mockFocused}));
jest.mock('../../../constants/FeatureFlags',()=>({get GROUPS_ENABLED(){return mockEnabled;}}));
jest.mock('../../yours/state/useAuthUserId',()=>({useAuthUserId:()=>({data:'alice'})}));
jest.mock('../../../hooks/useCircle',()=>({useCircle:()=>{
 const React=require('react');const viewerId=mockUser,viewerEpoch=mockEpoch;
 const isCurrentViewer=React.useCallback(()=>viewerId===mockUser&&viewerEpoch===mockEpoch,[viewerId,viewerEpoch]);
 return {data:mockError||mockLoading?undefined:{circle:{id:mockCircle,name:mockName,room_enabled:false,cover_upload_id:null},members:[mockMember(mockUser??'alice','Me'),mockMember('jamie','Jamie'),...(mockCount===3?[mockMember('cara','Cara')]:[])]},isLoading:mockLoading,isError:mockError,refetch:mockRefetch,viewerId,viewerEpoch,isCurrentViewer};
}}));
jest.mock('../../../hooks/useLeaveCircle',()=>({useLeaveCircle:()=>({mutateAsync:(id:string)=>new Promise((resolve,reject)=>mockLeave(id,{onSuccess:resolve,onError:reject})),isPending:mockPending}),isObsoleteCircleLeave:(error:any)=>error?.name==='ObsoleteCircleLeaveError'}));
jest.mock('../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:jest.requireActual('../../../constants/Typography').AfterglowFonts})}));
jest.mock('../../../lib/haptics',()=>({hapticSelection:jest.fn()}));
jest.mock('../../ProfileButton',()=>({__esModule:true,default:()=>null}));
jest.mock('../CircleNoticeboard',()=>({__esModule:true,default:()=>null}));
jest.mock('../RoomSlot',()=>({__esModule:true,default:()=>null}));
jest.mock('../AddPeopleSheet',()=>({__esModule:true,default:()=>null}));
jest.mock('../NameCircleSheet',()=>({__esModule:true,default:()=>null}));
jest.mock('../plan/CirclePlanComposer',()=>({__esModule:true,default:()=>null}));
jest.mock('../../BrandedAlert',()=>({BrandedAlert:()=>null}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View}));
jest.mock('lucide-react-native',()=>({ChevronLeft:()=>null,MoreHorizontal:()=>null}));
let tree:ReactTestRenderer;
const board=()=>tree.root.findByType(CircleNoticeboard).props;
const add=()=>tree.root.findByType(AddPeopleSheet).props;
const name=()=>tree.root.findAllByType(NameCircleSheet).find(n=>n.props.mode!=='edit')!.props;
const plan=()=>tree.root.findByType(CirclePlanComposer).props;
const alert=()=>tree.root.findByType(BrandedAlert).props;
const button=(label:string)=>tree.root.findAll(n=>n.props.accessibilityLabel===label && typeof n.props.onPress==='function')[0].props;
async function render(){await act(async()=>{if(tree)tree.update(<CircleDetailScreen/>);else tree=create(<CircleDetailScreen/>);});}
async function move(kind:'room'|'account'|'access'){if(kind==='room')mockCircle='circle-b';else if(kind==='account'){mockUser='bob';mockEpoch++;}else mockError=true;await render();}
beforeEach(()=>{jest.clearAllMocks();mockCircle='circle-a';mockUser='alice';mockEpoch=1;mockError=false;mockLoading=false;mockEnabled=true;mockName='Friends';mockRole='admin';mockCount=3;mockPending=false;mockFocused=true;jest.spyOn(Alert,'alert').mockImplementation(()=>{});});
afterEach(()=>{act(()=>tree?.unmount());tree=undefined as any;jest.restoreAllMocks();});
it('supplies one stable readable scope to both sheets across ordinary metadata refresh',async()=>{
 await render();const scope=plan().scope;expect(scope).toMatchObject({userId:'alice'});expect(scope.isCurrent()).toBe(true);expect(add().scope).toBe(scope);
 act(()=>{board().onPostPlan();board().onAddPeople();});expect(plan().visible).toBe(true);expect(add().visible).toBe(true);await render();expect(plan().scope).toBe(scope);expect(add().scope).toBe(scope);expect(plan().visible).toBe(true);expect(add().visible).toBe(true);
});
it('passes the active account scope to plans and preserves direct plan navigation',async()=>{
 await render(); const old=board(); const scope=old.plansScope;
 expect(scope).toMatchObject({userId:'alice',epoch:1});expect(scope.isCurrent()).toBe(true);
 expect(old.operationScope).toBe(plan().scope);
 await render();expect(board().plansScope).toBe(scope);
 act(()=>board().onOpenPlan('plan-a'));expect(mockPush).toHaveBeenCalledWith('/plan/plan-a');mockPush.mockClear();
 await move('account');expect(scope.isCurrent()).toBe(false);
 act(()=>old.onOpenPlan('old-plan'));expect(mockPush).not.toHaveBeenCalled();expect(mockDismissTo).not.toHaveBeenCalled();
 expect(board().plansScope).toMatchObject({userId:'bob',epoch:2});
});
it('preserves current sheet actions, IDs, chat route and close-before-post navigation',async()=>{
 await render();act(()=>board().onOpenChat());expect(mockDismissTo).toHaveBeenCalledWith('/(tabs)/chats/circle/circle-a');mockDismissTo.mockClear();
 mockFocused=false;await render();mockFocused=true;await render();
 act(()=>{board().onPostPlan();board().onAddPeople();});expect(add().existingMemberIds).toEqual(['alice','jamie','cara']);expect(plan()).toMatchObject({circleId:'circle-a',circleName:'Friends',isDm:false});
 const callbacks=plan();act(()=>{callbacks.onClose();callbacks.onPosted({event_id:'plan-a',has_own_chat:true});});expect(plan().visible).toBe(false);expect(mockPush).toHaveBeenCalledWith('/plan/plan-a');
 mockPush.mockClear();act(()=>plan().onPosted({event_id:'whole-circle',has_own_chat:false}));expect(mockPush).not.toHaveBeenCalled();expect(mockDismissTo).not.toHaveBeenCalled();act(()=>add().onClose());expect(add().visible).toBe(false);
});
it('coalesces repeated plan and chat navigation and retires callbacks on focus return',async()=>{
 await render();const old=board(),scope=board().plansScope;
 act(()=>{old.onOpenPlan('plan-a');old.onOpenPlan('plan-a');old.onOpenChat();});expect(mockPush).toHaveBeenCalledTimes(1);
 mockFocused=false;await render();expect(scope.isCurrent()).toBe(true);expect(board().plansScope).toBe(scope);
 act(()=>board().onOpenChat());expect(mockPush).toHaveBeenCalledTimes(1);
 mockFocused=true;await render();act(()=>old.onOpenPlan('old'));expect(mockPush).toHaveBeenCalledTimes(1);
 act(()=>board().onOpenChat());expect(mockPush).toHaveBeenCalledTimes(1);expect(mockDismissTo).toHaveBeenCalledTimes(1);
});
it('permits only one back action for a focused visit',async()=>{
 await render();const back=button(COPY.circleHomeBack);act(()=>{back.onPress();back.onPress();});expect(mockBack).toHaveBeenCalledTimes(1);
});
it.each(['room','account','access'] as const)('retires old opens, closes, post and navigation on %s change',async kind=>{
 await render();const oldBoard=board(),oldPlan=plan(),oldAdd=add(),oldBack=button(COPY.circleHomeBack).onPress;act(()=>{oldBoard.onPostPlan();oldBoard.onAddPeople();});await move(kind);
 if(kind==='access'){mockError=false;await render();}
 act(()=>{board().onPostPlan();board().onAddPeople();});expect(plan().visible).toBe(true);expect(add().visible).toBe(true);
 act(()=>{oldPlan.onClose();oldAdd.onClose();oldPlan.onPosted({event_id:'old',has_own_chat:true});oldBoard.onOpenChat();oldBack();});expect(plan().visible).toBe(true);expect(add().visible).toBe(true);expect(mockPush).not.toHaveBeenCalled();expect(mockDismissTo).not.toHaveBeenCalled();expect(mockBack).not.toHaveBeenCalled();
 act(()=>{plan().onClose();add().onClose();oldBoard.onPostPlan();oldBoard.onAddPeople();});expect(plan().visible).toBe(false);expect(add().visible).toBe(false);
});
it('retires callbacks after account ABA before any parent rerender',async()=>{
 await render();const old=board(),oldPlan=plan();mockEpoch+=2;act(()=>{old.onPostPlan();old.onOpenChat();oldPlan.onPosted({event_id:'old',has_own_chat:true});});expect(mockPush).not.toHaveBeenCalled();expect(mockDismissTo).not.toHaveBeenCalled();expect(plan().visible).toBe(false);
});
it('revokes the old admission scope permanently across access error and recovery',async()=>{
 await render();const scope=plan().scope;act(()=>board().onPostPlan());mockError=true;await render();expect(scope.isCurrent()).toBe(false);expect(plan().visible).toBe(false);expect(add().visible).toBe(false);
 mockError=false;await render();expect(scope.isCurrent()).toBe(false);expect(plan().scope.isCurrent()).toBe(true);expect(plan().scope).not.toBe(scope);
});
it('uses the observed account for naming gates and preserves unnamed DM classification',async()=>{
 mockUser='bob';mockName='';await render();expect(typeof board().onNameCircle).toBe('function');expect(name().userId).toBe('bob');act(()=>board().onNameCircle());expect(name().visible).toBe(true);act(()=>name().onClose());mockCount=2;await render();expect(board().onNameCircle).toBeUndefined();expect(plan()).toMatchObject({isDm:true,circleName:'Jamie'});
});
it('does not reuse a naming callback after the account loses the admin role',async()=>{
 mockName='';await render();const oldName=board().onNameCircle,scope=name().scope;expect(scope.isCurrent()).toBe(true);mockRole='member';await render();expect(scope.isCurrent()).toBe(false);expect(board().onNameCircle).toBeUndefined();act(()=>oldName());expect(name().visible).toBe(false);
});
it('keeps naming scope through metadata refresh and retires it on account ABA',async()=>{
 mockName='';await render();const scope=name().scope;act(()=>board().onNameCircle());await render();expect(name().scope).toBe(scope);expect(scope.isCurrent()).toBe(true);expect(name().visible).toBe(true);
 mockEpoch+=2;expect(scope.isCurrent()).toBe(false);await render();expect(name().visible).toBe(false);expect(name().scope).not.toBe(scope);
});
it('ends naming authority once the circle has been named',async()=>{
 mockName='';await render();const scope=name().scope;act(()=>board().onNameCircle());mockName='Friends';await render();expect(scope.isCurrent()).toBe(false);expect(name().visible).toBe(false);
});
it.each(['room','account','access'] as const)('suppresses late leave completion and error after %s change',async kind=>{
 await render();act(()=>button(COPY.circleHomeMore).onPress());const confirmation=alert();act(()=>{confirmation.onClose();confirmation.buttons[1].onPress();});expect(mockLeave).toHaveBeenCalledTimes(1);const callbacks=mockLeave.mock.calls[0][1];await move(kind);
 await act(async()=>{callbacks.onSuccess('left');callbacks.onError(new Error('old error'));});expect(mockDismiss).not.toHaveBeenCalled();expect(Alert.alert).not.toHaveBeenCalled();
});
it('preserves current leave confirmation order, duplicate guard and retry after error',async()=>{
 await render();act(()=>button(COPY.circleHomeMore).onPress());const confirmation=alert();act(()=>{confirmation.onClose();confirmation.buttons[1].onPress();confirmation.buttons[1].onPress();});expect(mockLeave).toHaveBeenCalledTimes(1);
 await act(async()=>mockLeave.mock.calls[0][1].onError(new Error('failure')));expect(Alert.alert).toHaveBeenCalledWith(COPY.circleLeaveError);act(()=>button(COPY.circleHomeMore).onPress());act(()=>{void alert().buttons[1].onPress();});expect(mockLeave).toHaveBeenCalledTimes(2);await act(async()=>mockLeave.mock.calls[1][1].onSuccess('left'));expect(mockDismiss).toHaveBeenCalledTimes(1);
});
it('keeps the current error retry and loading back action usable while retiring an old retry',async()=>{
 mockError=true;await render();const retry=button(COPY.circlesRetry);act(()=>{retry.onPressIn();retry.onPress();retry.onPressOut();});expect(mockRefetch).toHaveBeenCalledTimes(1);await move('account');act(()=>{retry.onPress();retry.onPressIn();retry.onPressOut();});expect(mockRefetch).toHaveBeenCalledTimes(1);
 mockError=false;mockLoading=true;await render();act(()=>button(COPY.circleHomeBack).onPress());expect(mockBack).toHaveBeenCalledTimes(1);
});
it('retires retained parent callbacks on unmount',async()=>{
 await render();const oldBoard=board(),oldPlan=plan(),oldScope=plan().scope;act(()=>tree.unmount());act(()=>{oldBoard.onOpenChat();oldPlan.onPosted({event_id:'old',has_own_chat:true});});expect(mockPush).not.toHaveBeenCalled();expect(mockDismissTo).not.toHaveBeenCalled();expect(oldScope.isCurrent()).toBe(false);
});
it('keeps the existing feature and missing-route redirect gates',async()=>{
 mockEnabled=false;await render();expect(tree.root.findAllByType(CircleNoticeboard)).toHaveLength(0);mockEnabled=true;mockCircle='';await render();expect(tree.root.findAllByType(CircleNoticeboard)).toHaveLength(0);
});

it('does not let the old hook pending state block a new entry or clear its leave attempt',async()=>{
 await render();act(()=>button(COPY.circleHomeMore).onPress());act(()=>{void alert().buttons[1].onPress();});const old=mockLeave.mock.calls[0][1];mockPending=true;await move('account');
 act(()=>button(COPY.circleHomeMore).onPress());act(()=>{void alert().buttons[1].onPress();});expect(mockLeave).toHaveBeenCalledTimes(2);const fresh=mockLeave.mock.calls[1][1];
 await act(async()=>old.onError(new Error('old')));expect(Alert.alert).not.toHaveBeenCalled();await act(async()=>fresh.onSuccess('left'));expect(mockDismiss).toHaveBeenCalledTimes(1);
});


it('releases an obsolete leave preflight without removing the page or trapping retry',async()=>{
 await render();act(()=>button(COPY.circleHomeMore).onPress());act(()=>{void alert().buttons[1].onPress();});
 await act(async()=>mockLeave.mock.calls[0][1].onError(Object.assign(new Error('Retired'),{name:'ObsoleteCircleLeaveError'})));
 expect(Alert.alert).not.toHaveBeenCalled();expect(mockDismiss).not.toHaveBeenCalled();
 act(()=>button(COPY.circleHomeMore).onPress());act(()=>{void alert().buttons[1].onPress();});expect(mockLeave).toHaveBeenCalledTimes(2);
 await act(async()=>mockLeave.mock.calls[1][1].onSuccess('not_member'));expect(mockDismiss).toHaveBeenCalledTimes(1);
});
