import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AfterglowColors as Colors } from '../../constants/Colors';
import { AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';
import type { useCommunityChatPreference } from '../../hooks/useCommunityChatPreference';

type Props = { control: ReturnType<typeof useCommunityChatPreference>; fonts: AfterglowFontFamilies; compact?: boolean };
/** Shared presentation of the same account-owned controller. */
export function CommunityChatPreferenceControl({ control, fonts, compact = false }: Props) {
  const button = (label: string, name: string, action: () => void, disabled = false) => <TouchableOpacity
    accessibilityRole="button" accessibilityLabel={name} accessibilityState={{ disabled }} disabled={disabled}
    onPress={action} style={[styles.button, disabled && styles.disabled]}>
    <Text numberOfLines={1} style={[styles.action, { fontFamily: fonts.semibold }]}>{label}</Text>
  </TouchableOpacity>;
  if (compact && control.data && !control.data.muted && !control.pending && !control.error && !control.notice) return null;
  return <View style={styles.content} accessibilityLiveRegion="polite">
    {!compact && <Text style={[styles.body, { fontFamily: fonts.regular }]}>Mute a chat or all community chats. You’ll still see unread messages here.</Text>}
    {!!control.notice && <Text style={[styles.body, { fontFamily: fonts.regular }]}>{control.notice}</Text>}
    {control.pending ? <>
      <Text style={[styles.body, { fontFamily: fonts.regular }]}>{control.busy ? 'Saving your notification choice…' : control.pending.retryReady ? 'Your latest setting is loaded. Retry your saved choice when you’re ready.' : 'Your choice may have saved. Check before trying again.'}</Text>
      <View style={styles.actions}>
        {button('Check status', 'Check community notification change', () => { void control.check(); }, control.busy)}
        {control.pending.retryReady && button('Retry save', 'Retry community notification change', () => { void control.retry(); }, control.busy)}
      </View>
    </> : control.error ? <>
      <Text style={[styles.body, { fontFamily: fonts.regular }]}>Couldn’t check community notifications.</Text>
      {button('Try again', 'Check community notifications', () => { void control.refresh(); }, control.busy)}
    </> : !control.data ? <ActivityIndicator color={Colors.clay} accessibilityLabel="Loading community notifications" /> : <>
      <Text style={[styles.body, { fontFamily: fonts.regular }]}>{control.data.muted ? 'All community chats muted' : 'Individual chat settings apply'}</Text>
      {button(control.data.muted ? 'Unmute all' : 'Mute all', control.data.muted ? 'Unmute all community chats' : 'Mute all community chats', () => { void control.change(!control.data!.muted); }, !control.ready)}
    </>}
  </View>;
}
const styles = StyleSheet.create({
  content: { gap: 8 }, body: { ...AfterglowType.caption, color: Colors.muted },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  button: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', alignSelf: 'flex-start' },
  action: { ...AfterglowType.caption, color: Colors.clay }, disabled: { opacity: 0.5 },
});
