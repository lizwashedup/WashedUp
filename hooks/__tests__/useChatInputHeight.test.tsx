import React, { type RefObject } from 'react';
import { Platform, type TextInput } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AfterglowFonts, Fonts } from '../../constants/Typography';
import { useChatInputHeight } from '../useChatInputHeight';

type InputHeight = ReturnType<typeof useChatInputHeight>;
type Options = { value: string | undefined; fontFamily: string; maxHeight: number; enabled: boolean };
const trees: ReactTestRenderer[] = [];
const inputRef = (field: unknown = null) => ({ current: field } as RefObject<TextInput | null>);
const contentSize = (height: number) => ({ nativeEvent: { contentSize: { width: 220, height } } }) as Parameters<InputHeight['onContentSizeChange']>[0];

function mount(ref = inputRef(), options: Partial<Options> = {}) {
  let current!: InputHeight;
  let props: Options = { value: '', fontFamily: Fonts.sans, maxHeight: 100, enabled: true, ...options };
  let tree!: ReactTestRenderer;
  function Harness(next: Options) {
    current = useChatInputHeight(ref, next.value, next.fontFamily, next.maxHeight, next.enabled);
    return null;
  }
  act(() => { tree = create(<Harness {...props} />); });
  trees.push(tree);
  return {
    get current() { return current; },
    update(next: Partial<Options>) {
      props = { ...props, ...next };
      act(() => tree.update(<Harness {...props} />));
    },
    size(height: number) { act(() => current.onContentSizeChange(contentSize(height))); },
    layout() { act(() => current.measureWebInput()); },
  };
}

// A textarea's constrained scrollHeight cannot shrink below its rendered
// height. Only measuring with height=auto reveals the shorter natural draft.
function textarea(initialNaturalHeight = 24) {
  let naturalHeight = initialNaturalHeight;
  let height = '64px';
  const writes: string[] = [];
  const field = {
    style: {
      get height() { return height; },
      set height(next: string) { writes.push(next); height = next; },
    },
    get scrollHeight() {
      return height === 'auto' ? naturalHeight : Math.max(naturalHeight, Number.parseFloat(height));
    },
    focus: jest.fn(),
  };
  return { field, writes, setNaturalHeight(next: number) { naturalHeight = next; } };
}

beforeEach(() => { jest.replaceProperty(Platform, 'OS', 'ios'); });
afterEach(() => {
  trees.splice(0).forEach(tree => act(() => tree.unmount()));
  jest.restoreAllMocks();
});

it.each([100, 120])('grows and shrinks native content within the caller’s %i-point cap', maxHeight => {
  const fixture = mount(inputRef(), { maxHeight });
  expect(fixture.current.inputHeight).toBe(44);
  fixture.size(70.25);
  expect(fixture.current.inputHeight).toBe(71);
  fixture.size(240);
  expect(fixture.current.inputHeight).toBe(maxHeight);
  fixture.size(22);
  expect(fixture.current.inputHeight).toBe(44);
});

it('ignores invalid native measurements without losing the last valid height', () => {
  const fixture = mount();
  fixture.size(80);
  [NaN, Infinity, -Infinity].forEach(height => {
    fixture.size(height);
    expect(fixture.current.inputHeight).toBe(80);
  });
  fixture.size(-1);
  expect(fixture.current.inputHeight).toBe(44);
});

it('does not read or mutate a DOM-like ref on native and retains the caller’s focus target', () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  const element = textarea();
  const ref = inputRef(element.field);
  const fixture = mount(ref);
  fixture.layout();
  fixture.size(82);
  fixture.update({ value: 'A longer draft', fontFamily: AfterglowFonts.regular });
  expect(fixture.current.inputHeight).toBe(82);
  expect(ref.current).toBe(element.field);
  expect(element.writes).toEqual([]);
  expect(element.field.focus).not.toHaveBeenCalled();
});

