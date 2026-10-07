import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Pressable, ScrollView, StyleSheet, TextInput, Text, Dimensions } from 'react-native';
jest.mock('../../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: { regular: 'System', medium: 'System' } }) }));
import { COMMUNITY_CATEGORIES } from '../../../../lib/communityClassification';
import { CommunityClassificationFields, CommunityClassificationSummary } from '../CommunityClassificationFields';
let tree: ReactTestRenderer;
const areaChange = jest.fn(), categoriesChange = jest.fn();
const props = { area: null, categories: [], editable: true, errors: {}, onAreaChange: areaChange, onCategoriesChange: categoriesChange };
const button = (label: string) => tree.root.findAll(node => typeof node.props.onPress === 'function' && !!node.props.accessibilityRole).find(node => node.props.accessibilityLabel === label)!;
beforeEach(() => jest.clearAllMocks());
afterEach(() => act(() => tree?.unmount()));
function mount(overrides = {}) { act(() => { tree = create(<CommunityClassificationFields {...props} {...overrides} />); }); }
it('leaves both choices unselected and presents the exact shared category catalog', () => {
  mount(); expect(button('Area in LA: Choose an area')).toBeDefined();
  expect(new Set(tree.root.findAll(node => typeof node.props.onPress === 'function' && node.props.accessibilityRole === 'checkbox').map(node => node.props.accessibilityLabel)).size).toBe(COMMUNITY_CATEGORIES.length);
  expect(areaChange).not.toHaveBeenCalled(); expect(categoriesChange).not.toHaveBeenCalled();
});
it('searches a compact inline picker and saves the exact Many places around LA selection', () => {
  mount(); act(() => button('Area in LA: Choose an area').props.onPress());
  expect(StyleSheet.flatten(tree.root.findByType(ScrollView).props.style).maxHeight).toBe(220);
  act(() => tree.root.findByType(TextInput).props.onChangeText('many places'));
  expect(new Set(tree.root.findAll(node => typeof node.props.onPress === 'function' && node.props.accessibilityRole === 'radio').map(node => node.props.accessibilityLabel)).size).toBe(1);
  act(() => button('Many places around LA').props.onPress());
  expect(areaChange).toHaveBeenCalledWith('Many places around LA'); expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
});
it('keeps a selected option visible and gives area/category controls at least 44-point height', () => {
  mount({ area: 'Santa Monica', categories: ['music'] });
  act(() => button('Area in LA: Santa Monica').props.onPress());
  expect(button('Santa Monica').props.accessibilityState.checked).toBe(true);
  tree.root.findAll(node => typeof node.props.onPress === 'function' && !!node.props.accessibilityRole).forEach(node => expect(StyleSheet.flatten(node.props.style).minHeight).toBeGreaterThanOrEqual(44));
});
it('allows a second category without forcing Community and never allows a third', () => {
  mount({ categories: ['music'] }); act(() => button('Category: Outdoors').props.onPress());
  expect(categoriesChange).toHaveBeenLastCalledWith(['music', 'outdoors']);
  act(() => tree.update(<CommunityClassificationFields {...props} categories={['music', 'outdoors']} />));
  expect(button('Category: Art').props.disabled).toBe(true); act(() => button('Category: Art').props.onPress());
  expect(categoriesChange).toHaveBeenCalledTimes(1);
  act(() => button('Category: Music').props.onPress()); expect(categoriesChange).toHaveBeenLastCalledWith(['outdoors']);
});
it('can remove an unsupported saved category so validation cannot trap an old draft', () => {
  mount({ categories: ['retired choice', 'music'] });
  act(() => button('Remove unavailable category: retired choice').props.onPress());
  expect(categoriesChange).toHaveBeenCalledWith(['music']);
});
it('does not mutate choices when the editor is disabled', () => {
  mount({ editable: false }); act(() => button('Area in LA: Choose an area').props.onPress());
  act(() => button('Category: Music').props.onPress());
  expect(tree.root.findAllByType(TextInput)).toHaveLength(0); expect(areaChange).not.toHaveBeenCalled(); expect(categoriesChange).not.toHaveBeenCalled();
});
it('shows both inline validation messages without replacing the selected values', () => {
  mount({ area: 'Saved old area', errors: { discovery_area: 'Choose an area.', categories: 'Choose one or two categories.' } });
  expect(button('Area in LA: Saved old area')).toBeDefined();
  const rendered = JSON.stringify(tree.toJSON()); expect(rendered).toContain('Choose an area.'); expect(rendered).toContain('Choose one or two categories.');
});
it('private preview displays the exact area and readable categories and invents no empty default', () => {
  act(() => { tree = create(<CommunityClassificationSummary area="Many places around LA" categories={['food and drink', 'just for fun']} />); });
  let rendered = JSON.stringify(tree.toJSON()); expect(rendered).toContain('Many places around LA'); expect(rendered).toContain('Food and drink · Just for fun');
  act(() => tree.update(<CommunityClassificationSummary area={null} categories={null} />));
  rendered = JSON.stringify(tree.toJSON()); expect(rendered).not.toContain('Many places'); expect(rendered).not.toContain('Los Angeles');
});

it('remeasures expanded classification text while preserving search input, query, options and selected state',()=>{
 const previous=Dimensions.get('window');act(()=>Dimensions.set({window:{...previous,width:390,fontScale:1}}));
 try{
  mount({area:'Santa Monica',categories:['outdoors']});act(()=>button('Area in LA: Santa Monica').props.onPress());act(()=>tree.root.findByType(TextInput).props.onChangeText('santa'));
  const picker=tree.root.findByType(CommunityClassificationFields),search=tree.root.findByType(TextInput),scroll=tree.root.findByType(ScrollView),option=button('Santa Monica'),category=button('Category: Outdoors');
  const labels=['Area in LA · required','Categories · required','Choose one or two that fit your community.','Outdoors','1 of 2 selected'];
  const leaf=(value:string)=>tree.root.findAllByType(Text).find(node=>node.props.children===value)!;let leaves=labels.map(leaf);
  for(const fontScale of [1.35,1]){
   act(()=>Dimensions.set({window:{...previous,width:390,fontScale}}));labels.forEach((label,index)=>expect(leaf(label)).not.toBe(leaves[index]));leaves=labels.map(leaf);
   expect(tree.root.findByType(CommunityClassificationFields)).toBe(picker);expect(tree.root.findByType(TextInput)).toBe(search);expect(search.props.value).toBe('santa');expect(tree.root.findByType(ScrollView)).toBe(scroll);
   expect(button('Santa Monica')).toBe(option);expect(button('Category: Outdoors')).toBe(category);expect(category.props.accessibilityState.checked).toBe(true);expect(option.props.accessibilityState.checked).toBe(true);
   expect(areaChange).not.toHaveBeenCalled();expect(categoriesChange).not.toHaveBeenCalled();
  }
  act(()=>option.props.onPress());expect(areaChange).toHaveBeenCalledWith('Santa Monica');expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
 }finally{act(()=>Dimensions.set({window:previous}));}
});
