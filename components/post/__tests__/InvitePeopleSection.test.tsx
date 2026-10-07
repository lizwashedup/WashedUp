import React from 'react';
import { Text } from 'react-native';
import { Image } from 'expo-image';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import InvitePeopleSection, { type InviteSuggestion } from '../InvitePeopleSection';
import { AfterglowFallbackFonts } from '../../../constants/Typography';

jest.mock('lucide-react-native', () => ({ X: () => null, UserPlus: () => null }));
const appearance = { fonts: AfterglowFallbackFonts };
const suggestion = (index: number): InviteSuggestion => ({ user_id: `person-${index}`, name: `Amelia ${index}`, photo: `mock:${index}`, handle: index === 0 ? ' @@amelialocal ' : null, isWantIn: true, provenance: `Said they'd go next time · Plan ${index}` });
let tree: ReactTestRenderer;
const action = (root: ReactTestInstance, label: string) => root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
const labels = () => tree.root.findAllByType(Text).map(node => node.props.children);
const props = () => ({ invited: [{ user_id: 'picked', name: 'Jamie', photo: null, handle: 'jamielocal' }], suggestions: Array.from({ length: 8 }, (_, index) => suggestion(index)), showAll: false, onToggleShowAll: jest.fn(), onInvite: jest.fn(), onRemoveChip: jest.fn(), onDismiss: jest.fn(), onAddFromPeople: jest.fn() });
afterEach(() => act(() => tree?.unmount()));
it('preserves the first-six suggestion limit and exact invite, remove and dismiss callback payloads', () => {
  const p = props(); act(() => { tree = create(<InvitePeopleSection {...p} appearance={appearance}/>); });
  expect(action(tree.root, 'Invite Amelia 5')).toBeDefined(); expect(action(tree.root, 'Invite Amelia 6')).toBeUndefined();
  act(() => action(tree.root, 'Invite Amelia 0, @amelialocal').props.onPress()); expect(p.onInvite).toHaveBeenCalledWith(p.suggestions[0]);
  act(() => action(tree.root, 'Dismiss Amelia 0, @amelialocal').props.onPress()); expect(p.onDismiss).toHaveBeenCalledWith(p.suggestions[0]);
  act(() => action(tree.root, 'Remove Jamie, @jamielocal').props.onPress()); expect(p.onRemoveChip).toHaveBeenCalledWith('picked');
  act(() => action(tree.root, '+ Add from your people').props.onPress()); expect(p.onAddFromPeople).toHaveBeenCalledTimes(1);
  act(() => tree.update(<InvitePeopleSection {...p} appearance={appearance} showAll/>)); expect(action(tree.root, 'Invite Amelia 7')).toBeDefined();
});
it('renders only supplied handles, preserving the original name and provenance', () => {
  const p = props(); act(() => { tree = create(<InvitePeopleSection {...p} appearance={appearance}/>); });
  const handles = labels().filter(label => Array.isArray(label) && label[0] === '@');
  expect(handles).toEqual([['@', 'jamielocal'], ['@', 'amelialocal']]);
  expect(labels()).toContain('Amelia 0'); expect(labels()).toContain(p.suggestions[0].provenance);
});
it('keeps the default presentation and callbacks available without appearance', () => {
  const p = props(); act(() => { tree = create(<InvitePeopleSection {...p}/>); });
  expect(action(tree.root, 'Invite Amelia 0')).toBeDefined(); expect(action(tree.root, 'Remove Jamie')).toBeDefined();
  expect(labels().filter(label => Array.isArray(label) && label[0] === '@')).toEqual([]);
});
it('falls back on a failed photo without replacing a later portrait with an old error', () => {
  const p = props(); act(() => { tree = create(<InvitePeopleSection {...p} appearance={appearance}/>); });
  const oldFailure = tree.root.findAllByType(Image).find(node => node.props.source.uri === 'mock:0')!.props.onError;
  act(() => oldFailure()); expect(labels()).toContain('A');
  const next = p.suggestions.map((s, index) => index === 0 ? { ...s, photo: 'mock:new' } : s);
  act(() => tree.update(<InvitePeopleSection {...p} suggestions={next} appearance={appearance}/>)); act(() => oldFailure());
  expect(tree.root.findAllByType(Image).some(node => node.props.source.uri === 'mock:new')).toBe(true);
});
