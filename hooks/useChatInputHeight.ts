import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';
import { Platform, type TextInput, type TextInputProps } from 'react-native';

/** Natural-height message field. The caller keeps its existing native input
 * ref and keyboard/selection handlers. Web must measure unconstrained height
 * so clearing a multiline draft shrinks instead of feeding back scrollHeight. */
export function useChatInputHeight(
  inputRef: RefObject<TextInput | null>, value: string | undefined,
  fontFamily: string, maxHeight: number, enabled = true,
) {
  const [inputHeight, setInputHeight] = useState(44);
  const measureWebInput = useCallback(() => {
    if (!enabled || Platform.OS !== 'web' || !inputRef.current) return;
    const field = inputRef.current as unknown as { style: { height: string }; scrollHeight: number };
    if (!field.style || !Number.isFinite(field.scrollHeight)) return;
    field.style.height = 'auto';
    const height = Math.max(44, Math.min(maxHeight, Math.ceil(field.scrollHeight + 2)));
    field.style.height = `${height}px`;
    setInputHeight(height);
  }, [enabled, inputRef, maxHeight]);
  useLayoutEffect(() => { measureWebInput(); }, [value, fontFamily, measureWebInput]);
  const onContentSizeChange = useCallback<NonNullable<TextInputProps['onContentSizeChange']>>(event => {
    if (!enabled || Platform.OS === 'web') return;
    const height = event.nativeEvent.contentSize.height;
    if (Number.isFinite(height)) setInputHeight(Math.max(44, Math.min(maxHeight, Math.ceil(height))));
  }, [enabled, maxHeight]);
  return { inputHeight, measureWebInput, onContentSizeChange };
}
