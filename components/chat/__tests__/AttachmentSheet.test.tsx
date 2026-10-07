import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import AttachmentPanel from '../AttachmentSheet';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { AfterglowFallbackFonts, AfterglowFonts, AfterglowType, Fonts, FontSizes } from '../../../constants/Typography';

let tree: ReactTestRenderer;
afterEach(async () => { await act(async () => tree?.unmount()); });

function choices() { return tree.root.findAllByType(TouchableOpacity); }
function panelStyle() { return StyleSheet.flatten(tree.root.findAllByType(View)[0].props.style); }
function labelOf(choice: ReturnType<typeof choices>[number]) {
  return choice.findAllByType(Text).find(node => node.props.children === choice.props.accessibilityLabel)!;
}

it('keeps the existing default labels, appearance and keyboard-replacement dimensions', async () => {
  await act(async () => { tree = create(<AttachmentPanel height={280} bottomInset={34} onSelect={jest.fn()} />); });
  expect(choices().map(choice => choice.props.accessibilityLabel)).toEqual(['Photos & videos', 'Camera', 'Location']);
  expect(panelStyle()).toMatchObject({ height: 280, paddingBottom: 34, paddingHorizontal: 20, paddingTop: 16, backgroundColor: Colors.cardBg });
  for (const choice of choices()) {
    const label = labelOf(choice);
    expect(label.props.numberOfLines).toBe(1);
    expect(StyleSheet.flatten(label.props.style)).toMatchObject({ fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.textMedium });
  }
});

it.each([false, true])('preserves the three original attachment callbacks with staged appearance %s', async staged => {
  const onSelect = jest.fn();
  await act(async () => { tree = create(<AttachmentPanel height={280} bottomInset={34} onSelect={onSelect} appearance={staged ? { fonts: AfterglowFonts } : undefined} />); });
  expect(choices()).toHaveLength(3);
  if (staged) expect(choices().map(choice => choice.props.accessibilityLabel)).toEqual(['Photos', 'Camera', 'Location']);
  expect(onSelect).not.toHaveBeenCalled();
  act(() => { choices().forEach(choice => choice.props.onPress()); });
  expect(onSelect.mock.calls).toEqual([['photos'], ['camera'], ['location']]);
});

it('allows staged labels to scale and wrap without shrinking the touch targets or fixing the row height', async () => {
  await act(async () => { tree = create(<AttachmentPanel height={280} bottomInset={34} onSelect={jest.fn()} appearance={{ fonts: AfterglowFonts }} />); });
  for (const choice of choices()) {
    const targetStyle = StyleSheet.flatten(choice.props.style);
    const label = labelOf(choice);
    const labelStyle = StyleSheet.flatten(label.props.style);
    expect(choice.props.accessibilityRole).toBe('button');
    expect(targetStyle.minWidth).toBeGreaterThanOrEqual(44);
    expect(targetStyle.minHeight).toBeGreaterThanOrEqual(44);
    expect(targetStyle.height).toBeUndefined();
    expect(label.props.numberOfLines).toBeUndefined();
    expect(label.props.allowFontScaling).not.toBe(false);
    expect(label.props.maxFontSizeMultiplier).toBeUndefined();
    expect(label.props.adjustsFontSizeToFit).not.toBe(true);
    expect(labelStyle).toMatchObject({ ...AfterglowType.body, fontFamily: AfterglowFonts.medium, color: AfterglowColors.ink, alignSelf: 'stretch' });
    expect(labelStyle.height).toBeUndefined();
  }
});

it('accepts loaded or fallback fonts, preserves inline controls across updates and restores legacy styling when omitted', async () => {
  const onSelect = jest.fn();
  await act(async () => { tree = create(<AttachmentPanel height={280} bottomInset={34} onSelect={onSelect} appearance={{ fonts: AfterglowFallbackFonts }} />); });
  const originalCamera = choices()[1];
  expect(StyleSheet.flatten(labelOf(originalCamera).props.style).fontFamily).toBe(AfterglowFallbackFonts.medium);
  expect(panelStyle().backgroundColor).toBe(AfterglowColors.paper);

  act(() => tree.update(<AttachmentPanel height={346} bottomInset={0} onSelect={onSelect} appearance={{ fonts: AfterglowFonts }} />));
  expect(choices()[1]).toBe(originalCamera);
  expect(panelStyle()).toMatchObject({ height: 346, paddingBottom: 0, paddingHorizontal: 20, paddingTop: 16 });
  expect(StyleSheet.flatten(labelOf(choices()[1]).props.style).fontFamily).toBe(AfterglowFonts.medium);

  act(() => tree.update(<AttachmentPanel height={346} bottomInset={0} onSelect={onSelect} />));
  expect(choices()[1]).toBe(originalCamera);
  expect(panelStyle().backgroundColor).toBe(Colors.cardBg);
  expect(choices()[0].props.accessibilityLabel).toBe('Photos & videos');
  expect(labelOf(choices()[0]).props.numberOfLines).toBe(1);
  act(() => choices()[1].props.onPress());
  expect(onSelect).toHaveBeenCalledWith('camera');
  expect(onSelect).toHaveBeenCalledTimes(1);
});

it('adds a distinct optional GIF destination while keeping photos, camera and location callbacks', async () => {
  const onSelect = jest.fn();
  await act(async () => { tree = create(<AttachmentPanel height={300} bottomInset={34} onSelect={onSelect} showGif appearance={{ fonts: AfterglowFonts }} />); });
  expect(choices().map(choice => choice.props.accessibilityLabel)).toEqual(['Photos', 'Camera', 'Location', 'GIFs']);
  act(() => choices().forEach(choice => choice.props.onPress()));
  expect(onSelect.mock.calls).toEqual([['photos'], ['camera'], ['location'], ['gif']]);
  for (const choice of choices()) {
    expect(StyleSheet.flatten(choice.props.style)).toMatchObject({ width: '25%', minWidth: 44, minHeight: 44 });
    expect(labelOf(choice).props.numberOfLines).toBeUndefined();
  }
  expect(panelStyle()).toMatchObject({ height: 300, paddingBottom: 34 });
});
