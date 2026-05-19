import React from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { Settings } from 'lucide-react-native';
import { router } from 'expo-router';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import BottomSheet from '../primitives/BottomSheet';
import YoursAvatar from '../primitives/YoursAvatar';
import MilestoneArc from '../primitives/MilestoneArc';
import { COPY } from '../state/constants';
import { useProfileCard } from '../../../hooks/useProfileCard';
import {
  usePeopleConnectionMutations,
  friendlyConnectionError,
} from '../../../hooks/usePeopleConnectionMutations';

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

/** Reading-surface profile card. Full when connected, else minimal. */
export default function ProfileCardSheet({
  visible,
  onClose,
  userId,
  targetId,
}: {
  visible: boolean;
  onClose: () => void;
  userId: string;
  targetId: string | null;
}) {
  const { data: card, isLoading } = useProfileCard(userId, targetId);
  const { sendRequest, remove, setVisibility } =
    usePeopleConnectionMutations(userId);

  const openGear = () => {
    if (!card) return;
    Alert.alert(card.first_name_display ?? 'This person', undefined, [
      {
        text: COPY.privacyToggle(card.first_name_display ?? 'them'),
        onPress: () =>
          setVisibility.mutate({ personId: card.user_id, hidden: true }),
      },
      {
        text: COPY.profileRemove,
        style: 'destructive',
        onPress: () =>
          Alert.alert('', COPY.removeConfirm, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: COPY.profileRemove,
              style: 'destructive',
              onPress: () => {
                remove.mutate(card.user_id);
                onClose();
              },
            },
          ]),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} heightPct={0.8}>
      {isLoading || !card ? (
        <ActivityIndicator
          color={Colors.terracotta}
          style={{ marginVertical: 48 }}
        />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          {card.kind === 'full' && (
            <Pressable
              style={styles.gear}
              onPress={openGear}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Settings"
            >
              <Settings size={20} color={Colors.tertiary} />
            </Pressable>
          )}

          <View style={styles.header}>
            <YoursAvatar
              name={card.first_name_display}
              photoUrl={card.profile_photo_url}
              size={120}
              bucket="none"
            />
            <Text style={styles.name}>
              {card.first_name_display ?? 'Someone'}
            </Text>
            <Text style={styles.summary}>
              {card.shared_count > 0
                ? `${COPY.backlogPlansTogether(card.shared_count)}${
                    card.since_date ? `, since ${fmtDate(card.since_date)}` : ''
                  }`
                : ''}
            </Text>
          </View>

          {card.kind === 'minimal' ? (
            <Pressable
              style={styles.primaryBtn}
              onPress={async () => {
                try {
                  await sendRequest.mutateAsync({
                    recipientId: card.user_id,
                    context: 'handle_lookup',
                  });
                  onClose();
                } catch (e) {
                  Alert.alert('', friendlyConnectionError(e));
                }
              }}
            >
              <Text style={styles.primaryText}>{COPY.requestAdd}</Text>
            </Pressable>
          ) : (
            <>
              {!!card.upcoming?.length && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>
                    {COPY.profileComingUp}
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {card.upcoming.map((u) => (
                      <Pressable
                        key={u.event_id}
                        style={styles.upPill}
                        onPress={() =>
                          router.push(`/plan/${u.event_id}` as never)
                        }
                      >
                        <Text style={styles.upText}>{u.title}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              )}

              {!!card.adventures?.length && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>
                    {COPY.profileAdventures}
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {card.adventures.map((a) => (
                      <Pressable
                        key={a.album_id}
                        style={styles.thumb}
                        onPress={() =>
                          router.push(`/album/${a.event_id}` as never)
                        }
                      >
                        {a.thumb_url ? (
                          <Image
                            source={{ uri: a.thumb_url }}
                            style={styles.thumbImg}
                            contentFit="cover"
                          />
                        ) : (
                          <View
                            style={[styles.thumbImg, styles.thumbBlank]}
                          />
                        )}
                        <Text style={styles.thumbLabel} numberOfLines={1}>
                          {a.title}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              )}

              <View style={styles.milestone}>
                <MilestoneArc
                  sharedCount={card.shared_count}
                  milestone={card.milestone}
                />
              </View>

              {/* Invite-to-a-plan reuses the existing plan-invite flow on
                  the plan screen; routed there with the target preselected.
                  Full picker is a follow-up. */}
              <Pressable
                style={styles.primaryBtn}
                onPress={() => {
                  onClose();
                  router.push('/(tabs)/plans' as never);
                }}
              >
                <Text style={styles.primaryText}>
                  {COPY.profileInviteToPlan}
                </Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  gear: { position: 'absolute', right: 4, top: 0, zIndex: 2, padding: 8 },
  header: { alignItems: 'center', gap: 8, paddingVertical: 8 },
  name: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.displayMD,
    color: Colors.asphalt,
  },
  summary: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.secondary,
  },
  section: { marginTop: 20, gap: 10 },
  sectionTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  upPill: {
    backgroundColor: Colors.goldenAmberTint15,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
  },
  upText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.asphalt,
  },
  thumb: { width: 80, marginRight: 10 },
  thumbImg: { width: 80, height: 80, borderRadius: 10 },
  thumbBlank: { backgroundColor: Colors.inputBg },
  thumbLabel: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.micro,
    color: Colors.secondary,
    marginTop: 4,
  },
  milestone: { alignItems: 'center', marginTop: 28 },
  primaryBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 28,
    marginBottom: 8,
  },
  primaryText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.white,
  },
});
