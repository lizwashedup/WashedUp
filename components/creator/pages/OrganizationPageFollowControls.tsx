import React, { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { AfterglowColors, SceneDetailColors } from '../../../constants/Colors';
import { AfterglowType as T } from '../../../constants/Typography';
import { useAfterglowFonts } from '../../../hooks/useAfterglowFonts';
import { useCreatorPageRead } from '../../../hooks/useCreatorPageRead';
import { readOrganizationFollowerCount, readOrganizationFollowState, readPendingOrganizationFollow, prepareOrganizationFollow,
  sendOrganizationFollowAttempt, resolveOrganizationFollowAttempt, checkOrganizationFollowAttempt } from '../../../lib/organizationPageFollow';
import type { PageImageScope } from '../../../lib/publishedPageCover';
import type { CreatorPageScope } from '../../../lib/creatorPageReview';
import { MEMBER_COUNT_THRESHOLD } from '../../../lib/socialProof';
/** Shared page-follow protocol for the public page and its saved event. Legacy follows stay separate. */
export function OrganizationPageFollowControls({ pageId, ownerId, scope, surface = 'scene', preview = false, onPreview }: {
  pageId: string; ownerId: string | null; scope: PageImageScope | null; surface?: 'scene' | 'light'; preview?: boolean; onPreview?: () => void;
}) {
  const { fonts } = useAfterglowFonts(true, 'creator');
  const C = surface === 'scene' ? SceneDetailColors : { text: AfterglowColors.ink, supporting: AfterglowColors.muted, line: AfterglowColors.line, actionText: AfterglowColors.paper };
  const readFollowing = useCallback(async (owned: PageImageScope) => {
    const count = await readOrganizationFollowerCount(pageId, owned);
    if (preview || !owned.userId) return { count, state: null, pending: null };
    const signedIn = owned as CreatorPageScope;
    let [state, pending] = await Promise.all([readOrganizationFollowState(pageId, signedIn), readPendingOrganizationFollow(pageId, signedIn)]);
    if (pending) {
      const checked = await checkOrganizationFollowAttempt(pending, signedIn);
      state = checked.state;
      if (checked.receipt) pending = null;
    }
    return { count, state, pending };
  }, [pageId, preview]);
  const followRead = useCreatorPageRead(scope, readFollowing);
  const [activity, setActivity] = useState<{ scope: PageImageScope; busy: boolean; message?: string }>();
  const operation = useRef<PageImageScope | null>(null);
  const active = activity?.scope === scope ? activity : undefined;
  const busy = !!active?.busy, ownPage = !!scope?.userId && scope.userId === ownerId;
  const pending = preview ? null : followRead.data?.pending;
  const follow = (mode: 'toggle' | 'check' | 'retry') => {
    if (preview) { onPreview?.(); return; }
    if (!scope?.userId || !scope.isCurrent() || operation.current === scope || !followRead.data?.state || followRead.loading || followRead.error) return;
    const owned = scope as CreatorPageScope, state = followRead.data.state;
    if (mode === 'toggle' && (pending || ownPage)) return;
    operation.current = owned; setActivity({ scope: owned, busy: true });
    void (async () => {
      try {
        const attempt = mode === 'toggle' ? await prepareOrganizationFollow(state, !state.following, owned) : pending;
        if (!attempt || !owned.isCurrent()) return;
        if (mode !== 'check') await sendOrganizationFollowAttempt(attempt, owned);
        if (!owned.isCurrent()) return;
        await resolveOrganizationFollowAttempt(attempt, owned);
        if (!owned.isCurrent()) return;
        await followRead.refresh();
        if (owned.isCurrent()) setActivity({ scope: owned, busy: false });
      } catch {
        if (owned.isCurrent()) {
          const checked = await followRead.refresh().catch(() => undefined);
          if (owned.isCurrent()) setActivity({ scope: owned, busy: false, message: checked?.state && !checked.pending ? undefined : 'Following could not be confirmed. Check the saved status before trying again.' });
        }
      } finally { if (operation.current === owned) operation.current = null; if (owned.isCurrent()) setActivity(old => old?.scope === owned ? { ...old, busy: false } : old); }
    })();
  };
  const action = (title: string, onPress: () => void, disabled = false, primary = false) => <Pressable accessibilityRole="button" accessibilityLabel={title}
    accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[s.action, { borderColor: C.line }, primary && { backgroundColor: C.text }, disabled && { opacity: 0.55 }]}>
    <Text numberOfLines={1} style={[s.actionText, { fontFamily: fonts.semibold, color: primary ? C.actionText : C.text }]}>{title}</Text></Pressable>;
  return (
          <View style={{ gap: 12, marginTop: 20 }}>
            {ownPage && !preview && action('Manage', () => router.push(`/creator/page?id=${pageId}` as never))}
            {!!followRead.error && <View><Text accessibilityRole="alert" style={[s.body, { color: C.text, fontFamily: fonts.regular }]}>Following could not be checked.</Text>{action('Check following', () => { void followRead.refresh().catch(() => undefined); })}</View>}
            {!preview && !!active?.message && <Text accessibilityRole="alert" style={[s.body, { color: C.text, fontFamily: fonts.regular }]}>{active.message}</Text>}
            {!!pending ? <View style={{ gap: 10 }}><Text style={[s.body, { color: C.text, fontFamily: fonts.regular }]}>Your {pending.following ? 'follow' : 'unfollow'} has not been confirmed. The original attempt is saved.</Text>
              {action('Check following', () => follow('check'), busy || followRead.loading || !!followRead.error)}
              {action('Retry same action', () => follow('retry'), busy || followRead.loading || !!followRead.error)}</View>
              : preview ? action('Follow', () => onPreview?.()) : !!scope?.userId && !ownPage && followRead.data?.state && action(busy ? 'Saving…' : followRead.data.state.following ? 'Following' : 'Follow', () => follow('toggle'), busy || followRead.loading || !!followRead.error)}
            {followRead.data?.count !== null && followRead.data?.count !== undefined && followRead.data.count >= MEMBER_COUNT_THRESHOLD && <Text style={[s.meta, { color: C.supporting, fontFamily: fonts.regular }]}>{followRead.data.count} following</Text>}
            {(preview || !!scope?.userId && !ownPage) && <Text style={[s.meta, { color: C.supporting, fontFamily: fonts.regular }]}>Following doesn’t join a community or add you to a chat.</Text>}
          </View>
  );
}
const s = StyleSheet.create({
  action: { alignSelf:'flex-start', minHeight:44, paddingHorizontal:22, paddingVertical:10, borderWidth:1, borderRadius:24, justifyContent:'center', alignItems:'center' },
  actionText: { ...T.title },
  body: { ...T.message },
  meta: { ...T.caption },
});
