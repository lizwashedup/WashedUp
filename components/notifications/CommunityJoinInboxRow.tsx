import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ScaledText as Text } from '../ScaledText';
import { useObservedUser } from '../../hooks/useObservedUser';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import Colors, { AfterglowColors as C } from '../../constants/Colors';
import { AfterglowType as T } from '../../constants/Typography';
import { communityJoinNoticeRoute, loadCommunityJoinNotice, markCommunityJoinNoticeRead, CommunityJoinNoticeIdentityError, type CommunityJoinNoticeType } from '../../lib/communityJoinNotification';

type Props = { notice: { id: string; type: CommunityJoinNoticeType; title: string; body: string | null }; userId: string | null; visible: boolean; onClose(): void; onRead(): void };
export function CommunityJoinInboxRow({ notice, userId, visible, onClose, onRead }: Props) {
  const router = useRouter(), viewer = useObservedUser(), { fonts } = useAfterglowFonts();
  const visit = useMemo(() => ({}), [notice.id, notice.type, userId, visible, viewer.epoch, viewer.isCurrent]);
  const committed = useRef<object | null>(null);
  useLayoutEffect(() => { committed.current = visit; return () => { if (committed.current === visit) committed.current = null; }; }, [visit]);
  const scope = useMemo(() => ({ userId, isCurrent: () => committed.current === visit && visible && !!userId && viewer.viewerId === userId && !viewer.isLoading && !viewer.error && viewer.isCurrent() }), [visit, visible, userId, viewer.viewerId, viewer.isLoading, viewer.error, viewer.isCurrent]);
  const operation = useRef<object | null>(null);
  const [state, setState] = useState<{ visit: object; busy: boolean; error?: string }>();
  const stateHere = state?.visit === visit ? state : undefined;
  const ready = visible && !!userId && viewer.viewerId === userId && !viewer.isLoading && !viewer.error;
  const open = async (dismiss = false) => {
    if (!scope.isCurrent() || operation.current === visit) return;
    operation.current = visit; setState({ visit, busy: true });
    try {
      if (dismiss) {
        await markCommunityJoinNoticeRead(notice.id, notice.type, scope);
        if (scope.isCurrent()) onRead();
        return;
      }
      const target = await loadCommunityJoinNotice(notice.id, notice.type, scope);
      if (!scope.isCurrent()) return;
      const route = target ? communityJoinNoticeRoute(target) : notice.type === 'community_join_request' ? '/(creator)/members' : null;
      let read = false;
      try { await markCommunityJoinNoticeRead(notice.id, notice.type, scope, notice.type === 'community_join_request' ? 'acted' : 'read'); read = true; }
      catch (error) { if (error instanceof CommunityJoinNoticeIdentityError || !route) throw error; }
      if (!scope.isCurrent()) return;
      if (read) onRead();
      if (route) { onClose(); router.push(route as never); }
    } catch (error) {
      if (scope.isCurrent()) setState({ visit, busy: false, error: error instanceof Error ? error.message : 'Couldn’t check this community update.' });
    } finally {
      if (operation.current === visit) operation.current = null;
      if (scope.isCurrent()) setState(old => old?.visit === visit ? { ...old, busy: false } : old);
    }
  };
  const title = stateHere?.error ? 'Check update' : notice.type === 'community_join_request' ? 'Review requests' : 'View community';
  return <View style={s.row}>
    <Text style={[s.title, { fontFamily: fonts.semibold }]}>{notice.title}</Text>
    {!!notice.body && <Text style={[s.body, { fontFamily: fonts.regular }]}>{notice.body}</Text>}
    {!!(stateHere?.error || viewer.error) && <Text accessibilityRole="alert" style={[s.body, { fontFamily: fonts.regular }]}>{stateHere?.error ?? 'Couldn’t check your account.'}</Text>}
    <View style={s.actions}>
    <Pressable accessibilityRole="button" accessibilityLabel="Dismiss notification" accessibilityState={{ disabled: !ready || !!stateHere?.busy }} disabled={!ready || !!stateHere?.busy} onPress={() => void open(true)} style={s.action}><Text style={[s.body, { fontFamily: fonts.semibold }]}>Dismiss</Text></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={viewer.error ? 'Check account' : title} accessibilityState={{ disabled: !ready && !viewer.error || !!stateHere?.busy, busy: !!stateHere?.busy }} disabled={!ready && !viewer.error || !!stateHere?.busy} onPress={() => { if (viewer.error) void viewer.retry(); else void open(); }} style={s.action}>
      <Text style={[s.actionText, { fontFamily: fonts.semibold }]}>{stateHere?.busy ? 'Checking…' : viewer.error ? 'Check account' : title}</Text>
    </Pressable>
    </View>
  </View>;
}
const s = StyleSheet.create({
  row: { paddingHorizontal: 16, paddingVertical: 14, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  title: { ...T.title, color: C.ink }, body: { ...T.body, color: C.muted },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 },
  action: { alignSelf: 'flex-end', minHeight: 48, paddingHorizontal: 12, justifyContent: 'center' },
  actionText: { ...T.body, color: Colors.terracotta },
});
