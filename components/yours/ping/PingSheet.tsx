import React from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { COPY } from '../state/constants';
import type { YoursGridPerson } from '../../../lib/yours/types';
import InvitationPerson from './InvitationPerson';
import { useReduceMotion } from '../a11y/useReduceMotion';

/** Controlled picker: strip and full list always share the same selected people. */
export default function PingSheet({ visible, onClose, people, selectedIds, confirmedIds, onToggle, onSend, busy, status }: {
  visible: boolean;
  onClose: () => void;
  people: YoursGridPerson[];
  selectedIds: ReadonlySet<string>;
  confirmedIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onSend: () => void;
  busy: boolean;
  status: string | null;
}) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const close = () => { if (!busy) onClose(); };
  return (
    <Modal visible={visible} transparent animationType={reduceMotion ? 'none' : 'slide'} onRequestClose={close}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={close} disabled={busy} accessible={false} />
        <View style={[styles.sheet, { paddingBottom: Math.max(16, insets.bottom) }]} accessibilityViewIsModal>
          <View style={styles.header}>
            <Text style={styles.prompt}>{COPY.pingSheetPrompt}</Text>
            <Pressable onPress={close} disabled={busy} style={styles.close} accessibilityRole="button" accessibilityState={{ disabled: busy }}>
              <Text style={[styles.closeText, busy && styles.disabled]}>{COPY.pingBack}</Text>
            </Pressable>
          </View>
          <Text style={styles.helper}>{COPY.pingSelected(selectedIds.size)}</Text>
          <ScrollView style={styles.list}>
            {people.map(person => <InvitationPerson key={person.user_id} person={person}
              selected={selectedIds.has(person.user_id)} confirmed={confirmedIds.has(person.user_id)} disabled={busy}
              onPress={() => onToggle(person.user_id)} />)}
          </ScrollView>
          {!!status && <Text style={styles.status} accessibilityRole="alert" accessibilityLiveRegion="polite">{status}</Text>}
          <Pressable style={[styles.btn, (busy || selectedIds.size === 0) && styles.disabled]}
            disabled={busy || selectedIds.size === 0} onPress={onSend} accessibilityRole="button"
            accessibilityState={{ disabled: busy || selectedIds.size === 0, busy }}>
            <Text style={styles.btnText} numberOfLines={1}>{busy ? COPY.pingSending : COPY.pingButton}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: Colors.overlayMedium },
  backdrop: { ...StyleSheet.absoluteFillObject },
  sheet: { height: '75%', backgroundColor: Colors.parchment, paddingHorizontal: 20, paddingTop: 8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  prompt: { flex: 1, fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  close: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  helper: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary, marginBottom: 8 },
  list: { flex: 1 },
  status: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.secondary, marginTop: 12 },
  btn: { minHeight: 48, backgroundColor: Colors.terracotta, borderRadius: 8, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  disabled: { opacity: 0.4 },
  btnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.white },
});
