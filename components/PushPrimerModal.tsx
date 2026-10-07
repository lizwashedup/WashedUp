import React from 'react';
import {
  Modal,
  ScrollView,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import Colors, { AfterglowColors } from '../constants/Colors';
import { Fonts, FontSizes, LineHeights, AfterglowType, type AfterglowFontFamilies } from '../constants/Typography';

// Presentational only. The caller owns permission, registration, feedback and
// snooze persistence; opening this modal never requests native permission.
interface Props {
  visible: boolean;
  onEnable: () => void;
  onDismiss: () => void;
  pending?: boolean;
  feedback?: string | null;
  appearance?: { fonts: AfterglowFontFamilies };
  title?: string;
  body?: string;
  enableLabel?: string;
  enableAccessibilityLabel?: string;
  pendingLabel?: string;
  pendingAccessibilityLabel?: string;
}

export default function PushPrimerModal({ visible, onEnable, onDismiss, pending = false, feedback, appearance, title = 'Stay in the loop',
  body = 'Turn on notifications for messages, plan updates and reminders. You can mute individual chats anytime.',
  enableLabel = 'Enable', enableAccessibilityLabel = 'Enable notifications', pendingLabel = 'Turning on…', pendingAccessibilityLabel = 'Turning on notifications' }: Props) {
  const staged = React.useMemo(
    () => appearance ? createAppearance(appearance.fonts) : undefined,
    [appearance?.fonts],
  );
  const enable = () => {
    if (!pending) onEnable();
  };

  return (
    <Modal visible={visible} animationType="fade" transparent statusBarTranslucent onRequestClose={onDismiss}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.backdrop}>
          <View style={[styles.card, staged?.card]} accessibilityViewIsModal onAccessibilityEscape={onDismiss}>
            <View style={styles.topBar}>
              {appearance && <Text style={[styles.eyebrow, staged?.eyebrow]}>Notifications</Text>}
              <TouchableOpacity
                style={[styles.closeButton, staged?.closeButton]}
                onPress={onDismiss}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Close notifications reminder"
              >
                <Ionicons name="close" size={20} color={appearance ? AfterglowColors.ink : Colors.secondary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, staged?.content]} bounces={false}>
              {!appearance && (
                <Image
                  source={require('../assets/wave-icon.png')}
                  style={styles.icon}
                  contentFit="contain"
                  accessible={false}
                />
              )}

              <Text style={[styles.heading, staged?.heading]} accessibilityRole="header">{title}</Text>

              <Text style={[styles.body, staged?.body]}>
                {body}
              </Text>

              {!!feedback && !pending && (
                <Text style={[styles.feedback, staged?.feedback]} accessibilityRole="alert" accessibilityLiveRegion="polite">
                  {feedback}
                </Text>
              )}

              <TouchableOpacity
                style={[styles.primaryButton, staged?.primaryButton, pending && styles.pendingButton]}
                onPress={enable}
                disabled={pending}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={pending ? pendingAccessibilityLabel : enableAccessibilityLabel}
                accessibilityState={{ disabled: pending, busy: pending }}
              >
                <Text style={[styles.primaryButtonText, staged?.primaryButtonText]} numberOfLines={1} adjustsFontSizeToFit>
                  {pending ? pendingLabel : enableLabel}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.textButton}
                onPress={onDismiss}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Not now"
              >
                <Text style={[styles.textButtonText, staged?.textButtonText]} numberOfLines={1} adjustsFontSizeToFit>Not now</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.overlayDark,
  },
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: 24,
    width: '100%',
    maxWidth: 440,
    maxHeight: '100%',
    flexShrink: 1,
    overflow: 'hidden',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 8,
    paddingTop: 8,
    flexShrink: 0,
  },
  closeButton: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  eyebrow: {
    flex: 1,
    marginLeft: 16,
  },
  scroll: {
    flexShrink: 1,
  },
  content: {
    paddingHorizontal: 28,
    paddingTop: 8,
    paddingBottom: 24,
    alignItems: 'center',
  },
  icon: {
    width: 56,
    height: 56,
    marginBottom: 24,
    tintColor: Colors.terracotta,
  },
  heading: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displayMD,
    lineHeight: LineHeights.displayMD,
    color: Colors.darkWarm,
    textAlign: 'center',
    marginBottom: 12,
  },
  body: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    lineHeight: LineHeights.bodyMD,
    color: Colors.textMedium,
    textAlign: 'center',
    marginBottom: 24,
  },
  feedback: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    lineHeight: LineHeights.bodyMD,
    color: Colors.errorRed,
    marginBottom: 20,
    alignSelf: 'stretch',
  },
  primaryButton: {
    backgroundColor: Colors.terracotta,
    paddingVertical: 14,
    paddingHorizontal: 16,
    minWidth: 44,
    minHeight: 48,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    shadowColor: Colors.terracotta,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
    marginBottom: 8,
  },
  pendingButton: {
    opacity: 0.75,
  },
  primaryButtonText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    lineHeight: LineHeights.bodyLG,
    color: Colors.white,
    textAlign: 'center',
    alignSelf: 'stretch',
  },
  textButton: {
    minWidth: 44,
    minHeight: 44,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  textButtonText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    lineHeight: LineHeights.bodyMD,
    color: Colors.secondary,
    textAlign: 'center',
    alignSelf: 'stretch',
  },
});

function createAppearance(fonts: AfterglowFontFamilies) {
  return StyleSheet.create({
    card: {
      backgroundColor: AfterglowColors.paper,
      borderRadius: 6,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: AfterglowColors.line,
    },
    closeButton: {
      borderRadius: 6,
    },
    eyebrow: {
      ...AfterglowType.section,
      fontFamily: fonts.medium,
      color: AfterglowColors.muted,
    },
    content: {
      paddingHorizontal: 24,
      paddingTop: 12,
      alignItems: 'stretch',
    },
    heading: {
      ...AfterglowType.identity,
      fontFamily: fonts.display,
      color: AfterglowColors.ink,
      textAlign: 'left',
    },
    body: {
      ...AfterglowType.body,
      fontFamily: fonts.regular,
      color: AfterglowColors.muted,
      textAlign: 'left',
    },
    feedback: {
      ...AfterglowType.body,
      fontFamily: fonts.medium,
      color: AfterglowColors.clay,
    },
    primaryButton: {
      backgroundColor: AfterglowColors.clay,
      borderRadius: 6,
      shadowOpacity: 0,
      elevation: 0,
    },
    primaryButtonText: {
      ...AfterglowType.message,
      fontFamily: fonts.semibold,
      color: AfterglowColors.white,
    },
    textButtonText: {
      ...AfterglowType.body,
      fontFamily: fonts.medium,
      color: AfterglowColors.ink,
    },
  });
}
