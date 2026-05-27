import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';

// The chat attachment menu, rendered as an INLINE panel that takes the
// keyboard's place beneath a still-visible input bar (WhatsApp pattern), not a
// modal-over-backdrop. The input bar's left button toggles + <-> keyboard to
// open/close it. This panel is the reusable "keyboard-height panel" substrate
// that the emoji picker and GIF tab reuse in later chat-block commits.
// Photos/Camera/Location are wired to handlers; Document/Contact/Poll are
// placeholders pending later commits (Document is cut with the location
// refactor; Poll is deferred).

export type AttachmentKey =
  | 'photos'
  | 'camera'
  | 'document'
  | 'location'
  | 'contact'
  | 'poll';

interface AttachmentPanelProps {
  onSelect: (key: AttachmentKey) => void;
  // Matches the keyboard height it replaces, so the input bar doesn't jump.
  height: number;
  // Home-indicator floor so the bottom grid row clears the indicator when the
  // panel falls back to a default height (no keyboard observed yet).
  bottomInset: number;
}

interface AttachmentItem {
  key: AttachmentKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const GRID_COLUMNS = 3;
const ITEM_VERTICAL_GAP = 20;
const ICON_CIRCLE_SIZE = 56;
const ICON_SIZE = 26;
const PANEL_HORIZONTAL_PADDING = 20;
const PANEL_TOP_PADDING = 16;

// Document / Contact / Poll were cut: Document/Poll aren't relevant to hangout
// chats, and Contact (iOS contact picker) is redundant with @handles + the
// friend graph. A WashedUp-shaped "share a profile" can be built later if needed.
const ATTACHMENT_ITEMS: AttachmentItem[] = [
  { key: 'photos', label: 'Photos & videos', icon: 'images-outline' },
  { key: 'camera', label: 'Camera', icon: 'camera-outline' },
  { key: 'location', label: 'Location', icon: 'location-outline' },
];

export default function AttachmentPanel({ onSelect, height, bottomInset }: AttachmentPanelProps) {
  return (
    <View style={[styles.panel, { height, paddingBottom: bottomInset }]}>
      <View style={styles.grid}>
        {ATTACHMENT_ITEMS.map((item) => (
          <TouchableOpacity
            key={item.key}
            style={styles.item}
            activeOpacity={0.7}
            onPress={() => onSelect(item.key)}
            accessibilityRole="button"
            accessibilityLabel={item.label}
          >
            <View style={styles.iconCircle}>
              <Ionicons name={item.icon} size={ICON_SIZE} color={Colors.terracotta} />
            </View>
            <Text style={styles.label} numberOfLines={1}>
              {item.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: Colors.cardBg,
    borderTopWidth: 1,
    borderTopColor: Colors.inputBg,
    paddingHorizontal: PANEL_HORIZONTAL_PADDING,
    paddingTop: PANEL_TOP_PADDING,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  item: {
    width: `${100 / GRID_COLUMNS}%`,
    alignItems: 'center',
    marginBottom: ITEM_VERTICAL_GAP,
  },
  iconCircle: {
    width: ICON_CIRCLE_SIZE,
    height: ICON_CIRCLE_SIZE,
    borderRadius: ICON_CIRCLE_SIZE / 2,
    backgroundColor: Colors.parchment,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  label: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.textMedium,
    textAlign: 'center',
  },
});
