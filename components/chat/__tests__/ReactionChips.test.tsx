import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { act, create } from 'react-test-renderer';
import { ReactionChips } from '../ReactionChips';
import { AfterglowFonts, AfterglowType } from '../../../constants/Typography';
import { AfterglowColors } from '../../../constants/Colors';

jest.mock('lucide-react-native', () => ({ Check: () => null, SmilePlus: () => null }));

describe('ReactionChips', () => {
  it('announces count and selection and sends the original legacy key when pressed', () => {
    const onReact = jest.fn(), onAddReaction = jest.fn();
    let view: ReturnType<typeof create>;
    act(() => { view = create(<ReactionChips
      reactions={[{ emoji: '❤️', count: 2, mine: false }, { emoji: 'heart', count: 1, mine: true }, { emoji: '🪩', count: 1, mine: false }]}
      onReact={onReact} onAddReaction={onAddReaction}
    />); });
    const buttons = view!.root.findAllByType(TouchableOpacity);
    const selected = buttons.find(button => button.props.accessibilityState?.selected);
    expect(selected?.props.accessibilityLabel).toBe('❤️, 3 reactions, your reaction');
    expect(selected?.props.accessibilityRole).toBe('button');
    act(() => selected!.props.onPress());
    expect(onReact).toHaveBeenCalledWith('heart');
    expect(buttons.some(button => button.props.accessibilityLabel === '🪩, 1 reaction')).toBe(true);
    act(() => buttons.find(button => button.props.accessibilityLabel === 'Add reaction')!.props.onPress());
    expect(onAddReaction).toHaveBeenCalledTimes(1);
    act(() => view!.unmount());
  });

  it('offers the full picker for an empty message without inventing zero-count reactions', () => {
    let view: ReturnType<typeof create>;
    act(() => { view = create(<ReactionChips reactions={[]} onReact={jest.fn()} onAddReaction={jest.fn()} />); });
    expect(view!.root.findAllByType(TouchableOpacity).map(button => button.props.accessibilityLabel)).toEqual(['Add reaction']);
    act(() => view!.unmount());
  });

  it('keeps archived reactions visible and selected, with no enabled picker or chip', () => {
    let view: ReturnType<typeof create>;
    act(() => { view = create(<ReactionChips reactions={[{ emoji: 'heart', count: 1, mine: true }]} disabled onReact={jest.fn()} onAddReaction={jest.fn()} />); });
    const buttons = view!.root.findAllByType(TouchableOpacity);
    expect(buttons).toHaveLength(1);
    expect(buttons[0].props.accessibilityLabel).toBe('❤️, 1 reaction, your reaction');
    expect(buttons[0].props.disabled).toBe(true);
    expect(buttons[0].props.accessibilityState).toEqual({ selected: true, disabled: true });
    act(() => view!.unmount());
  });

  it('uses the staged readable count without a misleading delivery checkmark without changing the legacy alias callback', () => {
    const onReact = jest.fn(); let view: ReturnType<typeof create>;
    act(() => { view = create(<ReactionChips appearance={{ fonts: AfterglowFonts }}
      reactions={[{ emoji: '❤️', count: 2, mine: false }, { emoji: 'heart', count: 1, mine: true }]}
      onReact={onReact} />); });
    const button = view!.root.findByType(TouchableOpacity);
    expect(button.props.accessibilityState).toMatchObject({ selected: true, disabled: false });
    expect(button.props.accessibilityLabel).toBe('❤️, 3 reactions, your reaction');
    const count = view!.root.findAllByType(Text).find(text => text.props.children === 3)!;
    expect(StyleSheet.flatten(count.props.style)).toMatchObject({ fontFamily: AfterglowFonts.semibold, fontSize: AfterglowType.caption.fontSize, color: AfterglowColors.ink });
    expect(view!.root.findAllByType(Check)).toHaveLength(0);
    act(() => button.props.onPress()); expect(onReact).toHaveBeenCalledWith('heart');
    act(() => view!.unmount());
  });

  it('keeps staged visible chips compact inside separate full-size touch targets and lets counts grow', () => {
    let view: ReturnType<typeof create>;
    act(() => { view = create(<ReactionChips appearance={{ fonts: AfterglowFonts }}
      reactions={[{ emoji: '🪩', count: 12000, mine: false }]} onReact={jest.fn()} onAddReaction={jest.fn()} />); });
    const buttons = view!.root.findAllByType(TouchableOpacity);
    for (const button of buttons) expect(StyleSheet.flatten(button.props.style)).toMatchObject({ minWidth: 44, minHeight: 44 });
    const chip = buttons[0].findAllByType(View).find(node => StyleSheet.flatten(node.props.style)?.borderWidth === 1)!;
    expect(StyleSheet.flatten(chip.props.style)).toMatchObject({ minHeight: 28, borderRadius: 14, borderColor: AfterglowColors.line });
    expect(StyleSheet.flatten(chip.props.style).height).toBeUndefined();
    const count = view!.root.findAllByType(Text).find(text => text.props.children === 12000)!;
    expect(count.props.numberOfLines).toBeUndefined(); expect(count.props.allowFontScaling).not.toBe(false);
    act(() => view!.unmount());
  });

  it('preserves caller actions and read-only reactions in staged appearance', () => {
    const reply = jest.fn(); let view: ReturnType<typeof create>;
    act(() => { view = create(<ReactionChips appearance={{ fonts: AfterglowFonts }}
      reactions={[{ emoji: '🪩', count: 1, mine: true }, { emoji: '👏', count: 2, mine: true }]} disabled
      onReact={jest.fn()} onAddReaction={jest.fn()} style={{ justifyContent: 'flex-end' }}>
      <TouchableOpacity onPress={reply} accessibilityLabel="Reply to this message"><Text>Reply</Text></TouchableOpacity>
    </ReactionChips>); });
    const buttons = view!.root.findAllByType(TouchableOpacity);
    expect(buttons.filter(button => button.props.accessibilityState?.selected)).toHaveLength(2);
    expect(buttons.filter(button => button.props.accessibilityState?.selected).every(button => button.props.disabled)).toBe(true);
    expect(buttons.some(button => button.props.accessibilityLabel === 'Add reaction')).toBe(false);
    act(() => buttons.find(button => button.props.accessibilityLabel === 'Reply to this message')!.props.onPress());
    expect(reply).toHaveBeenCalledTimes(1);
    expect(StyleSheet.flatten(view!.root.findAllByType(View)[0].props.style).justifyContent).toBe('flex-end');
    act(() => view!.unmount());
  });
});


