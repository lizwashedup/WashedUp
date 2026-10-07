import React from 'react';
import { AccessibilityInfo, Keyboard, Dimensions } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useApplicationFormGuidance } from '../useApplicationFormGuidance';

let api: ReturnType<typeof useApplicationFormGuidance>, tree: ReactTestRenderer;
const messages = { name: 'Enter your name.', schedule: 'Choose a schedule.', other: 'Enter a schedule.', terms: 'Agree to the creator terms.' };
const Harness = ({ missing, reflow }: { missing: string[]; reflow?: { scope: object; stage: string } }) => { api = useApplicationFormGuidance(missing, messages, reflow); return null; };
const frames = new Map<number, FrameRequestCallback>();
const listeners = new Map<string, () => void>();
let nextFrame = 0;
let previous:ReturnType<typeof Dimensions.get>;
const scale=(fontScale:number)=>act(()=>Dimensions.set({window:{...previous,width:390,fontScale}}));
const scrollTo = jest.fn(), focus = jest.fn();
const flush = () => act(() => { const work = [...frames.values()]; frames.clear(); work.forEach(callback => callback(0)); });
const layout = (key: string, y: number) => api.field(key).onLayout({nativeEvent:{layout:{x:0,y,width:280,height:80}}} as never);
const mount = (missing: string[], reflow?:{scope:object;stage:string}) => { act(() => { tree = create(<Harness missing={missing} reflow={reflow}/>); }); api.scrollRef.current = { scrollTo } as never; };
beforeEach(() => {
  jest.clearAllMocks();
  frames.clear(); listeners.clear(); nextFrame = 0; scrollTo.mockReset(); focus.mockReset();
  previous=Dimensions.get('window');scale(1);
  jest.spyOn(global,'requestAnimationFrame').mockImplementation(callback => { frames.set(++nextFrame, callback); return nextFrame; });
  jest.spyOn(global,'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
  jest.spyOn(Keyboard,'addListener').mockImplementation((event, callback) => { listeners.set(event,()=>callback({} as never)); return {remove:()=>listeners.delete(event)} as never; });
  jest.spyOn(Keyboard,'dismiss').mockImplementation(()=>{});
  jest.spyOn(AccessibilityInfo,'announceForAccessibility').mockImplementation(()=>{});
});
afterEach(() => { if(tree) act(()=>tree.unmount()); act(()=>Dimensions.set({window:previous})); jest.restoreAllMocks(); });

it('shows errors only after Submit, focuses the earliest missing field and realigns after keyboard/layout changes', () => {
  mount(['name','terms']); layout('name',300); layout('terms',900); api.field('name').inputRef({focus} as never);
  expect(api.field('name').error).toBeUndefined();
  act(()=>api.revealFirstInvalid()); flush();
  expect(api.field('name').error).toBe('Enter your name.'); expect(api.field('terms').error).toBe('Agree to the creator terms.');
  expect(focus).toHaveBeenCalledTimes(1); expect(scrollTo).toHaveBeenLastCalledWith({y:284,animated:false});
  act(()=>layout('name',330)); act(()=>listeners.get('keyboardDidShow')!()); flush();
  expect(scrollTo).toHaveBeenLastCalledWith({y:314,animated:false}); expect(focus).toHaveBeenCalledTimes(1);
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Enter your name.');
});

it('waits for a conditional target layout, then focuses it once', () => {
  mount(['other']); api.field('other').inputRef({focus} as never);
  act(()=>api.revealFirstInvalid()); flush(); expect(focus).not.toHaveBeenCalled();
  act(()=>layout('other',480)); flush(); expect(focus).toHaveBeenCalledTimes(1);
  expect(scrollTo).toHaveBeenLastCalledWith({y:464,animated:false});
  api.field('other').inputRef(null); api.field('other').inputRef({focus} as never);
  act(()=>api.revealFirstInvalid()); flush(); expect(focus).toHaveBeenCalledTimes(1);
  act(()=>layout('other',620)); flush(); expect(focus).toHaveBeenCalledTimes(2);
  expect(scrollTo).toHaveBeenLastCalledWith({y:604,animated:false});
});

it('scrolls to choices and consent while dismissing the keyboard without changing any selection', () => {
  mount(['schedule','terms']); layout('schedule',480); act(()=>api.revealFirstInvalid()); flush();
  expect(Keyboard.dismiss).toHaveBeenCalledTimes(1); expect(focus).not.toHaveBeenCalled();
  expect(scrollTo).toHaveBeenLastCalledWith({y:464,animated:false});
  act(()=>tree.update(<Harness missing={['terms']}/>)); expect(api.field('schedule').error).toBeUndefined();
  layout('terms',840); act(()=>api.revealFirstInvalid()); flush();
  act(()=>listeners.get('keyboardDidHide')!()); flush();
  expect(scrollTo).toHaveBeenLastCalledWith({y:824,animated:false}); expect(Keyboard.dismiss).toHaveBeenCalledTimes(2);
});

it('clears resolved errors and cancels stale focus when a required condition is removed', () => {
  mount(['other']); layout('other',300); api.field('other').inputRef({focus} as never);
  act(()=>api.revealFirstInvalid()); act(()=>tree.update(<Harness missing={[]}/>)); flush();
  expect(api.field('other').error).toBeUndefined(); expect(focus).not.toHaveBeenCalled(); expect(scrollTo).not.toHaveBeenCalled();
});

it('respects manual touch/scroll or focus elsewhere and cancels pending work on unmount', () => {
  mount(['name']); layout('name',100); api.field('name').inputRef({focus} as never);
  act(()=>api.revealFirstInvalid()); act(()=>api.cancelReveal()); flush(); expect(focus).not.toHaveBeenCalled();
  act(()=>api.revealFirstInvalid()); act(()=>api.field('terms').onFocus()); flush(); expect(scrollTo).not.toHaveBeenCalled();
  act(()=>api.revealFirstInvalid()); act(()=>tree.unmount()); flush(); expect(focus).not.toHaveBeenCalled(); expect(listeners.size).toBe(0);
});

const reflowScope={scope:{userId:'creator',visit:1},stage:'page'};
function registerFocused(key='name'){
 const native={focus:jest.fn(),isFocused:jest.fn(()=>true),value:'Keep this exact draft',selection:{start:5,end:5}};
 api.field(key).inputRef(native as never);act(()=>api.field(key).onFocus());return native;
}
it('opts ordinary focused-input reflow in only for the creator editor that requests it',()=>{
 mount([]);const native=registerFocused();layout('name',200);scale(1.35);layout('name',420);act(()=>api.onContentSizeChange());flush();
 expect(scrollTo).not.toHaveBeenCalled();expect(native.focus).not.toHaveBeenCalled();expect(Keyboard.dismiss).not.toHaveBeenCalled();
});
it('waits for committed focused-field layout after a scale change, then scrolls once without refocusing or changing value/selection',()=>{
 mount([],reflowScope);const native=registerFocused();layout('name',200);scale(1.35);flush();
 act(()=>api.onViewportLayout());act(()=>api.onContentSizeChange());flush();expect(scrollTo).not.toHaveBeenCalled();
 act(()=>layout('name',460));act(()=>api.onViewportLayout());act(()=>api.onContentSizeChange());flush();
 expect(scrollTo).toHaveBeenCalledTimes(1);expect(scrollTo).toHaveBeenLastCalledWith({y:444,animated:false});
 expect(native.focus).not.toHaveBeenCalled();expect(Keyboard.dismiss).not.toHaveBeenCalled();expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();expect(native.value).toBe('Keep this exact draft');expect(native.selection).toEqual({start:5,end:5});
 act(()=>layout('name',500));act(()=>api.onViewportLayout());act(()=>api.onContentSizeChange());flush();expect(scrollTo).toHaveBeenCalledTimes(1);
 scale(1);act(()=>layout('name',200));flush();expect(scrollTo).toHaveBeenCalledTimes(2);expect(scrollTo).toHaveBeenLastCalledWith({y:184,animated:false});expect(native.focus).not.toHaveBeenCalled();
});
it.each(['blur','native focus lost','input removed','manual scroll'])('retires focused reflow on %s before the scheduled scroll can run',reason=>{
 mount([],reflowScope);const native=registerFocused();layout('name',200);scale(1.35);act(()=>layout('name',460));expect(frames.size).toBe(1);
 if(reason==='blur')act(()=>api.field('name').onBlur?.());
 else if(reason==='native focus lost')native.isFocused.mockReturnValue(false);
 else if(reason==='input removed')api.field('name').inputRef(null);
 else act(()=>api.onScrollBeginDrag());
 flush();expect(scrollTo).not.toHaveBeenCalled();expect(native.focus).not.toHaveBeenCalled();expect(Keyboard.dismiss).not.toHaveBeenCalled();
});
it('respects a deliberate focus change and never redirects the new input to the old field',()=>{
 mount([],reflowScope);const name=registerFocused();layout('name',200);scale(1.35);act(()=>layout('name',460));name.isFocused.mockReturnValue(false);
 const other=registerFocused('other');act(()=>api.field('name').onBlur?.());flush();expect(scrollTo).not.toHaveBeenCalled();
 scale(1);act(()=>layout('other',600));flush();expect(scrollTo).toHaveBeenLastCalledWith({y:584,animated:false});expect(name.focus).not.toHaveBeenCalled();expect(other.focus).not.toHaveBeenCalled();
});
it.each(['stage','account','unmount'])('retires old focused callbacks and targets on %s',reason=>{
 mount([],reflowScope);const native=registerFocused();layout('name',200);scale(1.35);const old=api.field('name');act(()=>layout('name',460));expect(frames.size).toBe(1);
 if(reason==='unmount')act(()=>tree.unmount());
 else act(()=>tree.update(<Harness missing={[]} reflow={reason==='stage'?{...reflowScope,stage:'creator'}:{scope:{userId:'other'},stage:'page'}}/>));
 act(()=>{old.onFocus();old.onLayout({nativeEvent:{layout:{y:900}}} as never);old.onBlur?.();});flush();expect(scrollTo).not.toHaveBeenCalled();expect(native.focus).not.toHaveBeenCalled();
});
it('does not let an old stage blur/layout cancel the newly focused stage input',()=>{
 mount([],reflowScope);registerFocused();layout('name',200);const old=api.field('name');
 act(()=>tree.update(<Harness missing={[]} reflow={{...reflowScope,stage:'creator'}}/>));const next=registerFocused();layout('name',300);scale(1.35);act(()=>layout('name',420));
 act(()=>{old.onLayout({nativeEvent:{layout:{y:900}}} as never);old.onBlur?.();old.onFocus();});flush();expect(scrollTo).toHaveBeenLastCalledWith({y:404,animated:false});expect(next.focus).not.toHaveBeenCalled();
});
it('keeps invalid-field reveal authoritative and focuses it only once during text-size reflow',()=>{
 mount(['name'],reflowScope);const native=registerFocused();layout('name',200);act(()=>api.revealFirstInvalid());flush();expect(native.focus).toHaveBeenCalledTimes(1);
 scale(1.35);act(()=>layout('name',460));act(()=>api.onViewportLayout());flush();expect(scrollTo).toHaveBeenLastCalledWith({y:444,animated:false});expect(native.focus).toHaveBeenCalledTimes(1);expect(Keyboard.dismiss).not.toHaveBeenCalled();expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);
});

