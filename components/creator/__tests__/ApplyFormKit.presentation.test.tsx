import { Dimensions } from 'react-native';
import React from 'react';
import { Text, TextInput, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Field, ChoiceList, ChipMulti, LinksInput, TermsCheck, SubmitButton, Confirmation } from '../ApplyFormKit';
import { CreatorFonts, FontSizes } from '../../../constants/Typography';
const appearance = { fonts: CreatorFonts, application: true };
let tree: ReactTestRenderer;
const mount = (content: React.ReactElement) => act(() => { tree = create(content); });
afterEach(() => { if (tree) act(() => tree.unmount()); });

it('retains legacy Field appearance sizing and opts only the application layout into larger full-width inputs', () => {
  mount(<Field label="Name" value="" onChange={() => {}} appearance={{fonts:CreatorFonts}} />);
  expect(StyleSheet.flatten(tree.root.findByType(TextInput).props.style).fontSize).toBe(FontSizes.bodyMD);
  act(() => tree.update(<Field label="Name" value="" onChange={() => {}} appearance={appearance} />));
  expect(StyleSheet.flatten(tree.root.findByType(TextInput).props.style)).toMatchObject({ width:'100%', minHeight:48, fontSize:FontSizes.bodyLG, fontFamily:CreatorFonts.regular });
});

it('keeps radio and category keys/callbacks while exposing selected state and 44-point minimum targets', () => {
  const select = jest.fn(), toggle = jest.fn();
  mount(<><ChoiceList label="Schedule" options={[{key:'monthly',label:'Monthly'}]} selected="monthly" onSelect={select} appearance={appearance}/><ChipMulti label="Categories" options={[{key:'fitness_outdoors',label:'Fitness and outdoors'}]} selected={['fitness_outdoors']} onToggle={toggle} appearance={appearance}/></>);
  const choices = tree.root.findAllByType(TouchableOpacity);
  expect(choices.every(node => StyleSheet.flatten(node.props.style).minHeight >= 44)).toBe(true);
  expect(choices.every(node => node.props.accessibilityState.checked === true)).toBe(true);
  act(() => choices.forEach(node => node.props.onPress()));
  expect(select).toHaveBeenCalledWith('monthly'); expect(toggle).toHaveBeenCalledWith('fitness_outdoors');
});

it('keeps all link slots, exact legal destination and consent callback', async () => {
  const links = jest.fn(), consent = jest.fn(), open = jest.spyOn(Linking,'openURL').mockResolvedValue(undefined as never);
  mount(<><LinksInput label="Links" hint="At least one" links={['first','second','third']} onChange={links} appearance={appearance}/><TermsCheck checked={false} onToggle={consent} appearance={appearance}/></>);
  const inputs = tree.root.findAllByType(TextInput); expect(inputs).toHaveLength(3);
  act(() => inputs[1].props.onChangeText('updated')); expect(links).toHaveBeenCalledWith(['first','updated','third']);
  const termLink = tree.root.findAllByType(Text).find(node=>node.props.children==='creator terms')!;
  await act(async () => { await termLink.props.onPress(); }); expect(open).toHaveBeenCalledWith('https://washedup.app/creator-terms');
  expect(consent).not.toHaveBeenCalled();
  act(() => tree.root.findByType(TouchableOpacity).props.onPress()); expect(consent).toHaveBeenCalledTimes(1);
  open.mockRestore();
});

it('preserves default Submit and Confirmation copy, incomplete-form tapping and pending protection', () => {
  const submit = jest.fn(); mount(<SubmitButton inactive submitting={false} onPress={submit}/>);
  expect(tree.root.findByType(Text).props.children).toBe('send it in');
  expect(tree.root.findByType(TouchableOpacity).props.disabled).toBe(false);
  act(() => tree.root.findByType(TouchableOpacity).props.onPress()); expect(submit).toHaveBeenCalledTimes(1);
  act(() => tree.update(<SubmitButton inactive submitting label="Submit application" onPress={submit} appearance={appearance}/>));
  expect(tree.root.findByType(TouchableOpacity).props.disabled).toBe(true);
  act(() => tree.update(<Confirmation onDone={()=>{}}/>));
  expect(tree.root.findAllByType(Text).map(node=>node.props.children)).toEqual(expect.arrayContaining(['got it','done','Application received. Check Apply to Scene for updates.']));
});

it('places grouped-link guidance before inputs so the error stays visible when the first box receives focus', () => {
  const guidance = { error:'Add at least one link.', onLayout:jest.fn(), inputRef:jest.fn(), onFocus:jest.fn() };
  mount(<LinksInput label="Links" hint="Any one link" links={['','','']} onChange={()=>{}} appearance={appearance} guidance={guidance}/>);
  const readingOrder = tree.root.findAll(node => node.type === TextInput || (node.type === Text && node.props.children === guidance.error));
  expect(readingOrder[0].props.children).toBe('Add at least one link.');
  expect(readingOrder.slice(1).map(node=>node.props.accessibilityLabel)).toEqual(['Links: link 1','Links: link 2','Links: link 3']);
  expect(readingOrder.slice(1).every(node=>node.props.accessibilityHint===guidance.error)).toBe(true);
});

it('opted-in field text remeasures while retaining the input ref, focus callback, value and validation',()=>{
 const previous=Dimensions.get('window');act(()=>Dimensions.set({window:{...previous,width:390,fontScale:1}}));
 try{
  const guidance={error:'Please finish this answer.',onLayout:jest.fn(),inputRef:jest.fn(),onFocus:jest.fn()},change=jest.fn();
  mount(<Field label="Your idea" hint="Tell us more" value="Unfinished" onChange={change} multiline maxLength={100} guidance={guidance} appearance={{...appearance,remeasureText:true}}/>);
  const input=tree.root.findByType(TextInput),field=tree.root.findByType(Field);const focus=input.props.onFocus;
  const leaves=()=>tree.root.findAllByType(Text);let before=leaves();guidance.inputRef.mockClear();
  for(const fontScale of [1.35,1]){
   act(()=>Dimensions.set({window:{...previous,width:390,fontScale}}));leaves().forEach((node,index)=>expect(node).not.toBe(before[index]));before=leaves();
   expect(tree.root.findByType(TextInput)).toBe(input);expect(tree.root.findByType(Field)).toBe(field);expect(input.props.value).toBe('Unfinished');expect(input.props.onFocus).toBe(focus);expect(input.props.accessibilityHint).toBe(guidance.error);
   expect(guidance.inputRef).not.toHaveBeenCalled();expect(guidance.onFocus).not.toHaveBeenCalled();expect(change).not.toHaveBeenCalled();
  }
  act(()=>input.props.onFocus());expect(guidance.onFocus).toHaveBeenCalledTimes(1);
 }finally{act(()=>Dimensions.set({window:previous}));}
});
