import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { ChatSizedText } from '../chat/ChatSizedText';

export function FollowReadRecovery({ pending, retry }: { pending: boolean; retry: () => void }) {
  return <View style={styles.container}>
    <ChatSizedText accessibilityRole="alert" style={styles.message}>Couldn't check following.</ChatSizedText>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry follow status"
      disabled={pending} accessibilityState={{ disabled: pending }} onPress={retry} style={styles.action}>
      <ChatSizedText style={styles.label}>{pending ? 'checking' : 'try again'}</ChatSizedText>
    </TouchableOpacity>
  </View>;
}
const styles = StyleSheet.create({
  container: { alignSelf: 'stretch', paddingVertical: 8 },
  message: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary },
  action: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  label: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.terracotta },
});
