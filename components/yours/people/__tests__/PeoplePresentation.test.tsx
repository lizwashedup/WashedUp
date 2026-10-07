import React from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { act, create } from 'react-test-renderer';
import PeopleScreen from '../PeopleScreen';
import PeopleListRow, { PeopleRecentPerson, peopleContext } from '../PeopleListRow';
import PeopleGridCell from '../PeopleGridCell';
import { CreatorActionFill } from '../../../creator/CreatorActionFill';
import { AfterglowFonts } from '../../../../constants/Typography';
import type { YoursGridPerson } from '../../../../lib/yours/types';

jest.mock('lucide-react-native', () => ({ Search: () => null, Plus: () => null, Users: () => null, ChevronRight: () => null, MoreHorizontal: () => null, Sparkles: () => null }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: (props: any) => require('react').createElement('Gradient', props) }));
jest.mock('expo-image', () => ({ Image: (props: any) => require('react').createElement('Photo', props) }));
const appearance = { fonts: AfterglowFonts };
const person = (id: string, extra: Partial<YoursGridPerson> = {}): YoursGridPerson => ({
  user_id: id, first_name_display: id, profile_photo_url: `https://example.invalid/${id}.jpg`,
  handle: id, ring_bucket: 'none', shared_count: 0, milestone: null, upcoming_event_id: null,
  upcoming_title: null, upcoming_start: null, upcoming_neighborhood: null, connected_at: '2026-09-13', ...extra,
});
const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).forEach(fn => fn()));
const textOf = (tree: ReturnType<typeof create>) => tree.root.findAllByType(Text).flatMap(n => n.props.children).join(' ');
const buttonsOf = (tree: ReturnType<typeof create>) => tree.root.findAll(n => typeof n.props.onPress === 'function' && typeof n.props.accessibilityLabel === 'string');
const press = (tree: ReturnType<typeof create>, testID: string) => tree.root.findAll(n => n.props.testID === testID && typeof n.props.onPress === 'function')[0];
function rowMount(initial = person('Amelia')) {
  let props = { person: initial, appearance, onPress: jest.fn(), onLongPress: jest.fn() };
  const measurements: Array<(x: number, y: number, w: number, h: number) => void> = [];
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<PeopleListRow {...props} />); });
  tree.root.findAll(n => jest.isMockFunction(n.instance?.measureInWindow)).forEach(n => {
    n.instance.measureInWindow.mockImplementation((cb: typeof measurements[number]) => measurements.push(cb));
  });
  let mounted = true;
  const unmount = () => { if (mounted) act(() => tree.unmount()); mounted = false; };
  cleanup.push(unmount);
  return { tree, measurements, unmount, get props() { return props; }, update(next: Partial<typeof props>) { props = { ...props, ...next }; act(() => tree.update(<PeopleListRow {...props} />)); } };
}
function screenMount() {
  let props: React.ComponentProps<typeof PeopleScreen> = {
    people: [person('Zoe', { ring_bucket: 'full' }), person('Amelia'), person('Élodie', { ring_bucket: 'full' })],
    query: '', onQueryChange: jest.fn(), searchResults: <Text>Supplied result</Text>, pendingRequests: 2,
    onRequestsPress: jest.fn(), onPersonPress: jest.fn(), onLongPressPerson: jest.fn(), onAddPeople: jest.fn(), onCreateCircle: jest.fn(), appearance,
  };
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<PeopleScreen {...props} />); });
  cleanup.push(() => act(() => tree.unmount()));
  return { tree, get props() { return props; }, update(next: Partial<typeof props>) { props = { ...props, ...next }; act(() => tree.update(<PeopleScreen {...props} />)); } };
}

