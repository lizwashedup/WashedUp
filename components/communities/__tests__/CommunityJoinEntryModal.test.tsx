import {Modal,TextInput,TouchableOpacity} from 'react-native';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockGate=jest.fn(),mockMembership=jest.fn(),mockAttempt=jest.fn(),mockCheck=jest.fn(),mockSend=jest.fn(),mockCancel=jest.fn(),mockFinish=jest.fn(),mockClose=jest.fn(),mockConfirmed=jest.fn();
let mockScope:any,mockLive=true,mockLegacy:any=null;
let mockScopesByPage:Record<string,any>|undefined;
jest.mock('../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:(pageId:string)=>({scope:mockScopesByPage?.[pageId] ?? mockScope,account:{isLoading:false,error:null,retry:jest.fn()}})}));
jest.mock('../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:require('../../../constants/Typography').AfterglowFonts})}));
jest.mock('../../../lib/creatorCommunityJoin',()=>({readCreatorCommunityJoinGate:(...a:any[])=>mockGate(...a),readOwnCommunityMembership:(...a:any[])=>mockMembership(...a),readCommunityJoinAttempt:(...a:any[])=>mockAttempt(...a),checkCommunityJoinRequest:(...a:any[])=>mockCheck(...a),sendCommunityJoinRequest:(...a:any[])=>mockSend(...a),cancelCommunityJoinRequest:(...a:any[])=>mockCancel(...a),finishCommunityJoinRequest:(...a:any[])=>mockFinish(...a)}));
jest.mock('../../../lib/communityJoin',()=>({...jest.requireActual('../../../lib/communityJoin'),getJoinGate:async()=>mockLegacy}));
jest.mock('@tanstack/react-query',()=>({useQuery:()=>({data:null})}));
jest.mock('../../../lib/haptics',()=>({hapticLight:jest.fn(),hapticSuccess:jest.fn()}));
jest.mock('expo-router',()=>({Stack:{Screen:()=>null}}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View}));
import { CommunityJoinEntry } from '../CommunityJoinEntry';
import { JoinCommunityPopup } from '../JoinCommunityPopup';
import { PageAction } from '../../creator/pages/PageFrame';
let tree:ReactTestRenderer,pending:any,receipt:any,membership:any;
const gate={communityId:'page',name:'Sunday Table',creatorPageVersion:2,creatorPagePolicy:'open',askReason:true};
const answer={first_name:'Juniper',last_name:'Test',email:'private@example.invalid',zip:'90026',intro_answer:'Hello',guidelines_accepted:true,reason_answer:'A reason'};
const props={communityId:'page',visible:true,legacyJoinsInstantly:false,onClose:mockClose,onConfirmed:mockConfirmed};
const form=()=>tree.root.findByType(JoinCommunityPopup), action=(title:string)=>tree.root.findAllByType(PageAction).find(n=>n.props.title===title);
const text=()=>JSON.stringify(tree.toJSON());
async function mount(p=props){await act(async()=>{tree=create(<CommunityJoinEntry {...p}/>);});}
async function press(title:string){await act(async()=>{action(title)!.props.onPress();});}
async function submit(){await act(async()=>{await form().props.flow.submit(answer);});}
beforeEach(()=>{jest.clearAllMocks();mockScopesByPage=undefined;mockLive=true;mockScope={userId:'member',isCurrent:()=>mockLive};mockLegacy=null;pending=null;receipt=null;membership=null;
 mockGate.mockImplementation(async()=>gate);mockMembership.mockImplementation(async()=>membership);mockAttempt.mockImplementation(async()=>pending);mockCheck.mockImplementation(async()=>receipt);
 mockSend.mockImplementation(async()=>{pending={id:'request'};receipt={outcome:'submitted',current_status:'active'};return receipt;});
 mockCancel.mockImplementation(async()=>{receipt={outcome:'cancelled',current_status:null};return receipt;});mockFinish.mockImplementation(async()=>{pending=null;return receipt;});});
afterEach(async()=>{if(tree)await act(async()=>tree.unmount());jest.useRealTimers();});

const held=()=>{let resolve!:(v:any)=>void;const promise=new Promise<any>(r=>resolve=r);return{promise,resolve};};
const input=(label:string)=>tree.root.findAllByType(TextInput).find(n=>n.props.accessibilityLabel===label)!;
const closeButton=()=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Close joining form')!;
it.each(['creator','legacy'] as const)('keeps the original native host when delayed %s questions become ready',async kind=>{
 const gateRead=held();mockGate.mockReturnValueOnce(gateRead.promise);if(kind==='legacy')mockLegacy={communityId:'page',name:'Legacy community'};
 await mount();const host=tree.root.findByType(Modal);expect(tree.root.findAllByType(JoinCommunityPopup)).toHaveLength(0);
 await act(async()=>gateRead.resolve(kind==='creator'?gate:null));
 expect(tree.root.findAllByType(Modal)).toHaveLength(1);expect(tree.root.findByType(Modal)).toBe(host);
 expect(input('First name')).toBeDefined();expect(form().props.gate.communityId).toBe('page');
 expect(mockSend).not.toHaveBeenCalled();expect(mockConfirmed).not.toHaveBeenCalled();
 act(()=>closeButton().props.onPress());expect(mockClose).toHaveBeenCalledTimes(1);
});
it('keeps one host through opening failure and explicit retry into questions',async()=>{
 mockGate.mockRejectedValueOnce(Error('Temporary read failure'));await mount();const host=tree.root.findByType(Modal);expect(text()).toContain('Temporary read failure');
 await press('Try again');expect(tree.root.findByType(Modal)).toBe(host);expect(tree.root.findAllByType(Modal)).toHaveLength(1);expect(input('First name')).toBeDefined();expect(mockSend).not.toHaveBeenCalled();
});
it('resets cancelled questions content without replacing the presenting host',async()=>{
 pending={id:'request'};receipt={outcome:'cancelled',current_status:null};await mount();const host=tree.root.findByType(Modal),original=form();
 expect(tree.root.findAllByType(TextInput)).toHaveLength(0);await press('Review questions');
 expect(form()).not.toBe(original);expect(tree.root.findByType(Modal)).toBe(host);expect(input('First name').props.value).toBe('');expect(mockSend).not.toHaveBeenCalled();
});
it('removes old private fields on account change while retaining one host and retiring old Close',async()=>{
 await mount();act(()=>input('First name').props.onChangeText('Cedar private'));const host=tree.root.findByType(Modal),oldClose=closeButton().props.onPress;
 const gateRead=held();mockGate.mockReturnValueOnce(gateRead.promise);mockScope={userId:'replacement',isCurrent:()=>true};
 await act(async()=>tree.update(<CommunityJoinEntry {...props}/>));expect(tree.root.findAllByType(TextInput)).toHaveLength(0);expect(tree.root.findByType(Modal)).toBe(host);
 act(()=>oldClose());expect(mockClose).not.toHaveBeenCalled();await act(async()=>gateRead.resolve(gate));
 expect(input('First name').props.value).toBe('');expect(tree.root.findByType(Modal)).toBe(host);expect(mockSend).not.toHaveBeenCalled();
});
it('closing before gate completion removes the host and late data cannot reopen it',async()=>{
 const gateRead=held();mockGate.mockReturnValueOnce(gateRead.promise);await mount();const host=tree.root.findByType(Modal);
 await act(async()=>tree.update(<CommunityJoinEntry {...props} visible={false}/>));expect(tree.root.findAllByType(Modal)).toHaveLength(0);
 await act(async()=>gateRead.resolve(gate));expect(tree.root.findAllByType(Modal)).toHaveLength(0);expect(tree.root.findAllByType(JoinCommunityPopup)).toHaveLength(0);
 await act(async()=>tree.update(<CommunityJoinEntry {...props}/>));expect(tree.root.findAllByType(Modal)).toHaveLength(1);expect(tree.root.findByType(Modal)).not.toBe(host);expect(input('First name').props.value).toBe('');expect(mockSend).not.toHaveBeenCalled();
});

it.each(['legacy','preview'] as const)('retains the default standalone %s Modal across visibility changes',async kind=>{
 const standalone={visible:true,gate:{communityId:'page',name:'Standalone page',welcomeMessage:null,introQuestion:null,guidelinesUrl:null,askReason:false,askSource:false,askRulesConfirm:false,openQuestion:null},onClose:mockClose,onRequested:mockConfirmed,previewMode:kind==='preview'};
 await act(async()=>{tree=create(<JoinCommunityPopup {...standalone}/>);});
 const host=tree.root.findByType(Modal);expect(tree.root.findAllByType(Modal)).toHaveLength(1);
 expect(host.props).toMatchObject({visible:true,animationType:'slide',presentationStyle:'pageSheet',onRequestClose:mockClose});
 await act(async()=>tree.update(<JoinCommunityPopup {...standalone} visible={false}/>));
 expect(tree.root.findByType(Modal)).toBe(host);expect(host.props.visible).toBe(false);
 await act(async()=>tree.update(<JoinCommunityPopup {...standalone}/>));
 expect(tree.root.findByType(Modal)).toBe(host);expect(host.props.visible).toBe(true);
 act(()=>host.props.onRequestClose());expect(mockClose).toHaveBeenCalledTimes(1);expect(mockSend).not.toHaveBeenCalled();expect(mockConfirmed).not.toHaveBeenCalled();
});
