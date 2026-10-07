import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import type { CommunityOperationScope } from '../../lib/communityChat';
import { checkTopicWelcome, finishTopicWelcome, prepareTopicWelcome, readTopicWelcome, saveTopicWelcomeDraft, sendTopicWelcome, type TopicWelcomeState } from '../../lib/topicWelcome';

export function TopicWelcomeEditor({ topicId, eventId, owner, canCreate, canManage = canCreate, onSaved }: {
  topicId: string; eventId: string; owner: CommunityOperationScope; canCreate: boolean; canManage?: boolean; onSaved(): Promise<void>;
}) {
  const [state, setState] = useState<TopicWelcomeState | null>(null);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [storageError, setStorageError] = useState(false), [notice, setNotice] = useState('');
  const visit = useMemo(() => ({}), [topicId, eventId, owner]);
  const active = useRef(false), latest = useRef(visit), action = useRef(false), revision = useRef(0);
  latest.current = visit;
  const current = () => active.current && latest.current === visit && owner.isCurrent();
  useEffect(() => {
    active.current = true; action.current = false; revision.current++;
    setState(null); setOpen(false); setBusy(false); setStorageError(false); setNotice('');
    // Parent conversation effects activate the account/room visit after child effects.
    // Read on the next microtask so that normal entry is not a storage failure.
    void Promise.resolve().then(() => readTopicWelcome(topicId, eventId, owner)).then(value => {
      if (!current()) return;
      setState(value); setOpen(!!value.text || !!value.attempt); setStorageError(!!value.unsaved);
    }).catch(() => { if (current()) setStorageError(true); });
    return () => { active.current = false; };
  }, [topicId, eventId, owner]);

  const change = (text: string) => {
    if (!current() || !state) return;
    const version = ++revision.current;
    setState({ ...state, text });
    void saveTopicWelcomeDraft(topicId, eventId, owner, text).then(() => {
      if (current() && version === revision.current) setStorageError(false);
    }).catch(() => { if (current() && version === revision.current) setStorageError(true); });
  };
  const restore = async () => {
    if (!current() || action.current) return;
    action.current = true; setBusy(true);
    try {
      if (state) await saveTopicWelcomeDraft(topicId, eventId, owner, state.text);
      const value = await readTopicWelcome(topicId, eventId, owner);
      if (current()) { setState(value); setStorageError(!!value.unsaved); setOpen(!!value.text || !!value.attempt); }
    } catch { if (current()) setStorageError(true); }
    finally { if (current()) { action.current = false; setBusy(false); } }
  };
  const save = async (send: boolean) => {
    if (!current() || action.current || !state || send && (!canCreate || storageError)) return;
    if (!state.attempt && !state.text.trim()) return;
    action.current = true; setBusy(true); setNotice('');
    let attempt = state.attempt;
    try {
      if (!attempt) attempt = await prepareTopicWelcome(topicId, eventId, owner, state.text);
      if (!current()) return;
      setState(previous => previous ? { ...previous, attempt } : previous);
      const receipt = send ? await sendTopicWelcome(attempt, owner) : await checkTopicWelcome(attempt, owner);
      if (!current()) return;
      if (!receipt) { setNotice('No confirmation yet. Your original welcome is kept.'); return; }
      const finishingRevision = revision.current;
      const next = await finishTopicWelcome(attempt, owner);
      if (!current()) return;
      setState(previous => revision.current !== finishingRevision && previous ? { ...next, text: previous.text } : next);
      setOpen(revision.current !== finishingRevision || !!next.text); setStorageError(false); setNotice('Welcome saved.');
      try { await onSaved(); }
      catch { if (current()) setNotice('Welcome saved. Pull down to refresh the conversation.'); }
    } catch {
      if (!current()) return;
      setNotice('Your welcome isn’t confirmed yet. Check it before trying again.');
      try {
        const readingRevision = revision.current;
        const saved = await readTopicWelcome(topicId, eventId, owner);
        if (current()) {
          setState(previous => revision.current !== readingRevision && previous ? { ...saved, text: previous.text } : saved);
          setStorageError(!!saved.unsaved);
        }
      } catch { if (current()) setStorageError(true); }
    } finally { if (current()) { action.current = false; setBusy(false); } }
  };
  if (!canCreate && !state?.attempt && !(canManage && storageError)) return null;
  if (!state && !storageError) return <View style={styles.card}><ActivityIndicator color={Colors.terracotta} accessibilityLabel="Checking welcome draft" /></View>;
  const button = (label: string, onPress: () => void, disabled = false, filled = false) => <TouchableOpacity
    accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, busy }} disabled={disabled}
    onPress={onPress} style={[styles.action, filled && styles.save, disabled && styles.disabled]}>
    <Text style={[styles.actionText, filled && styles.saveText]}>{label}</Text>
  </TouchableOpacity>;
  if (!open && !state?.attempt && !storageError) return <View style={styles.prompt}>
    {notice ? <Text style={styles.body}>{notice}</Text> : null}
    {button(state?.text ? 'Resume welcome' : '+ Add welcome', () => { if (current()) setOpen(true); })}
  </View>;
  return <View style={styles.card}>
    <Text style={styles.label}>welcome message</Text>
    {state && <TextInput style={styles.input} value={state.text} onChangeText={change} multiline maxLength={4000}
      editable={!storageError} placeholder="say hi before anyone else does" placeholderTextColor={Colors.inkSoft}
      accessibilityLabel="Welcome message for this chat space" />}
    {state?.attempt && <Text numberOfLines={3} style={styles.body}>Waiting to confirm: {state.attempt.text}</Text>}
    {!!notice && <Text accessibilityLiveRegion="polite" style={styles.body}>{notice}</Text>}
    {storageError && <><Text style={styles.body}>Your welcome draft couldn’t be saved or checked on this device.</Text>{button('Try draft again', () => { void restore(); }, busy)}</>}
    <View style={styles.actions}>
      {!state?.attempt && button('Close', () => { if (current()) setOpen(false); }, busy)}
      {state?.attempt ? <>
        {button('Check welcome', () => { void save(false); }, busy)}
        {canCreate && button('Retry save', () => { void save(true); }, busy || storageError, true)}
      </> : canCreate && button('Save welcome', () => { void save(true); }, busy || storageError || !state?.text.trim(), true)}
    </View>
  </View>;
}
const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 4, backgroundColor: Colors.cardBg, borderRadius: 16, borderWidth: 1, borderColor: Colors.border, padding: 14, gap: 8 },
  prompt: { marginHorizontal: 16, marginTop: 4, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: Colors.border, alignItems: 'center' },
  label: { fontFamily: Fonts.sansBold, fontSize: FontSizes.caption, color: Colors.terracotta, letterSpacing: 1.5, textTransform: 'uppercase' },
  body: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, lineHeight: LineHeights.bodySM, color: Colors.darkWarm },
  input: { minHeight: 60, maxHeight: 120, fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.darkWarm, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 8 },
  action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  actionText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  save: { backgroundColor: Colors.terracotta, borderRadius: 999 },
  saveText: { color: Colors.white, fontFamily: Fonts.sansBold },
  disabled: { opacity: 0.45 },
});
