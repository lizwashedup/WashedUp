import React from 'react';
import { Modal, Platform, TouchableOpacity } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ChatOptionsButton } from '../ChatOptionsButton';
import { AfterglowFallbackFonts } from '../../../constants/Typography';
let tree:ReactTestRenderer, current:boolean;
const navigate=jest.fn(),notifications=jest.fn();
const props=()=>({fonts:AfterglowFallbackFonts,isCurrent:()=>current,contextLabel:'View community',onViewContext:navigate,notificationLabel:'Mute chat',notificationBusy:false,onNotifications:notifications});
const button=(label:string)=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel===label)!;
function mount(){act(()=>{tree=create(<ChatOptionsButton {...props()}/>);});act(()=>button('Chat options').props.onPress());}
beforeEach(()=>{jest.replaceProperty(Platform,'OS','ios');jest.clearAllMocks();current=true;});
afterEach(()=>{act(()=>tree?.unmount());jest.restoreAllMocks();});
it('dismisses before navigating and admits one choice per presentation',()=>{
 mount();const view=button('View community').props.onPress;
 act(()=>{view();view();});expect(navigate).not.toHaveBeenCalled();expect(tree.root.findByType(Modal).props.visible).toBe(false);
 act(()=>tree.root.findByType(Modal).props.onDismiss());expect(navigate).toHaveBeenCalledTimes(1);
 act(()=>tree.root.findByType(Modal).props.onDismiss());expect(navigate).toHaveBeenCalledTimes(1);
});
it.each(['account','unmount'])('retires the pending choice on %s',reason=>{
 mount();act(()=>button('View community').props.onPress());const dismiss=tree.root.findByType(Modal).props.onDismiss;
 if(reason==='account')current=false;else act(()=>tree.unmount());act(()=>dismiss());expect(navigate).not.toHaveBeenCalled();
});
it('keeps notification controls inside options and reports checking as disabled',()=>{
 mount();act(()=>tree.update(<ChatOptionsButton {...props()} notificationBusy notificationLabel="Checking notifications"/>));
 expect(button('Checking notifications').props.disabled).toBe(true);expect(button('Checking notifications').props.accessibilityState.busy).toBe(true);
});
it('closes before applying a notification preference',()=>{
 mount();act(()=>button('Mute chat').props.onPress());expect(notifications).not.toHaveBeenCalled();
 act(()=>tree.root.findByType(Modal).props.onDismiss());expect(notifications).toHaveBeenCalledTimes(1);
});
