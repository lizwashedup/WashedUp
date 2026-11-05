/** Creator help uses the current account’s actual roles and approval records. */
import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Linking, View } from 'react-native';
import { ScaledText as Text } from '../../components/ScaledText';
import Colors from '../../constants/Colors';
import { PageAction, PageFrame, pageStyles as s } from '../../components/creator/pages/PageFrame';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { useCreatorAccessRead } from '../../hooks/useCreatorAccessRead';
import { useCreatorPageScope } from '../../hooks/useCreatorPageScope';
import { useCreatorPageRead } from '../../hooks/useCreatorPageRead';
import { fetchMyGrants, type OperatorGrantStatus } from '../../lib/operatorApplications';
import type { CommunityMemberRole } from '../../lib/creatorMode';
import type { CreatorPageScope } from '../../lib/creatorPageReview';
import { requestWithDeadline } from '../../lib/requestWithDeadline';

const roleLabels: Record<CommunityMemberRole, string> = {
  leader: 'Leader', co_leader: 'Co-leader', admin: 'Admin', events: 'Events',
  member_care: 'Member care', finance: 'Finance', member: 'Member',
};
const approvalLabels: Record<OperatorGrantStatus, string> = {
  applied: 'Submitted', in_review: 'In review', needs_more_info: 'More information needed',
  approved: 'Approved', declined: 'Not approved', withdrawn: 'Withdrawn', revoked: 'Access revoked',
};
const questions = [
  { title: 'Where do I manage my community?',
    answer: 'Open your community and tap Settings. You can also find your communities and organizations in Yours → You manage.' },
  { title: 'Who changes joining and visibility?',
    answer: 'A community’s leader or co-leader can change Joining settings and Visibility & link in Community settings. Your role can be different in each community.' },
  { title: 'Where do I manage an event?',
    answer: 'Open Events for the community or organization that created it, then choose the event. The available tools depend on your event access.' },
  { title: 'Is following the same as joining?',
    answer: 'No. Following an organization does not make someone a community member or give them community chat access.' },
  { title: 'Where can I check payments?',
    answer: 'Open Money & payouts to check the payment information available to your account. Review the event’s ticket settings for its fees and payment details.' },
];

export default function CreatorHelpScreen() {
  const access = useCreatorAccessRead();
  const observed = useCreatorPageScope('creator-help');
  const scope = !observed.account.isLoading && !observed.account.error ? observed.scope : null;
  const loadGrants = useCallback(async (owned: CreatorPageScope) => {
    const grants = await requestWithDeadline(fetchMyGrants(owned.userId), 12_000);
    if (!owned.isCurrent()) throw Error('This account changed.');
    return grants;
  }, []);
  const grants = useCreatorPageRead(scope, loadGrants);
  const { fonts } = useAfterglowFonts(true, 'creator');
  const body = [s.small, { fontFamily: fonts.regular }];
  const heading = [s.rowTitle, { fontFamily: fonts.medium }];
  const [support, setSupport] = useState<{ scope: CreatorPageScope; busy: boolean; failed: boolean }>();
  const supportLock = useRef(false);
  const ownSupport = support?.scope === scope ? support : undefined;
  const openSupport = async () => {
    if (!scope?.isCurrent() || supportLock.current) return;
    const owned = scope;
    supportLock.current = true;
    setSupport({ scope: owned, busy: true, failed: false });
    try {
      await Linking.openURL('mailto:hello@washedup.app');
      if (owned.isCurrent()) setSupport({ scope: owned, busy: false, failed: false });
    } catch {
      if (owned.isCurrent()) setSupport({ scope: owned, busy: false, failed: true });
    } finally { supportLock.current = false; }
  };
  const approvalsFailed = !!observed.account.error || !!grants.error;
  const approvalsLoading = observed.account.isLoading || grants.loading;
  const signedOut = observed.account.viewerId === null;
  return <PageFrame title="Help & permissions">
    <Text accessibilityRole="header" style={[s.section, { fontFamily: fonts.display }]}>Your access</Text>
    {access.isLoading ? <ActivityIndicator accessibilityLabel="Checking creator access" color={Colors.terracotta} />
      : access.isError ? <View style={s.notice}>
        <Text accessibilityRole="alert" style={body}>Couldn’t check your creator access.</Text>
        <PageAction title="Try again" singleLine accessibilityLabel="Retry creator access" disabled={access.isFetching} onPress={() => void access.refetch()} />
      </View> : <>
        <Text style={body}>These roles apply to the community named below. Access in one community does not change your role in another.</Text>
        {access.data?.ledCommunities.map(community => <View key={community.id} style={s.row}>
          <Text style={heading}>{community.name}</Text>
          <Text style={body}>{roleLabels[community.role] ?? 'Team member'}</Text>
        </View>)}
        {access.data?.hasEventHostGrant && <View style={s.row}>
          <Text style={heading}>Event creator</Text><Text style={body}>Approved to create events as yourself or an organization.</Text>
        </View>}
        {access.data?.hasLeaderGrant && <View style={s.row}>
          <Text style={heading}>Community creator</Text><Text style={body}>Approved to start a community. Each community keeps its own team roles.</Text>
        </View>}
        {access.data && access.data.ledCommunities.length === 0 && !access.data.hasLeaderGrant && !access.data.hasEventHostGrant &&
          <Text style={body}>{signedOut ? 'Sign in to check your creator access.' : 'No active creator access on this account. Check your application status below.'}</Text>}
      </>}

    <Text accessibilityRole="header" style={[s.section, { fontFamily: fonts.display }]}>Application status</Text>
    {approvalsFailed ? <View style={s.notice}>
      <Text accessibilityRole="alert" style={body}>Couldn’t load your application status.</Text>
      <PageAction title="Try again" singleLine accessibilityLabel="Retry application status" disabled={approvalsLoading}
        onPress={() => void (observed.account.error ? observed.account.retry() : grants.refresh()).catch(() => undefined)} />
    </View> : approvalsLoading ? <ActivityIndicator accessibilityLabel="Checking application status" color={Colors.terracotta} />
      : signedOut ? <Text style={body}>Sign in to view your applications.</Text>
      : grants.data ? <>
        {([{track:'community_leader', title:'Community creator'}, {track:'event_host', title:'Event creator'}] as const).map(item => {
          const grant = grants.data?.find(value => value.track === item.track);
          return <View style={s.row} key={item.track}>
            <Text style={heading}>{item.title}</Text>
            <Text style={body}>{grant ? approvalLabels[grant.status] ?? 'Status unavailable' : 'No application'}</Text>
            {!!grant?.applicant_message && <Text style={body}>{grant.applicant_message}</Text>}
          </View>;
        })}
        <Text style={[body, { marginTop: 12 }]}>These are separate approvals. A team role in an existing community is shown above.</Text>
      </> : null}

    <Text accessibilityRole="header" style={[s.section, { fontFamily: fonts.display }]}>Common questions</Text>
    {questions.map(item => <View style={s.row} key={item.title}>
      <Text style={heading}>{item.title}</Text><Text style={body}>{item.answer}</Text>
    </View>)}
    <View style={[s.notice, { marginTop: 24 }]}>
      <Text style={body}>Need help? Email hello@washedup.app.</Text>
      <PageAction title={ownSupport?.busy ? 'Opening…' : 'Contact support'} singleLine primary
        disabled={!scope || !!ownSupport?.busy} onPress={() => void openSupport()} />
      {ownSupport?.failed && <Text accessibilityRole="alert" selectable style={body}>Email didn’t open. Try again or email hello@washedup.app from your mail app.</Text>}
    </View>
  </PageFrame>;
}
