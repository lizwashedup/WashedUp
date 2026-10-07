import React from 'react';
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import { AccessibilityInfo, Dimensions, Keyboard, TextInput, View } from 'react-native';
jest.mock('../../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: { regular: 'System', medium: 'System' } }) }));
import { CommunityClassificationFields } from '../CommunityClassificationFields';
import { useApplicationFormGuidance } from '../../useApplicationFormGuidance';
let tree: ReactTestRenderer, api: ReturnType<typeof useApplicationFormGuidance>;
let previous: ReturnType<typeof Dimensions.get>;
const frames = new Map<number, FrameRequestCallback>();let nextFrame=0;
const scrollTo=jest.fn(), areaChange=jest.fn(), categoriesChange=jest.fn();
const firstScope={userId:'creator',visit:1};
const contentRef={current:{kind:'native-scroll-content'}} as unknown as React.RefObject<View>;
function Harness({scope=firstScope,missing=false}:{scope?:object;missing?:boolean}) {
 api=useApplicationFormGuidance(missing?['discovery_area']:[],{discovery_area:'Choose an area.'},{scope,stage:'page'});
 return <CommunityClassificationFields area={missing?null:'Santa Monica'} categories={['outdoors']} editable onAreaChange={areaChange} onCategoriesChange={categoriesChange} errors={{}}
 searchContentRef={contentRef} areaGuidance={api.field('discovery_area')} categoryGuidance={api.field('categories')} areaSearchGuidance={api.field('discovery_area_search')}/>;
}
const button=(label:string)=>tree.root.findAll(node=>typeof node.props.onPress==='function'&&node.props.accessibilityLabel===label)[0];
const search=()=>tree.root.findByType(TextInput);
const ancestorView=(node:ReactTestInstance):ReactTestInstance=>{let parent=node.parent;while(parent&&parent.type!==View)parent=parent.parent;return parent!;};
const area=()=>tree.root.findByType(CommunityClassificationFields).findAllByType(View)[0];
const layoutArea=(y:number)=>act(()=>area().props.onLayout({nativeEvent:{layout:{x:0,y,width:340,height:600}}}));
const flush=()=>act(()=>{const work=[...frames.values()];frames.clear();work.forEach(callback=>callback(0));});
const scale=(fontScale:number)=>act(()=>Dimensions.set({window:{...previous,width:390,fontScale}}));
function mount(missing=false){act(()=>{tree=create(<Harness missing={missing}/>);});api.scrollRef.current={scrollTo} as never;act(()=>button(`Area in LA: ${missing?'Choose an area':'Santa Monica'}`).props.onPress());layoutArea(500);}
function focusSearch(){const input=search();input.instance.isFocused=jest.fn(()=>true);input.instance.focus=jest.fn();act(()=>input.props.onFocus());return input;}
function measure(y:number){const view=ancestorView(search());view.instance.measureLayout=jest.fn((parent:unknown,done:(x:number,y:number,w:number,h:number)=>void)=>done(0,y,300,52));return view;}
beforeEach(()=>{jest.clearAllMocks();frames.clear();nextFrame=0;previous=Dimensions.get('window');scale(1);
 jest.spyOn(global,'requestAnimationFrame').mockImplementation(callback=>{frames.set(++nextFrame,callback);return nextFrame;});
 jest.spyOn(global,'cancelAnimationFrame').mockImplementation(id=>{frames.delete(id);});
 jest.spyOn(Keyboard,'dismiss').mockImplementation(()=>{});jest.spyOn(AccessibilityInfo,'announceForAccessibility').mockImplementation(()=>{});
});
afterEach(()=>{act(()=>tree?.unmount());act(()=>Dimensions.set({window:previous}));jest.restoreAllMocks();});
it('measures the nested search against native scroll content after scale even without inner or outer layout events',()=>{
 mount();const input=focusSearch();act(()=>input.props.onChangeText('santa'));const view=measure(740);flush();flush();expect(scrollTo).not.toHaveBeenCalled();view.instance.measureLayout.mockClear();
 scale(1.35);flush();expect(view.instance.measureLayout).toHaveBeenCalledTimes(1);expect(view.instance.measureLayout.mock.calls[0][0]).toBe(contentRef.current);flush();
 expect(scrollTo).toHaveBeenCalledTimes(1);expect(scrollTo).toHaveBeenLastCalledWith({y:724,animated:false});expect(search()).toBe(input);expect(input.props.value).toBe('santa');expect(input.instance.focus).not.toHaveBeenCalled();expect(Keyboard.dismiss).not.toHaveBeenCalled();expect(areaChange).not.toHaveBeenCalled();expect(categoriesChange).not.toHaveBeenCalled();
 scrollTo.mockClear();view.instance.measureLayout.mockImplementation((_p:unknown,done:Function)=>done(0,660,300,44));scale(1);flush();flush();expect(scrollTo).toHaveBeenCalledWith({y:644,animated:false});expect(search()).toBe(input);
});
it('rejects an obsolete measurement when the outer field moves and uses the latest native content coordinates',()=>{
 mount();focusSearch();const callbacks:Function[]=[];const view=measure(0);view.instance.measureLayout.mockImplementation((_p:unknown,done:Function)=>callbacks.push(done));flush();
 scale(1.35);flush();expect(callbacks).toHaveLength(2);layoutArea(800);act(()=>callbacks[1](0,240,300,52));expect(frames.size).toBe(1);flush();expect(callbacks).toHaveLength(3);act(()=>callbacks[2](0,1100,300,52));flush();expect(scrollTo).toHaveBeenCalledTimes(1);expect(scrollTo).toHaveBeenCalledWith({y:1084,animated:false});
});
it.each(['blur','collapse','unmount','scope'])('does not scroll from a delayed native measurement after %s',reason=>{
 mount();const input=focusSearch(),focus=input.instance.focus,callbacks:Function[]=[];const view=measure(0);view.instance.measureLayout.mockImplementation((_p:unknown,done:Function)=>callbacks.push(done));flush();scale(1.35);flush();expect(callbacks).toHaveLength(2);
 if(reason==='blur')act(()=>input.props.onBlur());
 else if(reason==='collapse')act(()=>button('Area in LA: Santa Monica').props.onPress());
 else if(reason==='scope')act(()=>tree.update(<Harness scope={{userId:'other',visit:2}}/>));
 else act(()=>tree.unmount());
 act(()=>callbacks[1](0,240,300,52));flush();expect(scrollTo).not.toHaveBeenCalled();expect(focus).not.toHaveBeenCalled();
});
it('keeps missing-area validation on the choice wrapper and dismisses the keyboard instead of focusing search',()=>{
 mount(true);const input=focusSearch();measure(240);flush();act(()=>api.revealFirstInvalid());flush();expect(scrollTo).toHaveBeenCalledWith({y:484,animated:false});expect(Keyboard.dismiss).toHaveBeenCalledTimes(1);expect(input.instance.focus).not.toHaveBeenCalled();expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Choose an area.');expect(areaChange).not.toHaveBeenCalled();
});

it('uses fresh content coordinates when native measurement resolves before the outer layout event',()=>{
 mount();focusSearch();const callbacks:Function[]=[];const view=measure(0);view.instance.measureLayout.mockImplementation((_p:unknown,done:Function)=>callbacks.push(done));flush();scale(1.35);flush();
 // Outer onLayout still reports its old y=500. Native measurement includes the
 // new outer y=800 plus nested y=300 in one coordinate space.
 act(()=>callbacks[1](0,1100,300,52));flush();expect(scrollTo).toHaveBeenCalledTimes(1);expect(scrollTo).toHaveBeenLastCalledWith({y:1084,animated:false});
 layoutArea(800);flush();act(()=>callbacks[2](0,1100,300,52));flush();expect(scrollTo).toHaveBeenCalledTimes(1);
});