it('retains the same search input and scroll owner across browse, successive queries and return', () => {
  const f = screenMount();
  const input = f.tree.root.findByType(TextInput);
  const scroll = f.tree.root.findAllByType(ScrollView)[0];
  act(() => input.props.onChangeText('Am'));
  expect(f.props.onQueryChange).toHaveBeenCalledWith('Am');
  for (const query of ['Am', 'Amelia', '']) {
    f.update({ query });
    expect(f.tree.root.findByType(TextInput)).toBe(input);
    expect(f.tree.root.findAllByType(ScrollView)[0]).toBe(scroll);
    expect(input.props.value).toBe(query);
  }
  expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
});
it('uses supplied search results without retaining browse entries or duplicate requests/actions', () => {
  const f = screenMount(); f.update({ query: '@new' });
  expect(textOf(f.tree)).toContain('Supplied result');
  expect(f.tree.root.findAllByType((PeopleListRow as any).type)).toHaveLength(0);
  expect(textOf(f.tree)).not.toContain('Recent people');
  expect(buttonsOf(f.tree)).toHaveLength(0);
});
it('keeps received recent order and full first-name ordering without mutating input', () => {
  const f = screenMount();
  expect(f.tree.root.findAllByType((PeopleRecentPerson as any).type).map(n => n.props.person.user_id)).toEqual(['Zoe', 'Élodie']);
  expect(f.tree.root.findAllByType((PeopleListRow as any).type).map(n => n.props.person.user_id)).toEqual(['Amelia', 'Élodie', 'Zoe']);
  expect(f.props.people.map(p => p.user_id)).toEqual(['Zoe', 'Amelia', 'Élodie']);
});
it('keeps the existing grid when the opt-in appearance is absent', () => {
  const f = screenMount(); f.update({ appearance: undefined });
  expect(f.tree.root.findAllByType((PeopleListRow as any).type)).toHaveLength(0);
  expect(f.tree.root.findAllByType((PeopleGridCell as any).type)).toHaveLength(3);
});
it('preserves all request, add and create callbacks', () => {
  const f = screenMount();
  const buttons = buttonsOf(f.tree);
  for (const label of ['2 people want to connect', 'Add people', 'Create a circle']) {
    act(() => buttons.find(b => b.props.accessibilityLabel === label)!.props.onPress());
  }
  expect(f.props.onRequestsPress).toHaveBeenCalledTimes(1);
  expect(f.props.onAddPeople).toHaveBeenCalledTimes(1);
  expect(f.props.onCreateCircle).toHaveBeenCalledTimes(1);
});
it('keeps requests reachable even with no current connections', () => {
  const f = screenMount(); f.update({ people: [] });
  expect(buttonsOf(f.tree).some(b => b.props.accessibilityLabel === '2 people want to connect')).toBe(true);
});
it('opens the exact person and keeps its 44-point menu outside the main press target', () => {
  const f = rowMount();
  const row = press(f.tree, 'people-row-Amelia');
  const menu = press(f.tree, 'people-options-Amelia');
  act(() => row.props.onPress());
  expect(f.props.onPress).toHaveBeenCalledWith(f.props.person);
  f.props.onPress.mockClear();
  expect(row.findAll(n => n.props.testID === 'people-options-Amelia')).toHaveLength(0);
  // Geometry cannot depend on Pressable's callback styles: the shipped native
  // render dropped those styles and stacked the photo above the person's name.
  expect(menu.findAllByType(View).some(n => {
    const style = StyleSheet.flatten(n.props.style);
    return style?.width === 44 && style?.height === 44;
  })).toBe(true);
  act(() => menu.props.onPress());
  act(() => f.measurements[0](10, 20, 54, 54));
  expect(f.props.onLongPress).toHaveBeenCalledWith(f.props.person, { x: 10, y: 20, width: 54, height: 54 });
  expect(f.props.onPress).not.toHaveBeenCalled();
});
it('retains the approved photo-left anatomy when Pressable callback styles are unavailable', () => {
  const f = rowMount(person('Alexandra Sofia Martinez-Rivera', { shared_count: 3 }));
  const target = press(f.tree, 'people-row-Alexandra Sofia Martinez-Rivera');
  const content = target.findAllByType(View).find(n => StyleSheet.flatten(n.props.style)?.flexDirection === 'row')!;
  expect(content).toBeDefined();
  expect(StyleSheet.flatten(content.props.style)).toMatchObject({ alignItems: 'center', minHeight: 82 });
  const face = content.findAllByType(View).find(n => n.props.collapsable === false)!;
  expect(StyleSheet.flatten(face.props.style)).toMatchObject({ width: 54, height: 54, flexShrink: 0 });
  expect(content.findAllByType(Text).map(n => n.props.children)).toEqual(['Alexandra Sofia Martinez-Rivera', '3 shared plans']);
  expect(StyleSheet.flatten(target.parent!.props.style)).toMatchObject({ flex: 1, minWidth: 0 });
});
it('retains long press with the same measured-avatar menu callback', () => {
  const f = rowMount();
  act(() => press(f.tree, 'people-row-Amelia').props.onLongPress());
  act(() => f.measurements[0](3, 8, 54, 54));
  expect(f.props.onLongPress).toHaveBeenCalledWith(f.props.person, { x: 3, y: 8, width: 54, height: 54 });
});
it.each(['25', 'none', 'full'] as const)('keeps photo full opacity for %s recency without quiet labels', bucket => {
  const f = rowMount(person('Amelia', { ring_bucket: bucket, shared_count: 3 }));
  const photo = f.tree.root.findByType('Photo' as any);
  expect(StyleSheet.flatten(photo.props.style).opacity).toBe(1);
  expect(textOf(f.tree)).toContain('3 shared plans');
  expect(textOf(f.tree)).not.toContain('quiet');
});
it('describes upcoming data without claiming the viewer is going too', () => {
  const value = peopleContext(person('Amelia', { upcoming_title: 'Beach walk', upcoming_start: '2026-09-19T18:00:00Z', shared_count: 3 }));
  expect(value).toBe('SAT · Beach walk');
  expect(value).not.toMatch(/together|your next/i);
});
it('uses actual count or normalized handle, and omits unsupported context', () => {
  expect(peopleContext(person('A', { shared_count: 1 }))).toBe('1 shared plan');
  expect(peopleContext(person('A', { handle: '@amelia' }))).toBe('@amelia');
  expect(peopleContext(person('A', { handle: null }))).toBeNull();
});
it('falls back on image failure, retries a replacement URL and ignores the retired image error', () => {
  const f = rowMount(); const oldError = f.tree.root.findByType('Photo' as any).props.onError;
  act(() => oldError()); expect(f.tree.root.findAllByType('Photo' as any)).toHaveLength(0);
  expect(textOf(f.tree)).toContain('A');
  f.update({ person: { ...f.props.person, profile_photo_url: 'https://example.invalid/new.jpg' } });
  act(() => oldError());
  expect(f.tree.root.findByType('Photo' as any).props.source.uri).toBe('https://example.invalid/new.jpg');
});
it('does not transfer a failed photo to a different person using the same image URL', () => {
  const f = rowMount(); const old = f.tree.root.findByType('Photo' as any).props.onError;
  act(() => old());
  f.update({ person: person('Bea', { profile_photo_url: 'https://example.invalid/Amelia.jpg' }) });
  act(() => old());
  expect(f.tree.root.findAllByType('Photo' as any)).toHaveLength(1);
  expect(textOf(f.tree)).toContain('Bea');
});
it('renders initials for missing photos without requiring an image request', () => {
  const f = rowMount(person('Élodie', { profile_photo_url: null }));
  expect(textOf(f.tree)).toContain('É');
  expect(f.tree.root.findAllByType('Photo' as any)).toHaveLength(0);
});
it.each(['identity', 'callback', 'unmount'])('retires a pending menu measurement on %s change', change => {
  const f = rowMount(); const original = f.props.onLongPress;
  act(() => press(f.tree, 'people-options-Amelia').props.onPress());
  if (change === 'identity') f.update({ person: person('Bea') });
  if (change === 'callback') f.update({ onLongPress: jest.fn() });
  if (change === 'unmount') f.unmount();
  act(() => f.measurements[0](10, 20, 54, 54));
  expect(original).not.toHaveBeenCalled();
  expect(f.props.onLongPress).not.toHaveBeenCalled();
});
it('does not open a menu from an invalid or unmeasured avatar rectangle', () => {
  const f = rowMount();
  act(() => press(f.tree, 'people-options-Amelia').props.onPress());
  act(() => f.measurements[0](0, 0, 0, 0));
  expect(f.props.onLongPress).not.toHaveBeenCalled();
});

