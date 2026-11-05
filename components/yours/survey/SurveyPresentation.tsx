import React, { useEffect, useRef } from 'react';
import { View, Text, Pressable, TextInput, Animated, ActivityIndicator, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '../../../constants/Colors';
import type { SurveyProps, SurveyMember } from '../../PostPlanSurvey';
import { useReduceMotion } from '../a11y/useReduceMotion';
import YoursAvatar from '../primitives/YoursAvatar';
import { COPY } from '../state/constants';
import { styles } from './surveyStyles';

export type Rating = 'thumbs_up' | 'thumbs_down' | 'fine';
export type AttendanceAnswer = 'there' | 'no_show' | 'unsure';

// ─── Plan card behind (the "which plan" context) ────────────────────────────
export function PlanCardBehind({
  plan,
  wentCount,
}: {
  plan: SurveyProps['plan'];
  wentCount: number;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.cardBehindWrap, { paddingTop: insets.top + 12 }]}>
      <Text style={styles.cardBehindEyebrow}>{COPY.wordmark}</Text>
      <View style={styles.cardBehind}>
        {plan.image_url ? (
          <Image
            source={{ uri: plan.image_url }}
            style={styles.cardBehindImg}
            contentFit="cover"
          />
        ) : (
          <View style={[styles.cardBehindImg, styles.cardBehindImgFallback]} />
        )}
        <View style={styles.cardBehindBody}>
          <Text style={styles.cardBehindTitle} numberOfLines={2}>
            {plan.title}
          </Text>
          <Text style={styles.cardBehindMeta}>{wentCount} joined</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Sheet header (eyebrow + serif title + step indicator) ──────────────────
export function SheetHeader({
  eyebrow,
  title,
  current,
  total,
}: {
  eyebrow: string;
  title: string | null;
  current: number;
  total: number;
}) {
  return (
    <View style={styles.header}>
      <Text style={styles.eyebrow} numberOfLines={1}>
        {eyebrow}
      </Text>
      {title != null && <Text style={styles.title}>{title}</Text>}
      <View style={styles.stepRow}>
        {Array.from({ length: total }).map((_, i) => {
          const n = i + 1;
          const state = n < current ? 'done' : n === current ? 'on' : 'todo';
          return (
            <View
              key={n}
              style={[
                styles.stepDot,
                state === 'on' && styles.stepDotOn,
                state === 'done' && styles.stepDotDone,
              ]}
            />
          );
        })}
        <Text style={styles.stepCounter}>
          {COPY.surveyStepCounter(current, total)}
        </Text>
      </View>
    </View>
  );
}

// ─── Footer (Continue + Not now) ────────────────────────────────────────────
export function Footer({
  primaryLabel,
  primaryActive,
  busy,
  onPrimary,
  onEscape,
}: {
  primaryLabel: string;
  primaryActive: boolean;
  busy: boolean;
  onPrimary: () => void;
  onEscape: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.footer, { paddingBottom: Math.max(20, insets.bottom + 8) }]}>
      <Pressable
        style={[styles.primary, !primaryActive && styles.primaryOff]}
        accessibilityRole="button"
        accessibilityLabel={primaryLabel}
        accessibilityState={{ disabled: !primaryActive || busy, busy }}
        disabled={!primaryActive || busy}
        onPress={onPrimary}
      >
        {busy ? (
          <ActivityIndicator color={Colors.white} />
        ) : (
          <Text style={styles.primaryText}>{primaryLabel}</Text>
        )}
      </Pressable>
      <Pressable
        style={styles.escape}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={COPY.surveyNotNow}
        onPress={onEscape}
      >
        <Text style={styles.escapeText}>{COPY.surveyNotNow}</Text>
      </Pressable>
    </View>
  );
}

// ─── Step 1: How was it? (pills + optional "Not great" comment reveal) ───────
const COMMENT_REVEAL_H = 134;

export function StepHow({
  selected,
  onPick,
  comment,
  setComment,
  showComment,
  onCommentFocus,
  onCommentBlur,
}: {
  selected: Rating | null;
  onPick: (r: Rating) => void;
  comment: string;
  setComment: (s: string) => void;
  showComment: boolean;
  onCommentFocus: () => void;
  onCommentBlur: () => void;
}) {
  const reduceMotion = useReduceMotion();
  const reveal = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) {
      reveal.setValue(showComment ? 1 : 0);
      return;
    }
    Animated.spring(reveal, {
      toValue: showComment ? 1 : 0,
      mass: 1,
      stiffness: 280,
      damping: 30,
      useNativeDriver: false,
    }).start();
  }, [showComment, reduceMotion, reveal]);

  const pills: Array<{ r: Rating; label: string }> = [
    { r: 'thumbs_up', label: COPY.surveyGood },
    { r: 'fine', label: COPY.surveyFine },
    { r: 'thumbs_down', label: COPY.surveyBad },
  ];
  return (
    <View style={styles.pillCol}>
      {pills.map((p) => {
        const on = selected === p.r;
        return (
          <Pressable
            key={p.r}
            style={[styles.pill, on && styles.pillOn]}
            onPress={() => onPick(p.r)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
          >
            <Text style={[styles.pillText, on && styles.pillTextOn]}>{p.label}</Text>
          </Pressable>
        );
      })}

      {/* "Not great" reveals an optional, never-required comment box. */}
      <Animated.View
        style={[
          styles.commentReveal,
          {
            height: reveal.interpolate({
              inputRange: [0, 1],
              outputRange: [0, COMMENT_REVEAL_H],
            }),
            opacity: reveal,
          },
        ]}
      >
        <Text style={styles.commentLabel}>{COPY.surveyBadFollowup}</Text>
        <TextInput
          accessibilityLabel="Optional feedback"
          onFocus={onCommentFocus}
          onBlur={onCommentBlur}
          value={comment}
          onChangeText={setComment}
          placeholder=""
          style={styles.commentInput}
          multiline
          editable={showComment}
        />
        <Text style={styles.commentHint}>{COPY.surveyBadHelper}</Text>
      </Animated.View>
    </View>
  );
}

