import React from 'react';
import { Text, TextInput } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import { TierEditorSheet } from '../TierEditorSheet';

jest.mock('../../../lib/haptics', () => ({ hapticLight: jest.fn() }));

jest.mock('../../composer/CollapsibleCalendar', () => {
  const { View } = require('react-native');
  return function MockCalendar() { return <View accessibilityLabel="calendar" />; };
});

jest.mock('../../composer/TimePicker', () => {
  const { View } = require('react-native');
  return function MockTimePicker() { return <View accessibilityLabel="time picker" />; };
});

function renderedText(root: ReactTestInstance): string[] {
  return root.findAllByType(Text).map((node) => node.props.children).flat(Infinity).filter(Boolean);
}

describe('TierEditorSheet', () => {
  it('turns a missing required name into visible guidance instead of a dead save button', () => {
    const onSave = jest.fn();
    let editor: ReturnType<typeof create>;
    act(() => {
      editor = create(
        <TierEditorSheet
          visible
          tier={null}
          commissionBps={400}
          busy={false}
          onSave={onSave}
          onClose={jest.fn()}
        />,
      );
    });

    const saveButton = editor!.root.findByProps({ accessibilityRole: 'button', activeOpacity: 0.85 });
    expect(saveButton.props.disabled).toBe(false);

    act(() => saveButton.props.onPress());

    expect(onSave).not.toHaveBeenCalled();
    expect(renderedText(editor!.root)).toContain('give this ticket a name.');
  });

  it('submits a named free ticket through the real save callback', () => {
    const onSave = jest.fn();
    let editor: ReturnType<typeof create>;
    act(() => {
      editor = create(
        <TierEditorSheet
          visible
          tier={null}
          commissionBps={400}
          busy={false}
          onSave={onSave}
          onClose={jest.fn()}
        />,
      );
    });

    const nameInput = editor!.root.findAllByType(TextInput).find((node) => node.props.accessibilityLabel === 'ticket name, required');
    expect(nameInput).toBeTruthy();
    act(() => nameInput!.props.onChangeText('General admission'));

    const saveButton = editor!.root.findByProps({ accessibilityRole: 'button', activeOpacity: 0.85 });
    act(() => saveButton.props.onPress());

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      name: 'General admission',
      price_cents: 0,
      status: 'draft',
    }));
  });
});
