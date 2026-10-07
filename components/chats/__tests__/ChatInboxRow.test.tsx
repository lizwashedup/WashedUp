import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ChatInboxRow } from '../ChatInboxRow';
import { AfterglowFonts } from '../../../constants/Typography';

it('retains the full message/count/context for accessibility when the compact visual row truncates', () => {
  const onPress = jest.fn(), onLongPress = jest.fn();
  let tree: ReactTestRenderer;
  act(() => { tree = create(<ChatInboxRow identity="event-1" title="A little sunset volleyball"
    preview="Riley: We moved to the north courts." metadata="Sunset Club LA" lifecycle="Chat closes in 1 hour"
    timestamp="Yesterday" unread={132} fonts={AfterglowFonts} onPress={onPress} onLongPress={onLongPress}
  />); });
  const button = tree!.root.findByType(TouchableOpacity);
  expect(button.props.accessibilityLabel).toContain('132 unread messages');
  expect(button.props.accessibilityLabel).toContain('Sunset Club LA. Riley: We moved to the north courts.');
  expect(button.props.accessibilityLabel).toContain('Chat closes in 1 hour');
  expect(button.props.accessibilityHint).toContain('Touch and hold');
  expect(tree!.root.findAllByType(Text).some(text => text.props.children === '99+')).toBe(true);
  expect(onPress).not.toHaveBeenCalled();
  act(() => { button.props.onPress(); button.props.onLongPress(); });
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(onLongPress).toHaveBeenCalledTimes(1);
  act(() => tree!.unmount());
});

it('does not manufacture an unread or options affordance for an empty or uncounted chat', () => {
  let tree: ReactTestRenderer;
  act(() => { tree = create(<ChatInboxRow identity="community-1" title="Sunset Club LA" preview="Say hello."
    unread={Number.NaN} community fonts={AfterglowFonts} onPress={jest.fn()}
  />); });
  const button = tree!.root.findByType(TouchableOpacity);
  expect(button.props.accessibilityLabel).toContain('Community');
  expect(button.props.accessibilityLabel).not.toContain('unread');
  expect(button.props.accessibilityHint).toBeUndefined();
  act(() => tree!.unmount());
});
