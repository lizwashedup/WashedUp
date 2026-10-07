import { ScaledText as Text } from '../ScaledText';
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { MessageCircle, Hand, Users } from 'lucide-react-native';
import { CreatorActionFill } from '../creator/CreatorActionFill';
import BrandColors, { AfterglowColors as Colors, CreatorSurfaceColors } from '../../constants/Colors';
import { AfterglowType } from '../../constants/Typography';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { useObservedUser } from '../../hooks/useObservedUser';
import { useCommunityRoomDirectory } from '../../hooks/useCommunityRoomDirectory';
import { useCreatorCommunityGroups } from '../../hooks/useCreatorCommunityGroups';
import { BrandedAlert } from '../BrandedAlert';
import type { CommunityRoomIdentity } from '../../lib/communityRoomHistory';

type Props = { communityId: string; enabled: boolean; preview?: boolean; fallback?: React.ReactNode; onOpen: (room: CommunityRoomIdentity) => void };
export function CommunityRoomDirectory({ communityId, enabled, preview = false, fallback, onOpen }: Props) {
  const viewer = useObservedUser(), { fonts } = useAfterglowFonts();
  const directory = useCommunityRoomDirectory(communityId, viewer, enabled && !preview);
  const creator = useCreatorCommunityGroups(communityId, viewer, enabled && !preview && !!directory.data);
  const key = JSON.stringify([communityId, viewer.viewerId, viewer.epoch]);
  const [confirmation, setConfirmation] = useState<{ key: string; room: CommunityRoomIdentity } | null>(null);
  const button = (label: string, name: string, action: () => void, disabled = false, primary = false) => <TouchableOpacity
    accessibilityRole="button" accessibilityLabel={name} accessibilityState={{ disabled }} disabled={disabled}
    onPress={action} style={[styles.button, primary && styles.primaryButton, disabled && styles.disabled]}>
    {primary && <CreatorActionFill/>}<Text style={[styles.action, { fontFamily: fonts.semibold }, primary && styles.primaryAction]}>{label}</Text>
  </TouchableOpacity>;
  if (preview) return <>{fallback}</>;
  if (!enabled && !directory.data) return null;
  // Legacy communities supply a complete directory. Do not nest it in the
  // loading card: its start alignment shrank every room to intrinsic width.
  if (directory.ready && directory.data === null && !directory.error && !directory.loading && fallback) {
    return <View style={styles.fallback}>{fallback}</View>;
  }
  if (!directory.data) return <View style={[styles.section, styles.stateCard]}>
    <Text accessibilityRole="header" style={[styles.heading, { fontFamily: fonts.semibold }]}>Chats</Text>
    {directory.loading ? <><ActivityIndicator color={Colors.clay} accessibilityLabel="Loading community chats"/><Text style={[styles.body, { fontFamily: fonts.regular }]}>Getting your conversations ready…</Text></> : directory.error ? <>
      <Text style={[styles.body, { fontFamily: fonts.regular }]}>Your chats couldn’t load. Try again.</Text>
      {button('Try again', 'Retry community chats', () => { void directory.refresh(); }, directory.fetching, true)}
    </> : directory.ready && directory.data === null ? <>{fallback ?? <Text style={[styles.body, { fontFamily: fonts.regular }]}>Community chats aren’t available yet.</Text>}</> : <>
      <Text style={[styles.body, { fontFamily: fonts.regular }]}>Sign in to see your community chats.</Text>
      {button('Check account', 'Check your account', () => { void directory.refresh(); })}
    </>}
  </View>;
  const pending = directory.pending;
  const creatorBusy = creator.busy || !!creator.form;
  return <View style={[styles.section, styles.sunsetSection]}>
    <LinearGradient pointerEvents="none" colors={[CreatorSurfaceColors.sunsetGoldLight, CreatorSurfaceColors.sunsetGoldMiddle, CreatorSurfaceColors.sunsetGoldWarm]} locations={[0,0.55,1]} start={{x:0,y:0}} end={{x:1,y:1}} style={StyleSheet.absoluteFill}/>
    <Text accessibilityRole="header" style={[styles.heading, { fontFamily: fonts.semibold }]}>Chats</Text>
    <Text style={[styles.body, { fontFamily: fonts.regular }]}>Say hello, catch up, or join a conversation that interests you.</Text>
    {!!creator.error && !creator.allowed && <View accessibilityLiveRegion="polite">
      <Text style={[styles.body, { fontFamily: fonts.regular }]}>{creator.error}</Text>
      {button('Try again', 'Retry creator tools', () => { void creator.refresh(); }, creator.busy)}
    </View>}
    {creator.allowed && <View style={styles.editor}>
      {!!creator.notice && <Text accessibilityLiveRegion="polite" style={[styles.body, { fontFamily: fonts.regular }]}>{creator.notice}</Text>}
      {!!creator.error && <Text accessibilityLiveRegion="polite" style={[styles.body, { fontFamily: fonts.regular }]}>{creator.error}</Text>}
      {creator.form ? <>
        <Text accessibilityRole="header" style={[styles.name, { fontFamily: fonts.semibold }]}>{creator.form.kind === 'create' ? 'New group' : `Rename ${creator.form.room.name}`}</Text>
        <Text style={[styles.body, { fontFamily: fonts.regular }]}>{creator.form.kind === 'create' ? 'You’ll join this group. Other community members can choose to join.' : 'Your conversation and its history stay together.'}</Text>
        <TextInput accessibilityLabel="Chat name" placeholder="Chat name" placeholderTextColor={Colors.muted}
          value={creator.form.draft} onChangeText={creator.setDraft} editable={creator.ready && !creator.form.pending}
          maxLength={120} autoCapitalize="sentences" returnKeyType="done" onSubmitEditing={() => { void creator.submit(); }}
          style={[styles.input, { fontFamily: fonts.regular }]} />
        <Text style={[styles.body, { fontFamily: fonts.regular }]}>1–60 characters</Text>
        {creator.form.pending ? <>
          <Text accessibilityLiveRegion="polite" style={[styles.body, { fontFamily: fonts.regular }]}>{creator.busy ? 'Saving your change…' : creator.form.retryReady ? 'No matching change is confirmed. Retry the saved request when you’re ready.' : 'Check your saved change before trying again.'}</Text>
          <View style={styles.actions}>
            {button('Check status', 'Check creator change', () => { void creator.check(); }, !creator.ready)}
            {creator.form.retryReady && button('Retry save', 'Retry saved creator change', () => { void creator.retry(); }, !creator.ready)}
          </View>
        </> : <View style={styles.actions}>
          {button(creator.form.kind === 'create' ? 'Create group' : 'Save name', 'Save chat name', () => { void creator.submit(); }, !creator.ready || directory.busy || !!pending)}
          {button('Cancel', 'Cancel chat name', creator.cancel, !creator.ready)}
        </View>}
      </> : button('Create group', 'Create community group', creator.startCreate, !creator.ready || directory.busy || !!pending, true)}
    </View>}
    {!!directory.error && <View accessibilityLiveRegion="polite"><Text style={[styles.body, { fontFamily: fonts.regular }]}>Couldn’t refresh your chats.</Text>{button('Try again', 'Refresh community chats', () => { void directory.refresh(); }, directory.busy)}</View>}
    {!!directory.notice && <Text accessibilityLiveRegion="polite" style={[styles.body, { fontFamily: fonts.regular }]}>{directory.notice}</Text>}
    {!!pending && !directory.data.rooms.some(room => room.id === pending.topicId && room.role === 'optional') && <View accessibilityLiveRegion="polite">
      <Text style={[styles.body, { fontFamily: fonts.regular }]}>This group is no longer listed. Check your change.</Text>
      {button('Check status', 'Check unavailable group membership', () => { void directory.check(); }, directory.busy)}
    </View>}
    {directory.data.rooms.map(room => {
      const waiting = pending?.topicId === room.id && room.role === 'optional';
      return <View key={`${room.storage}:${room.id}`} style={styles.row}>
        <View style={styles.roomHeading}>
          <View style={styles.roomIcon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{room.role === 'intros' ? <View style={styles.wave}>
            <Hand size={22} color={Colors.ink} style={{transform:[{rotate:'-24deg'}]}}/>
            <Svg width={32} height={32} style={StyleSheet.absoluteFill}><Path d="M25 3 Q29 6 29 10 M3 21 Q3 27 8 29" stroke={Colors.ink} strokeWidth={1.5} strokeLinecap="round" fill="none"/></Svg>
          </View> : room.role === 'main' ? <MessageCircle size={22} color={Colors.ink}/> : <Users size={22} color={Colors.ink}/>}</View>
          <View style={styles.roomCopy}><Text style={[styles.name, { fontFamily: fonts.semibold }]}>{room.name}</Text>
            {room.role !== 'optional' && <Text style={[styles.body, { fontFamily: fonts.regular }]}>{room.role === 'intros' ? 'Meet your community' : 'The everyday conversation'}</Text>}
          </View>
          {!waiting && (room.joined ? button('Open', `Open ${room.name}`, () => { if (directory.isCurrent()) onOpen(room); }, !directory.ready || directory.busy || creatorBusy, true) : button('Join', `Join ${room.name}`, () => { void directory.change(room.id, true)?.then(joined => { if (joined && directory.isCurrent()) onOpen(room); }); }, !directory.ready || directory.busy || !!pending || creatorBusy, true))}
        </View>
        {waiting ? <View accessibilityLiveRegion="polite">
          <Text style={[styles.body, { fontFamily: fonts.regular }]}>{directory.busy ? 'Checking your group…' : pending.retryReady ? 'Your change hasn’t been confirmed. You can retry the same action.' : 'Your change may have saved. Check its status before trying again.'}</Text>
          <View style={styles.actions}>{button('Check status', `Check ${room.name} membership`, () => { void directory.check(); }, directory.busy)}
            {pending.retryReady && button(pending.joined ? 'Retry join' : 'Retry leave', `Retry ${pending.joined ? 'joining' : 'leaving'} ${room.name}`, () => { void directory.retry(); }, directory.busy)}</View>
        </View> : room.role === 'optional' && room.joined ? <View style={styles.actions}>
          {button('Leave', `Leave ${room.name}`, () => setConfirmation({ key, room }), !directory.ready || directory.busy || !!pending || creatorBusy)}
        </View> : null}
        {creator.allowed && button('Rename', `Rename ${room.name}`, () => creator.startRename(room), !creator.ready || !!creator.form || directory.busy || !!pending)}
      </View>;
    })}
    <BrandedAlert visible={!!confirmation && confirmation.key === key && enabled} title={confirmation ? `Leave ${confirmation.room.name}?` : ''}
      message="You’ll leave this group and stop its notifications. You’ll still belong to the community."
      appearance={{ fonts }} onClose={() => setConfirmation(old => old?.key === key ? null : old)}
      buttons={[{ text: 'Cancel', style: 'cancel', onPress: () => setConfirmation(old => old?.key === key ? null : old) },
        { text: 'Leave', style: 'destructive', onPress: () => {
          const target = confirmation; setConfirmation(old => old?.key === key ? null : old);
          if (target?.key === key && directory.isCurrent()) void directory.change(target.room.id, false);
        } }]} />
  </View>;
}
const styles = StyleSheet.create({
  fallback: { alignSelf: 'stretch', width: '100%' },
  section: { alignSelf: 'stretch', gap: 12, paddingVertical: 16 }, sunsetSection: { padding: 14, borderRadius: 20, overflow: 'hidden' }, heading: { ...AfterglowType.contextTitle, color: Colors.ink },
  body: { ...AfterglowType.caption, color: Colors.ink }, name: { ...AfterglowType.body, color: Colors.ink },
  stateCard: { padding: 20, backgroundColor: Colors.white, borderRadius: 22, borderWidth: 1, borderColor: Colors.subtleLine, alignItems: 'stretch' },
  row: { gap: 8, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: CreatorSurfaceColors.goldEdge, backgroundColor: BrandColors.overlayWhite,
    shadowColor: BrandColors.darkWarm, shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: {width:0,height:3}, elevation: 1 },
  roomHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  roomIcon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }, wave: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  roomCopy: { flex: 1, minWidth: 0, gap: 4 },
  editor: { gap: 10 }, input: { ...AfterglowType.body, color: Colors.ink, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.line, borderRadius: 14, minHeight: 48, padding: 14 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  button: { minHeight: 44, maxWidth: '100%', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 22, borderWidth: 1, borderColor: Colors.subtleLine, justifyContent: 'center', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: Colors.white },
  primaryButton: { borderColor: CreatorSurfaceColors.goldEdge, paddingHorizontal: 14, minWidth: 62, alignSelf: 'center', flexShrink: 0 },
  action: { ...AfterglowType.caption, color: Colors.ink, textAlign: 'center' }, primaryAction: { color: BrandColors.white }, disabled: { opacity: 0.5 },
});
