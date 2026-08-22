/**
 * O-03 (Creator Space Complete Inventory): "native quick update" half of
 * follower communication. Reachable from organizer-home.tsx's followers
 * card. Single-shot send only -- no scheduling, no history list, both are
 * web-only per the doc's own native/web split. Audience preview via the
 * same getFollowerCount RPC organizer-home.tsx already uses.
 */

import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Users } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { EventAction, EventSpacing, EventSurface, EventType } from '../../constants/EventDesign';
import { FontSizes, LineHeights } from '../../constants/Typography';
import { getFollowerCount } from '../../lib/organizerFollows';
import { sendFollowerBroadcast } from '../../lib/followerBroadcasts';
import { supabase } from '../../lib/supabase';

const MAX_LEN = 2000;

export default function OrganizerBroadcastScreen() {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const { data: userId = null } = useQuery({
    queryKey: ['my-user-id'],
    queryFn: async () => (await supabase.auth.getUser()).data.user?.id ?? null,
    staleTime: Infinity,
  });

  const { data: followerCount = null } = useQuery({
    queryKey: ['organizer-follower-count', userId],
    queryFn: () => getFollowerCount({ kind: 'organizer', id: userId! }),
    enabled: !!userId,
    staleTime: 60_000,
  });

  const trimmed = body.trim();
  const canSend = trimmed.length > 0 && trimmed.length <= MAX_LEN && !sending;

  const handleSend = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      await sendFollowerBroadcast({ kind: 'organizer' }, trimmed);
      setSent(true);
      setTimeout(() => router.back(), 900);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not send. try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={12}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ArrowLeft size={22} color={Colors.darkWarm} strokeWidth={2} />
        </TouchableOpacity>
        {/* LIZ COPY (proposed, taste gate) */}
        <Text style={styles.headerTitle}>message your followers</Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={12}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.audienceRow}>
            <Users size={16} color={EventAction.primary} strokeWidth={2} />
            {/* LIZ COPY: honest preview, doc's "preview audience/channel" requirement */}
            <Text style={styles.audienceText}>
              {followerCount == null
                ? 'checking who follows you…'
                : followerCount === 0
                  ? 'nobody follows you yet -- this would go nowhere.'
                  : `goes to ${followerCount} ${followerCount === 1 ? 'person' : 'people'} following your events, in-app.`}
            </Text>
          </View>

          <TextInput
            style={styles.input}
            value={body}
            onChangeText={setBody}
            placeholder="what do your followers need to know?"
            placeholderTextColor={Colors.tertiary}
            multiline
            maxLength={MAX_LEN}
            editable={!sending && !sent}
            accessibilityLabel="Update for your followers"
          />
          <Text style={styles.counter} accessibilityLabel={`${trimmed.length} of ${MAX_LEN} characters used`}>
            {trimmed.length}/{MAX_LEN}
          </Text>

          {error && <Text style={styles.errorText}>{error}</Text>}

          <TouchableOpacity
            style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!canSend}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Send update"
            accessibilityState={{ disabled: !canSend, busy: sending }}
          >
            <Text style={styles.sendBtnText}>{sent ? 'sent' : sending ? 'sending…' : 'send update'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: EventSurface.base },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: EventSpacing.sm,
    paddingHorizontal: EventSpacing.md,
    paddingVertical: EventSpacing.sm,
  },
  backBtn: { padding: 4, marginLeft: -4 },
  headerTitle: { fontFamily: EventType.bodyBold, fontSize: FontSizes.bodyLG, color: Colors.darkWarm },
  content: { padding: EventSpacing.md, gap: EventSpacing.sm },

  audienceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: EventSurface.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.borderWarm,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  audienceText: { flex: 1, fontFamily: EventType.body, fontSize: FontSizes.bodySM, lineHeight: LineHeights.bodySM, color: Colors.secondary },

  input: {
    minHeight: 140,
    backgroundColor: EventSurface.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.borderWarm,
    padding: EventSpacing.md,
    fontFamily: EventType.body,
    fontSize: FontSizes.bodyMD,
    lineHeight: LineHeights.bodyMD,
    color: Colors.darkWarm,
    textAlignVertical: 'top',
  },
  counter: { alignSelf: 'flex-end', fontFamily: EventType.body, fontSize: FontSizes.caption, color: Colors.tertiary },

  errorText: { fontFamily: EventType.body, fontSize: FontSizes.bodySM, color: EventAction.scarcity },

  sendBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: EventAction.primary,
    borderRadius: 10,
    paddingVertical: 14,
    marginTop: EventSpacing.xs,
  },
  sendBtnDisabled: { opacity: 0.45 },
  sendBtnText: { fontFamily: EventType.bodyBold, fontSize: FontSizes.bodyMD, color: EventAction.onPrimary },
});
