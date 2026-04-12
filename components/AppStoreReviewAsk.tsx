import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Dimensions,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Colors from '../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../constants/Typography';
import { hapticLight } from '../lib/haptics';

const REVIEW_URL = Platform.OS === 'ios'
  ? 'https://apps.apple.com/app/id6759820053?action=write-review'
  : 'https://play.google.com/store/apps/details?id=com.washedup.app';

const STORE_NAME = Platform.OS === 'ios' ? 'the App Store' : 'Google Play';
// Show up to MAX_ASKS times if the user keeps tapping "Not now". If they tap
// "Write a Review", set the completed flag and never ask again regardless of
// count. The old `hasRequestedReview` key is honored for backwards compat —
// existing users who already dismissed once won't see it again.
export const REVIEW_ASK_COUNT_KEY = 'reviewAskCount';
export const REVIEW_ASK_COMPLETED_KEY = 'reviewAskCompleted';
export const REVIEW_ASK_LEGACY_KEY = 'hasRequestedReview';
export const REVIEW_ASK_MAX = 2;

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function AppStoreReviewAsk({ visible, onClose }: Props) {
  const dismiss = async () => {
    hapticLight();
    try {
      const raw = await AsyncStorage.getItem(REVIEW_ASK_COUNT_KEY);
      const next = (parseInt(raw ?? '0', 10) || 0) + 1;
      await AsyncStorage.setItem(REVIEW_ASK_COUNT_KEY, String(next));
    } catch {}
    onClose();
  };

  const handleReview = async () => {
    hapticLight();
    await AsyncStorage.setItem(REVIEW_ASK_COMPLETED_KEY, 'true').catch(() => {});
    Linking.openURL(REVIEW_URL).catch(() => {});
    onClose();
  };

  return (
    <Modal visible={visible} animationType="fade" transparent statusBarTranslucent onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={dismiss}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={18} color={Colors.secondary} />
          </TouchableOpacity>

          <Image
            source={require('../assets/wave-icon.png')}
            style={styles.icon}
            contentFit="contain"
          />

          <Text style={styles.heading}>
            Would you review washedup on {STORE_NAME}?
          </Text>

          <Text style={styles.body}>
            We're new and would love to hear how you like it.
          </Text>

          <TouchableOpacity style={styles.primaryButton} onPress={handleReview} activeOpacity={0.85}>
            <Text style={styles.primaryButtonText}>Write a Review</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.textButton} onPress={dismiss} activeOpacity={0.7}>
            <Text style={styles.textButtonText}>Not now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Colors.overlayDark,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: 24,
    width: '100%',
    maxHeight: SCREEN_HEIGHT * 0.6,
    paddingHorizontal: 28,
    paddingTop: 48,
    paddingBottom: 32,
    alignItems: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: 14,
    right: 14,
    zIndex: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.accentSubtle,
    justifyContent: 'center',
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
    color: Colors.textMedium,
    textAlign: 'center',
    marginBottom: 28,
  },
  primaryButton: {
    backgroundColor: Colors.terracotta,
    paddingVertical: 16,
    borderRadius: 999,
    alignItems: 'center',
    width: '100%',
    shadowColor: Colors.terracotta,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
    marginBottom: 14,
  },
  primaryButtonText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.white,
  },
  textButton: {
    paddingVertical: 8,
  },
  textButtonText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.secondary,
  },
});
