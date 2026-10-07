import { requestWithDeadline } from '../lib/requestWithDeadline';
import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from '../lib/supabase';
import { uploadBase64ToStorage } from '../lib/uploadPhoto';
import { PHOTO_FORMAT_ERROR_MESSAGE } from '../constants/PhotoUpload';
import { logError } from '../lib/logger';

type Patch = Record<string, string | number | boolean | null>;
type Options = {
  eventId: string; viewerId: string | null; isCurrent: () => boolean;
  canEdit: () => boolean; onCommitted?: () => void; onSaved: () => void; onPhoto: (url: string) => void;
};
const rejected = new Set(['P0001', '42501', '23502', '23503', '23505', '23514', '22P02', '28000', '28P01', '42883', '42703', '42P01', '40001', '40P01']);
export function confirmsPlanEdit(data: unknown, eventId: string, viewerId: string, patch: Patch) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const row = data as Record<string, unknown>;
  return row.id === eventId && row.creator_user_id === viewerId && Object.entries(patch).every(([key, value]) => {
    if ((key === 'start_time' || key === 'end_time') && typeof value === 'string' && typeof row[key] === 'string') {
      return Number.isFinite(Date.parse(value)) && Date.parse(value) === Date.parse(row[key] as string);
    }
    return row[key] === value;
  });
}

/** Locks the active edit from the first picker/auth step. Unknown writes retain
 * their exact patch for read-only reconciliation; this is not server idempotency. */