function peopleActionBody(tree: ReturnType<typeof create>, label: string) {
 const button = buttonsOf(tree).find(n => n.props.accessibilityLabel === label)!;
 return button.findAllByType(View).find(n => typeof StyleSheet.flatten(n.props.style)?.width === 'number')!;
}
it('fits equally sized branded actions inside a narrow parent while keeping the search input mounted', () => {
 const dimensions=jest.spyOn(require('react-native'),'useWindowDimensions').mockReturnValue({width:1024,height:844,scale:1,fontScale:1});
 try {
 const f=screenMount(); const input=f.tree.root.findByType(TextInput); const scroll=f.tree.root.findAllByType(ScrollView)[0];
 act(() => scroll.props.onLayout({nativeEvent:{layout:{width:320}}}));
 const bodies=['Add people','Create a circle'].map(label=>peopleActionBody(f.tree,label));
 for(const body of bodies){expect(StyleSheet.flatten(body.props.style)).toMatchObject({width:288,minHeight:46,borderRadius:24,paddingHorizontal:10,paddingVertical:12});expect(body.findByType(Text).props.numberOfLines).toBe(1);}
 expect(f.tree.root.findAllByType(CreatorActionFill)).toHaveLength(1);
 expect(peopleActionBody(f.tree,'Create a circle').findAllByType(CreatorActionFill)).toHaveLength(1);
 act(() => scroll.props.onLayout({nativeEvent:{layout:{width:390}}}));
 expect(StyleSheet.flatten(peopleActionBody(f.tree,'Add people').props.style).width).toBe(174);
 expect(f.tree.root.findByType(TextInput)).toBe(input);
 } finally {dimensions.mockRestore();}
});
it('gives each action a full row when the measured parent cannot fit both labels', () => {
 const f=screenMount(); const scroll=f.tree.root.findAllByType(ScrollView)[0];
 act(() => scroll.props.onLayout({nativeEvent:{layout:{width:280}}}));
 for(const label of ['Add people','Create a circle'])expect(StyleSheet.flatten(peopleActionBody(f.tree,label).props.style).width).toBe(248);
 expect(f.tree.root.findAllByType(View).some(n=>StyleSheet.flatten(n.props.style)?.flexDirection==='column')).toBe(true);
});
it('adapts action rows for enlarged text without remounting search or changing callbacks', () => {
 const dimensions=jest.spyOn(require('react-native'),'useWindowDimensions').mockReturnValue({width:390,height:844,scale:1,fontScale:1.5});
 try {
  const f=screenMount();const input=f.tree.root.findByType(TextInput);const scroll=f.tree.root.findAllByType(ScrollView)[0];
  act(() => scroll.props.onLayout({nativeEvent:{layout:{width:320}}}));
  for(const label of ['Add people','Create a circle'])expect(StyleSheet.flatten(peopleActionBody(f.tree,label).props.style).width).toBe(288);
  f.update({query:'Am'});expect(f.tree.root.findByType(TextInput)).toBe(input);f.update({query:''});expect(f.tree.root.findByType(TextInput)).toBe(input);
  act(()=>buttonsOf(f.tree).find(b=>b.props.accessibilityLabel==='Create a circle')!.props.onPress());expect(f.props.onCreateCircle).toHaveBeenCalledTimes(1);
 } finally {dimensions.mockRestore();}
});
it('retains flat legacy controls and window-based grid sizing when appearance is absent', () => {
 const f=screenMount();f.update({appearance:undefined});expect(f.tree.root.findAllByType(CreatorActionFill)).toHaveLength(0);
 for(const label of ['Add people','Create a circle'])expect(StyleSheet.flatten(peopleActionBody(f.tree,label).props.style)).toMatchObject({height:46,borderRadius:7});
 expect(f.tree.root.findAllByType(ScrollView)[0].props.onLayout).toBeUndefined();
});

