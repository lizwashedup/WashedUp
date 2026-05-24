import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  BottomSheetModal,
  BottomSheetView,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';

// The chat attachment menu. Opened from the + button in the input bar. Replaces
// the old ActionSheetIOS / BrandedAlert split with a single branded bottom-sheet
// grid that looks identical on iOS and Android. Photos/Camera/Location are wired
// to the existing handlers; Document/Contact/Poll are placeholders for later
// phases and no-op for now.

export type AttachmentKey =
  | 'photos'
  | 'camera'
  | 'document'
  | 'location'
  | 'contact'
  | 'poll';

export interface AttachmentSheetRef {
  present: () => void;
  dismiss: () => void;
}

interface AttachmentSheetProps {
  onSelect: (key: AttachmentKey) => void;
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
const SHEET_HORIZONTAL_PADDING = 20;
const SHEET_TOP_PADDING = 8;
const SHEET_BOTTOM_PADDING = 12;

const ATTACHMENT_ITEMS: AttachmentItem[] = [
  { key: 'photos', label: 'Photos & videos', icon: 'images-outline' },
  { key: 'camera', label: 'Camera', icon: 'camera-outline' },
  { key: 'document', label: 'Document', icon: 'document-outline' },
  { key: 'location', label: 'Location', icon: 'location-outline' },
  { key: 'contact', label: 'Contact', icon: 'person-outline' },
  { key: 'poll', label: 'Poll', icon: 'stats-chart-outline' },
];

const AttachmentSheet = forwardRef<AttachmentSheetRef, AttachmentSheetProps>(
  function AttachmentSheet({ onSelect }, ref) {
    const insets = useSafeAreaInsets();
    const modalRef = useRef<BottomSheetModal>(null);

    useImperativeHandle(ref, () => ({
      present: () => modalRef.current?.present(),
      dismiss: () => modalRef.current?.dismiss(),
    }));

    const handlePress = useCallback(
      (key: AttachmentKey) => {
        modalRef.current?.dismiss();
        onSelect(key);
      },
      [onSelect],
    );

    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} />
      ),
      [],
    );

    const contentStyle = useMemo(
      () => [styles.content, { paddingBottom: SHEET_BOTTOM_PADDING + insets.bottom }],
      [insets.bottom],
    );

    return (
      <BottomSheetModal
        ref={modalRef}
        enableDynamicSizing
        backdropComponent={renderBackdrop}
        backgroundStyle={styles.background}
        handleIndicatorStyle={styles.handleIndicator}
      >
        <BottomSheetView style={contentStyle}>
          <View style={styles.grid}>
            {ATTACHMENT_ITEMS.map((item) => (
              <TouchableOpacity
                key={item.key}
                style={styles.item}
                activeOpacity={0.7}
                onPress={() => handlePress(item.key)}
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
        </BottomSheetView>
      </BottomSheetModal>
    );
  },
);

export default AttachmentSheet;

const styles = StyleSheet.create({
  background: {
    backgroundColor: Colors.cardBg,
  },
  handleIndicator: {
    backgroundColor: Colors.warmGray,
  },
  content: {
    paddingHorizontal: SHEET_HORIZONTAL_PADDING,
    paddingTop: SHEET_TOP_PADDING,
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