export function usePlanEdit(options: Options) {
  const latest = useRef(options); latest.current = options;
  const focused = useRef<object | null>(null);
  const editor = useRef<object | null>(null);
  const pending = useRef<'photo' | 'save' | 'check' | null>(null);
  const unresolved = useRef<{ patch: Patch; eventId: string; viewerId: string } | null>(null);
  const [operation, setOperation] = useState<typeof pending.current>(null);
  const [unknown, setUnknown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(useCallback(() => {
    const visit = {}; focused.current = visit; setOperation(pending.current); setUnknown(!!unresolved.current);
    return () => { if (focused.current === visit) { focused.current = null; editor.current = null; } };
  }, []));
  const capture = () => {
    const visit = focused.current, edit = editor.current, owner = options;
    return () => !!visit && !!edit && focused.current === visit && editor.current === edit && owner.isCurrent() &&
      latest.current.viewerId === owner.viewerId && latest.current.eventId === owner.eventId;
  };
  const mayStart = () => !pending.current && !!focused.current && !!editor.current && options.isCurrent() && options.canEdit();
  const begin = () => {
    if (pending.current || !focused.current || !options.isCurrent() || !options.canEdit()) return false;
    editor.current = {}; setError(null); return true;
  };
  const close = () => {
    if (pending.current) return false;
    editor.current = null; setError(null); return true;
  };
  const finish = () => {
    pending.current = null;
    if (focused.current && latest.current.isCurrent()) setOperation(null);
  };
  const confirm = (isCurrent: () => boolean, onCommitted = options.onCommitted) => {
    try { onCommitted?.(); } catch (cause) { logError(cause, "plan.edit.refresh"); }
    unresolved.current = null; pending.current = null;
    if (!isCurrent()) return;
    setUnknown(false); setError(null);
    try { latest.current.onSaved(); } catch (cause) { logError(cause, 'plan.edit.feedback'); }
  };
  const pickPhoto = async () => {
    if (!mayStart() || unresolved.current || !options.viewerId) return;
    const isCurrent = capture(), viewerId = options.viewerId;
    pending.current = 'photo'; setOperation('photo'); setError(null);
    let stage: 'choose' | 'prepare' | 'upload' = 'choose';
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!isCurrent()) return;
      if (permission.status !== 'granted') { setError('Allow photo access in Settings to choose a photo.'); return; }
      const selection = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [16, 10], quality: 1 });
      if (!isCurrent() || selection.canceled || !selection.assets?.[0]) return;
      stage = 'prepare';
      const image = await ImageManipulator.manipulateAsync(selection.assets[0].uri, [{ resize: { width: 1200 } }], { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      if (!isCurrent()) return;
      if (!image.base64) throw new Error('Missing prepared photo');
      stage = 'upload';
      const auth = await requestWithDeadline(supabase.auth.getUser(), 12_000);
      if (!isCurrent()) return;
      if (auth.error || auth.data.user?.id !== viewerId) throw new Error('Account changed');
      const refresh = await requestWithDeadline(supabase.auth.refreshSession(), 12_000);
      if (!isCurrent()) return;
      if (refresh.error) throw refresh.error;
      const refreshed = await requestWithDeadline(supabase.auth.getUser(), 12_000);
      if (!isCurrent()) return;
      if (refreshed.error || refreshed.data.user?.id !== viewerId) throw new Error('Account changed');
      const url = await requestWithDeadline(uploadBase64ToStorage('event-images', `${viewerId}/${Date.now()}.jpg`, image.base64), 30_000);
      if (isCurrent()) latest.current.onPhoto(url);
    } catch {
      if (isCurrent()) setError(stage === 'choose' ? 'Couldn’t open photos. Try again.' : stage === 'prepare' ? PHOTO_FORMAT_ERROR_MESSAGE : 'Couldn’t upload this photo. Try again.');
    } finally { finish(); }
  };
  const save = async (draft: Patch) => {
    if (!mayStart() || unresolved.current || !options.viewerId) return;
    const isCurrent = capture(), eventId = options.eventId, viewerId = options.viewerId, patch = { ...draft };
    pending.current = 'save'; setOperation('save'); setError(null);
    let dispatched = false;
    try {
      const auth = await supabase.auth.getUser();
      if (!isCurrent() || !latest.current.canEdit()) return;
      if (auth.error || auth.data.user?.id !== viewerId) throw new Error('Couldn’t check your account. Try again.');
      dispatched = true;
      const response = await supabase.from('events').update(patch).eq('id', eventId).eq('creator_user_id', viewerId)
        .select(['id', 'creator_user_id', ...Object.keys(patch)].join(',')).maybeSingle();
      if (response.error && rejected.has(String(response.error.code))) { dispatched = false; throw response.error; }
      if (response.error !== null || !confirmsPlanEdit(response.data, eventId, viewerId, patch)) throw new Error('Unconfirmed save');
      // A late receipt must not close a different edit. Refresh occurs on the
      // next visit through the existing detail query; no old-account UI fires.
      confirm(isCurrent);
    } catch (cause: any) {
      if (dispatched) {
        unresolved.current = { patch, eventId, viewerId };
        if (focused.current && latest.current.isCurrent()) setUnknown(true);
        if (isCurrent()) setError(null);
      } else if (isCurrent()) {
        setError(cause?.message?.includes('events_host_message_length') ? 'Keep your message to 150 characters or fewer.' : 'Couldn’t save changes. Your edits are still here. Try again.');
      }
    } finally { finish(); }
  };
  const check = async () => {
    if (pending.current || !focused.current || !editor.current || !options.isCurrent() || !unresolved.current) return;
    const isCurrent = capture(), attempt = unresolved.current;
    if (attempt.viewerId !== options.viewerId || attempt.eventId !== options.eventId) return;
    pending.current = 'check'; setOperation('check'); setError(null);
    try {
      const auth = await supabase.auth.getUser();
      if (!isCurrent()) return;
      if (auth.error || auth.data.user?.id !== attempt.viewerId) throw new Error('Account changed');
      const response = await supabase.from('events').select(['id', 'creator_user_id', ...Object.keys(attempt.patch)].join(','))
        .eq('id', attempt.eventId).eq('creator_user_id', attempt.viewerId).maybeSingle();
      if (!isCurrent()) return;
      if (response.error !== null || !confirmsPlanEdit(response.data, attempt.eventId, attempt.viewerId, attempt.patch)) throw new Error('Save not confirmed');
      confirm(isCurrent);
    } catch { if (isCurrent()) setError('We still can’t confirm these changes. Check again in a moment.'); }
    finally { finish(); }
  };
  return { begin, close, capture, pickPhoto, save, check, error, unknown,
    isBusy: !!operation, isPhotoPending: operation === 'photo', isSaving: operation === 'save' || operation === 'check',
    canChange: () => mayStart() && !unresolved.current,
  };
}
