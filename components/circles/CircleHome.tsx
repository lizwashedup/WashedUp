/**
 * CircleHome - the circle's home surface (reached from Yours > Circles and from
 * the circle chat list). v1 renders the noticeboard (cover, members, plans,
 * the reserved Room slot) in a scroll; the persistent circle chat stacks in
 * below it in a following chunk (6b).
 *
 * Mounted only behind GROUPS_ENABLED (the route guards it).
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronLeft, MoreHorizontal } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { CIRCLE_HOME } from '../../constants/YoursDesign';
import { COPY } from '../yours/state/constants';
import { hapticSelection } from '../../lib/haptics';
import { useAuthUserId } from '../yours/state/useAuthUserId';
import { useCircle } from '../../hooks/useCircle';
import { useLeaveCircle } from '../../hooks/useLeaveCircle';
import { BrandedAlert } from '../BrandedAlert';
import CircleChat from './CircleChat';

// Distance from the top of the screen to the top of the chat surface, so the
// keyboard-avoiding chat offsets correctly: the safe-area top inset plus the
// header band (its vertical padding on both sides + the icon row height).
const HEADER_BAND = CIRCLE_HOME.headerVPad * 2 + CIRCLE_HOME.headerIcon;

export default function CircleHome({ circleId }: { circleId: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: userId } = useAuthUserId();
  const { data, isLoading, isError, refetch } = useCircle(circleId);
  const leaveCircle = useLeaveCircle(userId);

  // Single confirm modal (v1 has exactly one overflow action: leave). A real
  // multi-action sheet arrives in Step 8 (invite / edit / admin); chaining two
  // modals here is unreliable because BrandedAlert fires onPress then onClose
  // in the same tick, so we open the confirm directly.
  const [confirmOpen, setConfirmOpen] = useState(false);

  const title = data?.circle.name ?? '';

  const doLeave = () => {
    if (leaveCircle.isPending) return; // guard a double-tap before the modal closes
    leaveCircle.mutate(circleId, {
      onSuccess: () => router.back(),
      onError: () => Alert.alert(COPY.circleLeaveError),
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={COPY.circleHomeBack}
        >
          <ChevronLeft size={CIRCLE_HOME.headerIcon} color={Colors.asphalt} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        {data ? (
          <Pressable
            onPress={() => {
              hapticSelection();
              setConfirmOpen(true);
            }}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={COPY.circleHomeMore}
          >
            <MoreHorizontal size={CIRCLE_HOME.headerIcon} color={Colors.asphalt} />
          </Pressable>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.terracotta} />
        </View>
      ) : isError || !data ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{COPY.circleLoadError}</Text>
          <Pressable
            onPress={() => refetch()}
            style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={COPY.circlesRetry}
          >
            <Text style={styles.retryLabel}>{COPY.circlesRetry}</Text>
          </Pressable>
        </View>
      ) : (
        <CircleChat
          circleId={circleId}
          payload={data}
          headerOffset={insets.top + HEADER_BAND}
        />
      )}

      {/* Leave confirmation (the only overflow action in v1) */}
      <BrandedAlert
        visible={confirmOpen}
        title={COPY.circleLeaveTitle}
        message={COPY.circleLeaveBody}
        buttons={[
          { text: COPY.circleLeaveStay, style: 'cancel' },
          { text: COPY.circleLeaveGo, style: 'destructive', onPress: doLeave },
        ]}
        onClose={() => setConfirmOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: CIRCLE_HOME.sectionPadH,
    paddingVertical: CIRCLE_HOME.headerVPad,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    marginHorizontal: 12,
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
  },
  headerSpacer: { width: CIRCLE_HOME.headerIcon },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.secondary,
    textAlign: 'center',
    marginBottom: 16,
  },
  retry: {
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  pressed: { opacity: 0.85 },
  retryLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
  },
});
