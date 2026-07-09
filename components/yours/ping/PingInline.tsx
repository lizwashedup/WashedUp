import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Animated } from 'react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import YoursAvatar from '../primitives/YoursAvatar';
import PingSheet from './PingSheet';
import { COPY, PING_AUTOFADE_MS, ANIM } from '../state/constants';
import { hapticSelection, hapticSuccess } from '../../../lib/haptics';
import { useYoursGrid } from '../../../hooks/useYoursGrid';
import { usePeopleConnectionMutations } from '../../../hooks/usePeopleConnectionMutations';
import { useReduceMotion } from '../a11y/useReduceMotion';

/**
 * Inline "Let your people know" strip shown after creating/joining a plan.
 * Auto-fades after PING_AUTOFADE_MS (SIM-EYEBALL #2), then calls onDone so
 * the caller can run its original navigation. The auto-fade exists ONLY for
 * the untouched strip: the first tap (a face, See all) cancels it for good,
 * because the strip owns full-screen navigation via onDone: an auto-fade
 * firing mid-selection (or while the See-all sheet is up) yanks the user to
 * chat and silently drops their pings. "Not now" is the explicit exit once
 * the timer is dead.
 */
export default function PingInline({
  userId,
  planId,
  onDone,
}: {
  userId: string;
  planId: string;
  onDone: () => void;
}) {
  const reduceMotion = useReduceMotion();
  const { data: people = [] } = useYoursGrid(userId);
  const { ping } = usePeopleConnectionMutations(userId);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const doneRef = useRef(false);
  const engagedRef = useRef(false);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  };

  // First interaction kills the auto-dismiss: clear the pending timer and,
  // if the fade-out already started, halt it and restore the strip.
  const engage = () => {
    if (engagedRef.current) return;
    engagedRef.current = true;
    if (fadeTimerRef.current) {
      clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
    opacity.stopAnimation(() => {
      if (!doneRef.current) opacity.setValue(1);
    });
  };

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: reduceMotion ? 0 : ANIM.welcomeFadeMs,
      useNativeDriver: true,
    }).start();
    fadeTimerRef.current = setTimeout(() => {
      if (engagedRef.current) return;
      Animated.timing(opacity, {
        toValue: 0,
        duration: reduceMotion ? 0 : ANIM.welcomeFadeMs,
        useNativeDriver: true,
      }).start(({ finished }) => {
        // stopAnimation (engage mid-fade) lands here with finished=false;
        // only a fade-out that actually completed may run the host nav.
        if (finished && !engagedRef.current) finish();
      });
    }, PING_AUTOFADE_MS);
    return () => {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, []);

  const sendPings = async (ids: string[]) => {
    hapticSuccess();
    await Promise.allSettled(
      ids.map((id) =>
        ping.mutateAsync({ recipientId: id, eventId: planId }),
      ),
    );
    finish();
  };

  const top = people.slice(0, 8);

  return (
    <Animated.View style={[styles.wrap, { opacity }]}>
      <Text style={styles.prompt}>{COPY.pingPrompt}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        onScrollBeginDrag={engage}
      >
        {top.map((p) => (
          <Pressable
            key={p.user_id}
            style={styles.face}
            onPress={() => {
              engage();
              hapticSelection();
              setSel((s) => {
                const n = new Set(s);
                n.has(p.user_id) ? n.delete(p.user_id) : n.add(p.user_id);
                return n;
              });
            }}
          >
            <YoursAvatar
              name={p.first_name_display}
              photoUrl={p.profile_photo_url}
              size={52}
              bucket={sel.has(p.user_id) ? 'full' : 'none'}
            />
          </Pressable>
        ))}
        <Pressable
          style={styles.seeAll}
          onPress={() => {
            engage();
            setSheet(true);
          }}
        >
          <Text style={styles.seeAllText}>{COPY.pingSeeAll}</Text>
        </Pressable>
      </ScrollView>
      <Pressable
        style={[styles.btn, sel.size === 0 && styles.btnOff]}
        disabled={sel.size === 0}
        onPress={() => sendPings(Array.from(sel))}
      >
        <Text style={styles.btnText}>{COPY.pingButton}</Text>
      </Pressable>
      <Pressable style={styles.skip} onPress={finish}>
        <Text style={styles.skipText}>{COPY.pingSkip}</Text>
      </Pressable>

      <PingSheet
        visible={sheet}
        onClose={() => setSheet(false)}
        people={people}
        onPing={(ids) => {
          setSheet(false);
          sendPings(ids);
        }}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    margin: 16,
    gap: 12,
  },
  prompt: {
    fontFamily: Fonts.displayItalic,
    fontSize: FontSizes.displaySM,
    color: Colors.asphalt,
  },
  face: { marginRight: 8 },
  seeAll: { justifyContent: 'center', paddingHorizontal: 12 },
  seeAllText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
  },
  btn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnOff: { opacity: 0.4 },
  btnText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.white,
  },
  skip: { alignItems: 'center', paddingVertical: 4 },
  skipText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
  },
});
