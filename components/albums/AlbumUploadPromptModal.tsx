import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState, Modal, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { supabase } from '../../lib/supabase';
import { useInboxNotificationScope } from '../../hooks/useInboxNotificationScope';

// In-app popup that fires once per album_upload_prompt notification when the
// user opens the app. Spec rule: never prompt more than twice total — the
// initial prompt cron is the first ping, this modal is the second presentation
// of the same notification. We dismiss locally so it doesn't keep reappearing.
//
// Locally-dismissed notification IDs live in AsyncStorage. When the user taps
// "Upload memories" we navigate to the upload flow. When they tap
// "Maybe later" we record the dismissal — the cron-driven 24h reminder push
// is what nudges them again, not this modal.

const DISMISSED_KEY = 'albumUploadPrompt.dismissedV1';

type PromptRow = {
  id: string;
  event_id: string;
  title: string;
  body: string | null;
  created_at: string;
};

async function loadDismissed(): Promise<Set<string>> {
  const raw = await AsyncStorage.getItem(DISMISSED_KEY);
  if (!raw) return new Set();
  try { return new Set<string>(JSON.parse(raw)); }
  catch { return new Set(); }
}

async function saveDismissed(set: Set<string>): Promise<void> {
  await AsyncStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(set)));
}

export function AlbumUploadPromptModal({ userId }: { userId: string | null }) {
  const router = useRouter();
  const owner = useInboxNotificationScope(userId, true);
  const [prompt, setPrompt] = useState<{ owner: typeof owner; row: PromptRow } | null>(null);
  const promptRef = useRef<typeof prompt>(null);
  const [dismissedSet, setDismissedSet] = useState<Set<string> | null>(null);
  const dismissedRef = useRef<Set<string> | null>(null);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const revision = useRef(0);
  const afterDismiss = useRef<{ owner: typeof owner; route?: string } | null>(null);
  const row = prompt?.owner === owner && owner.isCurrent() ? prompt.row : null;

  useLayoutEffect(() => {
    revision.current++;
    promptRef.current = null;
    afterDismiss.current = null;
    closingRef.current = false;
    setPrompt(null);
    setClosing(false);
    return () => { revision.current++; afterDismiss.current = null; };
  }, [owner]);

  useEffect(() => {
    let cancelled = false;
    void loadDismissed().catch(() => new Set<string>()).then(next => {
      if (cancelled) return;
      dismissedRef.current = next;
      setDismissedSet(next);
    });
    return () => { cancelled = true; };
  }, []);

  const checkForPrompt = useCallback(async () => {
    if (!owner.isCurrent() || !dismissedRef.current || closingRef.current || promptRef.current) return;
    const request = ++revision.current;
    try {
      const { data, error } = await supabase
        .from('app_notifications')
        .select('id, event_id, title, body, created_at')
        .eq('user_id', userId)
        .eq('type', 'album_upload_prompt')
        .eq('status', 'unread')
        .order('created_at', { ascending: false })
        .limit(5);
      if (!owner.isCurrent() || request !== revision.current || closingRef.current || error || !data) return;
      const fresh = data.find(n => !dismissedRef.current?.has(n.id) && n.event_id);
      if (fresh) {
        const next = { owner, row: fresh as PromptRow };
        promptRef.current = next;
        setPrompt(next);
      }
    } catch { /* An optional reminder must not interrupt the current screen. */ }
  }, [owner, userId]);

  useEffect(() => {
    void checkForPrompt();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') void checkForPrompt();
    });
    return () => { revision.current++; sub.remove(); };
  }, [checkForPrompt, dismissedSet]);

  const finishDismissal = useCallback(() => {
    const pending = afterDismiss.current;
    if (!pending || pending.owner !== owner || !owner.isCurrent()) return;
    afterDismiss.current = null;
    promptRef.current = null;
    setPrompt(null);
    closingRef.current = false;
    setClosing(false);
    if (pending.route) router.push(pending.route as never);
  }, [owner, router]);

  const dismissPrompt = useCallback(async (upload: boolean) => {
    const current = promptRef.current;
    if (!current || current.owner !== owner || !owner.isCurrent() || closingRef.current) return;
    closingRef.current = true;
    revision.current++;
    const next = new Set(dismissedRef.current ?? []);
    next.add(current.row.id);
    dismissedRef.current = next;
    setDismissedSet(next);
    // Dismiss immediately. Optional local/read bookkeeping must not hold the
    // popup open on slow storage or network, and never changes its destination.
    void saveDismissed(next).catch(() => {});
    if (upload) {
      void (async () => {
        try {
          if (!owner.isCurrent()) return;
          await supabase.from('app_notifications').update({ status: 'read' })
            .eq('id', current.row.id).eq('user_id', userId);
        } catch { /* The confirmed local dismissal remains effective this session. */ }
      })();
    }
    afterDismiss.current = { owner, route: upload ? `/album/upload/${current.row.event_id}` : undefined };
    setClosing(true);
    if (Platform.OS !== 'ios') finishDismissal();
  }, [owner, userId, finishDismissal]);
  const handleClose = useCallback(() => dismissPrompt(false), [dismissPrompt]);
  const handleUpload = useCallback(() => dismissPrompt(true), [dismissPrompt]);

  return (
    <Modal
      visible={!!row && !closing}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
      onDismiss={finishDismissal}
    >
      <Pressable accessible={false} style={styles.backdrop} onPress={handleClose}>
        <Pressable accessible={false} accessibilityViewIsModal style={styles.card} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title} numberOfLines={2}>{row?.title}</Text>
          <Text style={styles.body}>
            Share your photos and videos, get everyone else's.
          </Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Upload memories" style={styles.primaryBtn} onPress={handleUpload} activeOpacity={0.9}>
            <Text numberOfLines={1} style={styles.primaryBtnText}>Upload memories</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Maybe later" style={styles.secondaryBtn} onPress={handleClose} activeOpacity={0.7}>
            <Text numberOfLines={1} style={styles.secondaryBtnText}>Maybe later</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: Colors.overlayDark,
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  card: {
    width: '100%', maxWidth: 360,
    backgroundColor: Colors.parchment, borderRadius: 12,
    padding: 22, gap: 12,
  },
  title: {
    fontFamily: Fonts.displayBold, fontSize: FontSizes.displayMD,
    color: Colors.asphalt,
  },
  body: {
    fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, lineHeight: 22,
    color: Colors.textMedium,
  },
  primaryBtn: {
    backgroundColor: Colors.terracotta,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    shadowColor: Colors.terracotta,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 3,
  },
  primaryBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  secondaryBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.warmGray },
});
