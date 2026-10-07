import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Colors from '../../constants/Colors';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { type AfterglowFontFamilies, AfterglowType as T } from '../../constants/Typography';
import type { CreatorPageScope } from '../../lib/creatorPageReview';
import { AttendeeMessageHistoryDenied, loadAttendeeMessageHistory, type MessageHistoryRow, type MessageHistoryCursor } from '../../lib/attendeeMessageHistory';
import { PageAction } from './pages/PageFrame';

export function AttendeeMessageHistory({ eventId, scope, invitation=false, historyLoader=loadAttendeeMessageHistory }: { eventId: string; scope: CreatorPageScope; invitation?:boolean; historyLoader?:typeof loadAttendeeMessageHistory }) {
  const s = useStyles();
  const life = useMemo(() => ({ lock: false, loaded: false, rows: [] as MessageHistoryRow[], next: null as MessageHistoryCursor | null }), [eventId, scope, historyLoader]);
  const latest = useRef(life); latest.current = life;
  const mounted = useRef(false);
  const [view, setView] = useState<{ life: object; error: string; busy: boolean; expanded?: string }>();
  const current = useCallback(() => mounted.current && latest.current === life && scope.isCurrent(), [life, scope]);
  const state = view?.life === life ? view : undefined;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const load = useCallback(async () => {
    if (!current() || life.lock || life.loaded && !life.next) return;
    life.lock = true; setView(old => ({ life, busy: true, error: '', expanded: old?.life === life ? old.expanded : undefined }));
    try {
      const page = await historyLoader(eventId, scope, life.next);
      if (!current()) return;
      const rows = new Map(life.rows.map(row => [row.id, row])); page.rows.forEach(row => rows.set(row.id, row));
      life.rows = [...rows.values()]; life.next = page.next; life.loaded = true;
    } catch (error) { if (current()) {
      if (error instanceof AttendeeMessageHistoryDenied) { life.rows=[]; life.next=null; life.loaded=false; }
      setView(old => ({ ...old, life, busy: false, error: error instanceof AttendeeMessageHistoryDenied ? invitation?'Invitation history access is no longer available.':'Event message access is no longer available.' : invitation?'Couldn’t load invitation history.':'Couldn’t load message history.' }));
    } }
    finally { life.lock = false; if (current()) setView(old => ({ ...old, life, busy: false, error: old?.life === life ? old.error : '' })); }
  }, [eventId, scope, life, current, historyLoader, invitation]);
  useEffect(() => { void load(); }, [load]);
  return <View style={s.section}>
    <Text accessibilityRole="header" style={s.heading}>{invitation?'Recent invitations':'Recent updates'}</Text>
    {scope.isCurrent() && life.rows.map(row => <View key={row.id} style={s.row}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Read ${row.subject}`} accessibilityState={{ expanded: state?.expanded === row.id }}
        style={s.summary} onPress={() => { if (current()) setView(old => ({ life, busy: !!old?.busy, error: old?.error ?? '', expanded: old?.expanded === row.id ? undefined : row.id })); }}>
        <Text style={s.title}>{row.subject}</Text>
        <Text style={s.caption}>{new Date(row.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {row.recipient_count} recipients · {row.queued_at ? 'Queued' : 'Unconfirmed'}</Text>
      </Pressable>
      {state?.expanded === row.id && <Text selectable style={s.body}>{row.body}</Text>}
    </View>)}
    {!life.loaded && !state?.error || state?.busy ? <ActivityIndicator accessibilityLabel="Loading message history" color={Colors.terracotta} /> : null}
    {life.loaded && !life.rows.length && <Text style={s.body}>{invitation?'Your queued invitations will appear here.':'Your sent updates will appear here.'}</Text>}
    {!!state?.error && <Text accessibilityRole="alert" style={s.body}>{state.error}</Text>}
    {(state?.error || life.next) && <PageAction quiet compact singleLine title={state?.error ? 'Try again' : invitation?'Earlier invitations':'Earlier updates'} disabled={!!state?.busy} onPress={() => { void load(); }} />}
    {!!life.rows.length && <Text style={s.caption}>{invitation?'These counts show what was queued. Delivery may change with recipient preferences.':'Queued updates are saved in-app. Device delivery isn’t confirmed here.'}</Text>}
  </View>;
}
function createStyles(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  section: { marginTop: 20, gap: 8 }, heading: { ...T.title, fontFamily: fonts.semibold, color: Colors.asphalt },
  row: { paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border, gap: 6 },
  summary: { minHeight: 44, justifyContent: 'center', gap: 4 }, title: { ...T.body, fontFamily: fonts.medium, color: Colors.asphalt },
  body: { ...T.body, fontFamily: fonts.regular, color: Colors.textMedium }, caption: { ...T.caption, fontFamily: fonts.regular, color: Colors.textMedium },
}); }
function useStyles() { const {fonts}=useAfterglowFonts(true, 'creator'); return useMemo(()=>createStyles(fonts),[fonts]); }
