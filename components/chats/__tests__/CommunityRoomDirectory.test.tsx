import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Dimensions, Text, TextInput, TouchableOpacity } from 'react-native';
import { CommunityRoomDirectory } from '../CommunityRoomDirectory';
import { BrandedAlert } from '../../BrandedAlert';
let mockNotifications:any, mockCreator:any, mockDirectory:any, mockUser='member', mockEpoch=1;
jest.mock('../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:jest.requireActual('../../../constants/Typography').AfterglowFonts})}));
jest.mock('../../../hooks/useObservedUser',()=>({useObservedUser:()=>({viewerId:mockUser,epoch:mockEpoch})}));
jest.mock('../../../hooks/useCommunityRoomDirectory',()=>({useCommunityRoomDirectory:()=>mockDirectory}));
jest.mock('../../../hooks/useCommunityChatPreference',()=>({useCommunityChatPreference:()=>mockNotifications}));
jest.mock('../../../hooks/useCreatorCommunityGroups',()=>({useCreatorCommunityGroups:()=>mockCreator}));
jest.mock('../../BrandedAlert',()=>({BrandedAlert:()=>null}));
const rooms=[
 {id:'intro',name:'Say hello',role:'intros',storage:'topic',included:true,joined:true},
 {id:'community',name:'After Glow',role:'main',storage:'broadcast',included:true,joined:true},
 {id:'walks',name:'Beach walks',role:'optional',storage:'topic',included:false,joined:false},
 {id:'coffee',name:'Coffee',role:'optional',storage:'topic',included:false,joined:true},
];
const cleanup:Array<()=>void>=[];
function setup(){const onOpen=jest.fn();let tree!:ReactTestRenderer;const node=()=> <CommunityRoomDirectory communityId="community" enabled onOpen={onOpen} fallback={<Text>Original legacy rooms</Text>}/>;act(()=>{tree=create(node());});cleanup.push(()=>act(()=>tree.unmount()));return{tree,onOpen,update:()=>act(()=>tree.update(node())),button:(label:string)=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel===label)};}
beforeEach(()=>{mockNotifications={data:{muted:false,version:0},ready:true,busy:false,pending:null,notice:null,error:null,change:jest.fn(),check:jest.fn(),retry:jest.fn(),refresh:jest.fn()};mockCreator={allowed:false,busy:false,form:null};mockUser='member';mockEpoch=1;mockDirectory={data:{name:'Community',rooms},ready:true,loading:false,error:null,busy:false,pending:null,isCurrent:()=>true,change:jest.fn().mockResolvedValue(true),check:jest.fn(),retry:jest.fn(),refresh:jest.fn()};});
afterEach(()=>cleanup.splice(0).forEach(f=>f()));
it('shows original core identities with Open and no individual leave control',()=>{const f=setup();expect(f.button('Open Say hello')).toBeDefined();expect(f.button('Open After Glow')).toBeDefined();expect(f.button('Leave Say hello')).toBeUndefined();expect(f.button('Leave After Glow')).toBeUndefined();expect(f.button('Join Beach walks')).toBeDefined();expect(f.button('Leave Coffee')).toBeDefined();expect(mockDirectory.change).not.toHaveBeenCalled();});
it('opens the same optional topic only after confirmed joining',async()=>{const f=setup();await act(async()=>{f.button('Join Beach walks')!.props.onPress();});expect(mockDirectory.change).toHaveBeenCalledWith('walks',true);expect(f.onOpen).toHaveBeenCalledWith(rooms[2]);});
it('does not navigate for an uncertain or retired join result',async()=>{mockDirectory.change.mockResolvedValue(undefined);const f=setup();await act(async()=>{f.button('Join Beach walks')!.props.onPress();});expect(f.onOpen).not.toHaveBeenCalled();mockDirectory.change.mockResolvedValue(true);mockDirectory.isCurrent=()=>false;await act(async()=>{f.button('Join Beach walks')!.props.onPress();});expect(f.onOpen).not.toHaveBeenCalled();});
it('requires explicit leave confirmation and retires the prompt across an account switch',()=>{const f=setup();act(()=>f.button('Leave Coffee')!.props.onPress());const alert=f.tree.root.findByType(BrandedAlert);expect(alert.props.visible).toBe(true);expect(mockDirectory.change).not.toHaveBeenCalled();act(()=>alert.props.buttons.find((b:any)=>b.text==='Cancel').onPress());expect(mockDirectory.change).not.toHaveBeenCalled();act(()=>f.button('Leave Coffee')!.props.onPress());mockUser='other';mockEpoch++;f.update();expect(f.tree.root.findByType(BrandedAlert).props.visible).toBe(false);});
it('keeps Check status distinct from an explicit same-action retry and blocks another membership action',()=>{mockDirectory.pending={topicId:'walks',joined:true,retryReady:false};const f=setup();expect(f.button('Check Beach walks membership')).toBeDefined();expect(f.button('Retry joining Beach walks')).toBeUndefined();expect(f.button('Leave Coffee')!.props.disabled).toBe(true);act(()=>f.button('Check Beach walks membership')!.props.onPress());expect(mockDirectory.check).toHaveBeenCalledTimes(1);expect(mockDirectory.change).not.toHaveBeenCalled();mockDirectory.pending.retryReady=true;f.update();act(()=>f.button('Retry joining Beach walks')!.props.onPress());expect(mockDirectory.retry).toHaveBeenCalledTimes(1);});
it('shows failed loading with retry, retains cached rooms on refresh failure and preserves an unmapped fallback',()=>{mockDirectory.data=undefined;mockDirectory.error=Error('Offline');const f=setup();expect(f.button('Retry community chats')).toBeDefined();expect(JSON.stringify(f.tree.toJSON())).not.toContain('Original legacy rooms');mockDirectory.data={name:'Community',rooms};f.update();expect(f.button('Open After Glow')).toBeDefined();expect(f.button('Refresh community chats')).toBeDefined();mockDirectory.error=null;mockDirectory.data=null;f.update();expect(JSON.stringify(f.tree.toJSON())).toContain('Original legacy rooms');});
it('keeps uncertain recovery reachable when the pending optional room disappears from refreshed data',()=>{mockDirectory.pending={topicId:'removed',joined:false,retryReady:false};const f=setup();expect(f.button('Check unavailable group membership')).toBeDefined();act(()=>f.button('Check unavailable group membership')!.props.onPress());expect(mockDirectory.check).toHaveBeenCalledTimes(1);});
it('adds creation and same-room rename only for the verified creator',()=>{mockCreator={allowed:true,ready:true,busy:false,form:null,startCreate:jest.fn(),startRename:jest.fn()};const f=setup();act(()=>f.button('Create community group')!.props.onPress());act(()=>f.button('Rename Say hello')!.props.onPress());expect(mockCreator.startCreate).toHaveBeenCalledTimes(1);expect(mockCreator.startRename).toHaveBeenCalledWith(rooms[0]);mockCreator.allowed=false;f.update();expect(f.button('Create community group')).toBeUndefined();expect(f.button('Rename Say hello')).toBeUndefined();});
it('separates uncertain creator checking from explicit retry and disables membership changes',()=>{mockCreator={allowed:true,ready:true,busy:false,form:{kind:'create',draft:'Walks',pending:true,retryReady:false},check:jest.fn(),retry:jest.fn()};const f=setup();expect(f.button('Retry saved creator change')).toBeUndefined();expect(f.button('Join Beach walks')!.props.disabled).toBe(true);act(()=>f.button('Check creator change')!.props.onPress());expect(mockCreator.check).toHaveBeenCalledTimes(1);mockCreator.form.retryReady=true;f.update();act(()=>f.button('Retry saved creator change')!.props.onPress());expect(mockCreator.retry).toHaveBeenCalledTimes(1);});

