import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { usePlanFeedModeration } from '../usePlanFeedModeration';

const mockBlock = jest.fn();
let mockFocused = true, viewer = 'alice';
jest.mock('expo-router', () => ({useFocusEffect: (callback: () => void) => {
  require('react').useEffect(() => mockFocused ? callback() : undefined, [mockFocused, callback]);
}}));
jest.mock('../useBlock', () => ({useBlock: () => ({blockUser: mockBlock})}));
const alice = () => viewer === 'alice', bob = () => viewer === 'bob';
const card = (id:string, name:string) => ({id, creator:{id:'creator-' + name, first_name_display:name}});
const plan = card('walk', 'Sam');
let featured = [card('picnic', 'Amelia')];
let tree: ReactTestRenderer, menu: ReturnType<typeof usePlanFeedModeration>;
function Screen() {
  menu = usePlanFeedModeration(viewer, viewer === 'alice' ? alice : bob, [plan], featured);
  return null;
}
const update = () => act(() => tree.update(<Screen/>));
beforeEach(() => {
  mockBlock.mockClear(); viewer='alice';mockFocused=true;featured=[card('picnic','Amelia')];
  act(() => { tree=create(<Screen/>); });
});
afterEach(() => act(() => tree.unmount()));

it.each([['picnic','Amelia'],['walk','Sam']])('opens report and block for the displayed creator of %s', (id,name) => {
  act(() => menu.handleReport(id));
  expect(menu.reportTarget).toMatchObject({eventId:id,userId:'creator-'+name,userName:name,scope:{userId:'alice'}});
  act(() => menu.handleBlock(id));
  expect(mockBlock).toHaveBeenCalledWith('creator-'+name,name,undefined,menu.reportTarget!.scope);
});
it('retires the open report, native block confirmation and saved menu after switching accounts', () => {
  const old = menu;act(() => { old.handleReport('picnic'); old.handleBlock('picnic'); });
  const confirmation = mockBlock.mock.calls[0][3];viewer='bob';
  expect(confirmation.isCurrent()).toBe(false);update();
  act(() => { old.handleReport('picnic');old.handleBlock('picnic'); });
  expect(menu.reportTarget).toBeNull();expect(mockBlock).toHaveBeenCalledTimes(1);
});
it('requires a new menu after blur and ignores a card whose creator changed', () => {
  const old = menu; mockFocused=false;update();mockFocused=true;update();
  act(() => old.handleReport('picnic'));expect(menu.reportTarget).toBeNull();
  const prior = menu;featured=[card('picnic','Chris')];update();
  act(() => prior.handleBlock('picnic'));expect(mockBlock).not.toHaveBeenCalled();
  act(() => menu.handleReport('picnic'));expect(menu.reportTarget?.userName).toBe('Chris');
});

it('preserves the mini profile handoff without attributing a profile report to a plan', () => {
  const visit=menu;
  act(() => visit.reportPerson('person','Amelia'));
  expect(menu.reportTarget).toMatchObject({userId:'person',eventId:'',scope:{userId:'alice'}});
  act(() => visit.blockPerson('person','Amelia'));
  expect(mockBlock).toHaveBeenCalledTimes(1);
  viewer='bob';update();
  act(() => { visit.reportPerson('person','Amelia'); visit.blockPerson('person','Amelia'); });
  expect(menu.reportTarget).toBeNull();expect(mockBlock).toHaveBeenCalledTimes(1);
});
