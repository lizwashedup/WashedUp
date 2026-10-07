import React, { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { PageFrame, PageAction } from './PageFrame';
import { useCreatorPageScope } from '../../../hooks/useCreatorPageScope';
import { usePageMembershipRequests } from '../../../hooks/usePageMembershipRequests';
import { useAfterglowFonts } from '../../../hooks/useAfterglowFonts';
import { AfterglowColors as C } from '../../../constants/Colors';
import { AfterglowType as T } from '../../../constants/Typography';
import type { MembershipDecision } from '../../../lib/pageMembershipRequests';
export default function CreatorPageRequestsScreen({ pageId }: { pageId: string }) {
  const { scope, account } = useCreatorPageScope(`requests:${pageId}`), { fonts } = useAfterglowFonts(true, 'creator');
  const requests = usePageMembershipRequests(pageId, scope);
  const [feedbackRevision, setFeedbackRevision] = useState(0);
  const feedback = requests.error || requests.message;
  useEffect(() => { if (feedback) setFeedbackRevision(value => value + 1); }, [feedback]);
  const [expanded, setExpanded] = useState<string>();
  const [confirmation, setConfirmation] = useState<MembershipDecision>();
  useEffect(() => { setExpanded(undefined); setConfirmation(undefined); }, [scope, account.error, account.isLoading]);
  useEffect(() => setConfirmation(undefined), [requests.inbox]);
  const body = [s.body, { fontFamily: fonts.regular }], meta = [s.meta, { fontFamily: fonts.regular }];
  const canReview = !!scope && !account.error && !account.isLoading;
  const confirm = () => { if (canReview && confirmation && requests.ready) { const saved = confirmation; setConfirmation(undefined); void requests.decide(saved); } };
  return <PageFrame title="Join requests" onBack={() => router.canGoBack() ? router.back() : router.replace(`/creator/page-team?id=${pageId}` as never)} busy={requests.busy} contentKey={`${pageId}:${feedbackRevision}`}>
    {(account.isLoading || requests.loading) && <ActivityIndicator color={C.clay} accessibilityLabel="Loading requests" />}
    {canReview && requests.inbox && <View style={s.identity}><Text style={[s.eyebrow, { fontFamily: fonts.medium }]}>COMMUNITY</Text><Text accessibilityRole="header" style={[s.heading, { fontFamily: fonts.display }]}>{requests.inbox.pageName}</Text><Text style={meta}>Review the people who’d like to join.</Text></View>}
    {(account.error || requests.error) && <View style={s.notice}><Text accessibilityRole="alert" style={body}>{account.error ? 'Check your sign-in to review requests.' : requests.error}</Text><PageAction title="Check status" compact quiet disabled={requests.busy} onPress={() => void (account.error ? account.retry() : requests.load())} /></View>}
    {!account.isLoading && !scope && !account.error && <Text style={body}>Sign in to review requests.</Text>}
    {canReview && requests.message && <Text accessibilityRole="alert" style={[...meta, s.message]}>{requests.message}</Text>}
    {canReview && requests.pending && requests.retry && !requests.error && <PageAction title={requests.pending.approve ? 'Retry approval' : 'Retry decline'} compact disabled={requests.busy} onPress={() => void requests.decide(requests.pending!)} />}
    {canReview && requests.inbox && !requests.error && <>
      <View style={s.listHeading}><Text accessibilityRole="header" style={[s.label, { fontFamily: fonts.semibold }]}>Awaiting review{requests.inbox.nextCursor ? '' : ` · ${requests.inbox.requests.length}`}</Text><PageAction title="Refresh" compact quiet disabled={requests.busy} onPress={() => void requests.load()} /></View>
      {!requests.inbox.requests.length && !requests.inbox.nextCursor && <View style={s.empty}><Text style={[s.label, { fontFamily: fonts.medium }]}>You’re all caught up</Text><Text style={meta}>New requests will appear here for your team to review.</Text></View>}
      {requests.inbox.requests.map(request => {
        const open = expanded === request.memberId;
        const name = [request.firstName, request.lastName].filter(Boolean).join(' ') || 'Community member';
        return <View key={request.memberId} style={s.card}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Review ${name}`} accessibilityState={{ expanded: open, disabled: !!requests.busy }} disabled={requests.busy} onPress={() => { if (!open) requests.clearMessage(); setExpanded(open ? undefined : request.memberId); setConfirmation(undefined); }} style={s.summary}>
            <View style={s.initial}><Text style={[s.label, { fontFamily: fonts.medium }]}>{(request.firstName || 'M').slice(0, 1)}</Text></View>
            <View style={s.name}><Text style={[s.label, { fontFamily: fonts.semibold }]}>{name}</Text><Text style={meta}>{new Date(request.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</Text></View>
            {open ? <ChevronUp size={18} color={C.muted} /> : <ChevronDown size={18} color={C.muted} />}
          </Pressable>
          {request.introduction ? <Text numberOfLines={open ? undefined : 2} style={body}>{request.introduction}</Text> : <Text style={meta}>Introduction unavailable</Text>}
          {open && <>
            <View style={s.answers}><Text style={[s.eyebrow, { fontFamily: fonts.medium }]}>PRIVATE JOINING ANSWERS</Text>
              {[["Why they’d like to join", request.reason], ['How they found you', request.source], [request.question || 'Additional answer', request.answer]].filter(([, answer]) => !!answer).map(([label, answer]) => <View key={label} style={s.answer}><Text style={[s.meta, { fontFamily: fonts.semibold }]}>{label}</Text><Text style={body}>{answer}</Text></View>)}
              {request.rulesConfirmed !== null && <Text style={meta}>{request.rulesConfirmed ? 'Membership requirement confirmed' : 'Membership requirement not confirmed'}</Text>}
              {request.guidelinesAcceptedAt && <Text style={meta}>Community guidelines accepted</Text>}
            </View>
            {confirmation?.memberId === request.memberId ? <View style={s.confirmation}><Text style={body}>{confirmation.approve ? `Approve ${name}? Their introduction will appear in the community.` : `Decline ${name}’s request? They’ll receive a private update.`}</Text><View style={s.actions}><PageAction title={confirmation.approve ? 'Approve' : 'Decline'} compact primary singleLine disabled={!requests.ready} onPress={confirm} /><PageAction title="Cancel" compact quiet disabled={requests.busy} onPress={() => setConfirmation(undefined)} /></View></View>
              : <View style={s.actions}><PageAction title="Approve" compact primary singleLine disabled={!requests.ready} onPress={() => setConfirmation(requests.choose(request, true))} /><PageAction title="Decline" compact quiet disabled={!requests.ready} onPress={() => setConfirmation(requests.choose(request, false))} /></View>}
          </>}
        </View>;
      })}
      {requests.inbox.nextCursor && <PageAction title="Load more" compact disabled={!requests.ready} onPress={() => void requests.more()} />}
    </>}
  </PageFrame>;
}
const s = StyleSheet.create({
  identity: { gap: 4, paddingBottom: 16 }, heading: { ...T.pageTitle, color: C.ink }, eyebrow: { ...T.timestamp, letterSpacing: 0.8, color: C.muted },
  body: { ...T.body, color: C.ink }, meta: { ...T.timestamp, color: C.muted }, label: { ...T.title, color: C.ink },
  listHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  card: { backgroundColor: C.white, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line, padding: 14, gap: 10, marginBottom: 12 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }, name: { flex: 1, gap: 3 },
  initial: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: C.paper },
  answers: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line, paddingTop: 12, gap: 10 }, answer: { gap: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, alignItems: 'center', paddingTop: 4 },
  confirmation: { gap: 10, paddingTop: 4 }, notice: { gap: 6, paddingVertical: 12 }, message: { paddingBottom: 12 }, empty: { gap: 6, paddingVertical: 18 },
});
