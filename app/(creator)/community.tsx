/**
 * Creator mode: community. This slice is the broadcast composer plus the
 * broadcast history (both live against community_broadcasts through RLS).
 * The page block editor lands with the block-editor beat; the placeholder
 * says so honestly. Functionally minimal per decision 15a.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../../components/keyboard/KeyboardDoneBar';
import { friendlyError } from '../../lib/friendlyError';
import { hapticSuccess } from '../../lib/haptics';
import { getCreatorAccess, getBroadcasts, sendBroadcast } from '../../lib/creatorMode';

export default function CreatorCommunityScreen() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);

  const { data: access } = useQuery({ queryKey: ['creator-access'], queryFn: getCreatorAccess });
  const community = access?.ledCommunities[0] ?? null;

  const { data: broadcasts = [], refetch, isRefetching } = useQuery({
    queryKey: ['creator-broadcasts', community?.id],
    queryFn: () => getBroadcasts(community!.id),
    enabled: !!community,
  });

  const handleSend = async () => {
    if (!community || !draft.trim()) return;
    setSending(true);
    try {
      await sendBroadcast(community.id, draft);
      hapticSuccess();
      setDraft('');
      queryClient.invalidateQueries({ queryKey: ['creator-broadcasts', community.id] });
    } catch (e) {
      setAlertInfo({ title: 'That did not send', message: friendlyError(e, 'Try again in a moment.') });
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.terracotta} />}
        >
          <Text style={styles.title}>community</Text>

          <Text style={styles.sectionLabel}>broadcast</Text>
          <Text style={styles.hint}>
            lands pinned at the top of every member&apos;s chats. about one a week
            is the sweet spot.
          </Text>
          <View style={styles.composer}>
            <TextInput
              style={styles.composerInput}
              value={draft}
              onChangeText={setDraft}
              placeholder="what should your people know?"
              placeholderTextColor={Colors.inkSoft}
              multiline
              maxLength={4000}
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!draft.trim() || sending) && { opacity: 0.4 }]}
              onPress={handleSend}
              disabled={!draft.trim() || sending}
            >
              {sending ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <Text style={styles.sendBtnText}>send to members</Text>
              )}
            </TouchableOpacity>
          </View>

          {broadcasts.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, { marginTop: 24 }]}>sent</Text>
              {broadcasts.map((b) => (
                <View key={b.id} style={styles.broadcastCard}>
                  <Text style={styles.broadcastBody}>{b.body}</Text>
                  <Text style={styles.broadcastMeta}>{new Date(b.created_at).toLocaleString()}</Text>
                </View>
              ))}
            </>
          )}

          <Text style={[styles.sectionLabel, { marginTop: 24 }]}>your page</Text>
          <View style={styles.placeholderCard}>
            <Text style={styles.placeholderText}>
              the page editor lands here: your cover, your colors, your blocks.
              it is the next big build after the logic settles.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <BrandedAlert
        visible={!!alertInfo}
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message}
        buttons={alertInfo?.buttons}
        onClose={() => setAlertInfo(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  content: { padding: 20 },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayLG,
    lineHeight: LineHeights.displayLG,
    color: Colors.darkWarm,
    marginBottom: 12,
  },
  sectionLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  hint: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary, marginBottom: 10 },
  composer: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    gap: 10,
  },
  composerInput: {
    minHeight: 70,
    textAlignVertical: 'top',
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.darkWarm,
  },
  sendBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
  },
  sendBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  broadcastCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    marginBottom: 10,
  },
  broadcastBody: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  broadcastMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.tertiary, marginTop: 6 },
  placeholderCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.borderWarm,
    padding: 16,
    marginBottom: 40,
  },
  placeholderText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary, lineHeight: LineHeights.bodySM },
});
