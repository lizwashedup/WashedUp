import React from 'react';
import { Platform, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { CommunityChatComposer } from '../CommunityChatComposer';
import { createChatComposerAppearance } from '../chatComposerAppearance';
import { AfterglowFonts } from '../../../constants/Typography';

let tree: ReactTestRenderer;
afterEach(() => { act(() => tree?.unmount()); jest.restoreAllMocks(); });
const defaults = () => ({ fonts: AfterglowFonts, inputProps: { value: '', multiline: true, maxLength: 4000, onChangeText: jest.fn(), onSelectionChange: jest.fn(), inputAccessoryViewID: 'existing-done-bar' }, photo: { onPress: jest.fn(), disabled: false, busy: false }, location: { onPress: jest.fn(), disabled: false }, onSend: jest.fn(), sendDisabled: false, sending: false, editing: false });
function button(label: string) { return tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === label)!; }

it('passes draft, caret and keyboard configuration through and invokes the original actions', () => {
  const props = defaults();
  act(() => { tree = create(<CommunityChatComposer {...props} />); });
  const input = tree.root.findByType(TextInput);
  const selection = { nativeEvent: { selection: { start: 2, end: 2 } } };
  expect(input.props.inputAccessoryViewID).toBe('existing-done-bar');
  expect(input.props.maxLength).toBe(4000);
  expect(input.props.multiline).toBe(true);
  act(() => {
    input.props.onChangeText('Hi @Amelia'); input.props.onSelectionChange(selection);
    button('Send message').props.onPress();
  });
  expect(props.inputProps.onChangeText).toHaveBeenCalledWith('Hi @Amelia');
  expect(props.inputProps.onSelectionChange).toHaveBeenCalledWith(selection);
  act(()=>button('Add attachment').props.onPress());
  act(()=>button('Add photo').props.onPress());
  act(()=>button('Add attachment').props.onPress());
  act(()=>button('Share location').props.onPress());
  expect(props.photo.onPress).toHaveBeenCalledTimes(1);
  expect(props.location.onPress).toHaveBeenCalledTimes(1);
  expect(props.onSend).toHaveBeenCalledTimes(1);
});

it('exposes upload and send progress without enabling admission-disabled attachments', () => {
  const props = defaults();
  act(() => { tree = create(<CommunityChatComposer {...props} photo={{ ...props.photo, disabled: true, busy: true }} location={{ ...props.location, disabled: true }} sendDisabled sending />); });
  expect(button('Uploading photo').props.disabled).toBe(true);
  expect(button('Uploading photo').props.accessibilityState.busy).toBe(true);
  expect(button('Share location')).toBeUndefined();
  expect(button('Sending message').props.disabled).toBe(true);
  expect(props.onSend).not.toHaveBeenCalled();
});

it('distinguishes saving an edit from posting another message', () => {
  const props = defaults();
  act(() => { tree = create(<CommunityChatComposer {...props} editing />); });
  act(() => button('Save changes').props.onPress());
  expect(props.onSend).toHaveBeenCalledTimes(1);
  act(() => tree.update(<CommunityChatComposer {...props} editing sending sendDisabled />));
  expect(button('Saving changes').props.disabled).toBe(true);
});

it('grows and shrinks Android drafts while retaining the caller measurement callback', () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  const props = defaults(), onContentSizeChange = jest.fn();
  act(() => { tree = create(<CommunityChatComposer {...props} inputProps={{ ...props.inputProps, onContentSizeChange }} />); });
  const input = () => tree.root.findByType(TextInput);
  const height = () => require('react-native').StyleSheet.flatten(input().props.style).height;
  expect(height()).toBe(44);
  act(() => input().props.onContentSizeChange({ nativeEvent: { contentSize: { height: 86, width: 200 } } }));
  expect(height()).toBe(86);
  act(() => input().props.onContentSizeChange({ nativeEvent: { contentSize: { height: 240, width: 200 } } }));
  expect(height()).toBe(120);
  act(() => input().props.onContentSizeChange({ nativeEvent: { contentSize: { height: 24, width: 200 } } }));
  expect(height()).toBe(44);
  expect(onContentSizeChange).toHaveBeenCalledTimes(3);
});

