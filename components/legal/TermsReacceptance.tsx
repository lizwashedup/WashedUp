/**
 * ToS reacceptance interstitial (legal v4.0): a material terms revision
 * requires AFFIRMATIVE reacceptance, never continued-use. One screen on
 * first open after the terms publish; the accept writes the immutable
 * member_terms_acceptances row (proposal 49) and the screen never returns
 * for that version.
 *
 * Dormant until proposal 49 applies (the status RPC does not exist, the
 * query answers false). Shows ONLY on a confirmed server answer, never on
 * a failed read, so an offline open is never blocked (the blocking-modal
 * offline-escape rule); it simply asks again next open until accepted.
 */

import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Colors from '../../constants/Colors';
import { useObservedUser } from '../../hooks/useObservedUser';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { getMemberTermsStatus, recordMemberTermsAcceptance } from '../../lib/participationTerms';

const TERMS_URL = 'https://washedup.app/terms';

export const MEMBER_TERMS_STATUS_KEY = ['member-terms-status'] as const;

export function TermsReacceptance({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient();
  const account = useObservedUser();
  const visit = useMemo(() => ({}), [enabled, account.viewerId, account.epoch]);
  const committed = useRef<object | null>(null);
  useLayoutEffect(() => {
    committed.current = visit;
    return () => { if (committed.current === visit) committed.current = null; };
  }, [visit]);
  const current = () => committed.current === visit && enabled && !!account.viewerId && account.isCurrent();
  const [result, setResult] = useState<{ visit: object; busy: boolean; problem: string | null; accepted: boolean }>();
  const pending = useRef<{ visit: object } | null>(null);
  const local = result?.visit === visit ? result : undefined;
  const busy = !!local?.busy, problem = local?.problem;
  // Keep both account and auth lifetime in the cache identity. A pending result
  // from the first A visit cannot become the current result after A→B→A.
  const queryKey = [...MEMBER_TERMS_STATUS_KEY, account.viewerId, account.epoch];
  const ready = enabled && !!account.viewerId && !account.isLoading && !account.error;
  const { data } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!current()) throw new Error('This account visit has changed.');
      const status = await getMemberTermsStatus();
      if (!current()) throw new Error('This account visit has changed.');
      return status;
    },
    enabled: ready,
    staleTime: Infinity,
  });

  const visible = ready && !local?.accepted && !!data?.needsAcceptance;

  const handleAccept = async () => {
    if (!current() || !visible || pending.current?.visit === visit) return;
    const attempt = { visit };
    pending.current = attempt;
    setResult({ visit, busy: true, problem: null, accepted: false });
    let ok = false;
    try { ok = await recordMemberTermsAcceptance(); }
    catch { /* A failed affirmative request stays available for explicit retry. */ }
    finally { if (pending.current === attempt) pending.current = null; }
    if (!current()) return;
    setResult({ visit, busy: false, accepted: ok,
      problem: ok ? null : 'that did not go through. give it another try.' });
    if (ok) {
      void queryClient.invalidateQueries({ queryKey, exact: true });
    }
  };

  if (!visible) return null;

  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={() => {}}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.body}>
          {/* LIZ COPY */}
          <Text style={styles.kicker}>a quick update</Text>
          {/* LIZ COPY */}
          <Text style={styles.title}>our terms have changed.</Text>
          {/* LIZ COPY */}
          <Text style={styles.text}>
            we've updated the washedup terms of service. take a look when you have a
            minute, and tap below to keep going.
          </Text>
          <TouchableOpacity onPress={() => Linking.openURL(TERMS_URL)} style={styles.linkWrap}>
            <Text style={styles.link}>{'read the terms of service →'}</Text>
          </TouchableOpacity>

          {!!problem && <Text style={styles.problem}>{problem}</Text>}

          <TouchableOpacity style={styles.acceptBtn} onPress={handleAccept} disabled={busy}>
            {busy ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              /* the affirmative action itself stays explicit; the framing
                 copy above is Liz's, this label states the legal act */
              <Text style={styles.acceptBtnText}>I agree to the updated Terms of Service</Text>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  kicker: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayLG,
    lineHeight: LineHeights.displayLG,
    color: Colors.darkWarm,
    marginBottom: 10,
  },
  text: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    lineHeight: 21,
    color: Colors.secondary,
  },
  linkWrap: { marginTop: 14, paddingVertical: 4 },
  link: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  problem: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.errorRed,
    marginTop: 14,
  },
  acceptBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
  },
  acceptBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
});
