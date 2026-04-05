import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { Search, Users, MessageCircle } from 'lucide-react-native';
import { hapticLight, hapticMedium, hapticHeavy, hapticSelection, hapticSuccess, hapticWarning, hapticError } from '../lib/haptics';
import Colors from '../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../constants/Typography';

const waveIcon = require('../assets/welcome-wave.png');

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH - 48;
const TOTAL_CARDS = 3;

interface WelcomeModalProps {
  visible: boolean;
  firstName: string;
  onDismiss: () => void;
  onPostPlan: () => void;
}

const STEPS = [
  { icon: Search, label: 'Browse plans' },
  { icon: Users, label: 'Join or create a plan' },
  { icon: MessageCircle, label: 'Chat and make it happen' },
];

export default function WelcomeModal({
  visible,
  firstName,
  onDismiss,
  onPostPlan,
}: WelcomeModalProps) {
  const scrollRef = useRef<ScrollView>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const idx = Math.round(e.nativeEvent.contentOffset.x / CARD_WIDTH);
      setActiveIndex(idx);
    },
    [],
  );

  const handleBrowse = useCallback(() => {
    hapticLight();
    onDismiss();
  }, [onDismiss]);

  const handlePost = useCallback(() => {
    hapticLight();
    onPostPlan();
  }, [onPostPlan]);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={handleScroll}
            contentContainerStyle={styles.scrollContent}
            bounces={false}
          >
            {/* Card 1: Welcome */}
            <View style={styles.page}>
              <Image
                source={waveIcon}
                style={styles.waveIcon}
                contentFit="contain"
              />
              <Text style={styles.displayTitle}>
                Welcome, {firstName || 'friend'}
              </Text>
              <Text style={styles.bodyText}>
                You just joined a community of people who actually want to do
                things.
              </Text>
              <Text style={styles.swipeHint}>Swipe to continue</Text>
            </View>

            {/* Card 2: How it works */}
            <View style={styles.page}>
              <Text style={styles.sectionTitle}>How it works</Text>
              {STEPS.map(({ icon: Icon, label }) => (
                <View key={label} style={styles.stepRow}>
                  <View style={styles.iconCircle}>
                    <Icon size={18} color={Colors.terracotta} />
                  </View>
                  <Text style={styles.stepLabel}>{label}</Text>
                </View>
              ))}
              <Text style={styles.swipeHint}>Swipe to continue</Text>
            </View>

            {/* Card 3: Ready */}
            <View style={styles.page}>
              <Text style={styles.displayTitle}>Ready?</Text>
              <Text style={styles.bodyText}>
                Jump in and see what people are up to, or post your own plan
                and find people to go with.
              </Text>
              <View style={styles.buttonGroup}>
                <TouchableOpacity
                  style={styles.outlineButton}
                  activeOpacity={0.7}
                  onPress={handleBrowse}
                >
                  <Text style={styles.outlineButtonText}>Browse Plans</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.filledButton}
                  activeOpacity={0.7}
                  onPress={handlePost}
                >
                  <Text style={styles.filledButtonText}>Post a Plan</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>

          <View style={styles.dots}>
            {Array.from({ length: TOTAL_CARDS }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  i === activeIndex ? styles.dotActive : styles.dotInactive,
                ]}
              />
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Colors.overlayDark,
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    width: CARD_WIDTH,
    backgroundColor: Colors.cardBg,
    borderRadius: 20,
    overflow: 'hidden',
    paddingBottom: 24,
  },
  scrollContent: {
    alignItems: 'stretch',
  },
  page: {
    width: CARD_WIDTH,
    paddingHorizontal: 28,
    paddingTop: 36,
    paddingBottom: 16,
    justifyContent: 'center',
  },
  waveIcon: {
    width: 110,
    height: 72,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 18,
  },
  displayTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displayLG,
    lineHeight: LineHeights.displayLG,
    color: Colors.asphalt,
    marginBottom: 12,
    textAlign: 'center',
  },
  sectionTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displayMD,
    lineHeight: LineHeights.displayMD,
    color: Colors.asphalt,
    marginBottom: 20,
    textAlign: 'center',
  },
  bodyText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyLG,
    lineHeight: LineHeights.bodyLG,
    color: Colors.textMedium,
    textAlign: 'center',
    marginBottom: 8,
  },
  swipeHint: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.caption,
    lineHeight: LineHeights.caption,
    color: Colors.textLight,
    textAlign: 'center',
    marginTop: 20,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.emptyIconBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  stepLabel: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyLG,
    lineHeight: LineHeights.bodyLG,
    color: Colors.asphalt,
    flexShrink: 1,
  },
  buttonGroup: {
    marginTop: 24,
    gap: 12,
  },
  outlineButton: {
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  outlineButtonText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.terracotta,
  },
  filledButton: {
    backgroundColor: Colors.terracotta,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  filledButtonText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.white,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotActive: {
    backgroundColor: Colors.terracotta,
  },
  dotInactive: {
    backgroundColor: Colors.border,
  },
});
