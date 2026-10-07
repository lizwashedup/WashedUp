import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Dimensions, Keyboard, Modal, ScrollView, Text, TextInput, TouchableOpacity } from 'react-native';
const mockSubmit=jest.fn(),mockLegacy=jest.fn();
jest.mock('@tanstack/react-query',()=>({useQuery:()=>({data:null})}));
jest.mock('../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:require('../../../constants/Typography').AfterglowFonts})}));
jest.mock('../../../lib/haptics',()=>({hapticLight:jest.fn(),hapticSuccess:jest.fn()}));
jest.mock('../../../lib/communityLeader',()=>({getLeaderCards:jest.fn()}));
jest.mock('../../../lib/supabase',()=>({supabase:{}}));
jest.mock('../../../constants/FeatureFlags',()=>({CONFIGURABLE_JOIN_QUESTIONS_ENABLED:false}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View}));
jest.mock('../../../lib/communityJoin',()=>({...jest.requireActual('../../../lib/communityJoin'),requestToJoinCommunity:(...a:any[])=>mockLegacy(...a)}));
import { JoinCommunityPopup } from '../JoinCommunityPopup';
let tree:ReactTestRenderer;
const gate={communityId:'page',name:'Sunday Table',welcomeMessage:null,introQuestion:'Introduce yourself',guidelinesUrl:null,askReason:true,askSource:false,askRulesConfirm:false,openQuestion:null};
const base={visible:true,gate,joinsInstantly:true,onClose:jest.fn(),onRequested:jest.fn()};
const input=(name:string)=>tree.root.findAllByType(TextInput).find(n=>n.props.accessibilityLabel===name);
const button=(label:string)=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel===label);
async function mount(flow:any={submit:mockSubmit,locked:false},previewMode=false){await act(async()=>{tree=create(<JoinCommunityPopup {...base} flow={flow} previewMode={previewMode}/>);});}
async function fill(){for(const [name,value] of Object.entries({'First name':'Juniper','Last name':'Synthetic','Email':'private@example.invalid','ZIP code':'90026','Introduce yourself':'I enjoy drawing'})){await act(async()=>input(name)!.props.onChangeText(value));}await act(async()=>{tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityRole==='checkbox')!.props.onPress();});}
beforeEach(()=>{jest.clearAllMocks();mockSubmit.mockResolvedValue(undefined);});
afterEach(async()=>{if(tree)await act(async()=>tree.unmount());});
it('new page flow displays saved required questions even when the legacy rollout flag is off',async()=>{await mount();expect(input('Why do you want to join?')).toBeDefined();expect(input('How did you hear about this community?')).toBeUndefined();expect(JSON.stringify(tree.toJSON())).toContain('Extra answers stay out of chat.');});
it('legacy form retains its independent rollout behavior',async()=>{await mount(null);expect(input('Why do you want to join?')).toBeUndefined();});
it('required visible answers block sending before the controller is called',async()=>{await mount();await fill();await act(async()=>button('Join community')!.props.onPress());expect(mockSubmit).not.toHaveBeenCalled();expect(JSON.stringify(tree.toJSON())).toContain('Tell us why you want to join.');});
it('valid form forwards only enabled fields to the page-specific controller',async()=>{await mount();await fill();await act(async()=>input('Why do you want to join?')!.props.onChangeText('Private reason'));await act(async()=>button('Join community')!.props.onPress());expect(mockSubmit).toHaveBeenCalledTimes(1);expect(mockSubmit.mock.calls[0][0]).toMatchObject({email:'private@example.invalid',reason_answer:'Private reason'});expect(mockSubmit.mock.calls[0][0].source_answer).toBeUndefined();expect(mockLegacy).not.toHaveBeenCalled();expect(base.onRequested).not.toHaveBeenCalled();});
it('pending recovery shows a compact status instead of an empty application or ordinary submit action',async()=>{await mount({submit:mockSubmit,locked:true,message:'Checking your request'});expect(tree.root.findAllByType(TextInput)).toHaveLength(0);expect(tree.root.findAllByType(TouchableOpacity).filter(n=>n.props.accessibilityRole==='checkbox')).toHaveLength(0);expect(JSON.stringify(tree.toJSON())).toContain('Checking your request');expect(button('Join community')).toBeUndefined();expect(button('Close joining form')).toBeDefined();});
it('creator preview remains non-submitting',async()=>{await mount(null,true);expect(button('Join community')).toBeUndefined();expect(mockSubmit).not.toHaveBeenCalled();expect(mockLegacy).not.toHaveBeenCalled();});