it('keeps notification settings inside conversations and opens the exact main chat',()=>{
 const f=setup();expect(f.button('Mute all community chats')).toBeUndefined();expect(f.button('Unmute all community chats')).toBeUndefined();
 act(()=>f.button('Open After Glow')!.props.onPress());expect(f.onOpen).toHaveBeenCalledWith(rooms[1]);
 expect(mockNotifications.change).not.toHaveBeenCalled();
});
it('keeps optional groups explicit and introduction navigation distinct',()=>{
 const f=setup();act(()=>f.button('Open Say hello')!.props.onPress());expect(f.onOpen).toHaveBeenCalledWith(rooms[0]);
 expect(f.button('Join Beach walks')).toBeDefined();expect(mockDirectory.change).not.toHaveBeenCalled();
});

it('remeasures mounted directory copy and controls while preserving an in-progress rename and room identities',()=>{
 const previous=Dimensions.get('window');act(()=>Dimensions.set({window:{...previous,width:390,fontScale:1}}));
 try{
  const longName='The long way home — coastal walks and coffee after';
  mockDirectory.data={name:'Reading Together',rooms:rooms.map(room=>room.id==='coffee'?{...room,name:longName}:room)};
  const target=mockDirectory.data.rooms.find((room:any)=>room.id==='coffee');
  mockCreator={allowed:true,ready:true,busy:false,form:{kind:'rename',room:target,draft:longName,pending:false},setDraft:jest.fn(),submit:jest.fn(),cancel:jest.fn()};
  const f=setup();mockCreator.setDraft.mockImplementation((value:string)=>{mockCreator.form={...mockCreator.form,draft:value};f.update();});
  act(()=>f.tree.root.findByType(TextInput).props.onChangeText('Coastal conversations — unfinished'));
  const input=f.tree.root.findByType(TextInput),directory=f.tree.root.findByType(CommunityRoomDirectory),alert=f.tree.root.findByType(BrandedAlert);
  const controlLabels=['Open '+longName,'Join Beach walks','Save chat name','Cancel chat name'];const controls=controlLabels.map(label=>f.button(label));
  const copy=['Chats','Say hello, catch up, or join a conversation that interests you.',longName,'Rename '+longName,'Your conversation and its history stay together.','Save name','Cancel','Join'];
  const leaf=(value:string)=>f.tree.root.findAllByType(Text).find(node=>node.props.children===value)!;let leaves=copy.map(leaf);expect(leaves.every(Boolean)).toBe(true);
  for(const fontScale of [1.35,1]){
   act(()=>Dimensions.set({window:{...previous,width:390,fontScale}}));
   copy.forEach((value,index)=>expect(leaf(value)).not.toBe(leaves[index]));leaves=copy.map(leaf);
   expect(f.tree.root.findByType(CommunityRoomDirectory)).toBe(directory);expect(f.tree.root.findByType(TextInput)).toBe(input);expect(input.props.value).toBe('Coastal conversations — unfinished');
   expect(f.tree.root.findByType(BrandedAlert)).toBe(alert);expect(alert.props.visible).toBe(false);
   controlLabels.forEach((label,index)=>expect(f.button(label)).toBe(controls[index]));expect(f.button('Join Beach walks')!.props.disabled).toBe(true);expect(f.button('Open '+longName)!.props.disabled).toBe(true);
   expect(mockCreator.setDraft).toHaveBeenCalledTimes(1);expect(mockCreator.submit).not.toHaveBeenCalled();expect(mockCreator.cancel).not.toHaveBeenCalled();expect(mockDirectory.change).not.toHaveBeenCalled();expect(mockDirectory.check).not.toHaveBeenCalled();expect(f.onOpen).not.toHaveBeenCalled();
  }
 }finally{act(()=>Dimensions.set({window:previous}));}
});
