import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  Animated,
  Easing,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import Colors from '../../constants/Colors';
import { Fonts } from '../../constants/Typography';
import { stripDigits } from '../../lib/phoneFormat';

type OtpState = 'idle' | 'success' | 'error';

type Props = {
  length?: number;
  value: string;
  onChangeText: (code: string) => void;
  onComplete?: (code: string) => void;
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
    state = 'idle',
    autoFocus,
    editable = true,
  },
  ref,
) {
  const inputRef = useRef<TextInput>(null);
  const shake = useRef(new Animated.Value(0)).current;

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    blur: () => inputRef.current?.blur(),
    clear: () => {
      onChangeText('');
      requestAnimationFrame(() => inputRef.current?.focus());
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

  const focus = () => inputRef.current?.focus();

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
      <View key={i} style={[styles.cell, cellStyle]}>
        <Text style={textStyle}>{ch}</Text>
      </View>
    );
  });

  return (
    <Pressable onPress={focus} accessibilityRole="text" disabled={!editable}>
      <Animated.View style={[styles.row, { transform: [{ translateX }] }]}>
        {cells}
      </Animated.View>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={handleChange}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        autoFocus={autoFocus}
        editable={editable}
        maxLength={length}
        caretHidden
        style={styles.hiddenInput}
      />
    </Pressable>
  );
});

const CELL_W = 50;
const CELL_H = 60;
const CELL_RADIUS = 10;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
  },
  cell: {
    width: CELL_W,
    height: CELL_H,
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
