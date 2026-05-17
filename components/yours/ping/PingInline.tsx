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
 * the caller can run its original navigation.
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

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  };

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: reduceMotion ? 0 : ANIM.welcomeFadeMs,
      useNativeDriver: true,
    }).start();
    const t = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: reduceMotion ? 0 : ANIM.welcomeFadeMs,
        useNativeDriver: true,
      }).start(finish);
    }, PING_AUTOFADE_MS);
    return () => clearTimeout(t);
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
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {top.map((p) => (
          <Pressable
            key={p.user_id}
            style={styles.face}
            onPress={() => {
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
        <Pressable style={styles.seeAll} onPress={() => setSheet(true)}>
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
});
