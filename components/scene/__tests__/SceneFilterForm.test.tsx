import React from 'react';
import { Modal,TextInput,TouchableOpacity,Text,StyleSheet,View,ScrollView } from 'react-native';
import { act,create,type ReactTestRenderer } from 'react-test-renderer';
import { SceneFilterForm } from '../SceneFilterForm';
import WashedUpCalendar from '../../calendar/WashedUpCalendar';
import { emptySceneFilters } from '../../../lib/sceneFilters';
jest.mock('../../calendar/WashedUpCalendar',()=>({__esModule:true,default:()=>null}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View,SafeAreaProvider:require('react-native').View,initialWindowMetrics:{insets:{top:59,bottom:34,left:0,right:0},frame:{x:0,y:0,width:390,height:844}}}));
let mockDimensions = { width: 390, height: 844, fontScale: 1, scale: 3 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockDimensions }));
let tree:ReactTestRenderer;const apply=jest.fn(),cancel=jest.fn();
const press=(label:string)=>act(()=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel===label)!.props.onPress());
const type=(label:string,value:string)=>act(()=>tree.root.findAllByType(TextInput).find(n=>n.props.accessibilityLabel===label)!.props.onChangeText(value));
beforeEach(()=>{jest.clearAllMocks();mockDimensions = { width: 390, height: 844, fontScale: 1, scale: 3 };act(()=>{tree=create(<SceneFilterForm kind="events" applied={{...emptySceneFilters(),area:'Santa Monica',query:'dinner'}} onApply={apply} onCancel={cancel}/>);});});
afterEach(()=>act(()=>tree.unmount()));
it('keeps edits and Clear private until applied; hardware back cancels once',()=>{
 type('City or area','Venice');press('Clear filter draft');expect(apply).not.toHaveBeenCalled();
 act(()=>tree.root.findByType(Modal).props.onRequestClose());act(()=>tree.root.findByType(Modal).props.onRequestClose());
 expect(cancel).toHaveBeenCalledTimes(1);expect(apply).not.toHaveBeenCalled();
});
it('holds an invalid range open, then applies the corrected same-day inclusive range once',()=>{
 press('From date, any date');act(()=>tree.root.findByType(WashedUpCalendar).props.onSelect({year:2026,month:8,day:20}));
 press('Through date, any date');act(()=>tree.root.findByType(WashedUpCalendar).props.onSelect({year:2026,month:8,day:19}));
 press('Show events');expect(apply).not.toHaveBeenCalled();expect(JSON.stringify(tree.toJSON())).toContain('Through must be on or after From');
 press('Through date, Sat, Sep 19');act(()=>tree.root.findByType(WashedUpCalendar).props.onSelect({year:2026,month:8,day:20}));
 press('Show events');press('Show events');expect(apply).toHaveBeenCalledTimes(1);
 expect(apply).toHaveBeenCalledWith({query:'dinner',area:'Santa Monica',from:'2026-09-20',through:'2026-09-20'});
});
it('applying Clear removes search, area and date constraints',()=>{
 press('Clear filter draft');press('Show events');expect(apply).toHaveBeenCalledWith(emptySceneFilters());
});

const communityOptions = { categories: ['Books', 'Outdoors'], areas: ['Many places around LA', 'Santa Monica'] };
function community(applied = { ...emptySceneFilters(), query: 'Book club', category: 'Books', area: 'Santa Monica' }, options = communityOptions) {
 act(() => { tree.unmount(); tree = create(<SceneFilterForm kind="communities" applied={applied} communityOptions={options} onApply={apply} onCancel={cancel}/>); });
}
const selection = (label:string) => tree.root.findAllByType(TouchableOpacity).find(node=>node.props.accessibilityLabel===label)!;
it('limits the Community sheet to available Category and Areas in LA with native-safe Close and footer',()=>{
 community();expect(tree.root.findAllByType(TextInput)).toHaveLength(0);expect(tree.root.findAllByType(WashedUpCalendar)).toHaveLength(0);
 const text=tree.root.findAllByType(Text).map(node=>node.props.children);
 expect(text).toEqual(expect.arrayContaining(['Community filters','Category','Areas in LA','Close','Many places around LA']));
 expect(text).not.toEqual(expect.arrayContaining(['City or area','Name or interest']));
 for (const node of tree.root.findAllByType(TouchableOpacity)) expect(StyleSheet.flatten(node.props.style).minHeight).toBeGreaterThanOrEqual(44);
 const modal=tree.root.findByType(Modal);const safe=modal.findAll(node=>node.props.accessibilityViewIsModal)[0];
 expect(safe.props.edges).toEqual(['top','bottom']);expect(modal.findAll(node=>node.props.initialMetrics?.insets.top===59).length).toBeGreaterThan(0);
});
it('chooses one category and one actual area, preserving outside search and applying once',()=>{
 community();press('Community category: Outdoors');press('Community area: Many places around LA');
 expect(selection('Community category: Books').props.accessibilityState.selected).toBe(false);
 expect(selection('Community category: Outdoors').props.accessibilityState.selected).toBe(true);
 expect(apply).not.toHaveBeenCalled();press('Show communities');press('Show communities');
 expect(apply).toHaveBeenCalledTimes(1);expect(apply).toHaveBeenCalledWith({...emptySceneFilters(),query:'Book club',category:'Outdoors',area:'Many places around LA'});
});
it('Community Clear only clears its two choices and Cancel cannot commit them or stale callbacks',()=>{
 community();const oldApply=selection('Show communities').props.onPress;
 press('Clear filter draft');expect(selection('Community category: All categories').props.accessibilityState.selected).toBe(true);
 press('Cancel filters');act(()=>oldApply());expect(apply).not.toHaveBeenCalled();expect(cancel).toHaveBeenCalledTimes(1);
 community();expect(selection('Community category: Books').props.accessibilityState.selected).toBe(true);
 press('Clear filter draft');press('Show communities');expect(apply).toHaveBeenCalledWith({...emptySceneFilters(),query:'Book club',category:'',area:''});
});
it('does not resurrect options from an obsolete visit or add unavailable choices',()=>{
 community();const oldApply=selection('Show communities').props.onPress;
 community({...emptySceneFilters(),query:'Book club',category:'Books',area:'Santa Monica'},{categories:['Outdoors'],areas:['Many places around LA']});
 act(()=>oldApply());expect(apply).not.toHaveBeenCalled();
 expect(tree.root.findAllByType(TouchableOpacity).some(node=>node.props.accessibilityLabel==='Community category: Books')).toBe(false);
 press('Show communities');expect(apply).toHaveBeenCalledWith({...emptySceneFilters(),query:'Book club',category:'',area:''});
});

