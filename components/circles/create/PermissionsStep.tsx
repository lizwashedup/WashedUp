/**
 * PermissionsStep - step 3: who can add people, the spec's role-based admin
 * model. only_me (creator-only admin), chosen (pick admins from the members you
 * just selected), or everyone (the network-extension mode: any member can add
 * someone you don't know). 'everyone' maps to update_circle set-all-admins;
 * 'chosen' maps to promote.
 */
import React from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Check } from 'lucide-react-native';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { Fonts, FontSizes, LineHeights, AfterglowType, type AfterglowFontFamilies } from '../../../constants/Typography';
import { CIRCLE_CREATE, TYPE } from '../../../constants/YoursDesign';
import { COPY } from '../../yours/state/constants';
import { hapticSelection } from '../../../lib/haptics';
import type { CircleInvitePolicy } from '../../../lib/circles/types';
import CreationPersonPhoto from './CreationPersonPhoto';
import type { YoursGridPerson } from '../../../lib/yours/types';

const OPTIONS: ReadonlyArray<{ key: CircleInvitePolicy; title: string; sub: string }> = [
  { key: 'only_me', title: COPY.circlePolicyOnlyMe, sub: COPY.circlePolicyOnlyMeSub },
  { key: 'chosen', title: COPY.circlePolicyChosen, sub: COPY.circlePolicyChosenSub },
  { key: 'everyone', title: COPY.circlePolicyEveryone, sub: COPY.circlePolicyEveryoneSub },
];

function nameOf(p: YoursGridPerson): string {
  return p.first_name_display?.trim() || p.handle?.trim() || 'Someone';
}

