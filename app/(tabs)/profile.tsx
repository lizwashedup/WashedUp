import React, { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect } from 'react';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../../components/keyboard/KeyboardDoneBar';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Linking,
  ActivityIndicator,
  TextInput,
  Keyboard,
  Modal,
  Pressable,
  Share,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import SettingsPortrait from '../../components/yours/profile/settings/SettingsPortrait';
import { ProfileEditFields } from '../../components/yours/profile/settings/ProfileEditFields';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { hapticLight, hapticSelection } from '../../lib/haptics';
import { useQueryClient } from '@tanstack/react-query';
import { registerPushNotificationsWithResult } from '../../hooks/usePushNotifications';
import { supabase } from '../../lib/supabase';
import { useObservedUser, type ObservedUser } from '../../hooks/useObservedUser';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { useProfileHandleAvailability } from '../../components/yours/profile/settings/useProfileHandleAvailability';
import { profileSaveFeedback } from '../../components/yours/profile/settings/profileSaveFeedback';
import { readOwnProfile, saveOwnProfile, deleteOwnProfile, verifyProfileOwner, requireProfileScope, normalizeProfileHandle, isObsoleteProfileOperation, type ProfileOperationScope, type OwnProfile as Profile } from '../../components/yours/profile/settings/profileOperations';
import { pushRegistrationFeedback } from '../../components/notifications/pushRegistrationFeedback';
import { PHOTO_FORMAT_ERROR_MESSAGE } from '../../constants/PhotoUpload';
import { friendlyError } from '../../lib/friendlyError';
import { logError } from '../../lib/logger';
import { PROFILE_PHOTO_KEY } from '../../constants/QueryKeys';
import Colors, { AfterglowColors } from '../../constants/Colors';
import { SkeletonProfile } from '../../components/SkeletonCard';
import { type AfterglowFontFamilies } from '../../constants/Typography';
import { isAdmin } from '../../constants/Admin';
import { COMMUNITY_CHAT_GROUPING_ENABLED } from '../../constants/FeatureFlags';
import { baseStyles, profileSettingsAppearance } from '../../components/yours/profile/settings/profileSettingsStyles';
import { useProfileCreatorEntries } from '../../components/yours/profile/settings/useProfileCreatorEntries';
import { ProfileCreatorSection } from '../../components/yours/profile/settings/ProfileCreatorSection';
import { checkContent } from '../../lib/contentFilter';
import { unauthedRoute } from '../../lib/authRouting';
import { lastUnauthRedirectAt, deliberateSignOutAt } from '../../lib/navState';
import { forgetAccount } from '../../lib/knownAccount';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';

import {
  NEIGHBORHOOD_OPTIONS,
  NEIGHBORHOOD_OTHER,
  NEIGHBORHOOD_SET,
} from '../../constants/Neighborhoods';

export default function ProfileScreen() {
  const viewer = useObservedUser();
  const { fonts } = useAfterglowFonts(COMMUNITY_CHAT_GROUPING_ENABLED);
  const appearance = useMemo(() => COMMUNITY_CHAT_GROUPING_ENABLED ? { fonts } : undefined, [fonts]);
  return <ProfileAccount key={JSON.stringify([viewer.viewerId, viewer.epoch])} viewer={viewer} appearance={appearance}/>;
}

