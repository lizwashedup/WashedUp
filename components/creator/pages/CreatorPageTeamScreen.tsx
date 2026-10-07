import { ScaledText as Text } from '../../ScaledText';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useCreatorPageTeam } from '../../../hooks/useCreatorPageTeam';
import { useAfterglowFonts } from '../../../hooks/useAfterglowFonts';
import { PageFrame, PageAction, pageStyles as s } from './PageFrame';
import Colors, { AfterglowColors as C, CreatorSurfaceColors } from '../../../constants/Colors';
import { pageTeamPermissions, pageTeamPermissionLabels, type PageTeamPermission, type PageTeamInvitation, type PageTeamStatus } from '../../../lib/creatorPageTeam';
import { Check, Plus, UserRound } from 'lucide-react-native';
import { AfterglowType as T } from '../../../constants/Typography';
const labels: Record<PageTeamStatus,string> = { pending: 'Awaiting acceptance', accepted: 'Accepted', declined: 'Declined', canceled: 'Canceled', expired: 'Expired' };
export default function CreatorPageTeamScreen({ pageId, invitationId }: { pageId: string; invitationId?: string }) {
  const team = useCreatorPageTeam(pageId, invitationId), { fonts } = useAfterglowFonts(true, 'creator');
  const [feedbackRevision, setFeedbackRevision] = React.useState(0);
  const feedback = team.readError || team.error || team.notice;
  React.useEffect(() => {
    // Bring an asynchronous outcome into view, without remounting inputs when it clears.
    if (feedback) setFeedbackRevision(value => value + 1);
  }, [feedback]);
  const body = [look.introduction, { fontFamily: fonts.regular }], small = [s.small, { fontFamily: fonts.regular }];
  const title = [look.title, { fontFamily: fonts.display }], row = [s.rowTitle, { fontFamily: fonts.medium, flexShrink: 1 }];
  const editable = team.ready && !team.recoveryRequired, roster = team.roster, invitation = team.invitation;
  const kind = invitation?.pageKind ?? roster?.pageKind;
  const canOpenEvents = !!roster?.canInvite || !!roster?.assignments.some(a => a.userId === team.account.viewerId && a.available && !a.revokedAt && a.permissions.includes('page_events')) || !!(invitation?.status === 'accepted' && !invitation.accessRevokedAt && invitation.currentPermissions?.includes('page_events'));
  const canEditContent = !!roster?.canInvite || !!roster?.assignments.some(a => a.userId === team.account.viewerId && a.available && !a.revokedAt && a.permissions.includes('page_content')) || !!(invitation?.status === 'accepted' && !invitation.accessRevokedAt && invitation.currentPermissions?.includes('page_content'));
  const canReviewRequests = kind === 'community' && (!!roster?.canInvite || !!roster?.assignments.some(a => a.userId === team.account.viewerId && a.available && !a.revokedAt && a.permissions.includes('membership_requests')) || !!(invitation?.status === 'accepted' && !invitation.accessRevokedAt && invitation.currentPermissions?.includes('membership_requests')));
  const open = (id: string) => { if (team.ready) router.push(`/creator/page-team?id=${pageId}&invitationId=${id}` as never); };
  const person = (name: string, role: string) => <View style={look.person}>
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={look.avatar}>
      {name === 'You' ? <UserRound size={19} strokeWidth={1.5} color={C.muted} /> : <Text style={[look.initial, { fontFamily: fonts.display }]}>{Array.from(name.trim())[0]?.toUpperCase()}</Text>}
    </View>
    <View style={look.personCopy}><Text style={row}>{name}</Text><Text style={[look.meta, { fontFamily: fonts.regular }]}>{role}</Text></View>
  </View>;
  const permissions = (selected: PageTeamPermission[], choosing = false, heading = 'Selected page permissions') => <View style={look.permissions}>
    <Text accessibilityRole="header" style={row}>{choosing ? 'Choose page permissions' : heading}</Text>
    <Text style={small}>Applies only to {invitation?.pageName ?? roster?.pageName}. The owner can edit or revoke this access.</Text>
    <View style={choosing ? look.choices : look.selectedPermissions}>
    {choosing ? pageTeamPermissions.filter(p => kind !== 'organization' || p !== 'membership_requests').map(p => <Pressable key={p} accessibilityRole="checkbox" accessibilityLabel={pageTeamPermissionLabels[p]}
      aria-checked={selected.includes(p)} accessibilityState={{ checked: selected.includes(p), disabled: !editable }} disabled={!editable} onPress={() => team.togglePermission(p)} style={[look.choice, selected.includes(p) && look.choiceSelected]}>
      <View style={look.choiceCopy}><Text style={[look.choiceTitle,{fontFamily:fonts.medium}]}>{pageTeamPermissionLabels[p]}</Text>
      <Text style={small}>{p === 'page_content' ? 'Update this page’s content.' : p === 'page_events' ? 'Create and manage this page’s event content and publication.' : 'Review requests to join this community.'}</Text></View>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[look.checkbox,selected.includes(p)&&look.checkboxSelected]}>{selected.includes(p)&&<Check size={15} color={Colors.white} strokeWidth={2}/>}</View>
    </Pressable>) : selected.map(p => <View key={p} style={look.selectedPermission}><Check size={14} color={Colors.terracotta}/><Text style={[small,look.permissionLabel]}>{pageTeamPermissionLabels[p]}</Text></View>)}
    </View>
    {!selected.length && <Text style={small}>{choosing ? 'Choose at least one permission to continue.' : 'No page permissions selected.'}</Text>}
    <Text style={[look.meta,{fontFamily:fonts.regular}]}>Ownership, teammate invitations, bank settings and platform approval stay with their existing owners. Refund access is separate.</Text>
  </View>;
  const inviteStatus = (i: PageTeamInvitation) => <>
    <View style={look.detail}><Text style={small}>Invited person</Text><Text style={row}>{i.recipientName}</Text></View>
    <View style={look.detail}><Text style={small}>Status</Text><Text style={row}>{labels[i.status]}</Text></View>
    {!!i.note && <View style={s.notice}><Text style={row}>A note from the owner</Text><Text style={small}>{i.note}</Text></View>}
  </>;
  return <PageFrame contentKey={`${invitationId ?? team.step}:${feedbackRevision}`} busy={team.busy} title={invitationId ? 'Co-creator invitation' : team.step === 'edit_access' ? 'Edit page permissions' : team.step === 'review_access' ? 'Review page access' : team.step === 'review' ? 'Review invitation' : team.step === 'invite' ? 'Invite a co-creator' : 'Team access'}
    onBack={!invitationId && team.step !== 'roster' && !team.recoveryRequired && !team.busy ? team.backToForm : undefined}>
    {team.account.isLoading || !team.loaded && team.busy ? <ActivityIndicator accessibilityLabel="Checking team access" color={C.clay} /> : null}
    {!team.account.isLoading && !team.account.viewerId && <Text style={body}>Sign in to see this page team.</Text>}
    {team.account.error && <View style={s.notice}><Text accessibilityRole="alert" style={small}>Couldn’t check your account.</Text><PageAction title="Check account" onPress={()=>void team.account.retry()} /></View>}
    {team.readError ? <View style={s.notice}><Text accessibilityRole="alert" style={small}>{team.readError}</Text><PageAction title="Check page team" disabled={team.busy} onPress={() => void team.refresh()} /></View> : team.loaded ? <>
      {(team.error || team.notice) && <View style={look.feedback}>
        {team.error && <Text accessibilityRole="alert" style={small}>{team.error}</Text>}
        {team.notice && <Text accessibilityLiveRegion="polite" style={small}>{team.notice}</Text>}
      </View>}
      {team.recoveryRequired && <View style={s.notice}><Text style={row}>Check your saved action</Text>
        <Text style={small}>We’ll check the original saved action before you continue.</Text>
        <PageAction title="Check saved status" disabled={!team.ready} onPress={() => void team.check()} />
        {team.retryReady && <PageAction title="Retry original action" disabled={!team.ready} onPress={() => void team.retry()} />}
      </View>}
      {invitation ? <>
        <Text style={[s.eyebrow,{fontFamily:fonts.semibold}]}>CO-CREATOR INVITATION</Text><Text accessibilityRole="header" style={title}>{invitation.pageName}</Text>
        {invitation.status === 'pending' && <Text style={body}>{invitation.inviterId === team.account.viewerId ? `${invitation.recipientName} can choose whether to accept your invitation.` : `${invitation.inviterName} invited you to help with this page. You choose whether to accept.`}</Text>}
        {inviteStatus(invitation)}
        {invitation.status !== 'accepted' ? permissions(invitation.permissions) : <>
          {invitation.accessRevokedAt ? <View style={s.notice}><Text accessibilityRole="header" style={row}>Page access revoked</Text><Text style={small}>This invitation no longer gives you access to the page.</Text></View>
            : permissions(invitation.currentPermissions ?? [], false, 'Current page access')}
          {(!!invitation.accessRevokedAt || invitation.permissions.length !== (invitation.currentPermissions?.length ?? 0) || invitation.permissions.some(p => !invitation.currentPermissions?.includes(p))) &&
            <Text style={small}>Original invitation: {invitation.permissions.map(p => pageTeamPermissionLabels[p]).join(' · ') || 'No page permissions selected.'}</Text>}
        </>}
        {invitation.status === 'pending' && invitation.recipientId === team.account.viewerId && <View style={{gap:12}}>
          <PageAction primary title="Accept invitation" disabled={!editable || !invitation.permissions.length} onPress={() => void team.respond(invitation,'accept')} />
          <PageAction title="Decline invitation" disabled={!editable} onPress={() => void team.respond(invitation,'decline')} />
        </View>}
        {invitation.status === 'pending' && invitation.inviterId === team.account.viewerId && <PageAction title="Cancel invitation" disabled={!editable} onPress={() => void team.respond(invitation,'cancel')} />}
        {invitation.status === 'accepted' && !invitation.accessRevokedAt && !!invitation.currentPermissions?.length && <PageAction primary title="View page team" disabled={!team.ready} onPress={() => { if (team.ready) router.dismissTo(`/creator/page-team?id=${pageId}` as never); }} />}
      </> : roster && team.editing && (team.step === 'edit_access' || team.step === 'review_access') ? <>
        <Text accessibilityRole="header" style={title}>{team.accessAction === 'revoke' ? `Revoke ${team.editing.name ?? 'this teammate'}’s access?` : `Permissions for ${team.editing.name ?? 'this teammate'}`}</Text>
        <Text style={body}>{roster.pageName}</Text>
        {team.accessAction === 'revoke' ? <Text style={body}>They’ll lose the permissions from this page assignment. Their invitation and participation history will remain. Any existing community role is separate.</Text> : permissions(team.accessPermissions, team.step === 'edit_access')}
        {team.step === 'edit_access' ? <PageAction primary title="Review permissions" disabled={!editable || !team.accessPermissions.length} onPress={() => void team.reviewAccess()} />
          : <PageAction primary title={team.accessAction === 'revoke' ? 'Revoke page access' : 'Save page permissions'} disabled={!editable} onPress={() => void team.saveAccess()} />}
      </> : roster && team.step === 'review' ? <>
        <Text style={[s.eyebrow,{fontFamily:fonts.semibold}]}>ONE PAGE · YOUR CHOICE</Text><Text accessibilityRole="header" style={title}>Invite {team.draft.person?.name}?</Text>
        <Text style={body}>They’ll be able to help only after they accept.</Text>
        <View style={look.detail}><Text style={small}>Page</Text><Text style={row}>{roster.pageName}</Text></View>
        <View style={look.detail}><Text style={small}>Role</Text><Text style={row}>Co-creator</Text></View>
        {!!team.draft.note.trim() && <View style={s.notice}><Text style={row}>Your note</Text><Text style={small}>{team.draft.note.trim()}</Text></View>}
        {permissions(team.draft.permissions)}<PageAction primary title="Send invitation" disabled={!editable || !team.draft.permissions.length} onPress={() => void team.create()} />
      </> : roster && team.step === 'invite' ? <>
        <Text style={[s.eyebrow,{fontFamily:fonts.semibold}]}>ONE PAGE · ONE PERSON</Text><Text accessibilityRole="header" style={title}>A little help goes a long way.</Text>
        <Text style={body}>Invite an existing account to help run {roster.pageName}.</Text>
        <Text style={row}>Who would you like to invite?</Text>
        <TextInput accessibilityLabel="Their exact handle" placeholder="Their exact handle" placeholderTextColor={C.muted} autoCapitalize="none" autoCorrect={false} maxLength={65} value={team.draft.handle}
          editable={editable} onChangeText={team.setHandle} style={[s.input,look.input,{fontFamily:fonts.regular}]} />
        <PageAction quiet compact title="Find person" disabled={!editable || !team.draft.handle.trim()} onPress={() => void team.lookup()} />
        {team.draft.person && <View style={s.notice}><Text style={row}>{team.draft.person.name}</Text><Text style={small}>Eligible for this page</Text></View>}
        <Text style={[row,{marginTop:16}]}>A note for them (optional)</Text>
        <TextInput accessibilityLabel="Invitation note" multiline maxLength={1000} value={team.draft.note} editable={editable} onChangeText={team.setNote}
          style={[s.input,look.input,{fontFamily:fonts.regular,minHeight:104,textAlignVertical:'top'}]} />
        {permissions(team.draft.permissions, true)}<PageAction primary title="Review invitation" disabled={!editable || !team.draft.person || !team.draft.permissions.length} onPress={() => void team.review()} />
      </> : roster ? <>
        <Text style={[s.eyebrow,{fontFamily:fonts.semibold}]}>{roster.pageKind.toUpperCase()} TEAM</Text><Text accessibilityRole="header" style={title}>{roster.pageName}</Text>
        <Text style={body}>{roster.canInvite ? 'Invite someone you trust to help run this page. They choose whether to accept.' : 'Your access belongs to this page. Other pages keep their own teams.'}</Text>
        <View style={look.roster}>
        <View style={[look.member,look.firstMember]}>{person(roster.ownerId === team.account.viewerId ? 'You' : roster.ownerName ?? 'Page owner', 'Owner')}</View>
        {roster.legacyMembers.filter(m=>m.userId!==roster.ownerId).map(m=><View key={m.memberId} style={look.member}>{person(m.userId === team.account.viewerId ? 'You' : m.name ?? 'Existing teammate', 'Existing community role')}</View>)}
        {roster.assignments.map(a=><View key={a.assignmentId} style={look.member}>
          {person(a.userId === team.account.viewerId ? 'You' : a.name ?? 'Co-creator', a.revokedAt ? 'Page access revoked' : a.available ? 'Co-creator' : 'Access unavailable')}
          {!a.revokedAt && <View style={look.memberDetails}>
            <Text style={[look.meta,{fontFamily:fonts.regular}]}>{a.permissions.map(p=>pageTeamPermissionLabels[p]).join(' · ') || 'No page permissions selected.'}</Text>
            {roster.canInvite && <View style={look.memberActions}>
              <PageAction quiet compact title="Edit permissions" accessibilityLabel={`Edit permissions for ${a.name ?? 'teammate'}`} disabled={!editable} onPress={() => team.startAccessChange(a,'edit')} />
              <PageAction quiet compact title="Revoke access" accessibilityLabel={`Revoke page access for ${a.name ?? 'teammate'}`} disabled={!editable} onPress={() => team.startAccessChange(a,'revoke')} />
            </View>}
          </View>}
        </View>)}
        </View>
        {roster.canInvite && <View style={look.inviteEntry}>
          {roster.assignments.length===0 && roster.legacyMembers.every(m=>m.userId===roster.ownerId) && <Text style={small}>You’re the only creator here so far.</Text>}
          <PageAction compact primary sunset leadingIcon={<Plus size={18} color={Colors.white} strokeWidth={1.8}/>} title="Invite a co-creator" disabled={!editable} onPress={team.startInvite} />
        </View>}
        {roster.invitations.filter(i=>!i.available||i.invitation.status!=='accepted').map(i=><View key={i.available?i.invitation.invitationId:i.invitationId} style={s.row}>
          {i.available ? <PageAction quiet title={`${i.invitation.recipientName} · ${labels[i.invitation.status]}`} disabled={!team.ready} onPress={()=>open(i.invitation.invitationId)} /> : <Text style={small}>Invitation · Access changed</Text>}
        </View>)}
      </> : null}
      {team.step === 'roster' && !invitation && <View style={look.navigation}>
      {canEditContent && <PageAction quiet disclosure title="Edit page" disabled={!team.ready || team.recoveryRequired} onPress={() => { if (team.ready && !team.recoveryRequired) router.push(`/creator/page-edit?id=${pageId}&mode=approved&from=team` as never); }} />}
      {canReviewRequests && <PageAction quiet disclosure title="Join requests" disabled={!team.ready || team.recoveryRequired} onPress={() => router.push(`/creator/page-requests?id=${pageId}` as never)} />}
      {canOpenEvents && <PageAction quiet disclosure title="Events" disabled={!team.ready || team.recoveryRequired} onPress={() => { if (team.ready && !team.recoveryRequired) router.dismissTo(`/creator/page-events?id=${pageId}` as never); }} />}
      </View>}
      <PageAction quiet compact title="Refresh team status" disabled={team.busy} onPress={() => void team.refresh()} />
    </> : null}
  </PageFrame>;
}

