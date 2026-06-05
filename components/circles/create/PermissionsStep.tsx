/**
 * PermissionsStep — step 3: who can add people, the spec's role-based admin
 * model. only_me (creator-only admin), chosen (pick admins from the members you
 * just selected), or everyone (the network-extension mode: any member can add
 * someone you don't know). 'everyone' maps to update_circle set-all-admins;
 * 'chosen' maps to promote.
 */
import React from 'react';
import { ScrollView, View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { Check } from 'lucide-react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../../constants/Typography';
import { CIRCLE_CREATE } from '../../../constants/YoursDesign';
import { COPY } from '../../yours/state/constants';
import { hapticSelection } from '../../../lib/haptics';
import type { CircleInvitePolicy } from '../../../lib/circles/types';
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
  policy,
  onPolicy,
  selectedPeople,
  adminIds,
  onToggleAdmin,
}: {
  policy: CircleInvitePolicy;
  onPolicy: (p: CircleInvitePolicy) => void;
  selectedPeople: YoursGridPerson[];
  adminIds: Set<string>;
  onToggleAdmin: (id: string) => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.wrap} showsVerticalScrollIndicator={false}>
      <Text style={styles.title}>{COPY.circleStep3Title}</Text>

      {OPTIONS.map((opt) => {
        const on = policy === opt.key;
        return (
          <Pressable
            key={opt.key}
            onPress={() => {
              hapticSelection();
              onPolicy(opt.key);
            }}
            style={[styles.option, on && styles.optionOn]}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
          >
            <View style={styles.optionBody}>
              <Text style={styles.optionTitle}>{opt.title}</Text>
              <Text style={styles.optionSub}>{opt.sub}</Text>
            </View>
            <View style={[styles.radio, on && styles.radioOn]}>
              {on && <View style={styles.radioDot} />}
            </View>
          </Pressable>
        );
      })}

      {policy === 'chosen' && (
        <View style={styles.chosen}>
          <Text style={styles.chosenLabel}>{COPY.circleChosenAdminsLabel}</Text>
          {selectedPeople.map((p) => {
            const on = adminIds.has(p.user_id);
            const name = nameOf(p);
            return (
              <Pressable
                key={p.user_id}
                onPress={() => {
                  hapticSelection();
                  onToggleAdmin(p.user_id);
                }}
                style={styles.adminRow}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={name}
              >
                {p.profile_photo_url ? (
                  <Image source={{ uri: p.profile_photo_url }} style={styles.adminAvatar} />
                ) : (
                  <View style={[styles.adminAvatar, styles.adminAvatarFallback]}>
                    <Text style={styles.adminInitial}>{name[0]?.toUpperCase() ?? '?'}</Text>
                  </View>
                )}
                <Text style={styles.adminName} numberOfLines={1}>
                  {name}
                </Text>
                <View style={[styles.check, on && styles.checkOn]}>
                  {on && <Check size={16} color={Colors.white} strokeWidth={3} />}
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
  adminName: { flex: 1, fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
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
