/**
 * O-03 (Creator Space Complete Inventory): "native quick update" half of
 * follower communication. Reachable from organizer-home.tsx's followers
 * card. Single-shot send only -- no scheduling, no history list, both are
 * web-only per the doc's own native/web split. Audience preview via the
 * same getFollowerCount RPC organizer-home.tsx already uses.
 */

import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Users } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { MESSAGE_TEST_SEND_ENABLED } from '../../constants/FeatureFlags';
import { EventAction, EventSpacing, EventSurface, EventType } from '../../constants/EventDesign';
import { FontSizes, LineHeights } from '../../constants/Typography';
import { getFollowerCount } from '../../lib/organizerFollows';
import { sendFollowerBroadcast, sendFollowerBroadcastTestToSelf } from '../../lib/followerBroadcasts';
import { useCreatorPageScope } from '../../hooks/useCreatorPageScope';
import type { CreatorPageScope } from '../../lib/creatorPageReview';

const MAX_LEN = 2000;

export default function OrganizerBroadcastScreen() {
  const { scope, account } = useCreatorPageScope('follower-update');
  return <BroadcastComposer key={account.epoch} scope={scope} account={account} />;
}

function BroadcastComposer({ scope, account }: Pick<ReturnType<typeof useCreatorPageScope>, 'scope' | 'account'>) {
  const router = useRouter();
  const mounted = useRef(false);
  const leaving = useRef(false);
  const busy = useRef(false);
  const confirmed = useRef(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const testTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimers = () => {
    if (exitTimer.current) clearTimeout(exitTimer.current);
    if (testTimer.current) clearTimeout(testTimer.current);
  };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearTimers(); };
  }, []);
  useEffect(() => () => { clearTimers(); }, [scope]);
  const leave = () => {
    if (leaving.current) return;
    leaving.current = true;
    clearTimers();
    router.back();
  };
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [testSending, setTestSending] = useState(false);
  const [testSent, setTestSent] = useState(false);

  const userId = account.viewerId;

  const { data: followerCount = null } = useQuery({
    queryKey: ['organizer-follower-count', userId],
    queryFn: () => getFollowerCount({ kind: 'organizer', id: userId! }),
    enabled: !!userId,
    staleTime: 60_000,
  });

  const trimmed = body.trim();
  const canSend = !!scope && !account.isLoading && !account.error && trimmed.length > 0 && trimmed.length <= MAX_LEN && !sending && !testSending && !sent;
  const canSendTest = canSend;

  const handleSend = async (test = false) => {
    if (!canSend || !scope?.isCurrent() || busy.current || confirmed.current || leaving.current) return;
    // A ref closes the same-frame gap before React renders disabled buttons.
    busy.current = true;
    const attempt: CreatorPageScope = {
      userId: scope.userId,
      isCurrent: () => mounted.current && !leaving.current && scope.isCurrent(),
    };
    if (testTimer.current) clearTimeout(testTimer.current);
    setTestSent(false);
    if (test) setTestSending(true); else setSending(true);
    setError(null);
    try {
      if (test) await sendFollowerBroadcastTestToSelf({ kind: 'organizer' }, trimmed, attempt);
      else await sendFollowerBroadcast({ kind: 'organizer' }, trimmed, attempt);
      // A committed send stays final even if the screen blurred while waiting.
      if (!test) confirmed.current = true;
      if (!mounted.current) return;
      if (test) {
        setTestSent(true);
        testTimer.current = setTimeout(() => {
          if (attempt.isCurrent()) setTestSent(false);
        }, 2500);
      } else {
        setSent(true);
        if (attempt.isCurrent()) exitTimer.current = setTimeout(() => {
          if (attempt.isCurrent()) leave();
        }, 900);
      }
    } catch (e) {
      if (attempt.isCurrent()) setError(e instanceof Error ? e.message : 'could not send. try again.');
    } finally {
      busy.current = false;
      if (mounted.current) { setSending(false); setTestSending(false); }
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={leave}
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
            editable={!!scope && !account.isLoading && !account.error && !sending && !testSending && !sent}
            accessibilityLabel="Update for your followers"
          />
          <Text style={styles.counter} accessibilityLabel={`${trimmed.length} of ${MAX_LEN} characters used`}>
            {trimmed.length}/{MAX_LEN}
          </Text>

          {account.error && <TouchableOpacity onPress={() => void account.retry()} accessibilityRole="button" accessibilityLabel="Retry account check">
            <Text style={styles.errorText}>Couldn’t check your account. Tap to retry.</Text>
          </TouchableOpacity>}
          {error && <Text style={styles.errorText}>{error}</Text>}

          {MESSAGE_TEST_SEND_ENABLED && (
            <TouchableOpacity
              style={[styles.testBtn, !canSendTest && styles.testBtnDisabled]}
              onPress={() => handleSend(true)}
              disabled={!canSendTest}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="send a test to yourself"
              accessibilityState={{ disabled: !canSendTest, busy: testSending }}
            >
              {/* LIZ COPY (proposed, taste gate). Founder button-label rule:
                  1-3 words, never wraps -- accessibilityLabel above stays fully
                  descriptive for screen readers since that rule is about
                  rendered/visual wrap, not spoken text. */}
              <Text style={styles.testBtnText}>{testSent ? 'sent to you' : testSending ? 'sending…' : 'test to me'}</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
            onPress={() => handleSend()}
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

  testBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: EventAction.primary,
    borderRadius: 10,
    paddingVertical: 14,
    marginTop: EventSpacing.xs,
  },
  testBtnDisabled: { opacity: 0.45 },
  testBtnText: { fontFamily: EventType.bodyBold, fontSize: FontSizes.bodyMD, color: EventAction.primary },
});
