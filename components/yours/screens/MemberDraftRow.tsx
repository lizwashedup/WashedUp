import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react-native';
import type { PlanDraft } from '../../../hooks/useMyPlansData';
import { supabase } from '../../../lib/supabase';
import { requestWithDeadline } from '../../../lib/requestWithDeadline';
import { formatEventDateLA } from '../../../lib/laDate';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { ScaledText as Text } from '../../ScaledText';
import { BrandedAlert } from '../../BrandedAlert';

type State = 'idle' | 'busy' | 'retry' | 'check';

// Parent keys the row by account and draft. A confirmation also belongs to a
// single visit: returning to Yours never reactivates a dismissed confirmation.
export function MemberDraftRow({ draft, userId, onOpen }: {
  draft: PlanDraft; userId: string; onOpen: (draft: PlanDraft) => void;
}) {
  const client = useQueryClient();
  const [state, setState] = useState<State>('idle');
  const [dialog, setDialog] = useState<object | null>(null);
  const visit = useRef<object | null>(null);
  const confirmation = useRef<object | null>(null);
  const pending = useRef(false);
  useFocusEffect(useCallback(() => {
    visit.current = {};
    setDialog(null);
    // If a write outlived this visit, the row can check its status on return.
    setState(s => s === 'busy' && !pending.current ? 'check' : s);
    return () => { visit.current = null; confirmation.current = null; };
  }, []));

  const close = () => { confirmation.current = null; setDialog(null); };
  const ask = () => {
    if (!visit.current || pending.current || confirmation.current) return;
    confirmation.current = {}; setDialog(confirmation.current);
  };
  const run = async (mode: 'remove' | 'check', token?: object | null) => {
    const start = visit.current;
    if (!start || pending.current || (mode === 'remove' && (!token || confirmation.current !== token))) return;
    confirmation.current = null;
    pending.current = true; setState('busy');
    const current = () => visit.current === start;
    const key = ['my-plan-drafts', userId];
    let writeStarted = false;
    const show = (s: State) => { if (current()) setState(s); };
    try {
      const auth = await requestWithDeadline(supabase.auth.getUser(), 8000);
      if (!current()) return;
      if (auth.error || auth.data.user?.id !== userId) { show(mode === 'check' ? 'check' : 'retry'); return; }
      const ownedDraft = () => supabase.from('events').select('id').eq('id', draft.id)
        .eq('creator_user_id', userId).eq('status', 'draft').maybeSingle();
      const read = await requestWithDeadline(ownedDraft(), 8000);
      if (!current()) return;
      if (read.error) { show('check'); return; }
      if (read.data) {
        if (read.data.id !== draft.id) { show('check'); return; }
        if (mode === 'check') { show('retry'); return; }
        writeStarted = true;
        const receipt = await requestWithDeadline(supabase.from('events').delete().eq('id', draft.id)
          .eq('creator_user_id', userId).eq('status', 'draft').select('id').maybeSingle(), 8000);
        if (receipt.error || receipt.data?.id !== draft.id) {
          show(receipt.error?.code === '42501' ? 'retry' : 'check'); return;
        }
      }
      if (current()) client.setQueryData<PlanDraft[]>(key, old => old?.filter(row => row.id !== draft.id));
      void client.invalidateQueries({ queryKey: key, exact: true, refetchType: current() ? 'active' : 'none' });
    } catch {
      show(writeStarted || mode === 'check' ? 'check' : 'retry');
    } finally {
      pending.current = false;
      if (visit.current && !current()) setState('check');
      if (!current() && writeStarted) void client.invalidateQueries({ queryKey: key, exact: true, refetchType: 'none' });
    }
  };
  const busy = state === 'busy';
  return <View style={styles.card}>
    <View style={styles.row}>
      <TouchableOpacity style={styles.body} accessibilityRole="button" accessibilityLabel={'Open draft: ' + draft.title}
        disabled={busy} onPress={() => onOpen(draft)}>
        <Text style={styles.title} numberOfLines={1}>{draft.title}</Text>
        <Text style={styles.meta}>{formatEventDateLA(draft.start_time)}{'  ·  finish it whenever'}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.remove} accessibilityRole="button" accessibilityLabel={(state === 'check' ? 'Check draft status: ' : 'Remove draft: ') + draft.title}
        disabled={busy} onPress={state === 'check' ? () => void run('check') : ask}>
        <X size={16} color={Colors.tertiary} strokeWidth={2.5}/>
      </TouchableOpacity>
    </View>
    {state !== 'idle' && <View>
      <Text style={styles.meta} accessibilityLiveRegion="polite">{busy ? 'Checking your draft…' : state === 'check'
        ? 'Couldn’t confirm whether this draft was removed.' : 'Couldn’t remove this draft. You can try again.'}</Text>
      {!busy && <TouchableOpacity style={styles.action} accessibilityRole="button"
        onPress={state === 'check' ? () => void run('check') : ask}>
        <Text style={styles.link}>{state === 'check' ? 'Check status' : 'Try again'}</Text>
      </TouchableOpacity>}
    </View>}
    {dialog && <BrandedAlert visible title="toss this draft?" message="it goes for good."
      buttons={[{ text: 'keep it', style: 'cancel' }, { text: 'toss it', onPress: () => void run('remove', dialog) }]}
      onClose={close}/>}
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.cardBg, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 8, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  body: { flex: 1, minHeight: 44, justifyContent: 'center' },
  remove: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  meta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary, marginTop: 2 },
  action: { minHeight: 44, justifyContent: 'center' },
  link: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
});