it('attaches compact badges without a persistent picker and keeps accessible counts and targets', () => {
  const react = jest.fn(); let view: ReturnType<typeof create>;
  act(() => { view = create(<ReactionChips attached reactions={[{ emoji: 'heart', count: 1, mine: true }]} onReact={react} onAddReaction={jest.fn()} />); });
  const buttons = view!.root.findAllByType(TouchableOpacity);
  expect(buttons).toHaveLength(1);
  expect(buttons[0].props.accessibilityLabel).toBe('❤️, 1 reaction, your reaction');
  expect(StyleSheet.flatten(buttons[0].props.style)).toMatchObject({ minWidth: 44, minHeight: 44 });
  expect(view!.root.findAllByType(Text).some(text => text.props.children === 1)).toBe(false);
  act(() => buttons[0].props.onPress()); expect(react).toHaveBeenCalledWith('heart');
  act(() => view!.unmount());
});

it('opens the people list in a read-only chat without toggling its reaction', () => {
  const onReact = jest.fn(), onViewReactions = jest.fn(); let view: ReturnType<typeof create>;
  act(() => { view = create(<ReactionChips attached disabled reactions={[{ emoji: 'heart', count: 2, mine: true }]} onReact={onReact} onViewReactions={onViewReactions} />); });
  const button = view!.root.findByType(TouchableOpacity);
  expect(button.props.disabled).toBe(false);
  expect(button.props.accessibilityHint).toBe('See who reacted');
  act(() => button.props.onPress());
  expect(onViewReactions).toHaveBeenCalledTimes(1); expect(onReact).not.toHaveBeenCalled();
  act(() => view!.unmount());
});

it('keeps attached reactions overlapping the bubble despite caller row spacing',()=>{
 let view:ReturnType<typeof create>;
 act(()=>{view=create(<ReactionChips attached style={{marginTop:4,justifyContent:'flex-end'}} reactions={[{emoji:'heart',count:2,mine:false}]} onReact={jest.fn()}/>);});
 const style=StyleSheet.flatten(view!.root.findAllByType(View)[0].props.style);
 expect(style.marginTop).toBeLessThan(-10);expect(style.justifyContent).toBe('flex-end');
 act(()=>view!.unmount());
});
