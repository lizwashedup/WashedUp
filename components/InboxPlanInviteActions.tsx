import React, { useLayoutEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { requestWithDeadline } from '../lib/requestWithDeadline';
import { hapticLight } from '../lib/haptics';
import { INBOX_COUNT_KEY, PENDING_INVITES_BADGE_KEY } from '../constants/QueryKeys';
import Colors from '../constants/Colors';
import { Fonts, FontSizes } from '../constants/Typography';

type Phase = 'idle' | 'saving' | 'retry' | 'unknown' | 'checking' | 'done';
type ReplyRow = { id: string; event_id: string; recipient_id: string; status: string };
type Scope = {epoch: number; userId: string | null; isCurrent: () => boolean};
const fields = 'id,event_id,recipient_id,status';
const rejected = new Set(['P0001','42501','23502','23503','23505','23514','22P02','28000','28P01','40001','40P01']);

export function InboxPlanInviteActions({ id, eventId, scope, visit, isOpen, onOpen }: {
  id: string; eventId: string; scope: Scope; visit: object; isOpen: () => boolean; onOpen: () => void;
}) {
  const client = useQueryClient();
  const [phase, setPhase] = useState<Phase>('idle');
  const state = useRef<Phase>('idle');
  const owner = useRef<object | null>(null);
  useLayoutEffect(() => {
    owner.current = {}; state.current = 'idle'; setPhase('idle');
    return () => { owner.current = null; };
  }, [scope, visit, id, eventId]);
  const set = (next: Phase) => { state.current = next; setPhase(next); };
  const current = () => !!owner.current && scope.isCurrent() && isOpen();
  const decline = async () => {
    const userId = scope.userId;
    if (!userId || !current() || !['idle','retry','unknown'].includes(state.current)) return;
    const token = owner.current;
    const active = () => owner.current === token && current();
    const checkOnly = state.current === 'unknown';
    set(checkOnly ? 'checking' : 'saving');
    hapticLight();
    const matches = (row: ReplyRow | null): row is ReplyRow => row?.id === id && row.event_id === eventId && row.recipient_id === userId;
    const retire = () => {
      // A confirmed response belongs to this row and recipient even if the
      // sheet closed while waiting. Never remove another account's entries.
      if (active()) set('done');
      client.setQueryData<{id: string; event_id: string}[]>(['pending-invites', userId, scope.epoch], rows => rows?.filter(row => row.id !== id || row.event_id !== eventId));
      for (const key of [['pending-invites', userId], [...INBOX_COUNT_KEY, userId], [...PENDING_INVITES_BADGE_KEY, userId]]) {
        void client.invalidateQueries({queryKey:key}).catch(() => {});
      }
    };
    try {
      // Reopening after a lost response must not replay an already-saved reply.
      const read = await requestWithDeadline(supabase.from('plan_invites').select(fields)
        .eq('id', id).eq('event_id', eventId).eq('recipient_id', userId).maybeSingle(), 12_000);
      if (!active()) return;
      if (read.error || !matches(read.data)) { set('unknown'); return; }
      if (read.data.status === 'declined' || read.data.status === 'accepted') { retire(); return; }
      if (read.data.status !== 'pending') { set('unknown'); return; }
      if (checkOnly) { set('retry'); return; }
      const response = await requestWithDeadline(supabase.from('plan_invites').update({status:'declined'})
        .eq('id', id).eq('event_id', eventId).eq('recipient_id', userId).eq('status','pending')
        .select(fields).maybeSingle(), 12_000);
      if (!response.error && matches(response.data) && response.data.status === 'declined') { retire(); return; }
      if (active()) set(response.error && rejected.has(String(response.error.code)) ? 'retry' : 'unknown');
    } catch {
      if (active()) set('unknown');
    }
  };
  const action = {idle:'Not This Time',saving:'Declining…',retry:'Retry decline',unknown:'Check invitation',checking:'Checking…',done:'Answered'}[phase];
  const busy = phase === 'saving' || phase === 'checking' || phase === 'done';
  return <View>
    {phase === 'retry' && <Text accessibilityLiveRegion="polite" style={s.note}>The decline didn’t go through. You can try again.</Text>}
    {phase === 'unknown' && <Text accessibilityLiveRegion="polite" style={s.note}>We couldn’t confirm the reply. Check the invitation before trying again.</Text>}
    <View style={s.inviteActions}>
      <TouchableOpacity accessibilityRole="button" style={s.letsGoBtn} disabled={busy || phase === 'unknown'} onPress={()=>{
        if (current() && (state.current === 'idle' || state.current === 'retry')) { hapticLight(); onOpen(); }
      }}><Text style={s.letsGoBtnText}>{"Let's Go →"}</Text></TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" style={s.notThisTimeBtn} disabled={busy} onPress={decline}>
        <Text style={s.notThisTimeBtnText}>{action}</Text>
      </TouchableOpacity>
    </View>
  </View>;
}
const s = StyleSheet.create({
  note:{fontFamily:Fonts.sans,fontSize:FontSizes.bodySM,color:Colors.asphalt,marginBottom:8},
  inviteActions:{flexDirection:'row',flexWrap:'wrap',gap:10,paddingBottom:12,justifyContent:'center'},
  letsGoBtn:{backgroundColor:Colors.terracotta,paddingHorizontal:24,paddingVertical:10,borderRadius:999},
  letsGoBtnText:{fontFamily:Fonts.sansBold,fontSize:FontSizes.bodyMD,color:Colors.white},
  notThisTimeBtn:{paddingHorizontal:16,paddingVertical:10,justifyContent:'center'},
  notThisTimeBtnText:{fontFamily:Fonts.sansMedium,fontSize:FontSizes.bodyMD,color:Colors.textLight},
});
