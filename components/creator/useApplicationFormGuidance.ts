import React from 'react';
import { AccessibilityInfo, Keyboard, ScrollView, TextInput, useWindowDimensions, type LayoutChangeEvent } from 'react-native';

export type ApplicationFieldGuidance = {
  error?: string;
  onLayout: (event: LayoutChangeEvent) => void;
  inputRef: (input: TextInput | null) => void;
  onFocus: () => void;
  onBlur?: () => void;
};
type FocusedInputReflow = { scope: unknown; stage: string };
type FocusedField = { key: string; input: TextInput; owner: object };
type FocusedReflow = FocusedField & { layoutReady: boolean };

/** Application-only guidance; required rules remain in operatorApplicationForms. */
export function useApplicationFormGuidance(missing: readonly string[], messages: Record<string, string>, focusedInputReflow?: FocusedInputReflow) {
  const scrollRef = React.useRef<ScrollView | null>(null);
  const currentMissing = React.useRef(missing);
  currentMissing.current = missing;
  const positions = React.useRef(new Map<string, number>());
  const inputs = React.useRef(new Map<string, TextInput>());
  const pending = React.useRef<{ key: string; focused: boolean } | null>(null);
  const frame = React.useRef<number | null>(null);
  const live = React.useRef(true);
  const [attempted, setAttempted] = React.useState(false);
  const registrations = React.useRef(new Map<string, Omit<ApplicationFieldGuidance, 'error'>>());
  const { fontScale } = useWindowDimensions();
  const previousFontScale = React.useRef(fontScale);
  const focusOwner = React.useMemo(() => ({}), [!!focusedInputReflow, focusedInputReflow?.scope, focusedInputReflow?.stage]);
  const committedFocusOwner = React.useRef<object | null>(null);
  const focused = React.useRef<FocusedField | null>(null);
  const reflow = React.useRef<FocusedReflow | null>(null);
  const focusHandoff = React.useRef<{ target: FocusedField; reflow: FocusedReflow | null } | null>(null);
  const reflowFrame = React.useRef<number | null>(null);

  const cancelFocusedReflow = React.useCallback(() => {
    focusHandoff.current = null;
    reflow.current = null;
    if (reflowFrame.current !== null) cancelAnimationFrame(reflowFrame.current);
    reflowFrame.current = null;
  }, []);
  const cancelReveal = React.useCallback(() => {
    pending.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    focused.current = null;
    cancelFocusedReflow();
  }, [cancelFocusedReflow]);

  // Publish focus ownership only after commit; old stage/account callbacks retire.
  React.useLayoutEffect(() => {
    committedFocusOwner.current = focusOwner;
    cancelReveal();
    return () => {
      if (committedFocusOwner.current === focusOwner) committedFocusOwner.current = null;
      cancelReveal();
    };
  }, [focusOwner, cancelReveal]);
  React.useLayoutEffect(() => {
    const changed = previousFontScale.current !== fontScale;
    previousFontScale.current = fontScale;
    if (!changed) return;
    cancelFocusedReflow();
    const target = focused.current;
    if (pending.current && !currentMissing.current.includes(pending.current.key)) pending.current = null;
    if (!focusedInputReflow || !target || target.owner !== focusOwner || pending.current
      || !target.input.isFocused()) return;
    // A fresh field layout, not cached pre-scale coordinates, releases this target.
    reflow.current = { ...target, layoutReady: false };
  }, [fontScale, focusOwner, !!focusedInputReflow, cancelFocusedReflow]);

  const alignTarget = React.useCallback(() => {
    frame.current = null;
    const target = pending.current;
    if (!live.current || !target) return;
    if (!currentMissing.current.includes(target.key)) { pending.current = null; return; }
    const y = positions.current.get(target.key);
    if (y === undefined) return; // Wait for this field's committed layout.
    if (!target.focused) {
      target.focused = true;
      const input = inputs.current.get(target.key);
      if (input) input.focus();
      else Keyboard.dismiss(); // Choices/consent never receive an accidental selection.
    }
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 16), animated: false });
  }, []);

  const scheduleAlignment = React.useCallback(() => {
    if (!live.current || !pending.current) return;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(alignTarget);
  }, [alignTarget]);
  const alignFocusedInput = React.useCallback(() => {
    reflowFrame.current = null;
    const target = reflow.current;
    if (!target?.layoutReady) return;
    if (!live.current || committedFocusOwner.current !== target.owner || focused.current?.input !== target.input
      || inputs.current.get(target.key) !== target.input || pending.current || !target.input.isFocused()) {
      cancelFocusedReflow(); return;
    }
    const y = positions.current.get(target.key);
    if (y === undefined || !Number.isFinite(y)) return;
    reflow.current = null; // One scale transition must not take over later scrolling.
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 16), animated: false });
  }, [cancelFocusedReflow]);
  const scheduleFocusedAlignment = React.useCallback(() => {
    if (!live.current || !reflow.current?.layoutReady) return;
    if (reflowFrame.current !== null) cancelAnimationFrame(reflowFrame.current);
    reflowFrame.current = requestAnimationFrame(alignFocusedInput);
  }, [alignFocusedInput]);
  const onGeometryChange = React.useCallback(() => {
    scheduleAlignment(); scheduleFocusedAlignment();
  }, [scheduleAlignment, scheduleFocusedAlignment]);

  React.useEffect(() => {
    live.current = true;
    // KeyboardAvoidingView changes the viewport after focus/dismiss. Re-align
    // with that settled geometry, not the pre-keyboard scroll limits.
    const shown = Keyboard.addListener('keyboardDidShow', scheduleAlignment);
    const hidden = Keyboard.addListener('keyboardDidHide', scheduleAlignment);
    return () => { live.current = false; cancelReveal(); shown.remove(); hidden.remove(); };
  }, [cancelReveal, scheduleAlignment]);

  const field = (key: string): ApplicationFieldGuidance => {
    if (!registrations.current.has(key)) {
      registrations.current.set(key, {
        onLayout: event => {
          positions.current.set(key, event.nativeEvent.layout.y);
          if (pending.current?.key === key) scheduleAlignment();
          if (reflow.current?.key === key) {
            reflow.current.layoutReady = true;
            scheduleFocusedAlignment();
          }
        },
        inputRef: input => {
          if (input) {
            inputs.current.set(key, input);
            const handoff = focusHandoff.current;
            if (handoff?.target.key === key) {
              focusHandoff.current = null;
              if (live.current && committedFocusOwner.current === handoff.target.owner
                && handoff.target.input === input && input.isFocused()) {
                focused.current = handoff.target;
                // A same-commit ref handoff is not blur, but its old layout is
                // no longer eligible to release a pending scale adjustment.
                if (handoff.reflow) reflow.current = { ...handoff.reflow, layoutReady: false };
              }
            }
          } else {
            const prior = inputs.current.get(key);
            inputs.current.delete(key); positions.current.delete(key);
            const target = focused.current;
            if (target && target.input === prior) {
              const paused = reflow.current;
              focused.current = null; cancelFocusedReflow();
              // TextInput may clear/reassign its forwarded ref in one commit
              // without a native blur. Only that exact focused instance can
              // recover; an unmatched detach expires at the microtask boundary.
              const handoff = { target, reflow: paused };
              focusHandoff.current = handoff;
              queueMicrotask(() => { if (focusHandoff.current === handoff) focusHandoff.current = null; });
            }
          }
        },
        onFocus: () => {
          if (pending.current && pending.current.key !== key) cancelReveal();
        },
      });
    }
    const registration = registrations.current.get(key)!;
    return {
      ...registration,
      ...(focusedInputReflow ? {
        onLayout: (event: LayoutChangeEvent) => {
          if (live.current && committedFocusOwner.current === focusOwner) registration.onLayout(event);
        },
        onFocus: () => {
          if (!live.current || committedFocusOwner.current !== focusOwner) return;
          registration.onFocus(); cancelFocusedReflow();
          const input = inputs.current.get(key);
          focused.current = input ? { key, input, owner: focusOwner } : null;
        },
        onBlur: () => {
          if (focusHandoff.current?.target.owner === focusOwner && focusHandoff.current.target.key === key) focusHandoff.current = null;
          if (committedFocusOwner.current === focusOwner && focused.current?.owner === focusOwner && focused.current.key === key) {
            focused.current = null; cancelFocusedReflow();
          }
        },
      } : {}),
      error: attempted && missing.includes(key) ? messages[key] ?? 'Complete this field.' : undefined,
    };
  };

  const revealFirstInvalid = () => {
    const key = currentMissing.current[0];
    if (!key) return;
    cancelFocusedReflow();
    setAttempted(true);
    pending.current = { key, focused: false };
    AccessibilityInfo.announceForAccessibility(messages[key] ?? 'Complete the first required field.');
    scheduleAlignment();
  };

  return {
    scrollRef, field, revealFirstInvalid, cancelReveal,
    onContentSizeChange: onGeometryChange,
    onViewportLayout: onGeometryChange,
    onScrollBeginDrag: cancelFocusedReflow,
  };
}