it('realigns the focused input after its validation error resolves, without refocusing the now-valid field',()=>{
 mount(['name'],reflowScope);const native=registerFocused();layout('name',200);act(()=>api.revealFirstInvalid());flush();expect(native.focus).toHaveBeenCalledTimes(1);
 act(()=>tree.update(<Harness missing={[]} reflow={reflowScope}/>));scrollTo.mockClear();scale(1.35);act(()=>layout('name',460));flush();
 expect(scrollTo).toHaveBeenCalledTimes(1);expect(scrollTo).toHaveBeenLastCalledWith({y:444,animated:false});expect(native.focus).toHaveBeenCalledTimes(1);expect(Keyboard.dismiss).not.toHaveBeenCalled();
});
it('keeps the same native focused input through a synchronous ref handoff without another focus event',()=>{
 mount([],reflowScope);const native=registerFocused();layout('name',200);
 act(()=>{api.field('name').inputRef(null);api.field('name').inputRef(native as never);});
 scale(1.35);act(()=>layout('name',460));flush();expect(scrollTo).toHaveBeenCalledWith({y:444,animated:false});expect(native.focus).not.toHaveBeenCalled();expect(Keyboard.dismiss).not.toHaveBeenCalled();
});
it('pauses an armed target across same-input ref handoff and waits for fresh post-handoff geometry',()=>{
 mount([],reflowScope);const native=registerFocused();layout('name',200);scale(1.35);act(()=>layout('name',400));expect(frames.size).toBe(1);
 act(()=>api.field('name').inputRef(null));flush();expect(scrollTo).not.toHaveBeenCalled();
 act(()=>api.field('name').inputRef(native as never));act(()=>api.onContentSizeChange());flush();expect(scrollTo).not.toHaveBeenCalled();
 act(()=>layout('name',460));flush();expect(scrollTo).toHaveBeenCalledTimes(1);expect(scrollTo).toHaveBeenCalledWith({y:444,animated:false});expect(native.focus).not.toHaveBeenCalled();
});
it.each(['different input','not focused','blur','manual drag','cancel','scope','stage','unmount'])('does not restore a ref handoff after %s',reason=>{
 mount([],reflowScope);const native=registerFocused();layout('name',200);const old=api.field('name');act(()=>old.inputRef(null));
 if(reason==='not focused')native.isFocused.mockReturnValue(false);
 else if(reason==='blur')act(()=>old.onBlur?.());
 else if(reason==='manual drag')act(()=>api.onScrollBeginDrag());
 else if(reason==='cancel')act(()=>api.cancelReveal());
 else if(reason==='scope')act(()=>tree.update(<Harness missing={[]} reflow={{scope:{userId:'other'},stage:'page'}}/>));
 else if(reason==='stage')act(()=>tree.update(<Harness missing={[]} reflow={{...reflowScope,stage:'creator'}}/>));
 else if(reason==='unmount')act(()=>tree.unmount());
 act(()=>old.inputRef((reason==='different input'?{...native,isFocused:()=>true}:native) as never));
 if(reason!=='unmount'){scale(1.35);act(()=>layout('name',460));}flush();expect(scrollTo).not.toHaveBeenCalled();expect(native.focus).not.toHaveBeenCalled();
});
it('expires an unmatched detach before a later asynchronous attachment can revive focus',async()=>{
 mount([],reflowScope);const native=registerFocused();layout('name',200);act(()=>api.field('name').inputRef(null));await act(async()=>{await Promise.resolve();});
 act(()=>api.field('name').inputRef(native as never));scale(1.35);act(()=>layout('name',460));flush();expect(scrollTo).not.toHaveBeenCalled();expect(native.focus).not.toHaveBeenCalled();
});
it('does not let an earlier handoff expiry clear a newer synchronous handoff',async()=>{
 mount([],reflowScope);const native=registerFocused();layout('name',200);
 act(()=>{api.field('name').inputRef(null);api.field('name').inputRef(native as never);api.field('name').inputRef(null);api.field('name').inputRef(native as never);});
 await act(async()=>{await Promise.resolve();});scale(1.35);act(()=>layout('name',460));flush();expect(scrollTo).toHaveBeenCalledWith({y:444,animated:false});
});
