import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import {
  ChevronLeft,
  MoreHorizontal,
  MessageCircle,
  CalendarPlus,
  UserMinus,
  Flag,
} from 'lucide-react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { COPY } from '../state/constants';
import { hapticSelection } from '../../../lib/haptics';
import { buildComposerWithPerson } from '../../../lib/composerLink';
import { usePersonProfile } from '../../../hooks/usePersonProfile';
import { useGetOrCreateDm } from '../../../hooks/useGetOrCreateDm';
import { usePeopleConnectionMutations } from '../../../hooks/usePeopleConnectionMutations';
import { useBlock } from '../../../hooks/useBlock';
import { useQueryClient } from '@tanstack/react-query';
import { yoursKeys } from '../../../lib/yours/keys';
import { BrandedAlert } from '../../BrandedAlert';
import MenuCard, { type AnchorRect } from '../../menu/MenuCard';
import type {
  PersonProfileUpcoming,
  PersonProfilePast,
} from '../../../lib/yours/types';

/** "Sat, Jun 14", pinned to the LA clock plans live on (no dashes). */
function fmtDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

/** Back chevron always; overflow only when there is a real profile to act on. */
function TopBar({ onMore }: { onMore?: (anchor: AnchorRect) => void }) {
  const moreRef = useRef<View>(null);
  const press = () => {
    if (!onMore) return;
    moreRef.current?.measureInWindow((x, y, width, height) =>
      onMore({ x, y, width, height }),
    );
  };
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
          ref={moreRef}
          onPress={press}
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

function Avatar({ name, photoUrl }: { name: string | null; photoUrl: string | null }) {
  return (
    <View style={styles.avatar}>
      {photoUrl ? (
        <Image source={{ uri: photoUrl }} style={styles.avatarImg} contentFit="cover" />
      ) : (
        <Text style={styles.avatarInitial}>
          {(name ?? '?').trim().charAt(0).toUpperCase() || '?'}
        </Text>
      )}
    </View>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

function UpcomingRow({ row }: { row: PersonProfileUpcoming }) {
  const [pressed, setPressed] = useState(false);
  const date = fmtDate(row.start_time);
  return (
    <Pressable
      onPress={() => router.push(`/plan/${row.event_id}` as never)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[styles.planRow, pressed && styles.planRowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${row.title}. ${date}.`}
    >
      <View style={styles.dateDot} />
      <View style={styles.planText}>
        <Text style={styles.planTitle} numberOfLines={1}>
          {row.title}
        </Text>
        <Text style={styles.planMeta} numberOfLines={1}>
          {row.neighborhood ? `${date} · ${row.neighborhood}` : date}
        </Text>
      </View>
    </Pressable>
  );
}

function PastRow({ row }: { row: PersonProfilePast }) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={() => router.push(`/plan/${row.event_id}` as never)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[styles.planRow, pressed && styles.planRowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${row.title}. ${fmtDate(row.date)}.`}
    >
      <Text style={styles.pastDate}>{fmtDate(row.date)}</Text>
      <Text style={styles.pastTitle} numberOfLines={1}>
        {row.title}
      </Text>
    </Pressable>
  );
}

/**
 * The individual profile page ("just {name}"): the keep page's visual
 * language, solo. Mutuals-only and viewer-visible filtering are enforced by
 * get_person_profile server-side; the client never re-implements the gate, and
 * a null payload (denied / severed / nonexistent) renders an identical quiet
 * not-found. No albums (those are keep-page only). Source:
 * individual-profile-page-spec.md.
 */
export default function PersonProfilePage({
  userId,
  targetId,
}: {
  userId: string;
  targetId: string;
}) {
  const { data: profile, isLoading } = usePersonProfile(userId, targetId);
  const getOrCreateDm = useGetOrCreateDm();
  const { remove } = usePeopleConnectionMutations(userId);
  const { blockUser } = useBlock();
  const qc = useQueryClient();

  const [messagePressed, setMessagePressed] = useState(false);
  const [planPressed, setPlanPressed] = useState(false);
  const [moreAnchor, setMoreAnchor] = useState<AnchorRect | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [removeConfirmVisible, setRemoveConfirmVisible] = useState(false);

  const name = profile?.first_name_display ?? 'them';

  const onMessage = () => {
    if (!profile || getOrCreateDm.isPending) return;
    hapticSelection();
    getOrCreateDm.mutate(profile.user_id, {
      onSuccess: (circleId) => router.push(`/(tabs)/chats/circle/${circleId}` as never),
      onError: () => {},
    });
  };

  const onMakePlan = () => {
    if (!profile) return;
    hapticSelection();
    router.push(
      buildComposerWithPerson(profile.user_id, profile.first_name_display, profile.profile_photo_url) as never,
    );
  };

  const onMore = (anchor: AnchorRect) => {
    setMoreAnchor(anchor);
    setMoreOpen(true);
  };

  // Open the destructive confirm only after the MenuCard's dismiss animation
  // finishes, so two Modals never co-mount (the iOS present-while-dismissing
  // trap). The block flow uses a system Alert (not an RN Modal), so it is safe
  // to fire directly from the closing menu.
  const confirmRemove = () => setTimeout(() => setRemoveConfirmVisible(true), 180);
  const doRemove = () => {
    remove.mutate(targetId);
    qc.invalidateQueries({ queryKey: yoursKeys.personProfile(userId, targetId) });
    router.back();
  };
  const onReportBlock = () => blockUser(targetId, name, () => router.back());

  const goKeep = () => router.push(`/person/${targetId}` as never);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <TopBar />
        <View style={styles.center}>
          <ActivityIndicator color={Colors.terracotta} />
        </View>
      </SafeAreaView>
    );
  }

  // Null payload: denied (non-mutual / severed / blocked) or nonexistent. They
  // look identical by design (no teaser, no explanation, no red).
  if (!profile) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <TopBar />
        <View style={styles.center}>
          <Text style={styles.notFound}>{COPY.ppNotFound}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const hasUpcoming = profile.upcoming.length > 0;
  const hasPast = profile.past.length > 0;
  const isBrandNew = profile.upcoming_count === 0 && profile.past_total === 0;
  const moreInPast = profile.past_total - profile.past.length;

  // Stats line, anti-zero: drop any zero, render nothing if both are zero.
  const statParts: string[] = [];
  if (profile.past_total > 0) statParts.push(COPY.ppStatPlans(profile.past_total));
  if (profile.upcoming_count > 0) statParts.push(COPY.ppStatComingUp(profile.upcoming_count));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <TopBar onMore={onMore} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Avatar name={profile.first_name_display} photoUrl={profile.profile_photo_url} />
        <Text style={styles.name}>{name}</Text>

        <View style={styles.actions}>
          <Pressable
            style={[styles.actionBtn, styles.actionGold, messagePressed && styles.actionPressed, getOrCreateDm.isPending && styles.actionDisabled]}
            onPress={onMessage}
            onPressIn={() => setMessagePressed(true)}
            onPressOut={() => setMessagePressed(false)}
            disabled={getOrCreateDm.isPending}
            accessibilityRole="button"
            accessibilityState={{ disabled: getOrCreateDm.isPending }}
            accessibilityLabel={`${COPY.keepMessage} ${name}`}
          >
            {getOrCreateDm.isPending ? (
              <ActivityIndicator color={Colors.asphalt} />
            ) : (
              <>
                <MessageCircle size={16} color={Colors.asphalt} />
                <Text style={styles.actionGoldText}>{COPY.keepMessage}</Text>
              </>
            )}
          </Pressable>
          <Pressable
            style={[styles.actionBtn, styles.actionPrimary, planPressed && styles.actionPressed]}
            onPress={onMakePlan}
            onPressIn={() => setPlanPressed(true)}
            onPressOut={() => setPlanPressed(false)}
            accessibilityRole="button"
            accessibilityLabel={COPY.keepMakePlan}
          >
            <CalendarPlus size={16} color={Colors.white} />
            <Text style={styles.actionPrimaryText}>{COPY.keepMakePlan}</Text>
          </Pressable>
        </View>

        {/* The two pages point at each other. */}
        <Pressable onPress={goKeep} hitSlop={8} style={styles.keepLink} accessibilityRole="button">
          <Text style={styles.keepLinkText}>{COPY.ppKeepLink(name)}</Text>
        </Pressable>

        {isBrandNew ? (
          <View style={styles.emptyBlock}>
            <Text style={styles.emptyHeadline}>{COPY.ppBrandNew(name)}</Text>
          </View>
        ) : (
          <>
            {hasUpcoming && (
              <View style={styles.section}>
                <SectionLabel>{COPY.profileComingUp}</SectionLabel>
                {profile.upcoming.map((u) => (
                  <UpcomingRow key={u.event_id} row={u} />
                ))}
              </View>
            )}

            {hasPast && (
              <View style={styles.section}>
                <SectionLabel>{COPY.ppStorySoFar}</SectionLabel>
                {profile.past.map((p) => (
                  <PastRow key={p.event_id} row={p} />
                ))}
                {moreInPast > 0 && (
                  <Text style={styles.moreCount}>{`and ${moreInPast} more`}</Text>
                )}
              </View>
            )}

            {statParts.length > 0 && (
              <Text style={styles.stats}>{statParts.join(' · ')}</Text>
            )}
          </>
        )}
      </ScrollView>

      <MenuCard
        visible={moreOpen}
        onClose={() => setMoreOpen(false)}
        anchor={moreAnchor}
        placement="top-right"
        rows={[
          {
            key: 'message',
            icon: MessageCircle,
            label: COPY.menuMessage,
            subtitle: COPY.menuMessageSub,
            onPress: onMessage,
          },
          {
            key: 'plan',
            icon: CalendarPlus,
            label: COPY.menuMakePlan,
            subtitle: COPY.menuMakePlanSub,
            onPress: onMakePlan,
          },
          {
            key: 'remove',
            icon: UserMinus,
            label: COPY.profileRemove,
            subtitle: COPY.profileRemoveSub,
            muted: true,
            dividerBefore: true,
            onPress: confirmRemove,
          },
          {
            key: 'report',
            icon: Flag,
            label: COPY.ppReport,
            subtitle: COPY.ppReportSub,
            muted: true,
            onPress: onReportBlock,
          },
        ]}
      />

      <BrandedAlert
        visible={removeConfirmVisible}
        title={COPY.profileRemove}
        message={COPY.removeConfirm}
        buttons={[
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: doRemove },
        ]}
        onClose={() => setRemoveConfirmVisible(false)}
      />
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
  scroll: { paddingBottom: 48, paddingTop: 8 },

  notFound: {
    fontFamily: Fonts.displayItalic,
    fontSize: FontSizes.displaySM,
    color: Colors.tertiary,
  },

  avatar: {
    width: 104,
    height: 104,
    borderRadius: 52,
    alignSelf: 'center',
    backgroundColor: Colors.brandSoft,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitial: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displayLG,
    color: Colors.terracotta,
  },
  name: {
    fontFamily: Fonts.displayItalic,
    fontSize: FontSizes.displayLG,
    color: Colors.terracotta,
    textAlign: 'center',
    marginTop: 14,
  },

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
  actionDisabled: { opacity: 0.55 },
  actionPressed: { opacity: 0.8 },
  actionPrimary: { backgroundColor: Colors.terracotta },
  actionPrimaryText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.white,
  },
  // Gold = the low-pressure "warm nudge" (documented gold-button exception in
  // CLAUDE.md), in deliberate contrast to the terracotta "do this now".
  actionGold: { backgroundColor: Colors.goldAccent },
  actionGoldText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },

  keepLink: { alignSelf: 'center', marginTop: 16, paddingVertical: 4 },
  keepLinkText: {
    fontFamily: Fonts.displayItalic,
    fontSize: FontSizes.bodyLG,
    color: Colors.secondary,
  },

  section: { marginTop: 28 },
  sectionLabel: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 12,
  },
  planRowPressed: { backgroundColor: Colors.warmTint },
  dateDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.terracotta,
  },
  planText: { flex: 1, minWidth: 0 },
  planTitle: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
  },
  planMeta: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    marginTop: 2,
  },
  pastDate: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.tertiary,
    width: 92,
  },
  pastTitle: {
    flex: 1,
    minWidth: 0,
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  moreCount: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.tertiary,
    paddingHorizontal: 20,
    marginTop: 8,
  },

  stats: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.tertiary,
    textAlign: 'center',
    marginTop: 32,
  },

  emptyBlock: { alignItems: 'center', marginTop: 36, paddingHorizontal: 32 },
  emptyHeadline: {
    fontFamily: Fonts.displayItalic,
    fontSize: FontSizes.displaySM,
    color: Colors.secondary,
    textAlign: 'center',
  },
});
