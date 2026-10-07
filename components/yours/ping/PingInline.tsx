import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Animated } from 'react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import PingSheet from './PingSheet';
import InvitationPerson from './InvitationPerson';
import { COPY, PING_AUTOFADE_MS, ANIM } from '../state/constants';
import { hapticSelection, hapticSuccess } from '../../../lib/haptics';
import { useYoursGrid } from '../../../hooks/useYoursGrid';
import { usePeopleConnectionMutations } from '../../../hooks/usePeopleConnectionMutations';
import { useReduceMotion } from '../a11y/useReduceMotion';

type Props = { userId: string; planId: string; onDone: () => void; onBusyChange?: (busy: boolean) => void };

/** Scope selections and in-flight completions to this account and plan. */
export default function PingInline(props: Props) {
  return <PlanInvitations key={JSON.stringify([props.userId, props.planId])} {...props} />;
}

function PlanInvitations({ userId, planId, onDone, onBusyChange }: Props) {
  const reduceMotion = useReduceMotion();
  const { data: people = [] } = useYoursGrid(userId);
  const { ping } = usePeopleConnectionMutations(userId);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectedRef = useRef(selected);
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const busyRef = useRef(false);
  const mounted = useRef(false);
  const callbacks = useRef({ onDone, onBusyChange });
  callbacks.current = { onDone, onBusyChange };
  const opacity = useRef(new Animated.Value(0)).current;
  const doneRef = useRef(false);
  const engagedRef = useRef(false);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finish = () => {
    if (!mounted.current || doneRef.current || busyRef.current) return;
    doneRef.current = true;
    callbacks.current.onDone();
  };
  const engage = () => {
    if (engagedRef.current) return;
    engagedRef.current = true;
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    fadeTimerRef.current = null;
    opacity.stopAnimation(() => { if (mounted.current && !doneRef.current) opacity.setValue(1); });
  };

  useEffect(() => {
    mounted.current = true;
    Animated.timing(opacity, { toValue: 1, duration: reduceMotion ? 0 : ANIM.welcomeFadeMs, useNativeDriver: true }).start();
    fadeTimerRef.current = setTimeout(() => {
      if (engagedRef.current || busyRef.current) return;
      Animated.timing(opacity, { toValue: 0, duration: reduceMotion ? 0 : ANIM.welcomeFadeMs, useNativeDriver: true }).start(({ finished }) => {
        if (finished && !engagedRef.current) finish();
      });
    }, PING_AUTOFADE_MS);
    return () => {
      mounted.current = false;
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
      opacity.stopAnimation();
      if (busyRef.current) callbacks.current.onBusyChange?.(false);
    };
  // The keyed component owns one invitation attempt lifecycle.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (id: string) => {
    engage();
    if (busyRef.current || confirmed.has(id) || !people.some(person => person.user_id === id)) return;
    hapticSelection();
    const next = new Set(selectedRef.current);
    next.has(id) ? next.delete(id) : next.add(id);
    selectedRef.current = next;
    setSelected(next);
  };

  const send = async () => {
    if (!mounted.current || doneRef.current || busyRef.current) return;
    engage();
    const eligible = new Set(people.map(person => person.user_id));
    const ids = [...selectedRef.current].filter(id => eligible.has(id) && !confirmed.has(id));
    if (ids.length === 0) {
      selectedRef.current = new Set();
      setSelected(selectedRef.current);
      setStatus(COPY.pingChoosePeople);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setStatus(null);
    callbacks.current.onBusyChange?.(true);
    const results = await Promise.allSettled(ids.map(recipientId =>
      Promise.resolve().then(() => ping.mutateAsync({ recipientId, eventId: planId })),
    ));
    if (!mounted.current) return;
    const accepted = ids.filter((_, index) => results[index].status === 'fulfilled');
    const unresolved = ids.filter((_, index) => results[index].status === 'rejected');
    // A void RPC acknowledgement may be a 24-hour dedupe no-op. It is not proof
    // of notification delivery or display, and unknown outcomes are never retried automatically.
    setConfirmed(previous => new Set([...previous, ...accepted]));
    selectedRef.current = new Set(unresolved);
    setSelected(selectedRef.current);
    busyRef.current = false;
    setBusy(false);
    callbacks.current.onBusyChange?.(false);
    if (accepted.length > 0) hapticSuccess();
    if (unresolved.length === 0) finish();
    else setStatus(COPY.pingUnconfirmed(unresolved.length, accepted.length));
  };

  const closeSheet = () => { if (!busyRef.current) setSheet(false); };
  return (
    <Animated.View style={[styles.wrap, { opacity }]}>
      <View accessibilityElementsHidden={sheet} aria-hidden={sheet} importantForAccessibility={sheet ? 'no-hide-descendants' : 'auto'} style={styles.content}>
        <Text style={styles.prompt}>{COPY.pingPrompt}</Text>
        <Text style={styles.helper}>{COPY.pingHelp}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} onScrollBeginDrag={engage}>
          {people.slice(0, 8).map(person => <InvitationPerson key={person.user_id} person={person} inline
            selected={selected.has(person.user_id)} confirmed={confirmed.has(person.user_id)} disabled={busy}
            onPress={() => toggle(person.user_id)} />)}
        </ScrollView>
        <View style={styles.selectionLine}>
          <Text style={styles.helper} accessibilityLiveRegion="polite">{COPY.pingSelected(selected.size)}</Text>
          <Pressable style={styles.seeAll} disabled={busy} onPress={() => { engage(); if (!busyRef.current) setSheet(true); }}
            accessibilityRole="button" accessibilityState={{ disabled: busy }}>
            <Text style={[styles.seeAllText, busy && styles.disabled]}>{COPY.pingSeeAll}</Text>
          </Pressable>
        </View>
        {!!status && <Text style={styles.status} accessibilityRole="alert" accessibilityLiveRegion="polite">{status}</Text>}
        <Pressable style={[styles.btn, (busy || selected.size === 0) && styles.disabled]} disabled={busy || selected.size === 0}
          onPress={() => { void send(); }} accessibilityRole="button" accessibilityState={{ disabled: busy || selected.size === 0, busy }}>
          <Text style={styles.btnText} numberOfLines={1}>{busy ? COPY.pingSending : COPY.pingButton}</Text>
        </Pressable>
        <Pressable style={styles.skip} disabled={busy} onPress={finish} accessibilityRole="button" accessibilityState={{ disabled: busy }}>
          <Text style={[styles.skipText, busy && styles.disabled]}>{COPY.pingSkip}</Text>
        </Pressable>
      </View>
      <PingSheet visible={sheet} onClose={closeSheet} people={people} selectedIds={selected} confirmedIds={confirmed}
        onToggle={toggle} onSend={() => { void send(); }} busy={busy} status={status} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: Colors.parchment, paddingHorizontal: 24, paddingVertical: 16 },
  content: { gap: 12 },
  prompt: { fontFamily: Fonts.sansBold, fontSize: FontSizes.displayMD, color: Colors.asphalt },
  helper: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.secondary },
  selectionLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  seeAll: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  seeAllText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  status: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.secondary },
  btn: { minHeight: 48, backgroundColor: Colors.terracotta, borderRadius: 8, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  btnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.white },
  skip: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  skipText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.secondary },
});
