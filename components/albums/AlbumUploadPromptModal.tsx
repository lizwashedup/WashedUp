import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { supabase } from '../../lib/supabase';

// In-app popup that fires once per album_upload_prompt notification when the
// user opens the app. Spec rule: never prompt more than twice total — the
// initial prompt cron is the first ping, this modal is the second presentation
// of the same notification. We dismiss locally so it doesn't keep reappearing.
//
// Locally-dismissed notification IDs live in AsyncStorage. When the user taps
// "Upload photos + videos" we navigate to the upload flow. When they tap
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
  const [prompt, setPrompt] = useState<PromptRow | null>(null);
  const [dismissedSet, setDismissedSet] = useState<Set<string> | null>(null);

  // Hydrate dismissed set once.
  useEffect(() => {
    let cancelled = false;
    void loadDismissed().then((s) => { if (!cancelled) setDismissedSet(s); });
    return () => { cancelled = true; };
  }, []);

  const checkForPrompt = useCallback(async () => {
    if (!userId || !dismissedSet) return;
    const { data, error } = await supabase
      .from('app_notifications')
      .select('id, event_id, title, body, created_at')
      .eq('user_id', userId)
      .eq('type', 'album_upload_prompt')
      .eq('status', 'unread')
      .order('created_at', { ascending: false })
      .limit(5);
    if (error || !data) return;
    const fresh = data.find((n) => !dismissedSet.has(n.id) && n.event_id);
    if (fresh) setPrompt(fresh as PromptRow);
  }, [userId, dismissedSet]);

  // On userId change + on app foreground.
  useEffect(() => {
    void checkForPrompt();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void checkForPrompt();
    });
    return () => sub.remove();
  }, [checkForPrompt]);

  const handleClose = useCallback(async () => {
    if (!prompt || !dismissedSet) return setPrompt(null);
    const next = new Set(dismissedSet);
    next.add(prompt.id);
    setDismissedSet(next);
    await saveDismissed(next);
    setPrompt(null);
  }, [prompt, dismissedSet]);

  const handleUpload = useCallback(async () => {
    if (!prompt) return;
    // Mark notification read so the badge clears + we don't re-show.
    await supabase
      .from('app_notifications')
      .update({ status: 'read' })
      .eq('id', prompt.id);
    if (dismissedSet) {
      const next = new Set(dismissedSet);
      next.add(prompt.id);
      setDismissedSet(next);
      await saveDismissed(next);
    }
    const eventId = prompt.event_id;
    setPrompt(null);
    router.push(`/album/upload/${eventId}` as any);
  }, [prompt, dismissedSet, router]);

  if (!prompt) return null;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <Pressable style={styles.backdrop} onPress={handleClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title} numberOfLines={2}>{prompt.title}</Text>
          <Text style={styles.body}>
            Everyone took photos. Now put them together. Upload yours and get everyone else's back. The more people share, the better the album.
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={handleUpload} activeOpacity={0.9}>
            <Text style={styles.primaryBtnText}>Upload photos + videos</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={handleClose} activeOpacity={0.7}>
            <Text style={styles.secondaryBtnText}>Maybe later</Text>
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
    backgroundColor: Colors.terracotta, paddingVertical: 14, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', marginTop: 6,
    shadowColor: Colors.terracotta, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3, shadowRadius: 8,
  },
  primaryBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  secondaryBtn: {
    paddingVertical: 12, borderRadius: 12, alignItems: 'center',
    borderWidth: 1.5, borderColor: Colors.terracotta,
  },
  secondaryBtnText: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
});
