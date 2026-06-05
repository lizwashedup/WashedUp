/**
 * CircleComposer — the text composer pinned at the bottom of a circle chat.
 * Text only in v1; the "Make a Plan" plus-menu (Step 8) and the attach/voice
 * affordances (a later chat-parity pass) layer on here.
 */
import React from 'react';
import { View, TextInput, Pressable, StyleSheet } from 'react-native';
import { ArrowUp } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { CIRCLE_CHAT } from '../../constants/YoursDesign';
import { COPY } from '../yours/state/constants';
import { hapticSelection } from '../../lib/haptics';

export default function CircleComposer({
  value,
  onChange,
  onSend,
}: {
  value: string;
  onChange: (t: string) => void;
  onSend: () => void;
}) {
  const canSend = value.trim().length > 0;
  return (
    <View style={styles.bar}>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={COPY.circleComposerPlaceholder}
        placeholderTextColor={Colors.tertiary}
        multiline
        maxLength={2000}
      />
      <Pressable
        onPress={() => {
          if (!canSend) return;
          hapticSelection();
          onSend();
        }}
        disabled={!canSend}
        style={[styles.send, !canSend && styles.sendDisabled]}
        accessibilityRole="button"
        accessibilityLabel="Send"
      >
        <ArrowUp size={CIRCLE_CHAT.sendIcon} color={Colors.white} strokeWidth={2.5} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: CIRCLE_CHAT.composerGap,
    paddingHorizontal: CIRCLE_CHAT.composerPadH,
    paddingVertical: CIRCLE_CHAT.composerPadV,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    backgroundColor: Colors.parchment,
  },
  input: {
    flex: 1,
    minHeight: CIRCLE_CHAT.composerMinHeight,
    maxHeight: CIRCLE_CHAT.composerMaxHeight,
    borderRadius: CIRCLE_CHAT.composerRadius,
    backgroundColor: Colors.inputBg,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyLG,
    color: Colors.darkWarm,
  },
  send: {
    width: CIRCLE_CHAT.sendButton,
    height: CIRCLE_CHAT.sendButton,
    borderRadius: CIRCLE_CHAT.sendButton / 2,
    backgroundColor: Colors.terracotta,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.4 },
});