it('remeasures mounted applicant copy without replacing typed fields, controls, unchecked assent or validation',async()=>{
 const previous=Dimensions.get('window');act(()=>Dimensions.set({window:{...previous,width:390,fontScale:1}}));
 const dismiss=jest.spyOn(Keyboard,'dismiss').mockImplementation(()=>{});
 try{
  await mount();await act(async()=>input('First name')!.props.onChangeText('Cedar'));
  await act(async()=>button('Join community')!.props.onPress());
  const popup=tree.root.findByType(JoinCommunityPopup),modal=tree.root.findByType(Modal),scroll=tree.root.findByType(ScrollView);
  const fields=tree.root.findAllByType(TextInput),change=input('First name')!.props.onChangeText;
  const close=button('Close joining form')!,send=button('Join community')!,closeAction=close.props.onPress,sendAction=send.props.onPress;
  const checkbox=tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityRole==='checkbox')!;
  expect(checkbox.props.accessibilityState.checked).toBe(false);
  const copy=['join Sunday Table','first name','last name','Your introduction is shared with community members after you join. Extra answers stay out of chat.','Introduce yourself','join','community guidelines'];
  const leaf=(value:string)=>tree.root.findAllByType(Text).find(n=>n.props.children===value)!;
  let leaves=copy.map(leaf);expect(leaves.every(Boolean)).toBe(true);
  const problem=()=>tree.root.findAllByType(Text).find(n=>n.props.accessibilityRole==='alert')!;
  let error=problem();const errorCopy=error.props.children;expect(errorCopy).toMatch(/last name/i);
  const disclosure=()=>tree.root.findAllByType(Text).find(n=>Array.isArray(n.props.children)&&n.props.children.join('').includes('before you apply'))!;
  let policy=disclosure();expect(policy).toBeDefined();
  for(const fontScale of [1.35,1]){
   act(()=>Dimensions.set({window:{...previous,width:390,fontScale}}));
   copy.forEach((value,index)=>expect(leaf(value)).not.toBe(leaves[index]));leaves=copy.map(leaf);
   expect(problem()).not.toBe(error);error=problem();expect(error.props.children).toBe(errorCopy);expect(disclosure()).not.toBe(policy);policy=disclosure();
   expect(tree.root.findByType(JoinCommunityPopup)).toBe(popup);expect(tree.root.findByType(Modal)).toBe(modal);expect(tree.root.findByType(ScrollView)).toBe(scroll);
   tree.root.findAllByType(TextInput).forEach((field,index)=>expect(field).toBe(fields[index]));expect(input('First name')!.props.value).toBe('Cedar');expect(input('First name')!.props.onChangeText).toBe(change);
   expect(button('Close joining form')).toBe(close);expect(close.props.onPress).toBe(closeAction);expect(button('Join community')).toBe(send);expect(send.props.onPress).toBe(sendAction);
   expect(tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityRole==='checkbox')).toBe(checkbox);expect(checkbox.props.accessibilityState.checked).toBe(false);
   expect(dismiss).not.toHaveBeenCalled();expect(mockSubmit).not.toHaveBeenCalled();expect(mockLegacy).not.toHaveBeenCalled();
  }
 }finally{dismiss.mockRestore();act(()=>Dimensions.set({window:previous}));}
});
