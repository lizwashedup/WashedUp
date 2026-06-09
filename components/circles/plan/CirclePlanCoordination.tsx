/**
 * CirclePlanCoordination - the two quiet, optional affordances shown inside a
 * circle plan's detail page (gated by GROUPS_ENABLED, rendered only when the
 * viewer is a member of the plan's circle):
 *
 *   "Start a chat for this"  - only on a whole-circle just-us plan that has no
 *                              chat of its own yet (lives in the circle chat).
 *   "Open it up"             - on any circle_only plan; releases it to the
 *                              public feed (with a stranger cap) and spawns its
 *                              own chat. Confirmed first, with the explain copy.
 *
 * Both are small offers in the margin, never competing with Join.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { MessageCircle, DoorOpen } from 'lucide-react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { CIRCLE_PLAN } from '../../../constants/YoursDesign';
import { COPY } from '../../yours/state/constants';
import { BrandedAlert } from '../../BrandedAlert';
import { useSpawnPlanChat, useReleaseCirclePlan } from '../../../hooks/useCirclePlanActions';

interface CirclePlanCoordinationProps {
  eventId: string;
  circleName: string;
  visibility: 'circle_only' | 'open' | null | undefined;
  hasOwnChat: boolean | undefined;
  /** Only members of the plan's circle see these affordances. */
  viewerIsMember: boolean | undefined;
}

export default function CirclePlanCoordination({
  eventId,
  circleName,
  visibility,
  hasOwnChat,
  viewerIsMember,
}: CirclePlanCoordinationProps) {
  const spawnChat = useSpawnPlanChat(eventId);
  const release = useReleaseCirclePlan(eventId);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Open plans (and non-circle plans) show nothing; only circle members coordinate.
  if (!viewerIsMember || visibility !== 'circle_only') return null;

  const showStartChat = hasOwnChat === false;

  return (
    <View style={styles.wrap}>
      {showStartChat && (
        <Pressable
          style={styles.row}
          onPress={() => spawnChat.mutate(undefined, { onError: () => setErrorMsg(COPY.circlePlanStartChatError) })}
          disabled={spawnChat.isPending}
        >
          <MessageCircle size={CIRCLE_PLAN.memberCheck} color={Colors.terracotta} strokeWidth={2} />
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle}>{COPY.circlePlanStartChat}</Text>
            <Text style={styles.rowSub}>{COPY.circlePlanStartChatSub(circleName)}</Text>
          </View>
        </Pressable>
      )}

      <Pressable
        style={styles.row}
        onPress={() => setConfirmRelease(true)}
        disabled={release.isPending}
      >
        <DoorOpen size={CIRCLE_PLAN.memberCheck} color={Colors.terracotta} strokeWidth={2} />
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle}>{COPY.circlePlanRelease}</Text>
          <Text style={styles.rowSub}>{COPY.circlePlanReleaseExplain(circleName)}</Text>
        </View>
      </Pressable>

      {confirmRelease && (
        <BrandedAlert
          visible
          title={COPY.circlePlanRelease}
          message={COPY.circlePlanReleaseExplain(circleName)}
          buttons={[
            { text: COPY.circlePlanReleaseCancel, style: 'cancel' },
            {
              text: COPY.circlePlanReleaseConfirm,
              onPress: () =>
                release.mutate(4, { onError: () => setErrorMsg(COPY.circlePlanReleaseError) }),
            },
          ]}
          onClose={() => setConfirmRelease(false)}
        />
      )}

      {errorMsg && (
        <BrandedAlert
          visible
          title="Oops"
          message={errorMsg}
          onClose={() => setErrorMsg(null)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: CIRCLE_PLAN.sectionGap,
    gap: CIRCLE_PLAN.cardGap,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: CIRCLE_PLAN.chipGap,
    paddingVertical: CIRCLE_PLAN.cardPadV,
    paddingHorizontal: CIRCLE_PLAN.cardPadH,
    borderRadius: CIRCLE_PLAN.cardRadius,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  rowBody: { flex: 1 },
  rowTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.darkWarm,
    marginBottom: 2,
  },
  rowSub: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    lineHeight: 18,
  },
});
