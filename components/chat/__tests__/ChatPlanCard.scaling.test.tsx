import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { router } from 'expo-router';
import ChatPlanCard from '../ChatPlanCard';
let mockFontScale = 1;
const mockFontListeners = new Set<(value: number) => void>();
let mockWrapped = false;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => {
  const React = require('react'); const [fontScale, setScale] = React.useState(mockFontScale);
  React.useEffect(() => { mockFontListeners.add(setScale); return () => { mockFontListeners.delete(setScale); }; }, []);
  return { width: 390, height: 844, scale: 3, fontScale };
} }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('../../../hooks/useEventCard', () => ({ useEventCard: () => ({ isLoading: false, data: { id: 'plan-one', title: 'A Sunday walk', start_time: '2026-10-04T17:00:00Z', wrapped: mockWrapped } }) }));
let tree: ReactTestRenderer;
afterEach(() => { act(() => tree?.unmount()); jest.clearAllMocks(); });
it.each([false, true])('remeasures every embedded plan label under a retained memoized parent (wrapped=%s)', wrapped => {
  mockFontScale = 1; mockWrapped = wrapped; let parentRenders = 0;
  const Parent = React.memo(function Parent() { parentRenders++; return <ChatPlanCard eventId="plan-one" />; });
  act(() => { tree = create(<Parent />); });
  const controls = tree.root.findAll(node => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function');
  let labels = tree.root.findAllByType(Text);
  expect(labels).toHaveLength(wrapped ? 1 : 3);
  const originalWords = labels.map(label => label.props.children);
  for (const scale of [2, 1]) {
    act(() => { mockFontScale = scale; mockFontListeners.forEach(update => update(scale)); });
    const resized = tree.root.findAllByType(Text);
    resized.forEach((node, index) => expect(node).not.toBe(labels[index]));
    expect(resized.map(label => label.props.children)).toEqual(originalWords); labels = resized;
    expect(tree.root.findAll(node => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function')).toEqual(controls);
    expect(parentRenders).toBe(1);
  }
  if (wrapped) expect(controls).toHaveLength(0);
  else { act(() => controls[0].props.onPress()); expect(router.push).toHaveBeenCalledWith('/plan/plan-one'); }
});