const look = StyleSheet.create({
  feedback: { gap: 8, marginBottom: 20 },
  title: { ...T.pageTitle, color: C.ink, marginBottom: 12 },
  introduction: { ...T.body, color: C.muted, marginBottom: 24 },
  roster: { backgroundColor: Colors.cardBg, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: CreatorSurfaceColors.goldEdge, paddingHorizontal: 16, shadowColor: C.ink, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 1 },
  member: { paddingVertical: 16, gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.subtleLine },
  firstMember: { borderTopWidth: 0 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.goldBadgeSoft, borderWidth: StyleSheet.hairlineWidth, borderColor: CreatorSurfaceColors.goldEdge, alignItems: 'center', justifyContent: 'center' },
  initial: { ...T.identity, color: C.ink },
  personCopy: { flex: 1, minWidth: 0, gap: 2 },
  meta: { ...T.caption, color: C.muted },
  memberDetails: { gap: 4 },
  memberActions: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 20 },
  inviteEntry: { gap: 12, marginVertical: 20 },
  permissions: { gap: 10, marginTop: 24, marginBottom: 24 },
  choices: { gap: 8, marginVertical: 2 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 14, minHeight: 64, backgroundColor: Colors.cardBg, borderWidth: 1, borderColor: C.subtleLine, borderRadius: 10 },
  choiceSelected: { borderColor: Colors.terracotta },
  choiceCopy: { flex: 1, minWidth: 0, gap: 4 },
  choiceTitle: { ...T.body, color: C.ink },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: C.line, justifyContent: 'center', alignItems: 'center' },
  checkboxSelected: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  selectedPermissions: { gap: 10, paddingVertical: 4 },
  selectedPermission: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  permissionLabel: { flex: 1 },
  detail: { paddingVertical: 12, gap: 5, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.subtleLine },
  input: { backgroundColor: Colors.cardBg, marginTop: 8 },
  navigation: { marginTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.subtleLine },
});
