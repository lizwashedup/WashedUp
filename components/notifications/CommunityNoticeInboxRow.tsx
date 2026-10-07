import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Colors, { AfterglowColors as C } from '../../constants/Colors';
import { AfterglowType as T } from '../../constants/Typography';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { CreatorActionFill } from '../creator/CreatorActionFill';
import { loadCommunityNoticeRoute, markCommunityNoticeRead } from '../../lib/communityNoticeDestination';

type Props = { notice: { id: string; title: string; body: string | null }; userId: string | null; visible: boolean; enabled: boolean; onClose(): void; onRead(): void };
export function CommunityNoticeInboxRow({ notice, userId, visible, enabled, onClose, onRead }: Props) {
  const router = useRouter(), { fonts } = useAfterglowFonts();
  const visit = useMemo(() => ({}), [notice.id, userId, visible, enabled]);
  const latest = useRef(visit); latest.current = visit;
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const scope = useMemo(() => ({ userId, isCurrent: () => mounted.current && visible && latest.current === visit }), [userId, visible, visit]);
  const operation = useRef<object | null>(null);
  const [state, setState] = useState<{ visit: object; busy?: 'open' | 'dismiss'; error?: string }>();
  const current = state?.visit === visit ? state : undefined;
  const act = (action: 'open' | 'dismiss') => {
    if (!scope.isCurrent() || operation.current === visit) return;
    if (action === 'open' && !enabled) { onClose(); router.push('/(tabs)/chats'); return; }
    operation.current = visit; setState({ visit, busy: action });
    void (async () => {
      try {
        if (action === 'dismiss') {
          await markCommunityNoticeRead(notice.id, scope);
          if (scope.isCurrent()) onRead();
        } else {
          const route = await loadCommunityNoticeRoute(notice.id, scope);
          if (!scope.isCurrent()) return;
          if (!route) throw new Error('This conversation is no longer available.');
          // A failed read receipt cannot replace the confirmed destination.
          try { await markCommunityNoticeRead(notice.id, scope); }
          catch (error) {
            // Account/visit ownership is required even when the receipt is optional.
            if (error instanceof Error && error.name === 'CommunityNoticeIdentityError') throw error;
          }
          if (!scope.isCurrent()) return;
          onRead(); onClose(); router.push(route as never);
        }
      } catch (error) {
        if (scope.isCurrent()) setState({ visit, error: error instanceof Error ? error.message : 'Couldn’t open this conversation. Try again.' });
      } finally {
        if (operation.current === visit) operation.current = null;
        if (scope.isCurrent()) setState(old => old?.visit === visit ? { ...old, busy: undefined } : old);
      }
    })();
  };
  return <View style={s.row}>
    <View style={s.content}>
      <Text style={[s.title, { fontFamily: fonts.semibold }]}>{notice.title}</Text>
      {!!notice.body && <Text numberOfLines={3} style={[s.body, { fontFamily: fonts.regular }]}>{notice.body}</Text>}
    </View>
    {!!current?.error && <Text accessibilityRole="alert" style={[s.body, { fontFamily: fonts.regular }]}>{current.error}</Text>}
    <View style={s.actions}>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss notification" accessibilityState={{ disabled: !!current?.busy }} disabled={!!current?.busy} onPress={() => act('dismiss')} style={s.dismiss}>
        <Text style={[s.body, { fontFamily: fonts.semibold }]}>{current?.busy === 'dismiss' ? 'Dismissing…' : 'Dismiss'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Open chat" accessibilityState={{ disabled: !!current?.busy }} disabled={!!current?.busy} onPress={() => act('open')} style={s.open}>
        <CreatorActionFill />
        <Text style={[s.actionText, { fontFamily: fonts.semibold }]}>{current?.busy === 'open' ? 'Opening…' : 'Open chat'}</Text>
      </Pressable>
    </View>
  </View>;
}
const s = StyleSheet.create({
  row: { paddingHorizontal: 16, paddingVertical: 14, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  content: { gap: 5 }, title: { ...T.title, color: C.ink }, body: { ...T.body, color: C.muted },
  actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 16 },
  dismiss: { minHeight: 44, justifyContent: 'center', flexShrink: 1 },
  open: { minHeight: 44, minWidth: 104, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 24, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  actionText: { ...T.section, color: Colors.white },
});
