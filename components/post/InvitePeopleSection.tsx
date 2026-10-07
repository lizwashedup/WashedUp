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
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { X, UserPlus } from 'lucide-react-native';
import Colors, { AfterglowColors } from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights, AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';
import { COPY } from '../yours/state/constants';

export interface InviteChip {
  user_id: string;
  name: string;
  photo: string | null;
  handle?: string | null;
}

export interface InviteSuggestion {
  user_id: string;
  name: string;
  photo: string | null;
  handle?: string | null;
  /** Want-in provenance line ("said they'd go next time · {title}"); absent for your-people. */
  provenance?: string;
  isWantIn: boolean;
}

type Appearance = { fonts: AfterglowFontFamilies };
const displayHandle = (handle?: string | null) => handle?.trim().replace(/^@+/, '') || '';

const AVATAR = 44;
const CHIP_AVATAR = 40;
const SUGGESTION_CAP = 6;

function initial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

// Gold invite pill, extracted so each row's pill carries its own pressed state
// (it renders inside a .map, so a shared hook won't do). iOS gets the opacity
// dim; Android keeps the ripple.
function InvitePill({ label, accessibilityLabel, onPress, appearance }: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  appearance?: Appearance;
}) {
  const styles = useMemo(() => appearance ? { ...baseStyles, ...afterglow(appearance.fonts) } : baseStyles, [appearance]);
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
      <Text style={styles.invitePillText} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

function Avatar({ name, photo, size, appearance }: { name: string; photo: string | null; size: number; appearance?: Appearance }) {
  const [failed, setFailed] = useState(false);
  const styles = useMemo(() => appearance ? { ...baseStyles, ...afterglow(appearance.fonts) } : baseStyles, [appearance]);
  if (photo && (!appearance || !failed)) {
    return <Image source={{ uri: photo }} style={{ width: size, height: size, borderRadius: size / 2 }} contentFit="cover" onError={appearance ? () => setFailed(true) : undefined} />;
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
  appearance,
}: {
  invited: InviteChip[];
  suggestions: InviteSuggestion[];
  showAll: boolean;
  onToggleShowAll: () => void;
  onInvite: (s: InviteSuggestion) => void;
  onRemoveChip: (userId: string) => void;
  onDismiss: (s: InviteSuggestion) => void;
  onAddFromPeople: () => void;
  appearance?: Appearance;
}) {
  const styles = useMemo(() => appearance ? { ...baseStyles, ...afterglow(appearance.fonts) } : baseStyles, [appearance]);
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
              <Avatar key={JSON.stringify([c.user_id, c.photo])} name={c.name} photo={c.photo} size={appearance ? 32 : CHIP_AVATAR} appearance={appearance} />
              {appearance ? <View style={styles.chipIdentity}><Text style={styles.chipName} numberOfLines={1}>{c.name}</Text>{!!displayHandle(c.handle) && <Text style={styles.handle} numberOfLines={1}>@{displayHandle(c.handle)}</Text>}</View> : <Text style={styles.chipName} numberOfLines={1}>{c.name}</Text>}
              <Pressable
                onPress={() => onRemoveChip(c.user_id)}
                hitSlop={10}
                style={styles.chipX}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${c.name}${appearance && displayHandle(c.handle) ? `, @${displayHandle(c.handle)}` : ''}`}
              >
                <X size={appearance ? 16 : 12} color={appearance ? AfterglowColors.muted : Colors.white} strokeWidth={2.5} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}

      {visible.map((s) => (
        <View key={s.user_id} style={styles.row}>
          <Avatar key={JSON.stringify([s.user_id, s.photo])} name={s.name} photo={s.photo} size={AVATAR} appearance={appearance} />
          <View style={styles.rowText}>
            <Text style={styles.rowName} numberOfLines={appearance ? undefined : 1}>{s.name}</Text>
            {appearance && !!displayHandle(s.handle) && <Text style={styles.handle} numberOfLines={1}>@{displayHandle(s.handle)}</Text>}
            {!!s.provenance && (
              <Text style={styles.rowProvenance} numberOfLines={appearance ? undefined : 1}>{s.provenance}</Text>
            )}
          </View>
          {s.isWantIn && (
            <Pressable
              onPress={() => onDismiss(s)}
              hitSlop={16}
              style={styles.dismiss}
              accessibilityRole="button"
              accessibilityLabel={`Dismiss ${s.name}${appearance && displayHandle(s.handle) ? `, @${displayHandle(s.handle)}` : ''}`}
            >
              <X size={16} color={appearance ? AfterglowColors.muted : Colors.tertiary} strokeWidth={2} />
            </Pressable>
          )}
          <InvitePill
            label={COPY.invitePill}
            accessibilityLabel={`${COPY.invitePill} ${s.name}${appearance && displayHandle(s.handle) ? `, @${displayHandle(s.handle)}` : ''}`}
            appearance={appearance}
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
        <UserPlus size={18} color={appearance ? AfterglowColors.clay : Colors.terracotta} strokeWidth={1.75} />
        <Text style={styles.addFromPeopleText}>{COPY.inviteAddFromPeople}</Text>
      </Pressable>
    </View>
  );
}

const baseStyles = StyleSheet.create({
  section: { marginBottom: 24 },
  chipIdentity: { minWidth: 0, flexShrink: 1 },
  handle: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.secondary },
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

function afterglow(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  header: { ...AfterglowType.contextTitle, fontFamily: fonts.semibold, color: AfterglowColors.ink, marginBottom: 4 },
  sub: { ...baseStyles.sub, ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted },
  avatarFallback: { ...baseStyles.avatarFallback, backgroundColor: AfterglowColors.avatar },
  avatarInitial: { ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.muted },
  chipsRow: { ...baseStyles.chipsRow, gap: 8, paddingBottom: 12 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 8, minHeight: 52, maxWidth: 240, borderRadius: 4, borderWidth: 1, borderColor: AfterglowColors.subtleLine },
  chipName: { ...AfterglowType.body, fontFamily: fonts.medium, color: AfterglowColors.ink, flexShrink: 1 },
  chipX: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  row: { ...baseStyles.row, gap: 8, minHeight: 72, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: AfterglowColors.subtleLine },
  rowName: { ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.ink },
  handle: { ...AfterglowType.caption, fontFamily: fonts.regular, color: AfterglowColors.muted },
  rowProvenance: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted, marginTop: 2 },
  dismiss: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  invitePill: { ...baseStyles.invitePill, minHeight: 44, borderRadius: 4, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  invitePillText: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.ink },
  seeMore: { ...baseStyles.seeMore, minHeight: 44, justifyContent: 'center' },
  seeMoreText: { ...AfterglowType.body, fontFamily: fonts.medium, color: AfterglowColors.clay },
  addFromPeople: { ...baseStyles.addFromPeople, minHeight: 44 },
  addFromPeopleText: { ...AfterglowType.body, fontFamily: fonts.medium, color: AfterglowColors.clay, flexShrink: 1 },
}); }
