import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../constants/Typography';
import { hapticLight } from '../lib/haptics';

// Post-join "re-enable notifications" soft-ask. Presentational only, mirroring
// PushPrimerModal: the parent (app/plan/[id].tsx) owns persistence, the
// permission call, and the denied-vs-undetermined branch. When deniedMode is
// true the OS has already recorded a hard denial, so the native dialog is a
// silent no-op and the only path forward is the Settings deep-link, so the
// button label changes rather than pretending the in-app prompt can re-ask.
interface Props {
  visible: boolean;
  deniedMode: boolean;
  onEnable: () => void;
  onDismiss: () => void;
}

export default function NotificationReenableModal({ visible, deniedMode, onEnable, onDismiss }: Props) {
  const dismiss = () => {
    hapticLight();
    onDismiss();
  };

  const enable = () => {
    hapticLight();
    onEnable();
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

          <Text style={styles.heading}>Know the moment someone's in</Text>

          <Text style={styles.body}>
            {deniedMode
              ? "Notifications are off, so you're missing it when people join your plans. Turn them back on in Settings and we'll keep you posted."
              : "Turn on notifications and we'll tell you the second someone joins a plan you're in, so you never miss the group coming together."}
          </Text>

          <TouchableOpacity style={styles.primaryButton} onPress={enable} activeOpacity={0.85}>
            <Text style={styles.primaryButtonText}>
              {deniedMode ? 'Open Settings' : 'Turn on notifications'}
            </Text>
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
    paddingVertical: 14,
    paddingHorizontal: 24,
  },
  textButtonText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.secondary,
  },
});
