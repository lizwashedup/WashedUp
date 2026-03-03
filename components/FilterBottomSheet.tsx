import React from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Check } from 'lucide-react-native';
import Colors from '../constants/Colors';
import { Fonts, FontSizes } from '../constants/Typography';

export interface FilterSheetOption {
  key: string;
  label: string;
}

interface FilterBottomSheetProps {
  visible: boolean;
  title: string;
  options: FilterSheetOption[];
  selected: string[];
  onToggle: (key: string) => void;
  onClose: () => void;
  onClear: () => void;
}

/**
 * Shared full-height filter bottom sheet with radio-style check circles and "Clear all".
 * Used for Category and When filters on Plans and Scene screens.
 */
export function FilterBottomSheet({
  visible,
  title,
  options,
  selected,
  onToggle,
  onClose,
  onClear,
}: FilterBottomSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onStartShouldSetResponder={() => true}>
          <View style={styles.sheetHandle} />

          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <TouchableOpacity onPress={onClear} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.sheetClear}>Clear all</Text>
            </TouchableOpacity>
          </View>

          {options.map((opt) => {
            const active = selected.includes(opt.key);
            return (
              <TouchableOpacity
                key={opt.key}
                style={styles.sheetRow}
                onPress={() => {
                  Haptics.selectionAsync();
                  onToggle(opt.key);
                }}
                activeOpacity={0.7}
              >
                <Text style={[styles.sheetRowText, active && styles.sheetRowTextActive]}>
                  {opt.label}
                </Text>
                <View style={[styles.sheetCheck, active && styles.sheetCheckActive]}>
                  {active && <Check size={13} color={Colors.white} strokeWidth={3} />}
                </View>
              </TouchableOpacity>
            );
          })}

          <TouchableOpacity style={styles.sheetDone} onPress={onClose}>
            <Text style={styles.sheetDoneText}>Done</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: Colors.overlayMedium,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 44,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 20,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  sheetTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.displaySM, color: Colors.asphalt },
  sheetClear: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.textLight },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  sheetRowText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  sheetRowTextActive: { fontFamily: Fonts.sansBold, color: Colors.terracotta },
  sheetCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetCheckActive: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  sheetDone: {
    marginTop: 20,
    backgroundColor: Colors.terracotta,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetDoneText: { color: Colors.white, fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG },
});
