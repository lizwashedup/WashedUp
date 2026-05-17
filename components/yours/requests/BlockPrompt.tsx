import React, { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { COPY } from '../state/constants';

const AUTO_DISMISS_MS = 4000;

/**
 * Quiet post-decline prompt. Auto-dismisses after 4s if untouched.
 */
export default function BlockPrompt({
  name,
  onBlock,
  onKeep,
}: {
  name: string;
  onBlock: () => void;
  onKeep: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onKeep, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [onKeep]);

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{COPY.blockPromptTitle(name)}</Text>
      <View style={styles.row}>
        <Pressable
          style={styles.block}
          onPress={onBlock}
          accessibilityRole="button"
        >
          <Text style={styles.blockText}>{COPY.blockPromptBlock}</Text>
        </Pressable>
        <Pressable
          style={styles.keep}
          onPress={onKeep}
          accessibilityRole="button"
        >
          <Text style={styles.keepText}>{COPY.blockPromptKeep}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 24,
    gap: 12,
  },
  title: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.secondary,
    textAlign: 'center',
  },
  row: { flexDirection: 'row', gap: 12 },
  block: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: 'center',
    backgroundColor: Colors.inputBg,
  },
  blockText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.tertiary,
  },
  keep: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: 'center',
    backgroundColor: Colors.terracotta,
  },
  keepText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.white,
  },
});