it.each([{ width: 320, fontScale: 1 }, { width: 390, fontScale: 2 }])('keeps filter edits while allocating separate footer rows at $width points and text scale $fontScale', dimensions => {
 community();press('Community category: Outdoors');press('Community area: Many places around LA');
 mockDimensions = { ...mockDimensions, ...dimensions };
 act(() => tree.update(<SceneFilterForm kind="communities" applied={{...emptySceneFilters(),query:'Book club',category:'Books',area:'Santa Monica'}} communityOptions={communityOptions} onApply={apply} onCancel={cancel}/>));
 const footer = tree.root.findAllByType(View).find(node => StyleSheet.flatten(node.props.style)?.borderTopWidth !== undefined)!;
 expect(StyleSheet.flatten(footer.props.style)).toEqual(expect.objectContaining({flexDirection:'column',alignItems:'stretch'}));
 expect(StyleSheet.flatten(selection('Show communities').props.style).flex).toBe(0);
 expect(selection('Community category: Outdoors').props.accessibilityState.selected).toBe(true);
 expect(selection('Community area: Many places around LA').props.accessibilityState.selected).toBe(true);
 expect(apply).not.toHaveBeenCalled();press('Show communities');
 expect(apply).toHaveBeenCalledWith({...emptySceneFilters(),query:'Book club',category:'Outdoors',area:'Many places around LA'});
});

it('refreshes native text on size changes without retiring the open community filter visit', () => {
 community();press('Community category: Outdoors');press('Community area: Many places around LA');
 const scroll = tree.root.findByType(ScrollView);
 const option = selection('Community category: Outdoors');
 const title = () => tree.root.findAllByType(Text).find(node => node.props.children === 'Community filters')!;
 let previousTitle = title(), previousOptionText = option.findByType(Text);
 for (const fontScale of [2, 1]) {
   mockDimensions = {...mockDimensions, fontScale};
   act(() => tree.update(<SceneFilterForm kind="communities" applied={{...emptySceneFilters(),query:'Book club',category:'Books',area:'Santa Monica'}} communityOptions={communityOptions} onApply={apply} onCancel={cancel}/>));
   expect(title()).not.toBe(previousTitle);
   expect(selection('Community category: Outdoors').findByType(Text)).not.toBe(previousOptionText);
   expect(tree.root.findByType(ScrollView)).toBe(scroll);
   expect(selection('Community category: Outdoors')).toBe(option);
   expect(option.props.accessibilityState.selected).toBe(true);
   previousTitle = title();previousOptionText = option.findByType(Text);
 }
 press('Show communities');press('Show communities');
 expect(apply).toHaveBeenCalledTimes(1);
 expect(apply).toHaveBeenCalledWith({...emptySceneFilters(),query:'Book club',category:'Outdoors',area:'Many places around LA'});
});
it('preserves event text inputs and calendar selection while refreshing size-dependent labels', () => {
 type('City or area','Venice');type('Filter search','sunset');press('From date, any date');
 const inputs = tree.root.findAllByType(TextInput), calendar = tree.root.findByType(WashedUpCalendar);
 mockDimensions = {...mockDimensions,fontScale:2};
 act(() => tree.update(<SceneFilterForm kind="events" applied={emptySceneFilters()} onApply={apply} onCancel={cancel}/>));
 expect(tree.root.findAllByType(TextInput)).toEqual(inputs);
 expect(tree.root.findByType(WashedUpCalendar)).toBe(calendar);
 expect(inputs.map(input=>input.props.value)).toEqual(['Venice','sunset']);
 act(()=>calendar.props.onSelect({year:2026,month:8,day:20}));press('Show events');
 expect(apply).toHaveBeenCalledWith({...emptySceneFilters(),query:'sunset',area:'Venice',from:'2026-09-20'});
});
