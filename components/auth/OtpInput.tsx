import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  Animated,
  Easing,
  Platform,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import Colors from '../../constants/Colors';
import { Fonts } from '../../constants/Typography';
import { stripDigits } from '../../lib/phoneFormat';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../keyboard/KeyboardDoneBar';

type OtpState = 'idle' | 'success' | 'error';

type Props = {
  length?: number;
  value: string;
  onChangeText: (code: string) => void;
  onComplete?: (code: string) => void;
  onFocus?: () => void;
  state?: OtpState;
  autoFocus?: boolean;
  editable?: boolean;
};

export type OtpInputHandle = {
  focus: () => void;
  blur: () => void;
  clear: () => void;
};

export const OtpInput = forwardRef<OtpInputHandle, Props>(function OtpInput(
  {
    length = 6,
    value,
    onChangeText,
    onComplete,
    onFocus,
    state = 'idle',
    autoFocus,
    editable = true,
  },
  ref,
) {
  const inputRef = useRef<TextInput>(null);
  const shake = useRef(new Animated.Value(0)).current;

  // Responsive cell sizing — cells cap at the design CELL_W on phones that
  // can accommodate, shrink fluidly on iPhone SE / Android compact / Z Fold
  // cover. Matches the canonical RN pattern documented by
  // react-native-confirmation-code-field. Memoized so it only recomputes on
  // orientation change, not every render.
  const { width: screenW } = useWindowDimensions();
  const computedCell = useMemo(() => {
    const PARENT_PADDING = 56; // verify-code KAV uses paddingHorizontal: 28 (× 2)
    const totalGaps = (CELL_COUNT - 1) * CELL_GAP;
    const w = Math.min(CELL_W, Math.floor((screenW - PARENT_PADDING - totalGaps) / CELL_COUNT));
    const h = Math.round(w * (CELL_H / CELL_W));
    return { width: w, height: h };
  }, [screenW]);

  // On web, react-native-web maps autoComplete="sms-otp" to the HTML
  // autocomplete="one-time-code" input. Chrome throws
  // "NotAllowedError: Input showPicker() requires a user gesture" if such an
  // input is .focus()ed without user activation (autofocus, rAF, effects).
  // So on web we only ever focus from a real tap (the Pressable below);
  // native keeps autofocus + SMS autofill, which depend on programmatic focus.
  const allowProgrammaticFocus = Platform.OS !== 'web';
  const safeFocus = () => {
    try {
      inputRef.current?.focus();
    } catch {
      // Chrome's one-time-code picker can still throw on some web paths;
      // never let a focus attempt crash the OTP screen.
    }
  };

  useImperativeHandle(ref, () => ({
    focus: () => {
      if (allowProgrammaticFocus) safeFocus();
    },
    blur: () => inputRef.current?.blur(),
    clear: () => {
      onChangeText('');
      if (allowProgrammaticFocus) {
        requestAnimationFrame(safeFocus);
      }
    },
  }));

  // Trigger shake whenever state transitions to 'error'
  useEffect(() => {
    if (state !== 'error') return;
    shake.setValue(0);
    Animated.sequence([
      Animated.timing(shake, { toValue: 1, duration: 50, easing: Easing.linear, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -1, duration: 80, easing: Easing.linear, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 1, duration: 80, easing: Easing.linear, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -1, duration: 80, easing: Easing.linear, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 60, easing: Easing.linear, useNativeDriver: true }),
    ]).start();
  }, [state, shake]);

  const translateX = shake.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: [-6, 0, 6],
  });

  const handleChange = (text: string) => {
    const digits = stripDigits(text).slice(0, length);
    onChangeText(digits);
    if (digits.length === length && onComplete) onComplete(digits);
  };

  // Invoked only by the Pressable's onPress below — a real user gesture, so
  // safe on web (this is the web focus path now that autofocus is disabled).
  const focus = () => safeFocus();

  const cells = Array.from({ length }, (_, i) => {
    const ch = value[i] ?? '';
    const filled = ch.length > 0;
    const active = !filled && i === Math.min(value.length, length - 1);

    let cellStyle: StyleProp<ViewStyle> = styles.cellEmpty;
    let textStyle: StyleProp<TextStyle> = styles.cellText;
    if (state === 'success') {
      cellStyle = styles.cellSuccess;
      textStyle = styles.cellTextSuccess;
    } else if (state === 'error') {
      cellStyle = styles.cellError;
      textStyle = styles.cellTextError;
    } else if (filled) {
      cellStyle = styles.cellFilled;
      textStyle = styles.cellTextFilled;
    } else if (active) {
      cellStyle = styles.cellActive;
    }

    return (
      <View key={i} style={[styles.cell, computedCell, cellStyle]}>
        <Text style={textStyle}>{ch}</Text>
      </View>
    );
  });

  return (
    <Pressable
      onPress={focus}
      accessibilityRole="button"
      accessibilityLabel="enter verification code"
      accessibilityHint="six digit code from your text message"
      disabled={!editable}
    >
      <Animated.View
        style={[styles.row, { transform: [{ translateX }] }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {cells}
      </Animated.View>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={handleChange}
        onFocus={onFocus}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        autoFocus={allowProgrammaticFocus ? autoFocus : false}
        editable={editable}
        maxLength={length}
        caretHidden
        style={styles.hiddenInput}
        inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
      />
    </Pressable>
  );
});

const CELL_W = 44;
const CELL_H = 60;
const CELL_RADIUS = 10;
const CELL_GAP = 6;
const CELL_COUNT = 6;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: CELL_GAP,
  },
  cell: {
    borderRadius: CELL_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  cellEmpty: {
    backgroundColor: Colors.inputBg,
    borderColor: Colors.borderWarm,
  },
  cellActive: {
    backgroundColor: Colors.inputBg,
    borderColor: Colors.brand,
    borderWidth: 1.5,
  },
  cellFilled: {
    backgroundColor: Colors.brandSoft,
    borderColor: Colors.brandSoft,
  },
  cellSuccess: {
    backgroundColor: Colors.cream,
    borderColor: Colors.gold,
    borderWidth: 1.5,
  },
  cellError: {
    backgroundColor: Colors.inputBg,
    borderColor: Colors.errorBrand,
    borderWidth: 1.5,
  },
  cellText: {
    fontFamily: Fonts.sansSemibold,
    fontSize: 24,
    color: Colors.text1,
  },
  cellTextFilled: {
    fontFamily: Fonts.sansSemibold,
    fontSize: 24,
    color: Colors.brandDeep,
  },
  cellTextSuccess: {
    fontFamily: Fonts.sansSemibold,
    fontSize: 24,
    color: Colors.gold,
  },
  cellTextError: {
    fontFamily: Fonts.sansSemibold,
    fontSize: 24,
    color: Colors.errorBrand,
  },
  hiddenInput: {
    position: 'absolute',
    opacity: 0,
    width: 1,
    height: 1,
    top: 0,
    left: 0,
  },
});

export default OtpInput;
