import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withDelay,
  runOnJS,
} from 'react-native-reanimated';

interface Props {
  visible: boolean;
  planId: string;
  planTitle: string;
  onShare: (planId: string) => void;
  onDismiss: () => void;
}

export function SaveSnackbar({ visible, planId, planTitle, onShare, onDismiss }: Props) {
  const translateY = useSharedValue(100);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      translateY.value = withSpring(0, { damping: 20, stiffness: 300 });
      opacity.value = withTiming(1, { duration: 150 });
      // Auto-dismiss after 4 seconds
      const timer = setTimeout(() => {
        opacity.value = withTiming(0, { duration: 300 });
        translateY.value = withDelay(200, withTiming(100, { duration: 200 }, () => {
          runOnJS(onDismiss)();
        }));
      }, 4000);
      return () => clearTimeout(timer);
    } else {
      translateY.value = 100;
      opacity.value = 0;
    }
  }, [visible]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  if (!visible) return null;

  return (
    <Animated.View style={[styles.container, animStyle]}>
      <View style={styles.left}>
        <Ionicons name="bookmark" size={14} color="#B5522E" />
        <Text style={styles.savedText}>Saved!</Text>
        <Text style={styles.promptText}> · Share with a friend?</Text>
      </View>
      <TouchableOpacity
        style={styles.shareBtn}
        onPress={() => onShare(planId)}
        activeOpacity={0.8}
      >
        <Text style={styles.shareBtnText}>Share</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 90,
    left: 16,
    right: 16,
    backgroundColor: '#2C1810',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 999,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  savedText: {
    fontWeight: '700',
    fontSize: 14,
    color: '#FFFFFF',
    marginLeft: 6,
  },
  promptText: {
    fontSize: 13,
    color: '#FFFFFF',
  },
  shareBtn: {
    backgroundColor: '#B5522E',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  shareBtnText: {
    fontWeight: '700',
    fontSize: 13,
    color: '#FFFFFF',
  },
});