it.each([100, 120])('measures web drafts at natural height before clamping to %i, including shrink after clearing', maxHeight => {
  jest.replaceProperty(Platform, 'OS', 'web');
  const element = textarea();
  const ref = inputRef(element.field);
  const fixture = mount(ref, { maxHeight });
  expect(fixture.current.inputHeight).toBe(44);
  expect(element.writes).toEqual(['auto', '44px']);

  element.setNaturalHeight(78.2);
  fixture.update({ value: 'Two lines' });
  expect(fixture.current.inputHeight).toBe(81);
  element.setNaturalHeight(260);
  fixture.update({ value: 'A much longer draft' });
  expect(fixture.current.inputHeight).toBe(maxHeight);

  element.setNaturalHeight(24);
  fixture.update({ value: '' });
  expect(fixture.current.inputHeight).toBe(44);
  expect(element.writes.slice(-2)).toEqual(['auto', '44px']);
  expect(ref.current).toBe(element.field);
  expect(element.field.focus).not.toHaveBeenCalled();
});

it('remeasures web after fonts or available layout change and ignores native size events', () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  const element = textarea(45);
  const fixture = mount(inputRef(element.field));
  expect(fixture.current.inputHeight).toBe(47);
  element.setNaturalHeight(67);
  fixture.update({ fontFamily: Fonts.sansMedium });
  expect(fixture.current.inputHeight).toBe(69);
  element.setNaturalHeight(86);
  fixture.layout();
  expect(fixture.current.inputHeight).toBe(88);
  const writes = [...element.writes];
  fixture.size(240);
  expect(fixture.current.inputHeight).toBe(88);
  expect(element.writes).toEqual(writes);
});

it('can measure a web input attached after the initial render without replacing its external ref', () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  const ref = inputRef();
  const fixture = mount(ref, { value: undefined });
  fixture.layout();
  expect(fixture.current.inputHeight).toBe(44);
  const element = textarea(78);
  ref.current = element.field as unknown as TextInput;
  fixture.layout();
  expect(fixture.current.inputHeight).toBe(80);
  expect(ref.current).toBe(element.field);
});

it('ignores unavailable web layout measurements without changing DOM or current height', () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  const element = textarea(70);
  const ref = inputRef(element.field);
  const fixture = mount(ref);
  expect(fixture.current.inputHeight).toBe(72);
  for (const scrollHeight of [NaN, Infinity, -Infinity]) {
    const field = { style: { height: '72px' }, scrollHeight };
    ref.current = field as unknown as TextInput;
    fixture.layout();
    expect(field.style.height).toBe('72px');
    expect(fixture.current.inputHeight).toBe(72);
  }
  ref.current = { scrollHeight: 90 } as unknown as TextInput;
  fixture.layout();
  expect(fixture.current.inputHeight).toBe(72);
});

it('keeps the disabled native appearance inert', () => {
  const fixture = mount(inputRef(), { enabled: false });
  fixture.size(90);
  fixture.update({ value: 'Several lines' });
  expect(fixture.current.inputHeight).toBe(44);
  fixture.update({ enabled: true });
  fixture.size(90);
  expect(fixture.current.inputHeight).toBe(90);
  fixture.update({ enabled: false });
  fixture.size(44);
  expect(fixture.current.inputHeight).toBe(90);
});

it('never touches web DOM while disabled and measures the current draft when enabled', () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  const element = textarea(86);
  const fixture = mount(inputRef(element.field), { enabled: false });
  fixture.layout();
  fixture.size(120);
  fixture.update({ value: 'Several lines', fontFamily: AfterglowFonts.regular });
  expect(element.writes).toEqual([]);
  expect(element.field.style.height).toBe('64px');
  expect(fixture.current.inputHeight).toBe(44);
  fixture.update({ enabled: true });
  expect(fixture.current.inputHeight).toBe(88);
  expect(element.writes).toEqual(['auto', '88px']);
  fixture.update({ enabled: false });
  element.setNaturalHeight(24);
  fixture.update({ value: '' });
  fixture.layout();
  expect(element.writes).toEqual(['auto', '88px']);
});
