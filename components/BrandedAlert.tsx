import React, { useMemo } from 'react';
import { View, TouchableOpacity, Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { ScaledText as Text } from './ScaledText';
import Colors, { AfterglowColors } from '../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../constants/Typography';

export interface BrandedAlertButton {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

interface BrandedAlertProps {
  visible: boolean;
  title: string;
  message?: string;
  scrollMessage?: boolean;
  buttons?: BrandedAlertButton[];
  onClose: () => void;
  onDismiss?: () => void;
  appearance?: { fonts: AfterglowFontFamilies; variant?: 'creator' };
}

export function BrandedAlert({ visible, title, message, scrollMessage = false, buttons, onClose, onDismiss, appearance }: BrandedAlertProps) {
  const styles = useMemo(() => appearance ? { ...baseStyles, ...afterglowStyles(appearance.fonts,appearance.variant==='creator') } : baseStyles, [appearance]);
  const { height, fontScale } = useWindowDimensions();
  const resolvedButtons = buttons && buttons.length > 0 ? buttons : [{ text: 'OK', onPress: onClose }];

  const columnButtons = resolvedButtons.length > 2 || (scrollMessage && fontScale > 1.3 && resolvedButtons.length > 1);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} onDismiss={onDismiss} statusBarTranslucent>
      <Pressable style={[styles.overlay, scrollMessage && styles.scrollOverlay]} onPress={onClose} accessible={false} focusable={false}>
        <Pressable
          style={[styles.card, scrollMessage && { maxHeight: Math.max(0, height - 48) }]}
          onPress={(e) => e.stopPropagation()}
          accessible={false}
          focusable={false}
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
        >
          <Text style={[styles.title, scrollMessage && styles.fixedSection]} accessibilityRole="header">{title}</Text>
          {message && (scrollMessage ? (
            <ScrollView
              style={[styles.scrollMessage, { maxHeight: Math.min(320, height * 0.45) }]}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator
              keyboardShouldPersistTaps="handled"
            >
              <Text style={[styles.message, styles.selectableMessage]} selectable>{message}</Text>
            </ScrollView>
          ) : <Text style={styles.message}>{message}</Text>)}
          <View style={[
            styles.buttonRow,
            columnButtons && styles.buttonColumn,
            scrollMessage && styles.fixedSection,
          ]}>
            {resolvedButtons.map((btn, i) => {
              const isDestructive = btn.style === 'destructive';
              const isCancel = btn.style === 'cancel';
              return (
                <TouchableOpacity
                  key={i}
                  style={[
                    styles.button,
                    isDestructive && styles.buttonDestructive,
                    isCancel && styles.buttonCancel,
                    !isDestructive && !isCancel && styles.buttonDefault,
                    resolvedButtons.length === 1 && { flex: 0, minWidth: 120 },
                    columnButtons && { flex: 0 },
                    scrollMessage && styles.scrollButton,
                  ]}
                  onPress={() => {
                    btn.onPress?.();
                    onClose();
                  }}
                  activeOpacity={0.85}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={btn.text}
                >
                  <Text
                    style={[
                      styles.buttonText,
                      isDestructive && styles.buttonTextDestructive,
                      isCancel && styles.buttonTextCancel,
                    ]}
                  >
                    {btn.text}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const baseStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: Colors.overlayDark,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  scrollOverlay: { paddingVertical: 24 },
  fixedSection: { flexShrink: 0 },
  scrollMessage: { width: '100%', flexShrink: 1, minHeight: 0, marginBottom: 20 },
  scrollContent: { paddingBottom: 2 },
  selectableMessage: { textAlign: 'left', marginBottom: 0 },
  scrollButton: { minHeight: 44 },
  card: {
    backgroundColor: Colors.white,
    borderRadius: 20,
    paddingTop: 28,
    paddingBottom: 20,
    paddingHorizontal: 24,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
  },
  title: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.displaySM,
    color: Colors.asphalt,
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.textMedium,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    justifyContent: 'center',
  },
  buttonColumn: {
    flexDirection: 'column',
    gap: 10,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDefault: {
    backgroundColor: Colors.terracotta,
  },
  buttonCancel: {
    backgroundColor: Colors.parchment,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  buttonDestructive: {
    backgroundColor: Colors.errorRed,
  },
  buttonText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.white,
  },
  buttonTextCancel: {
    color: Colors.asphalt,
  },
  buttonTextDestructive: {
    color: Colors.white,
  },
});

function afterglowStyles(fonts: AfterglowFontFamilies,creator=false) {
  return StyleSheet.create({
    card: { ...baseStyles.card, backgroundColor: AfterglowColors.paper, borderRadius: creator?20:4, paddingTop: creator?24:20, paddingHorizontal: creator?24:20 },
    title: { ...baseStyles.title, ...(creator?AfterglowType.pageTitle:AfterglowType.contextTitle), fontFamily: creator?fonts.display:fonts.semibold, color: AfterglowColors.ink },
    message: { ...baseStyles.message, ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted },
    button: { ...baseStyles.button, minHeight: 44, borderRadius: creator?22:4, paddingVertical: 12 },
    buttonDefault: { backgroundColor: AfterglowColors.clay },
    buttonCancel: { backgroundColor: AfterglowColors.paper, borderWidth: 1, borderColor: AfterglowColors.line },
    buttonText: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.white },
    buttonTextCancel: { color: AfterglowColors.ink },
  });
}