type ProfileAppearance = { fonts: AfterglowFontFamilies };
type PhotoSelection = { scope: ProfileOperationScope; kind: 'camera' | 'library' | null | undefined; started: boolean; alert: ProfileAlert | null };
type ProfileAlert = { title: string; message?: string; buttons?: BrandedAlertButton[] };
function ProfileAccount({ viewer: pushViewer, appearance }: { viewer: ObservedUser; appearance?: ProfileAppearance }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const styles = useMemo(() => appearance ? { ...baseStyles, ...profileSettingsAppearance(appearance.fonts) } : baseStyles, [appearance]);
  const ink = appearance ? AfterglowColors.ink : Colors.asphalt;
  const accent = appearance ? AfterglowColors.clay : Colors.terracotta;
  const muted = appearance ? AfterglowColors.muted : Colors.warmGray;
  const [profile, setProfile] = useState<Profile | null>(null);
  const profileRef = useRef(profile); profileRef.current = profile;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [alertInfo, setAlertState] = useState<ProfileAlert | null>(null);
  const alertRef = useRef<ProfileAlert | null>(null);
  const setAlertInfo = useCallback((value: React.SetStateAction<ProfileAlert | null>) => {
    const next = typeof value === 'function' ? value(alertRef.current) : value;
    alertRef.current = next; setAlertState(next);
  }, []);
  const closeAlert = (info: ProfileAlert | null) => {
    if (alertRef.current !== info) return;
    const selection = photoLock.current;
    if (selection?.alert === info && selection.kind === undefined) selection.kind = null;
    setAlertInfo(null);
  };
  const mounted = useRef(false);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const identity = useRef(pushViewer); identity.current = pushViewer;
  const userId = pushViewer.viewerId ?? '';
  const identityReady = !!userId && !pushViewer.isLoading && !pushViewer.error && pushViewer.isCurrent();
  const accountCurrent = useCallback(() => mounted.current && !!userId && identity.current.viewerId === userId && !identity.current.isLoading && !identity.current.error && pushViewer.isCurrent(), [userId, pushViewer.isCurrent]);
  const pushFocus = useRef<object | null>(null);
  const [screenVisit, setScreenVisit] = useState<object | null>(null);
  const retiredVisit = useRef<object | null>(null);
  const pushAttempt = useRef<object | null>(null);
  const pushAlert = useRef<ProfileAlert | null>(null);
  const [enablingPush, setEnablingPush] = useState(false);
  const pushProfileId = useRef(profile?.id); pushProfileId.current = profile?.id;
  useFocusEffect(useCallback(() => {
    const visit = {}; pushFocus.current = visit; retiredVisit.current = null; setScreenVisit(visit);
    pushAttempt.current = null; setEnablingPush(false);
    photoLock.current = null; setPhotoSelection(null); readAttempt.current = null; resetCreatorAttempt();
    setSaving(!!saveLock.current); setPhotoBusy(false); setDeleting(!!deleteLock.current);
    return () => {
      if (pushFocus.current !== visit) return;
      pushFocus.current = null; setScreenVisit(null); pushAttempt.current = null; pushAlert.current = null; setAlertInfo(null);
    };
  }, [userId, pushViewer.epoch, setAlertInfo]));
  const pageCurrent = useCallback(() => accountCurrent() && !!screenVisit && pushFocus.current === screenVisit && retiredVisit.current !== screenVisit, [accountCurrent, screenVisit]);
  const canUseProfile = () => pageCurrent() && profileRef.current?.id === userId;
  const pageScope = useMemo(() => ({ userId, isCurrent: pageCurrent }), [userId, pageCurrent]);
  const { creatorAccess, organizerName, pendingGrants, creatorError, loadingCreators, creatorsNeedRefresh, fetchCreatorEntries, resetCreatorAttempt } = useProfileCreatorEntries(pageScope);
  const back = () => { if (!mounted.current || !screenVisit || pushFocus.current !== screenVisit || retiredVisit.current === screenVisit) return; retiredVisit.current = screenVisit; router.back(); };
  const navigate = (href: string, replace = false) => { if (!canUseProfile()) return; retiredVisit.current = screenVisit; if (replace) router.replace(href as never); else router.push(href as never); };

  const [showDeleteFlow, setShowDeleteFlow] = useState(false);
  const [deleteEntry, setDeleteEntry] = useState<object | null>(null);
  const deleteEntryRef = useRef(deleteEntry); deleteEntryRef.current = deleteEntry;
  const [deleteStep, setDeleteStep] = useState(1);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const deleteValues = useRef({ deleteStep, deleteConfirmText }); deleteValues.current = { deleteStep, deleteConfirmText };
  const [deleting, setDeleting] = useState(false);
  const deleteLock = useRef<object | null>(null);
  const deleteScope = useMemo(() => ({ userId, isCurrent: () => pageCurrent() && !!deleteEntry && deleteEntryRef.current === deleteEntry }), [userId, pageCurrent, deleteEntry]);
  const [showEditFlow, setShowEditFlow] = useState(false);
  const [editEntry, setEditEntry] = useState<object | null>(null);
  const editEntryRef = useRef(editEntry); editEntryRef.current = editEntry;
  const [editName, setEditName] = useState('');
  const [editHandle, setEditHandle] = useState('');
  const [editPhotoUri, setEditPhotoUri] = useState<string | null>(null);
  const [editPhotoBase64, setEditPhotoBase64] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const saveLock = useRef<object | null>(null), photoLock = useRef<PhotoSelection | null>(null);
  const [photoSelection, setPhotoSelection] = useState<PhotoSelection | null>(null);
  const [editNeighborhood, setEditNeighborhood] = useState('');
  const [editNeighborhoodOther, setEditNeighborhoodOther] = useState('');
  const [showNeighborhoodPicker, setShowNeighborhoodPicker] = useState(false);
  const [editIsVisitor, setEditIsVisitor] = useState(false);
  const [editFunFact, setEditFunFact] = useState('');
  const editScope = useMemo(() => ({ userId, isCurrent: () => pageCurrent() && !!editEntry && editEntryRef.current === editEntry }), [userId, pageCurrent, editEntry]);
  const handleCheck = useProfileHandleAvailability({ enabled: showEditFlow && identityReady && !!screenVisit, handle: editHandle, currentHandle: profile?.handle ?? null, scope: editScope });
  const latestHandleCheck = useRef(handleCheck); latestHandleCheck.current = handleCheck;
  const editChange = <T,>(setter: React.Dispatch<React.SetStateAction<T>>, value: T) => { if (editScope.isCurrent() && !saveLock.current && !photoLock.current) setter(value); };
  const editValues = useRef({ editName, editHandle, editNeighborhood, editNeighborhoodOther, editIsVisitor, editFunFact, editPhotoBase64 });
  editValues.current = { editName, editHandle, editNeighborhood, editNeighborhoodOther, editIsVisitor, editFunFact, editPhotoBase64 };
  const closeEditFlow = () => {
    if (!editScope.isCurrent() || saveLock.current) return;
    editEntryRef.current = null; setEditEntry(null); setShowEditFlow(false); setShowNeighborhoodPicker(false);
    saveLock.current = null; photoLock.current = null; setPhotoSelection(null); setSaving(false); setPhotoBusy(false); setAlertInfo(null);
  };
  const readAttempt = useRef<object | null>(null);
  const lastProfileFocusFetchRef = useRef(0);
  const profileNeedsRefresh = useRef(false);
  const refreshCurrentProfile = useRef<(() => Promise<void>) | null>(null);
  const fetchProfile = async (afterSettledWrite = false) => {
    if (!pageScope.isCurrent() || (readAttempt.current && !afterSettledWrite)) return;
    const attempt = {}; readAttempt.current = attempt; setLoadError(false); setLoading(!profileRef.current);
    const scope = { userId, isCurrent: () => pageScope.isCurrent() && readAttempt.current === attempt };
    try { const data = await readOwnProfile(scope); if (scope.isCurrent()) { setProfile(data); profileNeedsRefresh.current = false; } }
    catch (error) { if (scope.isCurrent() && !isObsoleteProfileOperation(error)) { setLoadError(true); logError(error, 'profile.fetchProfile'); } }
    finally { if (scope.isCurrent()) { setLoading(false); readAttempt.current = null; } }
  };
  // A refocus read may have started before the pending write settled. Retire
  // that read so its old snapshot cannot clear the reconciliation marker.
  refreshCurrentProfile.current = () => fetchProfile(true);

  useEffect(() => {
    if (!identityReady) { setLoading(pushViewer.isLoading); return; }
    if (!screenVisit) return;
    const now = Date.now();
    const refreshProfile = !profileRef.current || profileNeedsRefresh.current || now - lastProfileFocusFetchRef.current > 20_000;
    if (refreshProfile) {
      lastProfileFocusFetchRef.current = now; void fetchProfile();
    }
    // The profile cache must not suppress a creator read interrupted by leaving.
    if (refreshProfile || creatorsNeedRefresh.current) void fetchCreatorEntries();
  }, [screenVisit, identityReady]);

  const openEditFlow = () => {
    if (!canUseProfile() || editEntryRef.current) return;
    const current = profileRef.current!;
    setEditName(current.first_name ?? ''); setEditHandle(current.handle ?? '');
    const savedNeighborhood = (current.neighborhood ?? '').trim();
    if (!savedNeighborhood) { setEditNeighborhood(''); setEditNeighborhoodOther(''); }
    else if (NEIGHBORHOOD_SET.has(savedNeighborhood)) { setEditNeighborhood(savedNeighborhood); setEditNeighborhoodOther(''); }
    else { setEditNeighborhood(NEIGHBORHOOD_OTHER); setEditNeighborhoodOther(savedNeighborhood); }
    setEditIsVisitor(current.is_visitor ?? false); setEditFunFact(current.fun_fact ?? ''); setEditPhotoUri(null); setEditPhotoBase64(null);
    const entry = {}; editEntryRef.current = entry; setEditEntry(entry); setShowEditFlow(true); setSaving(false); setPhotoBusy(false);
  };
  const { openEdit } = useLocalSearchParams<{ openEdit?: string }>();
  const consumedOpenEdit = useRef(false);
  useEffect(() => {
    if (openEdit !== 'true') { consumedOpenEdit.current = false; return; }
    if (!consumedOpenEdit.current && !loading && profile && pageCurrent()) { consumedOpenEdit.current = true; openEditFlow(); }
  }, [openEdit, loading, profile, screenVisit]);
  const shareHandle = async () => {
    if (!canUseProfile() || !profileRef.current?.handle) return;
    const handle = profileRef.current.handle; hapticSelection();
    try { await Share.share({ message: `@${handle}` }); } catch (error) { if (pageScope.isCurrent()) logError(error, 'profile.shareHandle'); }
  };
  const chooseEditPhoto = async (attempt: PhotoSelection) => {
    const { scope, kind } = attempt;
    const current = () => scope.isCurrent() && photoLock.current === attempt;
    try {
      if (kind === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!current()) return;
        if (permission.status !== 'granted') { setAlertInfo({ title: 'Permission needed', message: 'Go to Settings and allow camera access.' }); return; }
      }
      // The system library picker grants access only to the selected photo;
      // broad Photos permission is not required, even after an earlier denial.
      const result = kind === 'camera' ? await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1, 1], quality: 1 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 });
      if (!current() || result.canceled || !result.assets?.[0]) return;
      const manipulated = await ImageManipulator.manipulateAsync(result.assets[0].uri, [{ resize: { width: 800, height: 800 } }], { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      if (!current()) return;
      if (!manipulated.base64) throw new Error('No image data');
      setEditPhotoUri(manipulated.uri); setEditPhotoBase64(manipulated.base64);
    } catch { if (current()) setAlertInfo({ title: 'Invalid image', message: PHOTO_FORMAT_ERROR_MESSAGE }); }
    finally { if (photoLock.current === attempt) { photoLock.current = null; setPhotoSelection(null); if (scope.isCurrent()) setPhotoBusy(false); } }
  };
  const finishPhotoDismissal = (selection: PhotoSelection | null) => {
    if (!selection || photoLock.current !== selection || !selection.scope.isCurrent()
      || selection.started || selection.kind === undefined) return;
    selection.started = true;
    if (selection.kind === null) {
      photoLock.current = null; setPhotoSelection(null); setPhotoBusy(false);
    } else void chooseEditPhoto(selection);
  };
  useEffect(() => {
    // Android has no Modal.onDismiss. Dispatch only after hidden state commits.
    if (Platform.OS !== 'ios' && !alertInfo) finishPhotoDismissal(photoSelection);
  }, [alertInfo, photoSelection]);
  const pickEditPhoto = () => {
    if (!editScope.isCurrent() || photoLock.current || saveLock.current) return; hapticLight();
    const selection: PhotoSelection = { scope: editScope, kind: undefined, started: false, alert: null };
    photoLock.current = selection; setPhotoSelection(selection); setPhotoBusy(true);
    const choose = (kind: PhotoSelection['kind']) => {
      if (photoLock.current !== selection || !selection.scope.isCurrent() || selection.kind !== undefined) return;
      selection.kind = kind;
      if (alertRef.current === selection.alert) setAlertInfo(null);
    };
    selection.alert = { title: 'Change photo', message: 'Choose how to add your photo', buttons: [
      { text: 'Take Photo', onPress: () => choose('camera') },
      { text: 'Photo library', onPress: () => choose('library') },
      { text: 'Cancel', style: 'cancel', onPress: () => choose(null) },
    ] };
    setAlertInfo(selection.alert);
  };
  const handleSaveProfile = async () => {
    if (!editScope.isCurrent() || saveLock.current || photoLock.current) return;
    const draft = { ...editValues.current };
    if (!latestHandleCheck.current.canSave || latestHandleCheck.current.handle !== normalizeProfileHandle(draft.editHandle)) return;
    hapticLight(); Keyboard.dismiss();
    const trimmedName = draft.editName.trim();
    if (!trimmedName) { setAlertInfo({ title: 'Name required', message: 'Please enter a display name.' }); return; }
    const neighborhood = draft.editNeighborhood === NEIGHBORHOOD_OTHER ? draft.editNeighborhoodOther.trim() : draft.editNeighborhood.trim();
    const filter = checkContent([trimmedName, neighborhood, draft.editFunFact].filter(Boolean).join(' '));
    if (!filter.ok) { setAlertInfo({ title: 'Content not allowed', message: filter.reason ?? 'Please revise your profile and try again.' }); return; }
    const attempt = {}; saveLock.current = attempt; profileNeedsRefresh.current = true; setSaving(true);
    const scope = { userId, isCurrent: () => editScope.isCurrent() && saveLock.current === attempt };
    try {
      const fields = await saveOwnProfile({ name: trimmedName, handle: draft.editHandle, neighborhood, isVisitor: draft.editIsVisitor, funFact: draft.editFunFact, photoUrl: profileRef.current?.avatar_url ?? null, photoBase64: draft.editPhotoBase64 }, scope);
      if (!scope.isCurrent()) return;
      void queryClient.invalidateQueries({ queryKey: PROFILE_PHOTO_KEY });
      setProfile(prev => prev?.id === userId ? { ...prev, first_name: fields.first_name_display, avatar_url: fields.profile_photo_url, handle: fields.handle, neighborhood: fields.neighborhood, is_visitor: fields.is_visitor, fun_fact: fields.fun_fact } : prev);
      profileNeedsRefresh.current = false; saveLock.current = null; closeEditFlow();
    } catch (error) { if (scope.isCurrent() && !isObsoleteProfileOperation(error)) setAlertInfo({ title: 'Could not save', message: profileSaveFeedback(error) }); }
    finally {
      if (saveLock.current === attempt) {
        if (accountCurrent() && !editScope.isCurrent()) {
          profileNeedsRefresh.current = true;
          await refreshCurrentProfile.current?.();
        }
        if (saveLock.current === attempt) { saveLock.current = null; if (accountCurrent()) setSaving(false); }
      }
    }
  };

  const openDeleteFlow = () => { if (!canUseProfile()) return; const entry = {}; deleteEntryRef.current = entry; setDeleteEntry(entry); setShowDeleteFlow(true); setDeleteStep(1); setDeleteConfirmText(''); setDeleting(false); };
  const resetDeleteFlow = () => { if (!deleteScope.isCurrent() || deleteLock.current) return; deleteEntryRef.current = null; setDeleteEntry(null); setShowDeleteFlow(false); setDeleteStep(1); setDeleteConfirmText(''); deleteLock.current = null; setDeleting(false); };
  const changeDeleteStep = (step: number) => { if (deleteScope.isCurrent() && !deleteLock.current) setDeleteStep(step); };
  const handleDeleteAccount = async () => {
    if (!deleteScope.isCurrent() || deleteLock.current || deleteValues.current.deleteStep !== 2) return;
    if (deleteValues.current.deleteConfirmText.trim().toUpperCase() !== 'DELETE') { setAlertInfo({ title: 'Type DELETE to confirm', message: 'Please type DELETE in all caps to confirm.' }); return; }
    const attempt = {}; deleteLock.current = attempt; setDeleting(true);
    const scope = { userId, isCurrent: () => deleteScope.isCurrent() && deleteLock.current === attempt };
    try {
      await deleteOwnProfile(scope, () => {
        lastUnauthRedirectAt.ts = Date.now(); deliberateSignOutAt.ts = Date.now();
        void forgetAccount(); router.replace(unauthedRoute() as never);
      });
    } catch (error) {
      if (scope.isCurrent() && !isObsoleteProfileOperation(error)) {
        setAlertInfo({ title: 'Something went wrong', message: friendlyError(error, 'We could not delete your account automatically.\n\nPlease email hello@washedup.app and we will delete it within 24 hours.') });
      }
    } finally { if (deleteLock.current === attempt) { deleteLock.current = null; if (accountCurrent()) setDeleting(false); } }
  };
  const logoutLock = useRef<object | null>(null);
  const handleLogOut = () => {
    if (!canUseProfile() || logoutLock.current) return;
    const info: ProfileAlert = { title: appearance ? 'Log out' : 'Log Out', message: 'Are you sure you want to log out?', buttons: [
      { text: 'Cancel', style: 'cancel' },
      { text: appearance ? 'Log out' : 'Log Out', style: 'destructive', onPress: () => {
        if (!pageScope.isCurrent() || alertRef.current !== info || logoutLock.current) return;
        const attempt = {}; logoutLock.current = attempt;
        void (async () => { try {
          await verifyProfileOwner(pageScope); requireProfileScope(pageScope);
          deliberateSignOutAt.ts = Date.now(); void forgetAccount();
          const { error } = await supabase.auth.signOut();
          if (error) throw error;
        } catch (error) { if (pageScope.isCurrent() && !isObsoleteProfileOperation(error)) setAlertInfo({ title: 'Could not log out', message: friendlyError(error, 'Please try again.') }); }
        finally { if (logoutLock.current === attempt) logoutLock.current = null; } })();
      } },
    ] }; setAlertInfo(info);
  };

  const handleEnablePushFromSettings = async () => {
    const visit = pushFocus.current;
    const userId = profile?.id;
    const isCurrent = () => pageCurrent() && visit !== null && pushFocus.current === visit &&
      !!userId && pushProfileId.current === userId && userId === pushViewer.viewerId &&
      !pushViewer.error && pushViewer.isCurrent();
    if (!isCurrent() || pushAttempt.current) return;
    const attempt = {};
    pushAttempt.current = attempt;
    // A fresh attempt retires any Settings callback from an earlier alert,
    // even if the account and visible screen have not changed.
    const previousPushAlert = pushAlert.current;
    pushAlert.current = null;
    setAlertInfo(current => current === previousPushAlert ? null : current);
    setEnablingPush(true);
    const showFeedback = (result: Parameters<typeof pushRegistrationFeedback>[0]) => {
      if (!isCurrent() || pushAttempt.current !== attempt) return;
      const feedback = pushRegistrationFeedback(result);
      if (feedback.kind === 'silent') return;
      const info: NonNullable<typeof alertInfo> = {
        title: feedback.title,
        message: feedback.message,
        buttons: feedback.kind === 'settings' ? [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => {
            if (!isCurrent() || pushAlert.current !== info) return;
            void Linking.openSettings().catch(() => {
              if (!isCurrent() || pushAlert.current !== info) return;
              const failed = {
                title: 'Couldn’t open Settings',
                message: 'Open your device settings and choose WashedUp to change notifications.',
              };
              pushAlert.current = failed;
              setAlertInfo(failed);
            });
          } },
        ] : undefined,
      };
      pushAlert.current = info;
      setAlertInfo(info);
    };
    try {
      // Probe without prompting first. The structured API distinguishes an
      // unasked Android permission from a confirmed native denial.
      let result = await registerPushNotificationsWithResult({ prompt: false, userId });
      if (!isCurrent() || pushAttempt.current !== attempt) return;
      if (result.status === 'permission-required') {
        result = await registerPushNotificationsWithResult({ prompt: true, userId, canPrompt: () => isCurrent() && pushAttempt.current === attempt });
      }
      showFeedback(result);
    } catch {
      showFeedback({ status: 'failed' });
    } finally {
      if (pushAttempt.current === attempt) {
        pushAttempt.current = null;
        if (isCurrent()) setEnablingPush(false);
      }
    }
  };

  const notificationRows = [
    {
      icon: 'notifications-outline',
      label: enablingPush ? 'Turning on…' : 'Enable notifications',
      busy: enablingPush,
      onPress: handleEnablePushFromSettings,
    },
  ];
  const openExternal = (url: string, ctx: string) => { if (!pageScope.isCurrent()) return; void Linking.openURL(url).catch((error) => { if (pageScope.isCurrent()) logError(error, ctx); }); };
  const legalRows = [
    { icon: 'shield-outline', label: appearance ? 'Privacy policy' : 'Privacy Policy', onPress: () => openExternal('https://washedup.app/privacy', 'profile.openPrivacy') },
    { icon: 'document-text-outline', label: appearance ? 'Terms of service' : 'Terms of Service', onPress: () => openExternal('https://washedup.app/terms', 'profile.openTerms') },
    { icon: 'people-outline', label: appearance ? 'Community guidelines' : 'Community Guidelines', onPress: () => openExternal('https://washedup.app/community-guidelines', 'profile.openGuidelines') },
  ];
  const supportRows = [
    { icon: 'mail-outline', label: appearance ? 'Contact us' : 'Contact Us', onPress: () => openExternal('mailto:hello@washedup.app', 'profile.openMailto') },
  ];
  if (!identityReady || loadError || (!loading && !profile)) {
    const waiting = pushViewer.isLoading;
    return <SafeAreaView style={styles.container} edges={['top']}>
      <TouchableOpacity style={styles.backButton} accessibilityRole="button" accessibilityLabel="Back" onPress={back}><Ionicons name="chevron-back" size={24} color={ink}/></TouchableOpacity>
      <View style={styles.centered}>
        {waiting ? <><ActivityIndicator color={accent}/><Text style={styles.statusText}>Loading profile…</Text></> : <>
          <Text style={styles.statusTitle}>{pushViewer.error ? 'Couldn’t check your account.' : loadError ? 'Couldn’t load your profile.' : 'Your profile isn’t available.'}</Text>
          {(pushViewer.error || (identityReady && loadError)) && <TouchableOpacity style={styles.retryButton} accessibilityRole="button" accessibilityLabel={pushViewer.error ? 'Try again to check account' : 'Try again to load profile'} onPress={() => { if (pushViewer.error) { if (mounted.current && screenVisit && pushFocus.current === screenVisit && retiredVisit.current !== screenVisit) void pushViewer.retry(); } else void fetchProfile(); }}><Text style={styles.retryText}>Try again</Text></TouchableOpacity>}
        </>}
      </View>
    </SafeAreaView>;
  }

  // ── Loading ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <>
        <SafeAreaView style={styles.container} edges={['top']}>
          <TouchableOpacity style={styles.backButton} accessibilityRole="button" accessibilityLabel="Back" onPress={back}><Ionicons name="chevron-back" size={24} color={ink}/></TouchableOpacity>
          {appearance ? <View style={styles.centered}><ActivityIndicator color={accent}/><Text style={styles.statusText}>Loading profile…</Text></View> : <SkeletonProfile/>}
        </SafeAreaView>
        <BrandedAlert
          appearance={appearance}
          visible={!!alertInfo}
          title={alertInfo?.title ?? ''}
          message={alertInfo?.message}
          buttons={alertInfo?.buttons}
          onClose={() => closeAlert(alertInfo)}
          onDismiss={() => finishPhotoDismissal(photoSelection)}
        />
      </>
    );
  }

  // ── Delete Flow ─────────────────────────────────────────────────────────────

  if (showDeleteFlow) {
    return (
      <>
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.deleteHeader}>
          <TouchableOpacity
            onPress={resetDeleteFlow}
            disabled={deleting}
            style={styles.backButton} accessibilityRole="button" accessibilityLabel="Back from account deletion" accessibilityState={{ disabled: deleting }}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="chevron-back" size={24} color={ink} />
          </TouchableOpacity>
          <Text style={styles.deleteHeaderTitle}>{appearance ? 'Delete account' : 'Delete Account'}</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView decelerationRate="normal" contentContainerStyle={styles.deleteContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          {deleteStep === 1 && (
            <>
              <View style={styles.deleteWarningIcon}>
                <Ionicons name="warning-outline" size={40} color={accent} />
              </View>
              <Text style={styles.deleteTitle}>Are you sure?</Text>
              <Text style={styles.deleteBody}>
                Deleting your account is permanent and cannot be undone.{'\n\n'}
                All your plans, chats, and profile data will be permanently removed.{'\n\n'}
                {/* doc 45: the exact records-may-remain sentence — LIZ COPY
                    may warm the words AROUND it, never this substance */}
                some limited records — transactions, consent, fraud-prevention,
                security, tax, and legal compliance — may remain after deletion
                for the retention periods described in our privacy policy.
              </Text>
              <TouchableOpacity
                accessibilityRole="button" accessibilityLabel="I understand, continue"
                style={styles.deleteNextBtn}
                onPress={() => changeDeleteStep(2)}
              >
                <Text style={styles.deleteNextBtnText}>I understand, continue</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.deleteCancelBtn} onPress={resetDeleteFlow} accessibilityRole="button">
                <Text style={styles.deleteCancelBtnText}>Keep my account</Text>
              </TouchableOpacity>
            </>
          )}

          {deleteStep === 2 && (
            <>
              <View style={[styles.deleteWarningIcon, { backgroundColor: Colors.errorBgLight }]}>
                <Ionicons name="trash-outline" size={40} color={Colors.cancelRed} />
              </View>
              <Text style={styles.deleteTitle}>What you'll lose</Text>
              {[
                'Your profile and all personal information',
                'All plans you created or joined',
                'All chat messages',
                'Your saved wishlist',
              ].map((item, i) => (
                <View key={i} style={styles.deleteListRow}>
                  <Ionicons name="close-circle" size={18} color={Colors.cancelRed} />
                  <Text style={styles.deleteListText}>{item}</Text>
                </View>
              ))}
              <Text style={[styles.deleteBody, { marginTop: 24 }]}>
                Type DELETE below to permanently delete your account.
              </Text>
              <TextInput
                style={styles.deleteInput}
                value={deleteConfirmText}
                onChangeText={(value) => { if (deleteScope.isCurrent() && !deleteLock.current) setDeleteConfirmText(value); }}
                editable={!deleting}
                accessibilityLabel="Type DELETE to confirm"
                placeholder="Type DELETE here"
                placeholderTextColor={Colors.textLight}
                autoCapitalize="characters"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
                inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
              />
              <TouchableOpacity
                style={[
                  styles.deleteFinalBtn,
                  deleteConfirmText.trim().toUpperCase() !== 'DELETE' && styles.deleteFinalBtnDisabled,
                ]}
                onPress={handleDeleteAccount}
                accessibilityRole="button" accessibilityLabel="Permanently delete account"
                disabled={deleting || deleteConfirmText.trim().toUpperCase() !== 'DELETE'}
              >
                {deleting ? (
                  <ActivityIndicator size="small" color={Colors.white} />
                ) : (
                  <Text style={styles.deleteFinalBtnText}>Permanently Delete Account</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.deleteCancelBtn}
                accessibilityRole="button" disabled={deleting}
                onPress={() => changeDeleteStep(1)}
              >
                <Text style={styles.deleteCancelBtnText}>Go back</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
        <BrandedAlert
          appearance={appearance}
          visible={!!alertInfo}
          title={alertInfo?.title ?? ''}
          message={alertInfo?.message}
          buttons={alertInfo?.buttons}
          onClose={() => closeAlert(alertInfo)}
          onDismiss={() => finishPhotoDismissal(photoSelection)}
        />
      </>
    );
  }

  // ── Edit Profile Flow ───────────────────────────────────────────────────────

  if (showEditFlow) {
    const displayPhoto = editPhotoUri ?? profile?.avatar_url;
    return (
      <>
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.deleteHeader}>
          <TouchableOpacity
            onPress={closeEditFlow}
            disabled={saving}
            style={styles.backButton} accessibilityRole="button" accessibilityLabel="Back from profile editing" accessibilityState={{ disabled: saving }}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="chevron-back" size={24} color={ink} />
          </TouchableOpacity>
          <Text style={styles.deleteHeaderTitle}>{appearance ? 'Edit profile' : 'Edit Profile'}</Text>
          <View style={{ width: 24 }} />
        </View>

        <ProfileEditFields
          styles={styles} appearance={!!appearance} userId={userId}
          displayPhoto={displayPhoto} editName={editName} editHandle={editHandle}
          editFunFact={editFunFact} editNeighborhood={editNeighborhood}
          editNeighborhoodOther={editNeighborhoodOther} editIsVisitor={editIsVisitor}
          gender={profile?.gender} saving={saving} photoBusy={photoBusy} handleCheck={handleCheck}
          onNameChange={(value) => editChange(setEditName, value)}
          onHandleChange={(value) => editChange(setEditHandle, normalizeProfileHandle(value))}
          onFunFactChange={(value) => editChange(setEditFunFact, value)}
          onOtherNeighborhoodChange={(value) => editChange(setEditNeighborhoodOther, value)}
          onVisitorChange={(value) => editChange(setEditIsVisitor, value)}
          onOpenNeighborhood={() => { if (!editScope.isCurrent() || saveLock.current || photoLock.current) return; hapticLight(); Keyboard.dismiss(); setShowNeighborhoodPicker(true); }}
          pickEditPhoto={pickEditPhoto} handleSaveProfile={handleSaveProfile} closeEditFlow={closeEditFlow}
        />
      </SafeAreaView>
        <BrandedAlert
          appearance={appearance}
          visible={!!alertInfo}
          title={alertInfo?.title ?? ''}
          message={alertInfo?.message}
          buttons={alertInfo?.buttons}
          onClose={() => closeAlert(alertInfo)}
          onDismiss={() => finishPhotoDismissal(photoSelection)}
        />
        <Modal
          visible={showNeighborhoodPicker}
          transparent
          animationType="slide"
          onRequestClose={() => { if (editScope.isCurrent()) setShowNeighborhoodPicker(false); }}
          statusBarTranslucent
        >
          <Pressable style={styles.neighborhoodSheetOverlay} onPress={() => { if (editScope.isCurrent()) setShowNeighborhoodPicker(false); }}>
            <Pressable style={styles.neighborhoodSheet} onPress={(e) => e.stopPropagation()}>
              <View style={styles.neighborhoodSheetHeader}>
                <Text style={styles.neighborhoodSheetTitle}>Select neighborhood</Text>
                <TouchableOpacity
                  onPress={() => { if (editScope.isCurrent()) setShowNeighborhoodPicker(false); }}
                  style={styles.backButton} accessibilityRole="button" accessibilityLabel="Close neighborhood picker"
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <Ionicons name="close" size={22} color={ink} />
                </TouchableOpacity>
              </View>
              <ScrollView decelerationRate="normal" style={styles.neighborhoodSheetList} showsVerticalScrollIndicator={false}>
                {[...NEIGHBORHOOD_OPTIONS, NEIGHBORHOOD_OTHER].map((opt) => {
                  const selected = editNeighborhood === opt;
                  return (
                    <TouchableOpacity
                      key={opt}
                      accessibilityRole="radio" accessibilityLabel={opt} accessibilityState={{ checked: selected, disabled: saving || photoBusy }}
                      style={styles.neighborhoodOption}
                      onPress={() => {
                        if (!editScope.isCurrent() || saveLock.current || photoLock.current) return;
                        hapticLight();
                        setEditNeighborhood(opt);
                        setShowNeighborhoodPicker(false);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.neighborhoodOptionText, selected && styles.neighborhoodOptionTextSelected]}>
                        {opt}
                      </Text>
                      {selected && <Ionicons name="checkmark" size={18} color={accent} />}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
      </>
    );
  }

  // ── Main Profile Screen ─────────────────────────────────────────────────────

  const renderSettingsRow = (row: { icon: string; label: string; onPress: () => void; busy?: boolean }, isLast: boolean) => (
    <TouchableOpacity
      key={row.label}
      style={[styles.settingsRow, !isLast && styles.settingsRowDivider]}
      onPress={() => { if (canUseProfile()) row.onPress(); }}
      disabled={row.busy}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!row.busy, busy: !!row.busy }}
      activeOpacity={0.7}
    >
      <Ionicons name={row.icon as any} size={20} color={accent} />
      <Text style={styles.settingsLabel}>{row.label}</Text>
      <Ionicons name="chevron-forward" size={16} color={muted} />
    </TouchableOpacity>
  );

  return (
    <>
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScrollView decelerationRate="normal" showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* Header row with back button */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={back}
            accessibilityRole="button" accessibilityLabel="Back"
            style={styles.backButton}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="chevron-back" size={26} color={ink} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Profile</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Profile header: avatar, display name, handle */}
        <View style={styles.profileSection}>
          <View style={styles.avatarContainer}>
            <SettingsPortrait key={JSON.stringify([userId, profile?.avatar_url])} uri={profile?.avatar_url ?? null} name={profile?.first_name ?? null} style={styles.avatar} fallbackStyle={styles.avatarFallback} textStyle={styles.avatarInitial}/>

          </View>
          <Text style={styles.profileName}>{profile?.first_name ?? 'Your Profile'}</Text>
          {profile?.handle ? (
            <TouchableOpacity
              onPress={shareHandle}
              accessibilityRole="button" accessibilityLabel="Share your handle"
              style={styles.handleShareRow}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              activeOpacity={0.7}
            >
              <Text style={styles.profileHandle}>@{profile.handle}</Text>
              <Ionicons name="share-outline" size={14} color={muted} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={openEditFlow} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.profileHandleLink}>Set a handle</Text>
            </TouchableOpacity>
          )}
          {profile?.city && (
            <View style={styles.locationRow}>
              <Ionicons name="location-outline" size={14} color={muted} />
              <Text style={styles.locationText}>{profile.city}</Text>
            </View>
          )}
          {profile?.fun_fact && (
            <Text style={styles.bio}>{profile.fun_fact}</Text>
          )}

          <TouchableOpacity style={styles.editProfileBtn} accessibilityRole="button" accessibilityLabel="Edit profile" onPress={openEditFlow} activeOpacity={0.8}>
            <Ionicons name="create-outline" size={16} color={accent} />
            <Text style={styles.editProfileBtnText}>{appearance ? 'Edit profile' : 'Edit Profile'}</Text>
          </TouchableOpacity>
        </View>

        {/* your tickets (7-27 ship ruling item 3): the wallet's standing entry,
            above the settings groups because it is the user's own stuff, not a
            setting. Label ruled by Liz, logged as taste debt. */}
        <View style={[styles.settingsGroup, styles.ticketsGroup]}>
          {renderSettingsRow(
            /* LIZ COPY (ruled 7-27): matches the wallet screen's own header */
            { icon: 'ticket-outline', label: 'your tickets', onPress: () => navigate('/tickets') },
            true,
          )}
        </View>

        {/* Notifications */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Notifications</Text>
        </View>
        <View style={styles.settingsGroup}>
          {notificationRows.map((row, i) => renderSettingsRow(row, i === notificationRows.length - 1))}
        </View>

        {/* Legal */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Legal</Text>
        </View>
        <View style={styles.settingsGroup}>
          {legalRows.map((row, i) => renderSettingsRow(row, i === legalRows.length - 1))}
        </View>

        {/* Support */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Support</Text>
        </View>
        <View style={styles.settingsGroup}>
          {supportRows.map((row, i) => renderSettingsRow(row, i === supportRows.length - 1))}
        </View>

        <ProfileCreatorSection
          styles={styles} appearance={appearance} accent={accent} muted={muted}
          creatorError={creatorError} loadingCreators={loadingCreators}
          creatorAccess={creatorAccess} organizerName={organizerName} pendingGrants={pendingGrants}
          fetchCreatorEntries={fetchCreatorEntries} canUseProfile={canUseProfile} navigate={navigate}
        />

        {/* Admin */}
        {isAdmin(profile?.id ?? null) && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Admin</Text>
            </View>
            <View style={styles.settingsGroup}>
              <TouchableOpacity
                style={styles.settingsRow}
                onPress={() => navigate('/admin/events')}
                activeOpacity={0.7}
              >
                <Text style={styles.settingsLabel}>Manage Scene Events</Text>
                <Ionicons name="chevron-forward" size={16} color={muted} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.settingsRow}
                onPress={() => navigate('/admin/applications')}
                activeOpacity={0.7}
              >
                <Text style={styles.settingsLabel}>Creator Applications</Text>
                <Ionicons name="chevron-forward" size={16} color={muted} />
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* Account */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Account</Text>
        </View>
        <View style={styles.settingsGroup}>
          <TouchableOpacity style={styles.settingsRow} onPress={openDeleteFlow} accessibilityRole="button" accessibilityLabel="Delete account" activeOpacity={0.7}>
            <Text style={styles.deleteAccountLink}>{appearance ? 'Delete account' : 'Delete Account'}</Text>
          </TouchableOpacity>
        </View>

        {/* Log Out button — full-width outlined at bottom */}
        <View style={styles.logOutWrap}>
          <TouchableOpacity style={styles.logOutBtn} onPress={handleLogOut} accessibilityRole="button" accessibilityLabel="Log out" activeOpacity={0.85}>
            <Text style={styles.logOutBtnText}>{appearance ? 'Log out' : 'Log Out'}</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.footer}>washedup · hello@washedup.app</Text>
      </ScrollView>
    </SafeAreaView>
      <BrandedAlert
          appearance={appearance}
        visible={!!alertInfo}
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message}
        buttons={alertInfo?.buttons}
        onClose={() => closeAlert(alertInfo)}
          onDismiss={() => finishPhotoDismissal(photoSelection)}
      />
    </>
  );
}
