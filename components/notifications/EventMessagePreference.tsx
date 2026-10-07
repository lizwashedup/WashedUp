import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AfterglowColors as Light, SceneDetailColors as Scene } from '../../constants/Colors';
import { Fonts, AfterglowType as T } from '../../constants/Typography';
import { useCreatorPageScope } from '../../hooks/useCreatorPageScope';
import type { CreatorPageScope } from '../../lib/creatorPageReview';
import { readEventMessagePreference, saveEventMessagePreference } from '../../lib/eventMessagePreference';

type State = { scope: CreatorPageScope; muted?: boolean; busy: boolean; error?: string };
/** Quiet, event-specific control shared by the existing event and update routes. */
export function EventMessagePreference({ eventId, dark = false }: { eventId: string; dark?: boolean }) {
  const { scope, account } = useCreatorPageScope(`event-message-preference:${eventId}`);
  const [state, setState] = useState<State>();
  const pending = useRef<CreatorPageScope | null>(null);
  const sequence = useRef(0);
  const read = useCallback(async () => {
    if (!scope?.isCurrent() || pending.current === scope) return;
    pending.current = scope;
    const attempt = ++sequence.current;
    setState(old => ({ scope, muted: old?.scope === scope ? old.muted : undefined, busy: true }));
    try {
      const muted = await readEventMessagePreference(eventId, scope);
      if (scope.isCurrent() && attempt === sequence.current) setState({ scope, muted, busy: false });
    } catch {
      if (scope.isCurrent() && attempt === sequence.current) setState(old => ({ scope,
        muted: old?.scope === scope ? old.muted : undefined, busy: false, error: 'Could not check event updates.' }));
    } finally { if (pending.current === scope) pending.current = null; }
  }, [eventId, scope]);
  useEffect(() => { void read(); }, [read]);

  const current = state?.scope === scope ? state : undefined;
  const toggle = async () => {
    if (!scope?.isCurrent() || account.error || account.isLoading || pending.current === scope
      || !current || current.error || typeof current.muted !== 'boolean') return;
    pending.current = scope;
    const attempt = ++sequence.current;
    const muted = !current.muted;
    setState({ ...current, busy: true });
    try {
      await saveEventMessagePreference(eventId, muted, scope);
      if (scope.isCurrent() && attempt === sequence.current) setState({ scope, muted, busy: false });
    } catch {
      // Resolve a lost acknowledgement by reading; never blindly repeat a write.
      if (scope.isCurrent() && attempt === sequence.current) setState({ scope, muted: current.muted,
        busy: false, error: 'Your change could not be confirmed. Check its status.' });
    } finally { if (pending.current === scope) pending.current = null; }
  };
  if (!scope || account.error || account.isLoading) return null;
  const ink = dark ? Scene.text : Light.ink;
  const mutedInk = dark ? Scene.supporting : Light.muted;
  const busy = !current || current.busy;
  const action = current?.error ? 'Check status' : current?.muted ? 'Allow updates' : 'Mute updates';
  return <View style={[s.section, { borderTopColor: dark ? Scene.border : Light.line }]}>
    <View style={s.row}>
      <Text style={[s.heading, { color: ink }]}>Event updates</Text>
      {busy ? <ActivityIndicator color={mutedInk} accessibilityLabel="Checking event updates" /> :
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={action} style={s.action}
          onPress={() => { void (current?.error ? read() : toggle()); }}>
          <Text style={[s.actionText, { color: ink }]}>{action}</Text>
        </TouchableOpacity>}
    </View>
    <Text accessibilityLiveRegion="polite" style={[s.copy, { color: mutedInk }]}>
      {current?.error ?? (current?.muted === true ? 'Regular updates and reminders are muted for this event.' :
        current?.muted === false ? 'Regular updates and reminders are allowed for this event.' : 'Checking your preference…')}
    </Text>
    <Text style={[s.copy, { color: mutedInk }]}>Essential cancellation, venue and time changes aren’t muted.</Text>
  </View>;
}
const s = StyleSheet.create({
  section: { marginTop: 12, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, gap: 3 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  heading: { ...T.body, fontFamily: Fonts.sansSemibold },
  copy: { ...T.caption, fontFamily: Fonts.sans },
  action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  actionText: { ...T.body, fontFamily: Fonts.sansMedium, textDecorationLine: 'underline' },
});
