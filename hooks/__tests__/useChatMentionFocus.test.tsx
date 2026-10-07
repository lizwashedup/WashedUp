import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Platform, type TextInput } from 'react-native';
import { useChatMentionFocus } from '../useChatMentionFocus';

let tree: ReactTestRenderer, request: (caret:number)=>void, frames:FrameRequestCallback[];
let current:boolean;
const isCurrent=()=>current;
const field={focus:jest.fn(),setNativeProps:jest.fn(),setSelectionRange:jest.fn()};
const input={current:field as unknown as TextInput};
function Harness(){request=useChatMentionFocus(input,isCurrent);return null;}
beforeEach(()=>{
  jest.clearAllMocks();current=true;frames=[];
  jest.spyOn(global,'requestAnimationFrame').mockImplementation(callback=>{frames.push(callback);return frames.length;});
  jest.spyOn(global,'cancelAnimationFrame').mockImplementation(()=>{});
  act(()=>{tree=create(<Harness/>);});
});
afterEach(()=>{act(()=>tree.unmount());jest.restoreAllMocks();});

it.each(['ios','android','web'] as const)('returns focus and caret after the %s input update',platform=>{
  jest.replaceProperty(Platform,'OS',platform);
  act(()=>request(16));expect(field.focus).not.toHaveBeenCalled();
  act(()=>frames[0](0));expect(field.focus).toHaveBeenCalledTimes(1);
  if(platform==='web')expect(field.setSelectionRange).toHaveBeenCalledWith(16,16);
  else expect(field.setNativeProps).toHaveBeenCalledWith({selection:{start:16,end:16}});
});

it('does not move focus for retired rooms or superseded selections',()=>{
  act(()=>request(5));act(()=>request(12));
  act(()=>frames[0](0));expect(field.focus).not.toHaveBeenCalled();
  current=false;act(()=>frames[1](0));expect(field.focus).not.toHaveBeenCalled();
});