export default function PermissionsStep({
  circleName,
  policy,
  onPolicy,
  selectedPeople,
  adminIds,
  onToggleAdmin,
  appearance,
}: {
  circleName?: string;
  policy: CircleInvitePolicy;
  onPolicy: (p: CircleInvitePolicy) => void;
  selectedPeople: YoursGridPerson[];
  adminIds: Set<string>;
  onToggleAdmin: (id: string) => void;
  appearance?: { fonts: AfterglowFontFamilies };
}) {
  const styled = appearance ? { ...styles, ...afterglow(appearance.fonts) } : styles;
  return (
    <ScrollView contentContainerStyle={styled.wrap} showsVerticalScrollIndicator={false}>
      {/* The circle you just built, as a warm summary above the last choice. */}
      {!!circleName && (
        <View style={styled.summary}>
          <Text style={styled.summaryName} numberOfLines={appearance ? undefined : 2}>{circleName}</Text>
          <Text style={styled.summarySub}>{COPY.circleStep3Summary(selectedPeople.length)}</Text>
        </View>
      )}
      <Text style={styled.title}>{COPY.circleStep3Title}</Text>

      {OPTIONS.map((opt) => {
        const on = policy === opt.key;
        return (
          <Pressable
            key={opt.key}
            onPress={() => {
              hapticSelection();
              onPolicy(opt.key);
            }}
            style={[styled.option, on && styled.optionOn]}
            accessibilityRole="radio"
            accessibilityLabel={opt.title}
            accessibilityState={{ selected: on }}
          >
            <View style={styled.optionBody}>
              <Text style={styled.optionTitle}>{opt.title}</Text>
              <Text style={styled.optionSub}>{opt.sub}</Text>
            </View>
            <View style={[styled.radio, on && styled.radioOn]}>
              {on && <View style={styled.radioDot} />}
            </View>
          </Pressable>
        );
      })}

      {policy === 'chosen' && (
        <View style={styled.chosen}>
          <Text style={styled.chosenLabel}>{appearance ? 'Who else can add people' : COPY.circleChosenAdminsLabel}</Text>
          {selectedPeople.map((p) => {
            const on = adminIds.has(p.user_id);
            const name = nameOf(p);
            const handle = p.handle?.trim().replace(/^@+/, '');
            return (
              <Pressable
                key={p.user_id}
                onPress={() => {
                  hapticSelection();
                  onToggleAdmin(p.user_id);
                }}
                style={styled.adminRow}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={handle ? `${name}, @${handle}` : name}
              >
                {appearance ? <CreationPersonPhoto person={p} fonts={appearance.fonts}/> : p.profile_photo_url ? (
                  <Image source={{ uri: p.profile_photo_url }} style={styled.adminAvatar} />
                ) : (
                  <View style={[styled.adminAvatar, styled.adminAvatarFallback]}>
                    <Text style={styled.adminInitial}>{name[0]?.toUpperCase() ?? '?'}</Text>
                  </View>
                )}
                <View style={styled.adminIdentity}>
                  <Text style={styled.adminName} numberOfLines={appearance ? undefined : 1}>
                    {name}
                  </Text>
                  {!!handle && <Text style={styled.adminHandle} numberOfLines={1}>@{handle}</Text>}
                </View>
                <View style={[styled.check, on && styled.checkOn]}>
                  {on && <Check size={16} color={appearance ? AfterglowColors.white : Colors.white} strokeWidth={3} />}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 20 },
  summary: { alignItems: 'center', marginBottom: 24 },
  summaryName: {
    ...TYPE.heroDisplay,
    color: Colors.darkWarm,
    textAlign: 'center',
  },
  summarySub: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    marginTop: 6,
  },
  title: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displaySM,
    color: Colors.darkWarm,
    marginBottom: 16,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: CIRCLE_CREATE.optionRadius,
    paddingVertical: CIRCLE_CREATE.optionPadV,
    paddingHorizontal: CIRCLE_CREATE.optionPadH,
    backgroundColor: Colors.cardBg,
    borderWidth: 1.5,
    borderColor: Colors.border,
    marginBottom: 12,
  },
  optionOn: { borderColor: Colors.terracotta, backgroundColor: Colors.brandSoft },
  optionBody: { flex: 1, marginRight: 12 },
  optionTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.darkWarm },
  optionSub: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    lineHeight: LineHeights.bodySM,
    color: Colors.secondary,
    marginTop: 4,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: Colors.borderWarm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: Colors.terracotta },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: Colors.terracotta },
  chosen: { marginTop: 8 },
  chosenLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  adminRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 14 },
  adminAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.inputBg },
  adminAvatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.brandSoft },
  adminInitial: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  adminIdentity: { flex: 1, minWidth: 0, gap: 3 },
  adminName: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  adminHandle: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary },
  check: {
    width: CIRCLE_CREATE.pickCheck,
    height: CIRCLE_CREATE.pickCheck,
    borderRadius: CIRCLE_CREATE.pickCheck / 2,
    borderWidth: 1.5,
    borderColor: Colors.borderWarm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
});

function afterglow(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  summary: { marginBottom: 24, paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: AfterglowColors.line },
  summaryName: { ...AfterglowType.contextTitle, fontFamily: fonts.semibold, color: AfterglowColors.ink },
  summarySub: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted, marginTop: 4 },
  title: { ...AfterglowType.identity, fontFamily: fonts.display, color: AfterglowColors.ink, marginBottom: 20 },
  option: { ...styles.option, borderRadius: 4, borderWidth: 1, borderColor: AfterglowColors.line, backgroundColor: AfterglowColors.white, minHeight: 72 },
  optionOn: { borderColor: AfterglowColors.clay, backgroundColor: AfterglowColors.unread },
  optionTitle: { ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.ink },
  optionSub: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted, marginTop: 4 },
  radio: { ...styles.radio, borderColor: AfterglowColors.line },
  radioOn: { borderColor: AfterglowColors.clay }, radioDot: { ...styles.radioDot, backgroundColor: AfterglowColors.clay },
  chosenLabel: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.ink, marginBottom: 8 },
  adminRow: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: AfterglowColors.subtleLine },
  adminName: { ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.ink },
  adminHandle: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted },
  check: { ...styles.check, borderRadius: 4, borderColor: AfterglowColors.line },
  checkOn: { backgroundColor: AfterglowColors.clay, borderColor: AfterglowColors.clay },
}); }
