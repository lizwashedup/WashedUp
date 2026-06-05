/**
 * CreateCircleFlow — the 3-step create-circle wizard (identity, people,
 * permissions). Owns all wizard state; each step is a presentational child.
 * On submit it calls create_circle (+ update_circle for the invite policy) and
 * replaces into the new circle home.
 *
 * Mounted only behind GROUPS_ENABLED (the /circle/new route guards it).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, X } from 'lucide-react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { CIRCLE_CREATE } from '../../../constants/YoursDesign';
import { COPY } from '../../yours/state/constants';
import { hapticSelection } from '../../../lib/haptics';
import { useAuthUserId } from '../../yours/state/useAuthUserId';
import { useYoursGrid } from '../../../hooks/useYoursGrid';
import { useCreateCircle } from '../../../hooks/useCreateCircle';
import { useSetSuggestionStatus } from '../../../hooks/useCircleSuggestions';
import type { CircleInvitePolicy } from '../../../lib/circles/types';
import IdentityStep from './IdentityStep';
import PeopleStep from './PeopleStep';
import PermissionsStep from './PermissionsStep';

const TOTAL_STEPS = 3;
const MIN_OTHERS = 2; // creator + 2 = a circle of three

export default function CreateCircleFlow() {
  const router = useRouter();
  // Seeded from a co-attendance suggestion: pre-select those people and mark
  // the suggestion converted once the circle is made.
  const { seed, suggestion } = useLocalSearchParams<{ seed?: string; suggestion?: string }>();
  const { data: userId } = useAuthUserId();
  const { data: people = [] } = useYoursGrid(userId);
  const createCircle = useCreateCircle(userId);
  const setSuggestionStatus = useSetSuggestionStatus(userId);

  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Apply a suggestion seed ONCE the grid has loaded, intersected with it: only
  // people actually in your grid get pre-selected, so every selected person is
  // visible and removable in the picker (no invisible phantom members shipped
  // to create_circle, and selected.size stays in sync with the checkmarks).
  const seedAppliedRef = useRef(false);
  useEffect(() => {
    if (seedAppliedRef.current) return;
    if (typeof seed !== 'string' || !seed || people.length === 0) return;
    const seedIds = new Set(seed.split(',').filter(Boolean));
    const valid = people.filter((p) => seedIds.has(p.user_id)).map((p) => p.user_id);
    seedAppliedRef.current = true;
    if (valid.length > 0) setSelected(new Set(valid));
  }, [seed, people]);
  const [policy, setPolicy] = useState<CircleInvitePolicy>('only_me');
  const [adminIds, setAdminIds] = useState<Set<string>>(new Set());

  const selectedPeople = useMemo(
    () => people.filter((p) => selected.has(p.user_id)),
    [people, selected],
  );

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        // A deselected person can't remain a chosen admin.
        setAdminIds((a) => {
          if (!a.has(id)) return a;
          const na = new Set(a);
          na.delete(id);
          return na;
        });
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAdmin = (id: string) => {
    setAdminIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canAdvance =
    step === 1 ? name.trim().length > 0 : step === 2 ? selected.size >= MIN_OTHERS : true;

  const onBack = () => {
    if (step > 1) setStep(step - 1);
    else router.back();
  };

  const onPrimary = () => {
    hapticSelection();
    if (step < TOTAL_STEPS) {
      setStep(step + 1);
      return;
    }
    if (createCircle.isPending) return;
    createCircle.mutate(
      {
        name: name.trim(),
        description: description.trim() || null,
        memberUserIds: Array.from(selected),
        invitePolicy: policy,
        adminUserIds: policy === 'chosen' ? Array.from(adminIds) : [],
      },
      {
        onSuccess: (circleId) => {
          // Best-effort: mark the seeding suggestion converted so it stops
          // showing. Never blocks navigation into the new circle.
          if (typeof suggestion === 'string' && suggestion) {
            setSuggestionStatus.mutate({ id: suggestion, status: 'converted' });
          }
          router.replace(`/(tabs)/chats/circle/${circleId}` as never);
        },
        onError: () => Alert.alert(COPY.circleCreateError),
      },
    );
  };

  const primaryLabel = step < TOTAL_STEPS ? COPY.circleCreateNext : COPY.circleCreateMake;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          {step > 1 ? (
            <ChevronLeft size={24} color={Colors.asphalt} />
          ) : (
            <X size={24} color={Colors.asphalt} />
          )}
        </Pressable>
        <Text style={styles.headerTitle}>{COPY.circleCreateTitle}</Text>
        <View style={styles.dots}>
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <View key={i} style={[styles.dot, i + 1 === step && styles.dotOn]} />
          ))}
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.flex}>
          {step === 1 && (
            <IdentityStep
              name={name}
              description={description}
              onName={setName}
              onDescription={setDescription}
            />
          )}
          {step === 2 && (
            <PeopleStep
              people={people}
              selected={selected}
              onToggle={toggleSelected}
              // Defensive: /circle/new is only reachable when you already have
              // people, so this is a rare exit. Close the wizard back to the
              // directory, where the add-people paths live.
              onAddPeople={() => router.back()}
            />
          )}
          {step === 3 && (
            <PermissionsStep
              policy={policy}
              onPolicy={setPolicy}
              selectedPeople={selectedPeople}
              adminIds={adminIds}
              onToggleAdmin={toggleAdmin}
            />
          )}
        </View>

        <View style={styles.footer}>
          {step === 2 && selected.size > 0 && selected.size < MIN_OTHERS && (
            <Text style={styles.hint}>{COPY.circleStep2NeedMore}</Text>
          )}
          <Pressable
            onPress={onPrimary}
            disabled={!canAdvance || createCircle.isPending}
            style={[styles.primary, (!canAdvance || createCircle.isPending) && styles.primaryDisabled]}
            accessibilityRole="button"
            accessibilityLabel={primaryLabel}
          >
            {createCircle.isPending ? (
              <ActivityIndicator color={Colors.white} />
            ) : (
              <Text style={styles.primaryLabel}>{primaryLabel}</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  dots: { flexDirection: 'row', gap: CIRCLE_CREATE.stepDotGap, width: 24, justifyContent: 'flex-end' },
  dot: {
    width: CIRCLE_CREATE.stepDot,
    height: CIRCLE_CREATE.stepDot,
    borderRadius: CIRCLE_CREATE.stepDot / 2,
    backgroundColor: Colors.borderWarm,
  },
  dotOn: { backgroundColor: Colors.terracotta },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  hint: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    textAlign: 'center',
    marginBottom: 8,
  },
  primary: {
    height: CIRCLE_CREATE.footerBtnHeight,
    borderRadius: 999,
    backgroundColor: Colors.terracotta,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryDisabled: { opacity: 0.4 },
  primaryLabel: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.white },
});
