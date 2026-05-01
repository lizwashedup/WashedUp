import { forwardRef, useImperativeHandle, useRef } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import Colors from '../../constants/Colors';
import { Fonts } from '../../constants/Typography';
import { formatDisplay, stripDigits } from '../../lib/phoneFormat';

type Props = {
  value: string;
  onChangeText: (digits10: string) => void;
  onSubmitEditing?: () => void;
  error?: string | null;
  autoFocus?: boolean;
  editable?: boolean;
};

export type PhoneInputHandle = {
  focus: () => void;
  blur: () => void;
};

export const PhoneInput = forwardRef<PhoneInputHandle, Props>(function PhoneInput(
  { value, onChangeText, onSubmitEditing, error, autoFocus, editable = true },
  ref,
) {
  const inputRef = useRef<TextInput>(null);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    blur: () => inputRef.current?.blur(),
  }));

  const display = formatDisplay(value);
  const hasError = !!error;

  const handleChange = (text: string) => {
    const digits = stripDigits(text).slice(0, 10);
    onChangeText(digits);
  };

  return (
    <View style={styles.wrap}>
      <View style={[styles.fieldRow, hasError && styles.fieldRowError]}>
        <View style={styles.prefix}>
          <Text style={styles.flag}>🇺🇸</Text>
          <Text style={styles.prefixText}>+1</Text>
        </View>
        <View style={styles.divider} />
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={display}
          onChangeText={handleChange}
          onSubmitEditing={onSubmitEditing}
          placeholder="(213) 000 0000"
          placeholderTextColor={Colors.text3}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          autoFocus={autoFocus}
          editable={editable}
          maxLength={14}
          returnKeyType="done"
          selectionColor={Colors.brand}
        />
      </View>
      {hasError ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    borderRadius: 10,
    backgroundColor: Colors.surfaceTranslucent,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  fieldRowError: {
    borderWidth: 1.5,
    borderColor: Colors.errorBrand,
    shadowColor: Colors.errorBrand,
    shadowOpacity: 0.14,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  prefix: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  flag: {
    fontSize: 18,
  },
  prefixText: {
    fontFamily: Fonts.sansSemibold,
    fontSize: 16,
    color: Colors.text1,
  },
  divider: {
    width: 1,
    height: 24,
    backgroundColor: Colors.borderWarm,
    marginHorizontal: 12,
  },
  input: {
    flex: 1,
    fontFamily: Fonts.sansMedium,
    fontSize: 18,
    color: Colors.text1,
    letterSpacing: 0.2,
    paddingVertical: 0,
  },
  errorText: {
    fontFamily: Fonts.sansSemibold,
    fontSize: 13,
    color: Colors.errorBrand,
    marginTop: 8,
    paddingHorizontal: 4,
  },
});

export default PhoneInput;