it('stacks branded actions after a single text-size increase on a wide phone', () => {
 const dimensions=jest.spyOn(require('react-native'),'useWindowDimensions').mockReturnValue({width:440,height:956,scale:3,fontScale:1.12});
 try {
  const f=screenMount(); const scroll=f.tree.root.findAllByType(ScrollView)[0];
  act(() => scroll.props.onLayout({nativeEvent:{layout:{width:440}}}));
  for(const label of ['Add people','Create a circle']) {
   const body=peopleActionBody(f.tree,label);
   expect(StyleSheet.flatten(body.props.style).width).toBe(408);
   expect(body.findByType(Text).props.numberOfLines).toBe(1);
  }
 } finally {dimensions.mockRestore();}
});


// Model the real hook's independent dimension subscriptions so memoized people
// still receive system font changes without remounting their containing rows.
function liveFontScale() {
 let fontScale = 1;
 const listeners = new Set<() => void>();
 const hook = jest.spyOn(require('react-native'), 'useWindowDimensions').mockImplementation(() => {
  const [, refresh] = React.useReducer((value: number) => value + 1, 0);
  React.useEffect(() => { listeners.add(refresh); return () => { listeners.delete(refresh); }; }, []);
  return { width: 390, height: 844, scale: 3, fontScale };
 });
 return { change(next: number) { fontScale = next; act(() => listeners.forEach(listener => listener())); }, restore() { hook.mockRestore(); } };
}
const nativeText = (tree: ReturnType<typeof create>, value: string) => tree.root.findAllByType(Text).find(node => node.props.children === value)!;

