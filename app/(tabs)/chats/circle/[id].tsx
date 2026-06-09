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
import { useAuthUserId } from '../../../../components/yours/state/useAuthUserId';
import { useCircle } from '../../../../hooks/useCircle';
import { circleDisplay } from '../../../../lib/circles/display';
import ChatThread, { ChatThreadMember } from '../../../../components/chat/ChatThread';
import AddPeopleSheet from '../../../../components/circles/AddPeopleSheet';
import CirclePlanComposer from '../../../../components/circles/plan/CirclePlanComposer';

function CircleChatScreenInner({ circleId }: { circleId: string }) {
  const router = useRouter();
  const { data: myUserId } = useAuthUserId();
  const { data, isError } = useCircle(circleId);
  const [addOpen, setAddOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);

  const members: ChatThreadMember[] = (data?.members ?? []).map((m) => ({
    id: m.user_id,
    first_name: m.first_name_display,
    avatar_url: m.profile_photo_url,
  }));
  const memberIds = data?.members.map((m) => m.user_id) ?? [];

  // A DM is an unnamed 2-person circle: render the counterpart (name + "View
  // {name}" -> their keep page) instead of "View circle". A grown DM (3+) and a
  // named circle both render as a circle. Gate on myUserId too: without it, both
  // members survive the self-filter and a DM would briefly mis-render as a
  // 2-person "unnamed circle" until auth resolves.
  const disp = data && myUserId
    ? circleDisplay(
        data.circle.name,
        data.members.map((m) => ({
          user_id: m.user_id,
          name: m.first_name_display,
          avatar_url: m.profile_photo_url,
        })),
        myUserId,
      )
    : null;

  // The "+" header menu: add people now, or make a plan.
  const openPlusMenu = () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [COPY.circlePlusAddPeople, COPY.circlePlusMakePlan, COPY.circlePlusCancel],
          cancelButtonIndex: 2,
        },
        (i) => {
          if (i === 0) setAddOpen(true);
          else if (i === 1) setPlanOpen(true);
        },
      );
    } else {
      Alert.alert(COPY.circlePlusMenuTitle, undefined, [
        { text: COPY.circlePlusAddPeople, onPress: () => setAddOpen(true) },
        { text: COPY.circlePlusMakePlan, onPress: () => setPlanOpen(true) },
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
        title={disp?.title ?? '...'}
        subtitle={data && disp && !disp.isDm ? COPY.circleHomeMembers(members.length) : null}
        members={members}
        viewContextLabel={disp?.isDm ? COPY.dmViewPerson(disp.title) : COPY.circleViewButton}
        onViewContext={() =>
          disp?.isDm && disp.otherUserId
            ? router.push(`/person/${disp.otherUserId}` as any)
            : router.push(`/circle/${circleId}` as any)
        }
        headerMenu={{ type: 'plus', onPress: openPlusMenu }}
        emptyText={COPY.circleChatStart}
      />
      <AddPeopleSheet
        visible={addOpen}
        circleId={circleId}
        existingMemberIds={memberIds}
        onClose={() => setAddOpen(false)}
      />
      <CirclePlanComposer
        visible={planOpen}
        onClose={() => setPlanOpen(false)}
        circleId={circleId}
        circleName={disp?.title ?? data?.circle.name ?? ''}
        members={(data?.members ?? []).map((m) => ({
          user_id: m.user_id,
          first_name_display: m.first_name_display,
          profile_photo_url: m.profile_photo_url,
        }))}
        isDm={!!disp?.isDm}
        onPosted={(result) => {
          // Open plan / picked-subset plans get their own chat -> open it.
          // A whole-circle just-us plan lives in this circle chat already.
          if (result.has_own_chat) {
            router.push(`/plan/${result.event_id}` as any);
          }
        }}
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
