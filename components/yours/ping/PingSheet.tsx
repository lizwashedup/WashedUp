import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import BottomSheet from '../primitives/BottomSheet';
import YoursAvatar from '../primitives/YoursAvatar';
import { COPY } from '../state/constants';
import { hapticSelection } from '../../../lib/haptics';
import type { YoursGridPerson } from '../../../lib/yours/types';

/** Full ping picker. Tap faces, Ping them. */
export default function PingSheet({
  visible,
  onClose,
  people,
  onPing,
}: {
  visible: boolean;
  onClose: () => void;
  people: YoursGridPerson[];
  onPing: (ids: string[]) => void;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    hapticSelection();
    setSel((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} heightPct={0.65}>
      <Text style={styles.prompt}>{COPY.pingSheetPrompt}</Text>
      <ScrollView contentContainerStyle={styles.grid}>
        {people.map((p) => (
          <Pressable
            key={p.user_id}
            style={styles.cell}
            onPress={() => toggle(p.user_id)}
          >
            <YoursAvatar
              name={p.first_name_display}
              photoUrl={p.profile_photo_url}
              size={64}
              bucket={sel.has(p.user_id) ? 'full' : 'none'}
            />
            <Text style={styles.name} numberOfLines={1}>
              {p.first_name_display ?? ''}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <Pressable
        style={[styles.btn, sel.size === 0 && styles.btnOff]}
        disabled={sel.size === 0}
        onPress={() => onPing(Array.from(sel))}
      >
        <Text style={styles.btnText}>{COPY.pingButton}</Text>
      </Pressable>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  prompt: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
    textAlign: 'center',
    marginBottom: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 16,
  },
  cell: { width: '23%', alignItems: 'center' },
  name: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.micro,
    color: Colors.secondary,
    marginTop: 4,
  },
  btn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  btnOff: { opacity: 0.4 },
  btnText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.white,
  },
});
