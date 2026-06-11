/**
 * InvitePeopleSection - the composer's unified INVITE PEOPLE section
 * (composer-invite-section-spec.md). Presentational: the composer owns the data
 * (merged your-people + want-in suggestions), the invited chips, and the dismiss/
 * undo + invite-on-post wiring. This renders:
 *   - header + sub-line (always, as the invite entry point)
 *   - a removable chips row of people already on the plan
 *   - want-in suggestion rows ONLY (they raised a hand, so showing them is
 *     responsive): provenance, gold Invite pill, quiet dismiss x. "See more"
 *     past the first 6.
 *   - a neutral "+ Add from your people" affordance (the app never volunteers
 *     names of people who did NOT opt in; the user pulls the list). Reactance fix,
 *     composer-invite-section-spec.md "Suggestions list" (amended 2026-06-10).
 */
import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { X, UserPlus } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { COPY } from '../yours/state/constants';

export interface InviteChip {
  user_id: string;
  name: string;
  photo: string | null;
}

export interface InviteSuggestion {
  user_id: string;
  name: string;
  photo: string | null;
  /** Want-in provenance line ("said they'd go next time · {title}"); absent for your-people. */
  provenance?: string;
  isWantIn: boolean;
}

const AVATAR = 44;
const CHIP_AVATAR = 40;
const SUGGESTION_CAP = 6;

function initial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

// Gold invite pill, extracted so each row's pill carries its own pressed state
// (it renders inside a .map, so a shared hook won't do). iOS gets the opacity
// dim; Android keeps the ripple.
function InvitePill({ label, accessibilityLabel, onPress }: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      android_ripple={{ color: Colors.border }}
      style={[styles.invitePill, pressed && styles.invitePillPressed]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Text style={styles.invitePillText}>{label}</Text>
    </Pressable>
  );
}

function Avatar({ name, photo, size }: { name: string; photo: string | null; size: number }) {
  if (photo) {
    return <Image source={{ uri: photo }} style={{ width: size, height: size, borderRadius: size / 2 }} contentFit="cover" />;
  }
  return (
    <View style={[styles.avatarFallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={styles.avatarInitial}>{initial(name)}</Text>
    </View>
  );
}

export default function InvitePeopleSection({
  invited,
  suggestions,
  showAll,
  onToggleShowAll,
  onInvite,
  onRemoveChip,
  onDismiss,
  onAddFromPeople,
}: {
  invited: InviteChip[];
  suggestions: InviteSuggestion[];
  showAll: boolean;
  onToggleShowAll: () => void;
  onInvite: (s: InviteSuggestion) => void;
  onRemoveChip: (userId: string) => void;
  onDismiss: (s: InviteSuggestion) => void;
  onAddFromPeople: () => void;
}) {
  const visible = showAll ? suggestions : suggestions.slice(0, SUGGESTION_CAP);
  const hasMore = suggestions.length > SUGGESTION_CAP;
  const [addPressed, setAddPressed] = useState(false);

  return (
    <View style={styles.section}>
      <Text style={styles.header}>{COPY.inviteSectionHeader}</Text>
      <Text style={styles.sub}>{COPY.inviteSectionSub}</Text>

      {invited.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          {invited.map((c) => (
            <View key={c.user_id} style={styles.chip}>
              <Avatar name={c.name} photo={c.photo} size={CHIP_AVATAR} />
              <Text style={styles.chipName} numberOfLines={1}>{c.name}</Text>
              <Pressable
                onPress={() => onRemoveChip(c.user_id)}
                hitSlop={10}
                style={styles.chipX}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${c.name}`}
              >
                <X size={12} color={Colors.white} strokeWidth={2.5} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}

      {visible.map((s) => (
        <View key={s.user_id} style={styles.row}>
          <Avatar name={s.name} photo={s.photo} size={AVATAR} />
          <View style={styles.rowText}>
            <Text style={styles.rowName} numberOfLines={1}>{s.name}</Text>
            {!!s.provenance && (
              <Text style={styles.rowProvenance} numberOfLines={1}>{s.provenance}</Text>
            )}
          </View>
          {s.isWantIn && (
            <Pressable
              onPress={() => onDismiss(s)}
              hitSlop={16}
              style={styles.dismiss}
              accessibilityRole="button"
              accessibilityLabel={`Dismiss ${s.name}`}
            >
              <X size={16} color={Colors.tertiary} strokeWidth={2} />
            </Pressable>
          )}
          <InvitePill
            label={COPY.invitePill}
            accessibilityLabel={`${COPY.invitePill} ${s.name}`}
            onPress={() => onInvite(s)}
          />
        </View>
      ))}

      {hasMore && !showAll && (
        <Pressable onPress={onToggleShowAll} style={styles.seeMore} accessibilityRole="button">
          <Text style={styles.seeMoreText}>{COPY.inviteSeeMore}</Text>
        </Pressable>
      )}

      {/* Pull, not push: the user summons their people; the app never lists names
          of people who did not opt in. */}
      <Pressable
        onPress={onAddFromPeople}
        onPressIn={() => setAddPressed(true)}
        onPressOut={() => setAddPressed(false)}
        android_ripple={{ color: Colors.border }}
        style={[styles.addFromPeople, addPressed && styles.addFromPeoplePressed]}
        accessibilityRole="button"
        accessibilityLabel={COPY.inviteAddFromPeople}
      >
        <UserPlus size={18} color={Colors.terracotta} strokeWidth={1.75} />
        <Text style={styles.addFromPeopleText}>{COPY.inviteAddFromPeople}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 24 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.brandSoft },
  avatarInitial: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  header: {
    fontSize: FontSizes.bodyMD,
    fontFamily: Fonts.sansMedium,
    color: Colors.textMedium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  sub: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    lineHeight: LineHeights.bodySM,
    color: Colors.textLight,
    marginBottom: 12,
  },
  chipsRow: { gap: 12, paddingVertical: 4, paddingRight: 8 },
  chip: { alignItems: 'center', width: 64 },
  chipName: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.secondary,
    marginTop: 4,
    maxWidth: 64,
  },
  chipX: {
    position: 'absolute',
    top: -2,
    right: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.darkWarm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyLG, color: Colors.darkWarm },
  rowProvenance: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    marginTop: 2,
  },
  dismiss: { padding: 4 },
  invitePill: {
    backgroundColor: Colors.goldAccent,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  invitePillPressed: { opacity: 0.8 },
  invitePillText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.darkWarm },
  seeMore: { paddingVertical: 10, alignItems: 'center' },
  seeMoreText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  addFromPeople: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    marginTop: 4,
  },
  addFromPeoplePressed: { opacity: 0.7 },
  addFromPeopleText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
});
