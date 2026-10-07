import React from 'react';
import { StyleSheet, Text, ScrollView, View, Dimensions } from 'react-native';
import { act, create } from 'react-test-renderer';
import CircleCard from '../CircleCard';
import CircleMemberStack from '../CircleMemberStack';
import CirclesSummaryHeader from '../CirclesSummaryHeader';
import CirclesEmptyState from '../CirclesEmptyState';
import SuggestionCard from '../SuggestionCard';
import { AfterglowFallbackFonts, AfterglowType, Fonts } from '../../../../constants/Typography';
import { AfterglowColors } from '../../../../constants/Colors';
const mockCircle=jest.fn(),mockSigned=jest.fn();
jest.mock('../../../../hooks/useCircle',()=>({useCircle:(id:string|null)=>mockCircle(id)}));
jest.mock('../../../../hooks/useSignedAlbumUrls',()=>({useSignedAlbumUrls:(paths:string[])=>mockSigned(paths)}));
jest.mock('../../../../lib/circles/coverUrl',()=>({buildCircleCoverUrl:(id:string,cover:string|null)=>cover?`https://example.invalid/${id}/${cover}`:null}));
jest.mock('../../../../lib/haptics',()=>({hapticSelection:jest.fn()}));
jest.mock('../../../ProfileButton',()=>()=>null);
jest.mock('../../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:require('../../../../constants/Typography').AfterglowFallbackFonts,loaded:true,error:null})}));
jest.mock('expo-image',()=>({Image:(p:any)=>require('react').createElement('Photo',p)}));
const appearance={fonts:AfterglowFallbackFonts},cleanup:Array<()=>void>=[];
const base={id:'c1',name:'Saturday friends',description:null,cover_upload_id:'cover1',status:'active' as const,room_enabled:true,created_at:'2026-09-01',my_role:'member' as const,member_count:6,last_message_at:null};
const people=[{user_id:'bea',first_name_display:'Bea',handle:'bea',profile_photo_url:'https://example.invalid/bea.jpg'}];
const suggestion={id:'s1',suggested_user_ids:['bea'],shared_count:3,shared_event_ids:['p1'],created_at:'2026-09-01',people};
function render(node:React.ReactElement){let tree!:ReturnType<typeof create>;act(()=>{tree=create(node);});cleanup.push(()=>act(()=>tree.unmount()));return{tree,update:(next:React.ReactElement)=>act(()=>tree.update(next)),photos:()=>tree.root.findAllByType('Photo' as any),text:()=>tree.root.findAllByType(Text).flatMap(n=>n.props.children).join(' ').replace(/\s+/g,' '),button:(label:string)=>tree.root.findAll(n=>n.props.accessibilityLabel===label&&typeof n.props.onPress==='function')[0]};}
function actionStyle(button:any){return StyleSheet.flatten(typeof button.props.style==='function'?button.props.style({pressed:false}):button.props.style);}
beforeEach(()=>{jest.clearAllMocks();mockCircle.mockReturnValue({data:null});mockSigned.mockReturnValue({data:{}});});
afterEach(()=>cleanup.splice(0).forEach(fn=>fn()));
it('preserves the manual cover priority and compact readable native row',()=>{const f=render(<CircleCard circle={base} members={[]} onPress={jest.fn()} appearance={appearance}/>);expect(mockCircle).toHaveBeenCalledWith(null);expect(f.photos()[0].props.source.uri).toContain('c1/cover1');const row=f.button('Saturday friends, 6 people');expect(StyleSheet.flatten(row.props.style).minHeight).toBeGreaterThanOrEqual(44);expect(row.findAllByType(View).some(n=>StyleSheet.flatten(n.props.style)?.minHeight===92)).toBe(true);const name=f.tree.root.findAllByType(Text).find(n=>n.props.children==='Saturday friends')!;expect(name.props.numberOfLines).toBeUndefined();expect(StyleSheet.flatten(name.props.style).fontFamily).toBe(appearance.fonts.medium);expect(f.text()).not.toContain('plans this week');});
it('uses the existing signed album mosaic when no manual cover exists',()=>{mockCircle.mockReturnValue({data:{recent_together:[{media_path:'p1'},{media_path:'p2'}]}});mockSigned.mockReturnValue({data:{p1:'https://example.invalid/one.jpg',p2:'https://example.invalid/two.jpg'}});const f=render(<CircleCard circle={{...base,cover_upload_id:null}} members={[]} onPress={jest.fn()} appearance={appearance}/>);expect(mockCircle).toHaveBeenCalledWith('c1');expect(mockSigned).toHaveBeenCalledWith(['p1','p2']);expect(f.photos().map(p=>p.props.source.uri)).toEqual(['https://example.invalid/one.jpg','https://example.invalid/two.jpg']);});
it('falls back from a broken manual photo and resets for a replacement cover',()=>{const f=render(<CircleCard circle={base} members={[]} onPress={jest.fn()} appearance={appearance}/>);act(()=>f.photos()[0].props.onError());expect(f.photos()).toHaveLength(0);expect(f.text()).toContain('S');expect(StyleSheet.flatten(f.tree.root.findAllByType(Text).find(n=>n.props.children==='S')!.props.style).fontSize).toBe(AfterglowType.identity.fontSize);f.update(<CircleCard circle={{...base,cover_upload_id:'cover2'}} members={[]} onPress={jest.fn()} appearance={appearance}/>);expect(f.photos()[0].props.source.uri).toContain('cover2');});
it('labels actual message recency rather than member presence',()=>{const date=new Date(Date.now()-120*60*1000).toISOString();const f=render(<CircleCard circle={{...base,last_message_at:date}} members={[]} onPress={jest.fn()} appearance={appearance}/>);expect(f.text()).toContain('2h ago');expect(f.text()).not.toContain('Last message');const activity=f.tree.root.findAllByType(Text).find(n=>n.props.accessibilityLabel==='Last message 2h ago')!;expect(StyleSheet.flatten(activity.props.style).fontSize).toBeGreaterThanOrEqual(13);expect(f.button('Saturday friends, 6 people, last message 2h ago')).toBeDefined();expect(f.text()).not.toContain('active');});
it('keeps member overflow tied to the real count and full-color portrait fallback',()=>{const members=[{user_id:'bea',name:'Bea',photo_url:'https://example.invalid/bea.jpg'}];const f=render(<CircleMemberStack members={members} memberCount={6} appearance={appearance}/>);expect(f.text()).toContain('+5');expect(StyleSheet.flatten(f.photos()[0].props.style).opacity).toBeUndefined();act(()=>f.photos()[0].props.onError());expect(f.photos()).toHaveLength(0);expect(f.text()).toContain('B');});
it('summary creates through the existing callback with a 44pt control',()=>{const onCreate=jest.fn();const f=render(<CirclesSummaryHeader count={3} onCreate={onCreate} appearance={appearance}/>);expect(f.text()).toContain('3 circles');expect(actionStyle(f.button('New circle')).minHeight).toBeGreaterThanOrEqual(44);expect(f.button('New circle').findAllByType(Text).find(n=>n.props.children==='New circle')?.props.numberOfLines).toBe(1);act(()=>f.button('New circle').props.onPress());expect(onCreate).toHaveBeenCalledTimes(1);});
it.each([true,false])('empty hasPeople=%s uses only the relevant action and can scroll',hasPeople=>{const onCreate=jest.fn(),onAddPeople=jest.fn();const f=render(<CirclesEmptyState hasPeople={hasPeople} onCreate={onCreate} onAddPeople={onAddPeople} appearance={appearance}/>);expect(f.tree.root.findAllByType(ScrollView)).toHaveLength(1);const label=hasPeople?'Make a circle':'Add people';act(()=>f.button(label).props.onPress());expect(hasPeople?onCreate:onAddPeople).toHaveBeenCalledTimes(1);expect(hasPeople?onAddPeople:onCreate).not.toHaveBeenCalled();});
it('staged suggestion has one dismiss control, failure fallback and retry labels',()=>{const onDismiss=jest.fn();const f=render(<SuggestionCard suggestion={suggestion} onStart={jest.fn()} onDismiss={onDismiss} appearance={appearance}/>);const dismiss=f.tree.root.findAll(n=>n.props.accessibilityLabel==='Not now'&&typeof n.props.onPress==='function');expect(dismiss.filter(n=>typeof n.type==='function')).toHaveLength(1);act(()=>f.photos()[0].props.onError());expect(f.photos()).toHaveLength(0);f.update(<SuggestionCard suggestion={suggestion} onStart={jest.fn()} onDismiss={onDismiss} appearance={appearance} dismissError="Couldn’t dismiss this suggestion. Try again."/>);act(()=>f.button('Try again to dismiss suggestion').props.onPress());expect(onDismiss).toHaveBeenCalledWith(suggestion);});
it('suggestion pending disables both actions and uses one-line 44pt buttons',()=>{const f=render(<SuggestionCard suggestion={suggestion} onStart={jest.fn()} onDismiss={jest.fn()} appearance={appearance} dismissPending/>);for(const label of ['Start a circle','Dismissing…']){const button=f.button(label);expect(button.props.disabled).toBe(true);expect(actionStyle(button).minHeight).toBeGreaterThanOrEqual(44);}expect(f.text()).toContain('Dismissing…');});
it('the default summary keeps the legacy font and color family',()=>{const f=render(<CirclesSummaryHeader count={3} onCreate={jest.fn()}/>);const label=f.tree.root.findAllByType(Text).find(n=>n.props.children==='3 circles')!;expect(StyleSheet.flatten(label.props.style).fontFamily).toBe(Fonts.sansBold);expect(StyleSheet.flatten(label.props.style).color).not.toBe(AfterglowColors.ink);});

it('keeps permitted mosaic photos after one fails and shows the monogram when all fail',()=>{mockCircle.mockReturnValue({data:{recent_together:[{media_path:'p1'},{media_path:'p2'}]}});mockSigned.mockReturnValue({data:{p1:'https://example.invalid/one.jpg',p2:'https://example.invalid/two.jpg'}});const f=render(<CircleCard circle={{...base,cover_upload_id:null}} members={[]} onPress={jest.fn()} appearance={appearance}/>);act(()=>f.photos()[0].props.onError());expect(f.photos().map(p=>p.props.source.uri)).toEqual(['https://example.invalid/two.jpg']);act(()=>f.photos()[0].props.onError());expect(f.photos()).toHaveLength(0);expect(f.text()).toContain('S');});
it('a replaced signed photo set cannot be failed by its old image callback',()=>{mockCircle.mockReturnValue({data:{recent_together:[{media_path:'p1'}]}});mockSigned.mockReturnValue({data:{p1:'https://example.invalid/old.jpg'}});const props={circle:{...base,cover_upload_id:null},members:[],onPress:jest.fn(),appearance};const f=render(<CircleCard {...props}/>);const oldFailure=f.photos()[0].props.onError;mockSigned.mockReturnValue({data:{p1:'https://example.invalid/new.jpg'}});f.update(<CircleCard {...props}/>);act(()=>oldFailure());expect(f.photos().map(p=>p.props.source.uri)).toEqual(['https://example.invalid/new.jpg']);});
it('legacy album mosaics retain their existing behavior without opting into fallback',()=>{mockCircle.mockReturnValue({data:{recent_together:[{media_path:'p1'}]}});mockSigned.mockReturnValue({data:{p1:'https://example.invalid/one.jpg'}});const f=render(<CircleCard circle={{...base,cover_upload_id:null}} members={[]} onPress={jest.fn()}/>);expect(f.photos()[0].props.onError).toBeUndefined();});


it.each([['first', true, false], ['middle', false, false], ['last', false, true], ['single', true, true]] as const)('groups the %s row without card gaps or repeated borders', (groupPosition, first, last) => {
  const f=render(<CircleCard circle={base} members={[]} onPress={jest.fn()} appearance={appearance} groupPosition={groupPosition}/>);
  const surface=f.tree.root.findAllByType(View).map(n=>StyleSheet.flatten(n.props.style)).find(style=>style?.borderLeftWidth===1 && style?.overflow==='hidden')!;
  expect(surface.borderTopWidth===1).toBe(first);expect(surface.borderBottomWidth===1).toBe(last);
  const hit=StyleSheet.flatten(f.button('Saturday friends, 6 people').props.style);expect(hit.marginHorizontal).toBe(20);expect(hit.marginBottom).toBeUndefined();
});
it.each([320,390])('keeps long directory copy and metadata flexible at %spt', width=>{
 const previous=Dimensions.get('window');act(()=>Dimensions.set({window:{...previous,width,fontScale:1.5}}));
 try{
  const name='The long way home along the coast with all our favourite people';const onPress=jest.fn();const f=render(<CircleCard circle={{...base,name,last_message_at:null}} members={[]} onPress={onPress} appearance={appearance}/>);
  const label=f.tree.root.findAllByType(Text).find(n=>n.props.children===name)!;expect(label.props.numberOfLines).toBeUndefined();
  expect(f.tree.root.findAllByType(View).some(n=>StyleSheet.flatten(n.props.style)?.flexWrap==='wrap')).toBe(true);
  expect(f.text()).not.toContain('active');expect(f.text()).not.toContain('last message');expect(f.text()).not.toContain('quiet');
  act(()=>f.button(`${name}, 6 people`).props.onPress());expect(onPress).toHaveBeenCalledWith('c1');
 }finally{act(()=>Dimensions.set({window:previous}));}
});
it('compact member previews use three genuine faces and real total overflow; default stack stays unchanged',()=>{
 const previous=Dimensions.get('window');act(()=>Dimensions.set({window:{...previous,fontScale:1}}));
 try{
  const members=Array.from({length:5},(_,i)=>({user_id:`p${i}`,name:`Person ${i}`,photo_url:`https://example.invalid/p${i}.jpg`}));
  const f=render(<CircleMemberStack members={members} memberCount={10} appearance={appearance} compact/>);
  expect(f.photos()).toHaveLength(3);expect(f.text()).toContain('+7');expect(StyleSheet.flatten(f.photos()[0].props.style)).toMatchObject({width:20,height:20});
  expect(StyleSheet.flatten(f.tree.root.findAllByType(Text).find(n=>n.props.children==='+7')!.props.style)).toMatchObject(AfterglowType.timestamp);
  act(()=>f.photos()[0].props.onError());expect(f.photos()).toHaveLength(2);expect(f.text()).toContain('P');expect(f.text()).toContain('+7');
  expect(StyleSheet.flatten(f.tree.root.findAllByType(Text).find(n=>n.props.children==='P')!.props.style)).toMatchObject(AfterglowType.timestamp);
  f.update(<CircleMemberStack members={members} memberCount={10} appearance={appearance}/>);expect(f.text()).toContain('+5');expect(StyleSheet.flatten(f.photos()[0].props.style).width).toBeGreaterThan(20);
 }finally{act(()=>Dimensions.set({window:previous}));}
});
it('an empty directory keeps one full-width branded action with a single-line label',()=>{
 const f=render(<CirclesEmptyState hasPeople appearance={appearance} onCreate={jest.fn()} onAddPeople={jest.fn()}/>);
 const button=f.button('Make a circle');expect(button.findAllByType(View).some(n=>StyleSheet.flatten(n.props.style)?.minHeight===48)).toBe(true);
 expect(button.findAllByType(Text).find(n=>n.props.children==='Make a circle')!.props.numberOfLines).toBe(1);
});

it('remeasures Circle row text through mounted scale changes while retaining row controls and failed-image state',()=>{
 const previous=Dimensions.get('window');act(()=>Dimensions.set({window:{...previous,width:390,fontScale:1}}));
 try {
  const name='The long way home along the coast';const onPress=jest.fn();const members=[{user_id:'person',name:'Juniper',photo_url:'https://example.invalid/person.jpg'}];
  const f=render(<CircleCard circle={{...base,name}} members={members} onPress={onPress} appearance={appearance}/>);
  const row=f.button(`${name}, 6 people`);const card=f.tree.root.findByType(CircleCard);const stack=f.tree.root.findByType(CircleMemberStack);
  const cover=f.photos().find(p=>p.props.source.uri.includes('cover1'))!;act(()=>cover.props.onError());
  const person=f.photos()[0];act(()=>person.props.onError());expect(f.photos()).toHaveLength(0);
  const leaf=(value:string)=>f.tree.root.findAllByType(Text).find(n=>n.props.children===value)!;
  let title=leaf(name),count=leaf('6 people'),overflow=leaf('+5');
  for(const fontScale of [1.35,1]) {
   act(()=>Dimensions.set({window:{...previous,width:390,fontScale}}));
   expect(leaf(name)).not.toBe(title);expect(leaf('6 people')).not.toBe(count);expect(leaf('+5')).not.toBe(overflow);
   expect(leaf(name).props.numberOfLines).toBeUndefined();
   expect(f.tree.root.findByType(CircleCard)).toBe(card);expect(f.tree.root.findByType(CircleMemberStack)).toBe(stack);expect(f.button(`${name}, 6 people`)).toBe(row);expect(f.photos()).toHaveLength(0);
   title=leaf(name);count=leaf('6 people');overflow=leaf('+5');
  }
  act(()=>row.props.onPress());expect(onPress).toHaveBeenCalledTimes(1);expect(onPress).toHaveBeenCalledWith('c1');
 } finally {act(()=>Dimensions.set({window:previous}));}
});

it('remeasures mounted circle count, description and New circle label without remounting its action',()=>{
 const previous=Dimensions.get('window');act(()=>Dimensions.set({window:{...previous,width:390,fontScale:1}}));
 try {
  const onCreate=jest.fn();const f=render(<CirclesSummaryHeader count={3} onCreate={onCreate} appearance={appearance}/>);const button=f.button('New circle');const header=f.tree.root.findByType(CirclesSummaryHeader);
  const leaf=(value:string)=>f.tree.root.findAllByType(Text).find(n=>n.props.children===value)!;
  const labels=['3 circles','Chats and plans with your people.','New circle'];let before=labels.map(leaf);
  for(const fontScale of [1.35,1]) {act(()=>Dimensions.set({window:{...previous,width:390,fontScale}}));labels.forEach((label,i)=>expect(leaf(label)).not.toBe(before[i]));expect(f.button('New circle')).toBe(button);expect(f.tree.root.findByType(CirclesSummaryHeader)).toBe(header);before=labels.map(leaf);}
  act(()=>button.props.onPress());expect(onCreate).toHaveBeenCalledTimes(1);
 } finally {act(()=>Dimensions.set({window:previous}));}
});
