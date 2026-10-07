import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import CollapsibleCalendar from '../CollapsibleCalendar';
import WashedUpCalendar from '../../calendar/WashedUpCalendar';
import { AfterglowFonts } from '../../../constants/Typography';
import Colors, { AfterglowColors } from '../../../constants/Colors';
let mockToday = {y:2040,m:8,d:13};
jest.mock('../../../lib/laDate',()=>({
 ...jest.requireActual('../../../lib/laDate'),getTodayInLA:()=>mockToday,
 isBeforeTodayLA:(y:number,m:number,d:number)=>Date.UTC(y,m,d)<Date.UTC(mockToday.y,mockToday.m,mockToday.d),
}));
jest.mock('../../../lib/haptics',()=>({hapticLight:jest.fn(),hapticSelection:jest.fn()}));
jest.mock('@expo/vector-icons',()=>({Ionicons:()=>null}));
jest.mock('lucide-react-native',()=>({ChevronDown:()=>null,ChevronUp:()=>null}));
jest.mock('react-native-reanimated',()=>{
 const chain:any={};for(const name of ['springify','mass','damping','stiffness','duration'])chain[name]=()=>chain;
 return {__esModule:true,default:{View:require('react-native').View},FadeInDown:chain,FadeOutUp:chain};
});
let tree:ReactTestRenderer;
const appearance={fonts:AfterglowFonts};
const byLabel=(label:string)=>tree.root.findAll(n=>n.props.accessibilityLabel===label && typeof n.props.onPress==='function')[0];
const trigger=()=>tree.root.findAll(n=>String(n.props.accessibilityLabel).startsWith('Date,') && typeof n.props.onPress==='function')[0];
async function render(options:Partial<React.ComponentProps<typeof CollapsibleCalendar>>={}){
 const onSelect=jest.fn();await act(async()=>{tree=create(<CollapsibleCalendar selected={{year:2040,month:8,day:13}} onSelect={onSelect} {...options}/>);});return onSelect;
}
beforeEach(()=>{mockToday={y:2040,m:8,d:13};});
afterEach(()=>act(()=>tree?.unmount()));
it('preserves the existing appearance when the optional prop is absent',async()=>{
 await render();expect(StyleSheet.flatten(trigger().props.style)).toMatchObject({borderRadius:12,backgroundColor:Colors.white});
 act(()=>trigger().props.onPress());
 const surface=tree.root.findByType(WashedUpCalendar).findAllByType(View)[0];
 expect(StyleSheet.flatten(surface.props.style)).toMatchObject({borderRadius:16,backgroundColor:Colors.cream});
});
it('forwards the staged appearance to the expanded original calendar and preserves one selection',async()=>{
 const onSelect=await render({appearance});expect(StyleSheet.flatten(trigger().props.style)).toMatchObject({minHeight:48,borderRadius:6,backgroundColor:AfterglowColors.white});
 act(()=>trigger().props.onPress());expect(tree.root.findByType(WashedUpCalendar).props.appearance).toBe(appearance);
 expect(StyleSheet.flatten(byLabel('Choose tomorrow').props.style).minHeight).toBe(44);
 const day=byLabel('September 16, 2040');expect(StyleSheet.flatten(day.props.style).minHeight).toBe(44);
 act(()=>day.props.onPress());expect(onSelect).toHaveBeenCalledTimes(1);expect(onSelect).toHaveBeenCalledWith({year:2040,month:8,day:16});
 expect(trigger().props.accessibilityState.expanded).toBe(false);
});
it('keeps LA Today and Tomorrow shortcuts including the year boundary',async()=>{
 mockToday={y:2040,m:11,d:31};const onSelect=await render({appearance,selected:{year:2040,month:11,day:31}});
 act(()=>trigger().props.onPress());act(()=>byLabel('Choose tomorrow').props.onPress());
 expect(onSelect).toHaveBeenLastCalledWith({year:2041,month:0,day:1});
 act(()=>trigger().props.onPress());act(()=>byLabel('Choose today').props.onPress());
 expect(onSelect).toHaveBeenLastCalledWith({year:2040,month:11,day:31});
});
it('preserves past-day and current-month restrictions in the staged calendar',async()=>{
 await render({appearance});act(()=>trigger().props.onPress());
 expect(byLabel('September 12, 2040').props.disabled).toBe(true);
 expect(byLabel('September 12, 2040').props.accessibilityState.disabled).toBe(true);
 expect(byLabel('previous month').props.disabled).toBe(true);
 expect(byLabel('September 13, 2040').props.disabled).toBe(false);
 expect(StyleSheet.flatten(byLabel('next month').props.style)).toMatchObject({minWidth:44,minHeight:44});
 act(()=>byLabel('next month').props.onPress());expect(byLabel('previous month').props.disabled).toBe(false);
 act(()=>byLabel('previous month').props.onPress());expect(byLabel('previous month').props.disabled).toBe(true);
});
it('retains month jump and the exact selected date without closing for navigation',async()=>{
 const onSelect=await render({appearance});act(()=>trigger().props.onPress());
 act(()=>byLabel('Choose month, currently September 2040').props.onPress());
 expect(StyleSheet.flatten(byLabel('January 2041').props.style).minHeight).toBe(44);
 act(()=>byLabel('January 2041').props.onPress());expect(onSelect).not.toHaveBeenCalled();
 expect(trigger().props.accessibilityState.expanded).toBe(true);
 act(()=>byLabel('January 5, 2041').props.onPress());expect(onSelect).toHaveBeenCalledWith({year:2041,month:0,day:5});
});
it('uses readable staged date type while leaving the chosen-date payload untouched',async()=>{
 await render({appearance});const text=trigger().findAllByType(Text)[0];
 expect(StyleSheet.flatten(text.props.style)).toMatchObject({fontFamily:AfterglowFonts.semibold,color:AfterglowColors.ink});
 expect(String(text.props.children)).toContain('Sep');
});
