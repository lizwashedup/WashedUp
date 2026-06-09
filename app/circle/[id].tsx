/**
 * View-circle detail page.
 *
 * Reached from the circle chat header's "View circle" button. This is the
 * circle's noticeboard moved off the chat surface: identity (cover + name +
 * member count + description), "who's in it" (with an add affordance), "coming
 * up" plans, and the reserved gold "the room" slot. Circle management that used
 * to live on the stacked home (leave) now lives here, in the header overflow.
 *
 * Gated behind GROUPS_ENABLED (a direct hit with the flag off bounces to Chats).
 * Note: the static `circle/new` route takes precedence over this dynamic one.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, MoreHorizontal } from 'lucide-react-native';
import { GROUPS_ENABLED } from '../../constants/FeatureFlags';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { CIRCLE_HOME } from '../../constants/YoursDesign';
import { COPY } from '../../components/yours/state/constants';
import { hapticSelection } from '../../lib/haptics';
import { useAuthUserId } from '../../components/yours/state/useAuthUserId';
import { useCircle } from '../../hooks/useCircle';
import { useLeaveCircle } from '../../hooks/useLeaveCircle';
import { BrandedAlert } from '../../components/BrandedAlert';
import CircleNoticeboard from '../../components/circles/CircleNoticeboard';
import AddPeopleSheet from '../../components/circles/AddPeopleSheet';

function CircleDetail({ circleId }: { circleId: string }) {
  const router = useRouter();
  const { data: userId } = useAuthUserId();
  const { data, isLoading, isError, refetch } = useCircle(circleId);
  const leaveCircle = useLeaveCircle(userId);

  const [confirmLeave, setConfirmLeave] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const title = data?.circle.name ?? '';
  const memberIds = data?.members.map((m) => m.user_id) ?? [];

  const doLeave = () => {
    if (leaveCircle.isPending) return;
    leaveCircle.mutate(circleId, {
      // Leaving makes both this page and the circle chat invalid, so pop the
      // whole circle stack back to the Chats list rather than to the dead chat.
      onSuccess: () => router.dismissAll(),
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
              setConfirmLeave(true);
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
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <CircleNoticeboard payload={data} onAddPeople={() => setAddOpen(true)} />
        </ScrollView>
      )}

      <AddPeopleSheet
        visible={addOpen}
        circleId={circleId}
        existingMemberIds={memberIds}
        onClose={() => setAddOpen(false)}
      />

      <BrandedAlert
        visible={confirmLeave}
        title={COPY.circleLeaveTitle}
        message={COPY.circleLeaveBody}
        buttons={[
          { text: COPY.circleLeaveStay, style: 'cancel' },
          { text: COPY.circleLeaveGo, style: 'destructive', onPress: doLeave },
        ]}
        onClose={() => setConfirmLeave(false)}
      />
    </SafeAreaView>
  );
}

export default function CircleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!GROUPS_ENABLED || !id) {
    return <Redirect href="/(tabs)/chats" />;
  }
  return <CircleDetail circleId={id} />;
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
  scroll: { paddingBottom: 32 },
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
