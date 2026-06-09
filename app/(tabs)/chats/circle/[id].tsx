/**
 * Circle chat screen.
 *
 * A circle now opens into the SAME polished chat as a plan (the shared
 * <ChatThread>), not the old stacked noticeboard. This thin wrapper resolves the
 * circle's identity/members (get_circle) and hands the rest to ChatThread:
 *   header  = {circle name} + "View circle" (-> detail page) + "+" menu
 *   "+"     = Add people now (functional) | Make a plan (placeholder this build)
 *   chat    = persistent (never read-only), no countdown, no presence column
 *
 * Gated behind GROUPS_ENABLED; a direct hit with the flag off bounces to Chats.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Platform, ActionSheetIOS, Alert, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { GROUPS_ENABLED } from '../../../../constants/FeatureFlags';
import Colors from '../../../../constants/Colors';
import { Fonts, FontSizes } from '../../../../constants/Typography';
import { COPY } from '../../../../components/yours/state/constants';
import { useCircle } from '../../../../hooks/useCircle';
import ChatThread, { ChatThreadMember } from '../../../../components/chat/ChatThread';
import AddPeopleSheet from '../../../../components/circles/AddPeopleSheet';

function CircleChatScreenInner({ circleId }: { circleId: string }) {
  const router = useRouter();
  const { data, isError } = useCircle(circleId);
  const [addOpen, setAddOpen] = useState(false);

  const members: ChatThreadMember[] = (data?.members ?? []).map((m) => ({
    id: m.user_id,
    first_name: m.first_name_display,
    avatar_url: m.profile_photo_url,
  }));
  const memberIds = data?.members.map((m) => m.user_id) ?? [];

  // The "+" header menu: add people now, or make a plan (placeholder this build).
  const openPlusMenu = () => {
    const makePlanSoon = () => Alert.alert(COPY.circlePlusMakePlan, COPY.circlePlusMakePlanSoon);
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [COPY.circlePlusAddPeople, COPY.circlePlusMakePlan, COPY.circlePlusCancel],
          cancelButtonIndex: 2,
        },
        (i) => {
          if (i === 0) setAddOpen(true);
          else if (i === 1) makePlanSoon();
        },
      );
    } else {
      Alert.alert(COPY.circleAddTitle, undefined, [
        { text: COPY.circlePlusAddPeople, onPress: () => setAddOpen(true) },
        { text: COPY.circlePlusMakePlan, onPress: makePlanSoon },
        { text: COPY.circlePlusCancel, style: 'cancel' },
      ]);
    }
  };

  if (isError) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.center}>
          <Text style={styles.errorText}>{COPY.circleLoadError}</Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backLabel}>{COPY.circleHomeBack}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <>
      <ChatThread
        kind="circle"
        id={circleId}
        title={data?.circle.name ?? '...'}
        subtitle={data ? COPY.circleHomeMembers(members.length) : null}
        members={members}
        viewContextLabel={COPY.circleViewButton}
        onViewContext={() => router.push(`/circle/${circleId}` as any)}
        headerMenu={{ type: 'plus', onPress: openPlusMenu }}
        emptyText={COPY.circleChatStart}
      />
      <AddPeopleSheet
        visible={addOpen}
        circleId={circleId}
        existingMemberIds={memberIds}
        onClose={() => setAddOpen(false)}
      />
    </>
  );
}

export default function CircleChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!GROUPS_ENABLED || !id) {
    return <Redirect href="/(tabs)/chats" />;
  }
  return <CircleChatScreenInner circleId={id} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.secondary,
    textAlign: 'center',
    marginBottom: 16,
  },
  backBtn: {
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  backLabel: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
});
