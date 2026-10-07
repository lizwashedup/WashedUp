jest.mock('../../ProfileButton', () => ({ __esModule: true, default: () => require('react').createElement(require('react-native').TouchableOpacity, { accessibilityRole: 'button', accessibilityLabel: 'Profile' }) }));
import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ChatContextHeader } from '../ChatContextHeader';
import { AfterglowFonts } from '../../../constants/Typography';
let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => ({ width: 390, height: 844, scale: 3, fontScale: mockFontScale }) }));
beforeEach(() => { mockFontScale = 1; });

it('opens the real context from its identity and preserves explicit back and utility actions', () => {
  const back = jest.fn(), view = jest.fn(), calendar = jest.fn();
  let tree: ReactTestRenderer;
  act(() => { tree = create(<ChatContextHeader title="A little sunset volleyball" subtitle="Sat, Sep 19 · 5 PM" location="Ocean Park"
    contextLabel="View Plan" fonts={AfterglowFonts} onBack={back} onViewContext={view}
    actions={<TouchableOpacity accessibilityRole="button" accessibilityLabel="Add to calendar" onPress={calendar}><Text>Calendar</Text></TouchableOpacity>}
  />); });
  expect(back).not.toHaveBeenCalled();
  expect(view).not.toHaveBeenCalled();
  const buttons = tree!.root.findAllByType(TouchableOpacity);
  const identity = buttons.find(button => button.props.accessibilityLabel === 'View Plan: A little sunset volleyball');
  expect(identity?.props.accessibilityHint).toContain('Ocean Park');
  act(() => {
    identity!.props.onPress();
    buttons.find(button => button.props.accessibilityLabel === 'Back to Chats')!.props.onPress();
    buttons.find(button => button.props.accessibilityLabel === 'Add to calendar')!.props.onPress();
  });
  expect(view).toHaveBeenCalledTimes(1);
  expect(back).toHaveBeenCalledTimes(1);
  expect(calendar).toHaveBeenCalledTimes(1);
  act(() => tree!.unmount());
});

it('does not invent calendar, share, invite or details actions for a circle or DM', () => {
  let tree: ReactTestRenderer;
  act(() => { tree = create(<ChatContextHeader title="Amelia" subtitle="typing…" contextLabel="View Amelia" fonts={AfterglowFonts} onBack={jest.fn()} onViewContext={jest.fn()} />); });
  expect(tree!.root.findAllByType(TouchableOpacity).map(button => button.props.accessibilityLabel)).toEqual(['Back to Chats', 'View Amelia', 'Profile']);
  act(() => tree!.unmount());
});

it('keeps an unknown context readable without a dead navigation control', () => {
  const back = jest.fn();
  let tree: ReactTestRenderer;
  act(() => { tree = create(<ChatContextHeader title="Loading chat" contextLabel="View community" fonts={AfterglowFonts} onBack={back} backLabel="Back" />); });
  const buttons = tree!.root.findAllByType(TouchableOpacity);
  expect(buttons).toHaveLength(2);
  expect(buttons[1].props.accessibilityLabel).toBe('Profile');
  expect(buttons[0].props.accessibilityLabel).toBe('Back');
  act(() => buttons[0].props.onPress());
  expect(back).toHaveBeenCalledTimes(1);
  expect(tree!.root.findAllByType(Text).map(text => text.props.children)).toContain('Loading chat');
  act(() => tree!.unmount());
});

it('keeps context and utility actions reachable when a narrow header uses two rows', () => {
  const calendar = jest.fn();
  let tree: ReactTestRenderer;
  act(() => { tree = create(<ChatContextHeader wrapActionsOnNarrow title="A little sunset volleyball" subtitle="Saturday · Ocean Park" contextLabel="View Plan" fonts={AfterglowFonts} onBack={jest.fn()} onViewContext={jest.fn()} actions={<TouchableOpacity accessibilityLabel="Calendar" onPress={calendar}><Text>Calendar</Text></TouchableOpacity>} />); });
  const layout = tree!.root.find(node => typeof node.props.onLayout === 'function');
  act(() => layout.props.onLayout({ nativeEvent: { layout: { width: 320 } } }));
  expect(tree!.root.findAllByType(Text).filter(node => node.props.children === 'Saturday · Ocean Park')).toHaveLength(1);
  expect(tree!.root.findAllByType(TouchableOpacity).map(node => node.props.accessibilityLabel)).toEqual(['Back to Chats', 'View Plan: A little sunset volleyball', 'Profile', 'Calendar']);
  act(() => tree!.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === 'Calendar')!.props.onPress());
  expect(calendar).toHaveBeenCalledTimes(1);
  act(() => layout.props.onLayout({ nativeEvent: { layout: { width: 430 } } }));
  expect(tree!.root.findAllByType(TouchableOpacity).map(node => node.props.accessibilityLabel)).toEqual(['Back to Chats', 'View Plan: A little sunset volleyball', 'Calendar', 'Profile']);
  act(() => tree!.unmount());
});


it.each([false, true])('refreshes native identity text at mounted font changes without replacing navigation/actions (stacked=%s)', stacked => {
  const back = jest.fn(), view = jest.fn(), more = jest.fn();
  const render = () => <ChatContextHeader title="Sunday people" subtitle="3 people" contextLabel="View Circle"
    fonts={AfterglowFonts} onBack={back} onViewContext={view} wrapActionsOnNarrow={stacked}
    actions={<TouchableOpacity accessibilityRole="button" accessibilityLabel="Circle options" onPress={more}><Text>More</Text></TouchableOpacity>} />;
  let tree!: ReactTestRenderer;
  act(() => { tree = create(render()); });
  if (stacked) act(() => tree.root.find(node => typeof node.props.onLayout === 'function').props.onLayout({ nativeEvent: { layout: { width: 320 } } }));
  const label = (value: string) => tree.root.findAllByType(Text).find(node => node.props.children === value)!;
  const buttons = () => tree.root.findAllByType(TouchableOpacity);
  const originalButtons = buttons();
  let title = label('Sunday people'), subtitle = label('3 people');
  for (const scale of [2, 1]) {
    mockFontScale = scale; act(() => tree.update(render()));
    expect(label('Sunday people')).not.toBe(title); expect(label('3 people')).not.toBe(subtitle);
    expect(buttons()).toEqual(originalButtons);
    expect(buttons().find(node => node.props.accessibilityLabel === 'View Circle: Sunday people')!.props.accessibilityHint).toBe('3 people');
    title = label('Sunday people'); subtitle = label('3 people');
  }
  act(() => {
    buttons().find(node => node.props.accessibilityLabel === 'Back to Chats')!.props.onPress();
    buttons().find(node => node.props.accessibilityLabel === 'View Circle: Sunday people')!.props.onPress();
    buttons().find(node => node.props.accessibilityLabel === 'Circle options')!.props.onPress();
  });
  expect(back).toHaveBeenCalledTimes(1); expect(view).toHaveBeenCalledTimes(1); expect(more).toHaveBeenCalledTimes(1);
  expect(buttons().find(node => node.props.accessibilityLabel === 'Profile')).toBeDefined();
  act(() => tree.unmount());
});
