import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Modal, Platform, TouchableOpacity } from 'react-native';
import { MessageActionsMenu, type MessageMenu } from '../MessageActionsMenu';
import { QuickReactionBar } from '../QuickReactionBar';
import { messageActionAccess, messageActionWeb } from '../messageActionAccess';
let tree: ReactTestRenderer;
let current: boolean;
const react = jest.fn(), more = jest.fn(), edit = jest.fn(), close = jest.fn();
function opening(): MessageMenu { return {title:'Jamie', preview:'See you by the water.', isCurrent:()=>current, onReact:react, selectedReaction:'❤️', buttons:[{text:'react',onPress:more},{text:'edit',onPress:edit},{text:'cancel',style:'cancel'}]}; }
const button=(label:string)=>tree.root.findAllByType(TouchableOpacity).find(node=>node.props.accessibilityLabel===label)!;
const modal=()=>tree.root.findByType(Modal).props;
beforeEach(()=>{ jest.clearAllMocks(); current=true; Object.defineProperty(Platform,'OS',{configurable:true,value:'ios'}); });
afterEach(()=>{ act(()=>tree?.unmount()); });
async function mount(menu=opening()){await act(async()=>{tree=create(<MessageActionsMenu menu={menu} onClose={close}/>);});return menu;}
it('waits for modal dismissal before opening the full picker and ignores duplicate taps',async()=>{
 await mount();const press=button('More reactions').props.onPress;act(()=>{press();press();});
 expect(modal().visible).toBe(false);expect(more).not.toHaveBeenCalled();
 act(()=>modal().onDismiss());expect(close).toHaveBeenCalledTimes(1);expect(more).toHaveBeenCalledTimes(1);
 act(()=>modal().onDismiss());expect(more).toHaveBeenCalledTimes(1);
});
it('shows selection and dispatches the chosen emoji once after closing',async()=>{
 await mount();expect(button('React with ❤️').props.accessibilityState.selected).toBe(true);
 act(()=>button('React with ❤️').props.onPress());expect(react).not.toHaveBeenCalled();
 act(()=>modal().onDismiss());expect(react).toHaveBeenCalledWith('❤️');expect(react).toHaveBeenCalledTimes(1);
});
it('closes without dispatching when permission or the selected message is lost',async()=>{
 await mount();act(()=>button('Edit').props.onPress());current=false;act(()=>modal().onDismiss());
 expect(edit).not.toHaveBeenCalled();expect(close).toHaveBeenCalledTimes(1);
});
it('retires an old dismissal when another room opens a menu',async()=>{
 await mount();act(()=>button('Edit').props.onPress());const stale=modal().onDismiss;
 const next=opening();await act(async()=>tree.update(<MessageActionsMenu menu={next} onClose={close}/>));
 act(()=>stale());expect(edit).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();expect(modal().visible).toBe(true);
});
it('allows dismissing a menu even after its permissions expire',async()=>{
 await mount();current=false;act(()=>button('Close message actions').props.onPress());act(()=>modal().onDismiss());
 expect(close).toHaveBeenCalledTimes(1);expect(edit).not.toHaveBeenCalled();expect(react).not.toHaveBeenCalled();
});
it('does not offer reactions for a read-only message',async()=>{
 await mount({...opening(),onReact:undefined,buttons:[{text:'copy',onPress:edit}]});
 expect(tree.root.findAllByType(QuickReactionBar)).toHaveLength(0);
});
it('offers equivalent screen-reader and keyboard actions without hijacking typing',()=>{
 const open=jest.fn();Object.defineProperty(Platform,'OS',{configurable:true,value:'web'});const props={...messageActionAccess(open),...messageActionWeb(open)};
 props.onAccessibilityAction({nativeEvent:{actionName:'messageActions'}} as any);
 const preventDefault=jest.fn();props.onKeyDownCapture?.({key:'F10',shiftKey:true,preventDefault});
 props.onKeyDownCapture?.({key:'a',shiftKey:false,preventDefault});
 props.onContextMenu?.({preventDefault});expect(open).toHaveBeenCalledTimes(3);expect(preventDefault).toHaveBeenCalledTimes(2);
});

it('lets the web focus trap unmount before handing focus to the next action',async()=>{
 Object.defineProperty(Platform,'OS',{configurable:true,value:'web'});
 let frame!:FrameRequestCallback;const raf=jest.spyOn(global,'requestAnimationFrame').mockImplementation(callback=>{frame=callback;return 1;});
 const cancel=jest.spyOn(global,'cancelAnimationFrame').mockImplementation(()=>{});
 try{await mount();act(()=>button('Edit').props.onPress());expect(modal().onDismiss).toBeUndefined();expect(edit).not.toHaveBeenCalled();
 act(()=>frame(0));expect(edit).toHaveBeenCalledTimes(1);}
 finally{raf.mockRestore();cancel.mockRestore();}
});

// Android does not emit iOS Modal.onDismiss; the chosen reaction must still run.
it.each(['quick', 'picker'] as const)('dispatches the Android %s reaction action once after closing', async action => {
 Object.defineProperty(Platform,'OS',{configurable:true,value:'android'});
 let frame!:FrameRequestCallback;const raf=jest.spyOn(global,'requestAnimationFrame').mockImplementation(callback=>{frame=callback;return 1;});
 const cancel=jest.spyOn(global,'cancelAnimationFrame').mockImplementation(()=>{});
 try {
  await mount(); const press=button(action==='quick'?'React with ❤️':'More reactions').props.onPress;
  act(()=>{press();press();});expect(modal().visible).toBe(false);expect(modal().onDismiss).toBeUndefined();
  expect(react).not.toHaveBeenCalled();expect(more).not.toHaveBeenCalled();
  act(()=>{frame(0);frame(1);});expect(close).toHaveBeenCalledTimes(1);
  if(action==='quick'){expect(react).toHaveBeenCalledTimes(1);expect(react).toHaveBeenCalledWith('❤️');expect(more).not.toHaveBeenCalled();}
  else{expect(more).toHaveBeenCalledTimes(1);expect(react).not.toHaveBeenCalled();}
 } finally {raf.mockRestore();cancel.mockRestore();}
});

it('retires an Android reaction when the room changes before its frame callback',async()=>{
 Object.defineProperty(Platform,'OS',{configurable:true,value:'android'});
 let frame!:FrameRequestCallback;const raf=jest.spyOn(global,'requestAnimationFrame').mockImplementation(callback=>{frame=callback;return 1;});
 const cancel=jest.spyOn(global,'cancelAnimationFrame').mockImplementation(()=>{});
 try {await mount();act(()=>button('React with ❤️').props.onPress());const stale=frame;
 await act(async()=>tree.update(<MessageActionsMenu menu={opening()} onClose={close}/>));
 act(()=>stale(0));expect(react).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();
 } finally{raf.mockRestore();cancel.mockRestore();}
});