// ─── Step 2: Explicit attendance choices, initially unanswered ─────────────
export function StepWho({
  list,
  answers,
  disabled,
  onAnswer,
}: {
  list: SurveyMember[];
  answers: Record<string, AttendanceAnswer>;
  disabled: boolean;
  onAnswer: (id: string, answer: AttendanceAnswer) => void;
}) {
  const { width, fontScale } = useWindowDimensions();
  const choiceWidth = Math.min(width - 48, 154 * fontScale);
  return (
    <View>
      <Text style={styles.whoHelper}>{COPY.surveyWhoHelper}</Text>
      <View style={styles.attendList}>
        {list.map((m) => {
          const name = m.first_name_display ?? 'Someone';
          return (
            <View key={m.id} style={styles.attendancePerson}>
              <View style={styles.attendRow}>
                <YoursAvatar name={m.first_name_display} photoUrl={m.profile_photo_url} size={44} bucket="none" />
                <Text style={styles.attendName}>{name}</Text>
              </View>
              <View accessibilityRole="radiogroup" accessibilityLabel={`Attendance for ${name}`} style={styles.attendanceChoices}>
                {([['there', 'Was there'], ['no_show', 'Didn’t show up'], ['unsure', 'Not sure']] as const).map(([answer, label]) => {
                  const selected = answers[m.id] === answer;
                  return <Pressable key={answer} accessibilityRole="radio" accessibilityLabel={`${name}: ${label}`}
                    accessibilityState={{ checked: selected, disabled }} disabled={disabled}
                    onPress={() => onAnswer(m.id, answer)}
                    style={[styles.attendanceChoice, { flexBasis: choiceWidth }, selected && styles.attendanceChoiceSelected]}>
                    <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.attendanceChoiceText, selected && styles.attendanceChoiceTextSelected]}>{selected ? `✓ ${label}` : label}</Text>
                  </Pressable>;
                })}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ─── Step 3: Keep these people (pre-selected avatar chips) ──────────────────
export function StepKeep({
  candidates,
  selected,
  disabled,
  onToggle,
}: {
  candidates: SurveyMember[];
  selected: Set<string>;
  disabled: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <View>
      <Text style={styles.keepHeadline}>{COPY.surveyAddPrompt}</Text>
      <View style={styles.chipWrap}>
        {candidates.map((m) => {
          const on = selected.has(m.id);
          return (
            <Pressable
              key={m.id}
              style={[styles.chip, on ? styles.chipOn : styles.chipOff]}
              onPress={() => onToggle(m.id)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={`Keep in touch with ${m.first_name_display ?? 'this person'}`}
              accessibilityState={{ selected: on, disabled }}
            >
              <YoursAvatar name={m.first_name_display} photoUrl={m.profile_photo_url} size={28} bucket="none" />
              <Text style={styles.chipName} numberOfLines={1}>
                {m.first_name_display ?? ''}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ─── Step 3 footer: equal-weight Add / Skip + the always-live escape ────────
export function KeepFooter({
  addLabel,
  canAdd,
  busy,
  onAdd,
  onSkip,
  onEscape,
}: {
  addLabel: string;
  canAdd: boolean;
  busy: boolean;
  onAdd: () => void;
  onSkip: () => void;
  onEscape: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.footer, { paddingBottom: Math.max(20, insets.bottom + 8) }]}>
      <View style={styles.keepRow}>
        <Pressable
          style={[styles.keepBtn, styles.keepBtnFill, !canAdd && styles.primaryOff]}
          disabled={!canAdd || busy}
          accessibilityRole="button"
          accessibilityLabel={addLabel}
          accessibilityState={{ disabled: !canAdd || busy, busy }}
          onPress={onAdd}
        >
          {busy ? (
            <ActivityIndicator color={Colors.white} />
          ) : (
            <Text style={styles.keepBtnFillText}>{addLabel}</Text>
          )}
        </Pressable>
        <Pressable style={[styles.keepBtn, styles.keepBtnGhost]} onPress={onSkip}>
          <Text style={styles.keepBtnGhostText}>{COPY.surveySkip}</Text>
        </Pressable>
      </View>
      <Pressable
        style={styles.escape}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={COPY.surveyNotNow}
        onPress={onEscape}
      >
        <Text style={styles.escapeText}>{COPY.surveyNotNow}</Text>
      </Pressable>
    </View>
  );
}