it.each(['ios', 'android'] as const)('keeps the actual %s message field multiline without a native line cap', platform => {
  jest.replaceProperty(Platform, 'OS', platform);
  const props = defaults();
  const draft = 'First line\nSecond line\nThird line';
  act(() => { tree = create(<CommunityChatComposer {...props} inputProps={{ ...props.inputProps, value: draft }} />); });
  const input = () => tree.root.findByType(TextInput);
  expect(input().props.multiline).toBe(true);
  expect(input().props.numberOfLines).toBeUndefined();
  expect(input().props.rows).toBeUndefined();
  expect(input().props.value).toBe(draft);
  expect(input().props.onChangeText).toBe(props.inputProps.onChangeText);
  expect(input().props.onSelectionChange).toBe(props.inputProps.onSelectionChange);
  expect(input().props.inputAccessoryViewID).toBe('existing-done-bar');
  act(() => input().props.onContentSizeChange({ nativeEvent: { contentSize: { height: 86, width: 200 } } }));
  const style = StyleSheet.flatten(input().props.style);
  expect(style.height).toBe(platform === 'ios' ? undefined : 86);
  expect(style.minHeight).toBe(44);
  expect(style.maxHeight).toBe(120);
});

it('uses one initial textarea row only on web while retaining multiline draft editing', () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  const props = defaults();
  act(() => { tree = create(<CommunityChatComposer {...props} />); });
  const input = tree.root.findByType(TextInput);
  expect(input.props.numberOfLines).toBe(1);
  expect(input.props.multiline).toBe(true);
  const draft = 'First line\nSecond line';
  act(() => input.props.onChangeText(draft));
  expect(props.inputProps.onChangeText).toHaveBeenCalledWith(draft);
});

it('gives edits the full text field and closes attachments when typing resumes',()=>{
 const props=defaults();act(()=>{tree=create(<CommunityChatComposer {...props}/>);});
 act(()=>button('Add attachment').props.onPress());expect(button('Add photo')).toBeDefined();
 act(()=>tree.root.findByType(TextInput).props.onFocus({}));expect(button('Add photo')).toBeUndefined();
 act(()=>tree.update(<CommunityChatComposer {...props} editing/>));
 expect(button('Add attachment')).toBeUndefined();expect(button('Save changes')).toBeDefined();
});


it('offers camera separately from library and closes the tray before capture',()=>{
 const props=defaults(),camera={onPress:jest.fn(),disabled:false};
 act(()=>{tree=create(<CommunityChatComposer {...props} camera={camera}/>);});
 act(()=>button('Add attachment').props.onPress());
 expect(button('Take photo')).toBeDefined();expect(button('Add photo')).toBeDefined();expect(button('Share location')).toBeDefined();
 act(()=>button('Take photo').props.onPress());expect(camera.onPress).toHaveBeenCalledTimes(1);expect(props.photo.onPress).not.toHaveBeenCalled();
 expect(button('Take photo')).toBeUndefined();
 act(()=>tree.update(<CommunityChatComposer {...props} camera={camera} editing/>));expect(button('Add attachment')).toBeUndefined();
});


it.each(['android', 'ios', 'web'] as const)('gives %s composer actions platform-sized bounds without changing message input sizing', platform => {
  jest.replaceProperty(Platform, 'OS', platform);
  const props = defaults();
  act(() => { tree = create(<CommunityChatComposer {...props} />); });
  const size = platform === 'android' ? 48 : 44;
  for (const label of ['Add attachment', 'Send message']) {
    expect(StyleSheet.flatten(button(label).props.style)).toMatchObject({ width: size, height: size });
  }
  const input = tree.root.findByType(TextInput);
  expect(StyleSheet.flatten(input.props.style).height).toBe(platform === 'ios' ? undefined : 44);
  expect(input.props.onChangeText).toBe(props.inputProps.onChangeText);
  const shared = createChatComposerAppearance(AfterglowFonts);
  expect(StyleSheet.flatten(shared.utility)).toMatchObject({ width: size, height: size });
  expect(StyleSheet.flatten(shared.morph)).toMatchObject({ width: size, height: size });
  expect(StyleSheet.flatten(shared.input).minHeight).toBe(44);
  act(() => button('Send message').props.onPress());
  expect(props.onSend).toHaveBeenCalledTimes(1);
});
