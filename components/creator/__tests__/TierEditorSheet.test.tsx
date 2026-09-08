import React from 'react';
import { Text, TextInput } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import { TierEditorSheet } from '../TierEditorSheet';

jest.mock('../../../lib/haptics', () => ({ hapticLight: jest.fn() }));

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

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

  it('submits a named $5 paid ticket instead of looping in the editor', () => {
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

    const inputs = editor!.root.findAllByType(TextInput);
    const nameInput = inputs.find((node) => node.props.accessibilityLabel === 'ticket name, required');
    expect(nameInput).toBeTruthy();
    act(() => {
      nameInput!.props.onChangeText('General admission');
      inputs[2].props.onChangeText('5');
    });

    const saveButton = editor!.root.findByProps({ accessibilityRole: 'button', activeOpacity: 0.85 });
    act(() => saveButton.props.onPress());

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      name: 'General admission',
      price_cents: 500,
      status: 'draft',
    }));
  });

  it('locks a rapid second tap before React can render the busy state', () => {
    const onSave = jest.fn();
    let editor: ReturnType<typeof create>;
    act(() => {
      editor = create(
        <TierEditorSheet
          visible
          tier={null}
          commissionBps={400}
          busy={false}
          initialDraft={{
            name: 'General admission',
            description: null,
            price_cents: 500,
            quantity_cap: null,
            per_order_min: 1,
            per_order_max: null,
            visibility: 'visible',
            status: 'draft',
            sales_open_at: null,
            sales_close_at: null,
          }}
          onSave={onSave}
          onClose={jest.fn()}
        />,
      );
    });

    const saveButton = editor!.root.findByProps({ accessibilityRole: 'button', activeOpacity: 0.85 });
    act(() => {
      saveButton.props.onPress();
      saveButton.props.onPress();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      name: 'General admission',
      price_cents: 500,
    }));
  });

  it('restores attempted edits after an existing free tier detours to add an event end time', () => {
    const onSave = jest.fn();
    const existingTier = {
      id: 'tier-1',
      event_id: 'event-1',
      name: 'General admission',
      description: null,
      price_cents: 0,
      quantity_cap: null,
      per_order_min: 1,
      per_order_max: null,
      sales_open_at: null,
      sales_close_at: null,
      opens_after_tier_id: null,
      visibility: 'visible' as const,
      status: 'draft' as const,
      sort_order: 0,
    };
    let editor: ReturnType<typeof create>;
    act(() => {
      editor = create(
        <TierEditorSheet
          visible
          tier={existingTier}
          commissionBps={400}
          busy={false}
          initialDraft={{
            name: 'Updated admission',
            description: null,
            price_cents: 500,
            quantity_cap: null,
            per_order_min: 1,
            per_order_max: null,
            visibility: 'visible',
            status: 'draft',
            sales_open_at: null,
            sales_close_at: null,
          }}
          onSave={onSave}
          onClose={jest.fn()}
        />,
      );
    });

    const saveButton = editor!.root.findByProps({ accessibilityRole: 'button', activeOpacity: 0.85 });
    act(() => saveButton.props.onPress());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Updated admission',
      price_cents: 500,
    }));
  });
});
