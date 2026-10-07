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
  it('turns a missing required name into visible guidance instead of a dead save button', async () => {
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

    await act(async () => { await saveButton.props.onPress(); });

    expect(onSave).not.toHaveBeenCalled();
    expect(renderedText(editor!.root)).toContain('give this ticket a name.');
  });

  it('submits a named free ticket through the real save callback', async () => {
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
    await act(async () => { await saveButton.props.onPress(); });

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      name: 'General admission',
      price_cents: 0,
      status: 'draft',
    }));
  });

  it('submits a named $5 paid ticket instead of looping in the editor', async () => {
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
    await act(async () => { await saveButton.props.onPress(); });

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      name: 'General admission',
      price_cents: 500,
      status: 'draft',
    }));
  });

  it('locks a rapid second tap before React can render the busy state', async () => {
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
    await act(async () => {
      const first = saveButton.props.onPress();
      const second = saveButton.props.onPress();
      await Promise.all([first, second]);
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      name: 'General admission',
      price_cents: 500,
    }));
  });

  it('restores attempted edits after an existing free tier detours to add an event end time', async () => {
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
    await act(async () => { await saveButton.props.onPress(); });
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Updated admission',
      price_cents: 500,
    }));
  });
});

describe('ticket draft recovery',()=>{
 it('keeps typed content across a hidden visit with the same draft identity',async()=>{const props={visible:true,tier:null,commissionBps:400,busy:false,onSave:jest.fn(),onClose:jest.fn(),draftKey:'stable'};let tree:any;act(()=>{tree=create(<TierEditorSheet {...props}/>);});const name=()=>tree.root.findAllByType(TextInput).find((n:any)=>n.props.accessibilityLabel==='ticket name, required');act(()=>name().props.onChangeText('Still here'));act(()=>tree.update(<TierEditorSheet {...props} visible={false}/>));act(()=>tree.update(<TierEditorSheet {...props}/>));expect(name().props.value).toBe('Still here');act(()=>tree.unmount());});
 it('keeps a failed draft editable and releases the synchronous save lock for retry',async()=>{const onSave=jest.fn().mockRejectedValueOnce(Error('Connection lost')).mockResolvedValue(undefined);let tree:any;act(()=>{tree=create(<TierEditorSheet visible tier={null} commissionBps={400} busy={false} draftKey="stable" onSave={onSave} onClose={jest.fn()}/>);});const name=tree.root.findAllByType(TextInput).find((n:any)=>n.props.accessibilityLabel==='ticket name, required');act(()=>name.props.onChangeText('Sunday'));const button=()=>tree.root.findByProps({accessibilityRole:'button',activeOpacity:0.85});await act(async()=>{await button().props.onPress();});expect(renderedText(tree.root)).toContain('Connection lost');expect(name.props.value).toBe('Sunday');await act(async()=>{await button().props.onPress();});expect(onSave).toHaveBeenCalledTimes(2);act(()=>tree.unmount());});
 it('rejects fractional quantity input rather than truncating it',async()=>{const onSave=jest.fn();let tree:any;act(()=>{tree=create(<TierEditorSheet visible tier={null} commissionBps={400} busy={false} onSave={onSave} onClose={jest.fn()}/>);});act(()=>{tree.root.findAllByType(TextInput).find((n:any)=>n.props.accessibilityLabel==='ticket name, required').props.onChangeText('Sunday');tree.root.findAllByType(TextInput).find((n:any)=>n.props.placeholder==='no cap').props.onChangeText('2.5');});await act(async()=>{await tree.root.findByProps({accessibilityRole:'button',activeOpacity:0.85}).props.onPress();});expect(onSave).not.toHaveBeenCalled();expect(renderedText(tree.root)).toContain('Use positive whole numbers for ticket quantities.');act(()=>tree.unmount());});
});

it('keeps fields and dismissal locked while the actual save promise is pending',async()=>{
 let finish:any;const onSave=jest.fn(()=>new Promise(r=>{finish=r;})),onClose=jest.fn();let tree:any;
 act(()=>{tree=create(<TierEditorSheet visible tier={null} initialName="Sunday" commissionBps={400} busy={false} onSave={onSave} onClose={onClose}/>);});
 let pending:any;act(()=>{pending=tree.root.findByProps({accessibilityRole:'button',activeOpacity:0.85}).props.onPress();});
 expect(tree.root.findAllByType(TextInput).every((n:any)=>n.props.editable===false)).toBe(true);
 act(()=>tree.root.findByProps({accessibilityLabel:'close ticket editor'}).props.onPress());expect(onClose).not.toHaveBeenCalled();
 await act(async()=>{finish(undefined);await pending;});expect(tree.root.findAllByType(TextInput).every((n:any)=>n.props.editable===true)).toBe(true);act(()=>tree.unmount());
});
