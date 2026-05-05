import { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Easing } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import Colors from '../../constants/Colors';
import { Fonts } from '../../constants/Typography';

type Props = {
  step: number;
  totalSteps?: number;
  onBack?: () => void;
};

export function ProgressHead({ step, totalSteps = 4, onBack }: Props) {
  const target = Math.max(0, Math.min(1, step / totalSteps));
  const progress = useRef(new Animated.Value(target)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: target,
      duration: 320,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: false,
    }).start();
  }, [target, progress]);

  const widthInterpolated = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  const percentLabel = `${Math.round(target * 100)}%`;

  return (
    <View style={styles.wrap}>
      <View style={styles.topRow}>
        {onBack ? (
          <TouchableOpacity
            style={styles.backHit}
            onPress={onBack}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel="back"
          >
            <Ionicons name="chevron-back" size={24} color={Colors.text1} />
          </TouchableOpacity>
        ) : (
          <View style={styles.backHit} />
        )}
        <View style={styles.labelRow}>
          <Text style={styles.stepLabel}>step {step} of {totalSteps}</Text>
          <Text style={styles.percentLabel}>{percentLabel}</Text>
        </View>
      </View>

      <View style={styles.track}>
        <Animated.View style={[styles.fillWrap, { width: widthInterpolated }]}>
          <LinearGradient
            colors={[Colors.gold, Colors.brand]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.fill}
          />
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingTop: 4,
    paddingBottom: 8,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  backHit: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  labelRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepLabel: {
    fontFamily: Fonts.sansSemibold,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: Colors.brand,
  },
  percentLabel: {
    fontFamily: Fonts.sansSemibold,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: Colors.brand,
  },
  track: {
    height: 5,
    backgroundColor: Colors.brandSoft,
    borderRadius: 999,
    overflow: 'hidden',
  },
  fillWrap: {
    height: '100%',
    borderRadius: 999,
    overflow: 'hidden',
  },
  fill: {
    flex: 1,
    borderRadius: 999,
  },
});

export default ProgressHead;
