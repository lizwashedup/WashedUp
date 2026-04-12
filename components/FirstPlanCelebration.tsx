/**
 * FirstPlanCelebration — Standalone screen shown once when a user creates
 * their very first event. Not part of the marks system.
 */
import React from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import Colors from '../constants/Colors';
import { Fonts, FontSizes } from '../constants/Typography';

interface Props {
  visible: boolean;
  onDismiss: () => void;
}

export default function FirstPlanCelebration({ visible, onDismiss }: Props) {
  if (!visible) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onDismiss} statusBarTranslucent>
      <Animated.View entering={FadeIn.duration(300)} style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.headline}>Your first plan is live</Text>
          <Text style={styles.subtext}>
            That took courage. Now let's find your people.
          </Text>
          <TouchableOpacity style={styles.button} onPress={onDismiss} activeOpacity={0.8}>
            <Text style={styles.buttonText}>Got it</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    backgroundColor: '#FDF8F4',
    borderRadius: 20,
    paddingTop: 40,
    paddingBottom: 32,
    paddingHorizontal: 32,
    marginHorizontal: 36,
    alignItems: 'center',
    maxWidth: 340,
    width: '100%',
  },
  headline: {
    fontFamily: Fonts.displayBold,
    fontSize: 24,
    color: Colors.asphalt,
    textAlign: 'center',
    marginBottom: 12,
  },
  subtext: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: '#9B8B7A',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 32,
  },
  button: {
    backgroundColor: Colors.terracotta,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 999,
  },
  buttonText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.white,
  },
});
