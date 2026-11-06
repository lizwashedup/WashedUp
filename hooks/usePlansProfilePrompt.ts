import { useCallback, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { Platform } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { wasHandlePromptShownThisSession, wasWelcomeShownThisSession } from '../lib/promptState';
import { withDeadline } from '../lib/withTimeout';

type Visit = { userId: string; isCurrentAccount: () => boolean };

function otherPromptShown() {
  return wasHandlePromptShownThisSession() || wasWelcomeShownThisSession();
}

export function usePlansProfilePrompt(userId: string | null, welcomeChecked: boolean, isCurrentAccount: () => boolean) {
  const focused = useIsFocused();
  const current = useRef<Visit | null>(null);
  const dismissed = useRef(new Set<string>());
  const [closingEditor, setClosingEditor] = useState<Visit | null>(null);
  const [shown, setShown] = useState<Visit | null>(null);

  useFocusEffect(useCallback(() => {
    if (!userId || !welcomeChecked || dismissed.current.has(userId) || otherPromptShown()) return;
    const visit = { userId, isCurrentAccount };
    current.current = visit;
    const owns = () => current.current === visit && visit.isCurrentAccount();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function check() {
      const seen = await withDeadline(AsyncStorage.getItem('has_seen_profile_complete_prompt_' + visit.userId), 4000, 'Profile reminder');
      if (seen || !owns()) return;
      const { data, error } = await withDeadline(supabase.from('profiles')
        .select('onboarding_status, handle, fun_fact, neighborhood').eq('id', visit.userId).single(), 4000, 'Profile details');
      if (!owns() || error || data?.onboarding_status !== 'complete') return;
      if ([data.handle, data.fun_fact, data.neighborhood].every(value => String(value ?? '').trim().length > 0)) return;
      timer = setTimeout(() => {
        if (owns() && !otherPromptShown()) setShown(visit);
      }, 2000);
    }
    void check().catch(() => { /* An optional prompt needs confirmed eligibility. */ });
    return () => {
      current.current = null;
      clearTimeout(timer);
      setClosingEditor(null);
      setShown(null);
    };
  }, [userId, welcomeChecked, isCurrentAccount]));

  const finish = (openEditor: boolean) => {
    if (!shown || shown !== current.current || !shown.isCurrentAccount()) return;
    if (dismissed.current.has(shown.userId)) return;
    dismissed.current.add(shown.userId);
    void AsyncStorage.setItem('has_seen_profile_complete_prompt_' + shown.userId, '1').catch(() => {});
    if (openEditor && Platform.OS === 'ios') {
      setClosingEditor(shown);
      return;
    }
    current.current = null;
    setShown(null);
    if (openEditor) router.push('/(tabs)/profile?openEdit=true' as never);
  };
  const onDismiss = () => {
    if (!closingEditor || closingEditor !== current.current || !closingEditor.isCurrentAccount()) return;
    current.current = null;
    setClosingEditor(null);
    setShown(null);
    router.push('/(tabs)/profile?openEdit=true' as never);
  };
  const presenting = focused && !!shown && shown === current.current && shown.userId === userId && shown.isCurrentAccount();
  return {
    presenting,
    visible: presenting && !closingEditor,
    onDismiss,
    dismiss: () => finish(false),
    openEditor: () => finish(true),
  };
}