it('remeasures mounted action labels at both scale transitions without replacing controls, search or scroll', () => {
 const scale = liveFontScale();
 try {
  const f = screenMount(), input = f.tree.root.findByType(TextInput), scroll = f.tree.root.findAllByType(ScrollView)[0];
  const labels = ['Add people', 'Create a circle'];
  const controls = labels.map(label => buttonsOf(f.tree).find(node => node.props.accessibilityLabel === label));
  let text = labels.map(label => nativeText(f.tree, label));
  for (const next of [1.5, 1]) {
   scale.change(next);
   labels.forEach((label, index) => {
    const fresh = nativeText(f.tree, label); expect(fresh).not.toBe(text[index]); text[index] = fresh;
    expect(buttonsOf(f.tree).find(node => node.props.accessibilityLabel === label)).toBe(controls[index]);
   });
   expect(f.tree.root.findByType(TextInput)).toBe(input); expect(f.tree.root.findAllByType(ScrollView)[0]).toBe(scroll);
  }
  f.update({ query: 'Juniper' }); scale.change(1.5);
  expect(f.tree.root.findByType(TextInput)).toBe(input); expect(input.props.value).toBe('Juniper');
  act(() => input.props.onChangeText('Juniper Test')); expect(f.props.onQueryChange).toHaveBeenLastCalledWith('Juniper Test');
  f.update({ query: '' });
  act(() => buttonsOf(f.tree).find(node => node.props.accessibilityLabel === 'Add people')!.props.onPress()); expect(f.props.onAddPeople).toHaveBeenCalledTimes(1);
 } finally { scale.restore(); }
});

it('remeasures memoized person name and context while retaining photo and exact-person controls', () => {
 const scale = liveFontScale();
 try {
  const f = rowMount(person('Juniper Test', { shared_count: 3 }));
  const row = press(f.tree, 'people-row-Juniper Test'), menu = press(f.tree, 'people-options-Juniper Test'), photo = f.tree.root.findByType('Photo' as any);
  let texts = ['Juniper Test', '3 shared plans'].map(label => nativeText(f.tree, label));
  for (const next of [1.5, 1]) {
   scale.change(next);
   ['Juniper Test', '3 shared plans'].forEach((label, index) => { const fresh = nativeText(f.tree, label); expect(fresh).not.toBe(texts[index]); texts[index] = fresh; });
   expect(press(f.tree, 'people-row-Juniper Test')).toBe(row); expect(press(f.tree, 'people-options-Juniper Test')).toBe(menu);
   expect(f.tree.root.findByType('Photo' as any)).toBe(photo);
  }
  act(() => row.props.onPress()); expect(f.props.onPress).toHaveBeenCalledWith(f.props.person); expect(f.props.onPress).toHaveBeenCalledTimes(1);
  act(() => photo.props.onError()); const initial = nativeText(f.tree, 'J'); scale.change(1.5);
  expect(nativeText(f.tree, 'J')).not.toBe(initial); expect(f.tree.root.findAllByType('Photo' as any)).toHaveLength(0);
 } finally { scale.restore(); }
});

it('remeasures the recent-person label without replacing its avatar or press target', () => {
 const scale = liveFontScale();
 try {
  const f = screenMount(), recent = press(f.tree, 'people-recent-Zoe');
  const photo = recent.findByType('Photo' as any), label = recent.findByType(Text);
  scale.change(1.5);
  expect(press(f.tree, 'people-recent-Zoe')).toBe(recent); expect(recent.findByType('Photo' as any)).toBe(photo); expect(recent.findByType(Text)).not.toBe(label);
  act(() => recent.props.onPress()); expect(f.props.onPersonPress).toHaveBeenCalledWith(f.props.people[0]); expect(f.props.onPersonPress).toHaveBeenCalledTimes(1);
 } finally { scale.restore(); }
});
