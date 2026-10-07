import { useCallback, useEffect, useState, type RefObject } from 'react';
import { Platform, type TextInput } from 'react-native';

/** Restore writing only after the inserted name has committed to the input. */
export function useChatMentionFocus(input: RefObject<TextInput | null>, isCurrent: () => boolean) {
  const [request, setRequest] = useState<{ caret: number; isCurrent: () => boolean } | null>(null);
  useEffect(() => {
    if (!request) return;
    let active = true;
    const frame = requestAnimationFrame(() => {
      if (!active || !request.isCurrent()) return;
      const field = input.current;
      field?.focus();
      if (Platform.OS === 'web') {
        (field as unknown as { setSelectionRange?: (start: number, end: number) => void })?.setSelectionRange?.(request.caret, request.caret);
      } else {
        field?.setNativeProps({ selection: { start: request.caret, end: request.caret } });
      }
    });
    return () => { active = false; cancelAnimationFrame(frame); };
  }, [input, request]);
  return useCallback((caret: number) => setRequest({ caret, isCurrent }), [isCurrent]);
}
