import React from 'react';
import {
  InputAccessoryView,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';

export const KEYBOARD_DONE_ACCESSORY_ID = 'globalKeyboardDone';

export function KeyboardDoneBar() {
  if (Platform.OS !== 'ios') return null;
  return (
    <InputAccessoryView nativeID={KEYBOARD_DONE_ACCESSORY_ID}>
      <View style={styles.bar}>
        <Pressable onPress={Keyboard.dismiss} hitSlop={12} style={styles.btn}>
          <Text style={styles.label}>Done</Text>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: '#F5F5F7',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#C0C0C5',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  label: {
    color: Colors.terracotta,
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
  },
});
