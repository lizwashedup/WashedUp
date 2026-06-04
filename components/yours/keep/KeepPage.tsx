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
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft, MoreHorizontal, Bell, CalendarPlus } from 'lucide-react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { COPY } from '../state/constants';
import { hapticSelection } from '../../../lib/haptics';
import { useProfileCard } from '../../../hooks/useProfileCard';
import { useMyFace } from '../../../hooks/useMyFace';
import {
  usePeopleConnectionMutations,
  friendlyConnectionError,
} from '../../../hooks/usePeopleConnectionMutations';
import KeepHero from './KeepHero';
import StoryTimeline from './StoryTimeline';

/** Shared top bar: back, plus an optional overflow (full cards only). */
function TopBar({ onMore }: { onMore?: () => void }) {
  return (
    <View style={styles.topBar}>
      <Pressable
        onPress={() => router.back()}
        hitSlop={12}
        style={styles.iconBtn}
        accessibilityRole="button"
        accessibilityLabel={COPY.keepBack}
      >
        <ChevronLeft size={24} color={Colors.asphalt} />
      </Pressable>
      {onMore ? (
        <Pressable
          onPress={onMore}
          hitSlop={12}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel={COPY.keepMore}
        >
          <MoreHorizontal size={22} color={Colors.asphalt} />
        </Pressable>
      ) : (
        <View style={styles.iconBtn} />
      )}
    </View>
  );
}

/**
 * The "you & [name]" keep page: a shared story between two people, not a
 * profile. The spine of the retention layer (tap a face in People to open
 * it). Full when connected; a graceful minimal view otherwise.
 */
export default function KeepPage({
  userId,
  targetId,
}: {
  userId: string;
  targetId: string;
}) {
  const { data: card, isLoading } = useProfileCard(userId, targetId);
  const { data: myFace } = useMyFace(userId);
  const { sendRequest, remove, setVisibility, ping } =
    usePeopleConnectionMutations(userId);

  const name = card?.first_name_display ?? 'them';

  const openMore = () => {
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
                router.back();
              },
            },
          ]),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const nextShared = card?.upcoming?.[0] ?? null;

  const onPing = () => {
    if (!card || !nextShared) return;
    hapticSelection();
    ping.mutate(
      { recipientId: card.user_id, eventId: nextShared.event_id },
      {
        onSuccess: () => Alert.alert('', COPY.keepPingSent(name)),
        onError: (e) => Alert.alert('', friendlyConnectionError(e)),
      },
    );
  };

  const onInvite = () => {
    hapticSelection();
    // Mirrors the profile sheet: routes to plans. A picker pre-attached to
    // this person is a follow-up.
    router.push('/(tabs)/plans' as never);
  };

  if (isLoading || !card) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <TopBar />
        <View style={styles.center}>
          <ActivityIndicator color={Colors.terracotta} />
        </View>
      </SafeAreaView>
    );
  }

  // Not (yet) connected: a quiet add prompt rather than the full story.
  if (card.kind === 'minimal') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <TopBar />
        <View style={styles.minimal}>
          <KeepHero
            myName={myFace?.first_name_display ?? null}
            myPhoto={myFace?.profile_photo_url ?? null}
            theirName={card.first_name_display}
            theirPhoto={card.profile_photo_url}
            plansCount={card.shared_count}
            albumsCount={0}
            comingUpCount={0}
            sinceDate={null}
          />
          <Pressable
            style={styles.primaryBtn}
            onPress={async () => {
              try {
                await sendRequest.mutateAsync({
                  recipientId: card.user_id,
                  context: 'handle_lookup',
                });
                router.back();
              } catch (e) {
                Alert.alert('', friendlyConnectionError(e));
              }
            }}
          >
            <Text style={styles.primaryText}>{COPY.requestAdd}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <TopBar onMore={openMore} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        <KeepHero
          myName={myFace?.first_name_display ?? null}
          myPhoto={myFace?.profile_photo_url ?? null}
          theirName={card.first_name_display}
          theirPhoto={card.profile_photo_url}
          plansCount={card.shared_count}
          albumsCount={card.adventures?.length ?? 0}
          comingUpCount={card.upcoming?.length ?? 0}
          sinceDate={card.since_date}
        />

        <View style={styles.actions}>
          {!!nextShared && (
            <Pressable
              style={[styles.actionBtn, styles.actionGold]}
              onPress={onPing}
              accessibilityRole="button"
              accessibilityLabel={`${COPY.keepPing} ${name}`}
            >
              <Bell size={16} color={Colors.asphalt} />
              <Text style={styles.actionGoldText}>{COPY.keepPing}</Text>
            </Pressable>
          )}
          <Pressable
            style={[styles.actionBtn, styles.actionPrimary]}
            onPress={onInvite}
            accessibilityRole="button"
            accessibilityLabel={COPY.keepInvite}
          >
            <CalendarPlus size={16} color={Colors.white} />
            <Text style={styles.actionPrimaryText}>{COPY.keepInvite}</Text>
          </Pressable>
        </View>

        {!!card.upcoming?.length && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{COPY.keepComingUpTogether}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {card.upcoming.map((u) => (
                <Pressable
                  key={u.event_id}
                  style={styles.upPill}
                  onPress={() => router.push(`/plan/${u.event_id}` as never)}
                >
                  <Text style={styles.upText} numberOfLines={1}>
                    {u.title}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{COPY.keepStorySoFar}</Text>
          <StoryTimeline
            adventures={card.adventures ?? []}
            theirName={card.first_name_display}
          />
        </View>

        <Text style={styles.closing}>{COPY.keepClosing}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  iconBtn: { padding: 8, minWidth: 40 },
  scroll: { paddingBottom: 48 },
  minimal: { paddingHorizontal: 24, gap: 8 },

  actions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    marginTop: 22,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 999,
    paddingVertical: 14,
  },
  actionPrimary: { backgroundColor: Colors.terracotta },
  actionPrimaryText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.white,
  },
  // Gold = low-pressure "warm nudge", in deliberate contrast to the
  // terracotta "do this now" invite. Documented gold-button exception in
  // CLAUDE.md (same framing as the "I'd go next time" button).
  actionGold: { backgroundColor: Colors.goldAccent },
  actionGoldText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },

  section: { marginTop: 28, gap: 12 },
  sectionLabel: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    paddingHorizontal: 20,
  },
  upPill: {
    backgroundColor: Colors.goldenAmberTint15,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginLeft: 20,
    maxWidth: 240,
  },
  upText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.asphalt,
  },

  closing: {
    fontFamily: Fonts.displayItalic,
    fontSize: FontSizes.displaySM,
    color: Colors.tertiary,
    textAlign: 'center',
    marginTop: 32,
    paddingHorizontal: 24,
  },

  primaryBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 28,
  },
  primaryText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.white,
  },
});
