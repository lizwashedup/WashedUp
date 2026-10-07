import React, { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect } from 'react';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../../components/keyboard/KeyboardDoneBar';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Linking,
  ActivityIndicator,
  TextInput,
  Keyboard,
  Modal,
  Pressable,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import SettingsPortrait from '../../components/yours/profile/settings/SettingsPortrait';
import { Camera } from 'lucide-react-native';
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
import { Fonts, FontSizes, displaySmall, bodySmall, bodyMedium, labelSmall, AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';
import { isAdmin } from '../../constants/Admin';
import { COMMUNITIES_ENABLED, COMMUNITY_CHAT_GROUPING_ENABLED, CREATOR_PAGES_ENABLED } from '../../constants/FeatureFlags';
import { getCreatorAccess, hasCreatorAccess, type CreatorAccess } from '../../lib/creatorMode';
import { getMyOrganizerProfile } from '../../lib/organizerProfile';
import { fetchMyGrants, type OperatorGrant } from '../../lib/operatorApplications';
import { setSelectedCommunityId } from '../../lib/selectedCommunity';
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
  const [creatorAccess, setCreatorAccess] = useState<CreatorAccess | null>(null);
  const [organizerName, setOrganizerName] = useState<string | null>(null);
  const [pendingGrants, setPendingGrants] = useState<OperatorGrant[]>([]);
  const [creatorError, setCreatorError] = useState(false);
  const [loadingCreators, setLoadingCreators] = useState(false);
  const [alertInfo, setAlertState] = useState<ProfileAlert | null>(null);
  const alertRef = useRef<ProfileAlert | null>(null);
  const setAlertInfo = useCallback((value: React.SetStateAction<ProfileAlert | null>) => {
    const next = typeof value === 'function' ? value(alertRef.current) : value;
    alertRef.current = next; setAlertState(next);
  }, []);
  const closeAlert = (info: ProfileAlert | null) => { if (alertRef.current === info) setAlertInfo(null); };
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
    photoLock.current = null; readAttempt.current = null; creatorsAttempt.current = null;
    setSaving(!!saveLock.current); setPhotoBusy(false); setDeleting(!!deleteLock.current);
    return () => {
      if (pushFocus.current !== visit) return;
      pushFocus.current = null; setScreenVisit(null); pushAttempt.current = null; pushAlert.current = null; setAlertInfo(null);
    };
  }, [userId, pushViewer.epoch, setAlertInfo]));
  const pageCurrent = useCallback(() => accountCurrent() && !!screenVisit && pushFocus.current === screenVisit && retiredVisit.current !== screenVisit, [accountCurrent, screenVisit]);
  const canUseProfile = () => pageCurrent() && profileRef.current?.id === userId;
  const pageScope = useMemo(() => ({ userId, isCurrent: pageCurrent }), [userId, pageCurrent]);
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
  const saveLock = useRef<object | null>(null), photoLock = useRef<object | null>(null);
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
    saveLock.current = null; photoLock.current = null; setSaving(false); setPhotoBusy(false); setAlertInfo(null);
  };
  const readAttempt = useRef<object | null>(null), creatorsAttempt = useRef<object | null>(null);
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
  const fetchCreatorEntries = async () => {
    if (!pageScope.isCurrent() || creatorsAttempt.current) return;
    const attempt = {}; creatorsAttempt.current = attempt; setLoadingCreators(true); setCreatorError(false);
    const scope = { userId, isCurrent: () => pageScope.isCurrent() && creatorsAttempt.current === attempt };
    try {
      await verifyProfileOwner(scope);
      const [accessResult, grantsResult] = await Promise.allSettled([getCreatorAccess(), fetchMyGrants()]);
      await verifyProfileOwner(scope);
      requireProfileScope(scope);
      let failed = accessResult.status === 'rejected' || grantsResult.status === 'rejected';
      // These are independent original settings destinations. A failed
      // application or optional name lookup must not hide confirmed access.
      if (grantsResult.status === 'fulfilled') setPendingGrants(grantsResult.value.filter(g => g.status === 'applied' || g.status === 'in_review' || g.status === 'needs_more_info'));
      if (accessResult.status === 'fulfilled') {
        const access = accessResult.value;
        setCreatorAccess(hasCreatorAccess(access) ? access : null);
        if (access?.hasEventHostGrant) {
          try {
            const organizer = await getMyOrganizerProfile();
            await verifyProfileOwner(scope);
            requireProfileScope(scope);
            setOrganizerName(organizer?.display_name ?? null);
          } catch (error) { requireProfileScope(scope); if (isObsoleteProfileOperation(error)) throw error; failed = true; }
        } else setOrganizerName(null);
      }
      requireProfileScope(scope);
      setCreatorError(failed);
    } catch (error) { if (scope.isCurrent() && !isObsoleteProfileOperation(error)) setCreatorError(true); }
    finally { if (scope.isCurrent()) { setLoadingCreators(false); creatorsAttempt.current = null; } }
  };
  useEffect(() => {
    if (!identityReady) { setLoading(pushViewer.isLoading); return; }
    if (!screenVisit) return;
    const now = Date.now();
    if (!profileRef.current || profileNeedsRefresh.current || now - lastProfileFocusFetchRef.current > 20_000) {
      lastProfileFocusFetchRef.current = now; void fetchProfile(); void fetchCreatorEntries();
    }
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
  const chooseEditPhoto = async (kind: 'camera' | 'library', scope: ProfileOperationScope) => {
    if (!scope.isCurrent() || photoLock.current || saveLock.current) return;
    const attempt = {}; photoLock.current = attempt; setPhotoBusy(true);
    const current = () => scope.isCurrent() && photoLock.current === attempt;
    try {
      const permission = kind === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!current()) return;
      if (permission.status !== 'granted') { setAlertInfo({ title: 'Permission needed', message: kind === 'camera' ? 'Go to Settings and allow camera access.' : 'Go to Settings and allow photo access.' }); return; }
      const result = kind === 'camera' ? await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1, 1], quality: 1 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 });
      if (!current() || result.canceled || !result.assets?.[0]) return;
      const manipulated = await ImageManipulator.manipulateAsync(result.assets[0].uri, [{ resize: { width: 800, height: 800 } }], { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      if (!current()) return;
      if (!manipulated.base64) throw new Error('No image data');
      setEditPhotoUri(manipulated.uri); setEditPhotoBase64(manipulated.base64);
    } catch { if (current()) setAlertInfo({ title: 'Invalid image', message: PHOTO_FORMAT_ERROR_MESSAGE }); }
    finally { if (photoLock.current === attempt) { photoLock.current = null; if (scope.isCurrent()) setPhotoBusy(false); } }
  };
  const pickEditPhoto = () => {
    if (!editScope.isCurrent() || photoLock.current || saveLock.current) return; hapticLight();
    setAlertInfo({ title: 'Change photo', message: 'Choose how to add your photo', buttons: [
      { text: 'Take Photo', onPress: () => { void chooseEditPhoto('camera', editScope); } },
      { text: 'Choose from Library', onPress: () => { void chooseEditPhoto('library', editScope); } },
      { text: 'Cancel', style: 'cancel' },
    ] });
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
    } catch (error) { if (scope.isCurrent() && !isObsoleteProfileOperation(error)) setAlertInfo({ title: 'Could not save', message: appearance ? profileSaveFeedback(error) : friendlyError(error, 'Please try again.') }); }
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
        />
      </>
    );
  }

  // ── Edit Profile Flow ───────────────────────────────────────────────────────

  if (showEditFlow) {
    const displayPhoto = editPhotoUri ?? profile?.avatar_url;
    const saveDisabledByHandle = !handleCheck.canSave;
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

        <ScrollView
          decelerationRate="normal"
          contentContainerStyle={styles.editContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity onPress={pickEditPhoto} disabled={saving || photoBusy} accessibilityRole="button" accessibilityLabel="Change photo" activeOpacity={0.8} style={styles.editAvatarWrap}>
            <SettingsPortrait key={JSON.stringify([userId, displayPhoto])} uri={displayPhoto ?? null} name={editName} style={styles.editAvatar} fallbackStyle={styles.avatarFallback} textStyle={styles.avatarInitial}/>
            <View style={styles.editAvatarBadge}>
              <Camera size={14} color={Colors.white} strokeWidth={2.5} />
            </View>
          </TouchableOpacity>
          <Text style={styles.editPhotoHint}>{photoBusy ? 'Preparing photo…' : 'Tap to change photo'}</Text>

          <View style={styles.editFieldGroup}>
            <Text style={styles.editLabel}>{appearance ? 'Display name' : 'Display Name'}</Text>
            <TextInput
              style={styles.editInput}
              value={editName}
              onChangeText={(value) => editChange(setEditName, value)}
              editable={!saving && !photoBusy}
              accessibilityLabel="Display name"
              placeholder="Your name"
              placeholderTextColor={Colors.textLight}
              maxLength={30}
              autoCorrect={false}
              returnKeyType="next"
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />
          </View>

          <View style={styles.editFieldGroup}>
            <Text style={styles.editLabel}>Handle</Text>
            <View style={styles.handleInputRow}>
              <Text style={styles.handlePrefix}>@</Text>
              <TextInput
                style={styles.handleInput}
                value={editHandle}
                onChangeText={(value) => editChange(setEditHandle, normalizeProfileHandle(value))}
                editable={!saving && !photoBusy}
                accessibilityLabel="Handle"
                placeholder="yourhandle"
                placeholderTextColor={Colors.textLight}
                maxLength={20}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
              />
            </View>
            <View accessibilityLiveRegion="polite">
              {handleCheck.status === 'checking' ? <Text style={styles.editHelp}>Checking handle…</Text> :
               handleCheck.status === 'available' ? <Text style={styles.handleAvailable}>Available</Text> :
               handleCheck.status === 'taken' ? <Text style={styles.handleTaken}>This handle is taken.</Text> :
               handleCheck.status === 'invalid' ? <Text style={styles.handleTaken}>Use at least 2 characters.</Text> :
               handleCheck.status === 'error' ? <><Text style={styles.handleTaken}>Couldn’t check this handle.</Text><TouchableOpacity style={styles.retryButton} accessibilityRole="button" accessibilityLabel="Try again to check handle" onPress={handleCheck.retry}><Text style={styles.retryText}>Try again</Text></TouchableOpacity></> : null}
            </View>
            <Text style={styles.editHelp}>This is how people find you on washedup</Text>
          </View>

          <View style={styles.editFieldGroup}>
            <Text style={styles.editLabel}>{appearance ? 'Fun fact' : 'Fun Fact'}</Text>
            <TextInput
              style={[styles.editInput, styles.editBioInput]}
              value={editFunFact}
              onChangeText={(value) => editChange(setEditFunFact, value)}
              editable={!saving && !photoBusy}
              accessibilityLabel="Fun fact"
              placeholder="Something fun about you (e.g. I know every taco spot in Silver Lake)"
              placeholderTextColor={Colors.textLight}
              maxLength={120}
              multiline
              textAlignVertical="top"
              returnKeyType="default"
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />
            <Text style={styles.editCharCount}>{editFunFact.length}/120</Text>
            <Text style={styles.editHelp}>This shows on your profile and when people tap your picture</Text>
          </View>

          <View style={styles.editFieldGroup}>
            <Text style={styles.editLabel}>Neighborhood</Text>
            <TouchableOpacity
              style={styles.editInput}
              onPress={() => { if (!editScope.isCurrent() || saveLock.current || photoLock.current) return; hapticLight(); Keyboard.dismiss(); setShowNeighborhoodPicker(true); }}
              accessibilityRole="button" accessibilityLabel="Neighborhood"
              activeOpacity={0.8}
            >
              <View style={styles.neighborhoodRow}>
                <Text style={editNeighborhood ? styles.neighborhoodValue : styles.neighborhoodPlaceholder}>
                  {editNeighborhood || 'Select your neighborhood'}
                </Text>
                <Ionicons name="chevron-down" size={18} color={Colors.textLight} />
              </View>
            </TouchableOpacity>
            {editNeighborhood === NEIGHBORHOOD_OTHER && (
              <TextInput
                style={[styles.editInput, { marginTop: 8 }]}
                value={editNeighborhoodOther}
                onChangeText={(value) => editChange(setEditNeighborhoodOther, value)}
                editable={!saving && !photoBusy}
                accessibilityLabel="Other neighborhood"
                placeholder="Where are you based?"
                placeholderTextColor={Colors.textLight}
                maxLength={40}
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
                inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
              />
            )}
            <Text style={styles.editHelp}>Where you're based (shown on your mini profile)</Text>
          </View>

          <View style={styles.editFieldGroup}>
            <Text style={styles.editLabel}>Do you live in LA?</Text>
            <View style={styles.travelOptions}>
              <TouchableOpacity
                style={[styles.travelOption, !editIsVisitor && styles.travelOptionActive]}
                onPress={() => editChange<boolean>(setEditIsVisitor, false)} accessibilityRole="radio" accessibilityState={{ checked: !editIsVisitor }} accessibilityLabel="I live in LA"
                activeOpacity={0.7}
              >
                <Text style={[styles.travelOptionText, !editIsVisitor && styles.travelOptionTextActive]}>
                  Yes, I live here
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.travelOption, editIsVisitor && styles.travelOptionActive]}
                onPress={() => editChange<boolean>(setEditIsVisitor, true)} accessibilityRole="radio" accessibilityState={{ checked: editIsVisitor }} accessibilityLabel="I am visiting LA"
                activeOpacity={0.7}
              >
                <Text style={[styles.travelOptionText, editIsVisitor && styles.travelOptionTextActive]}>
                  I'm visiting LA
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {profile?.gender && (
            <View style={styles.editFieldGroup}>
              <Text style={styles.editLabel}>{appearance ? 'Gender identity' : 'Gender Identity'}</Text>
              <View style={styles.editReadOnly}>
                <Text style={styles.editReadOnlyText}>
                  {profile.gender === 'woman' ? 'Woman' : profile.gender === 'man' ? 'Man' : 'Non-binary'}
                </Text>
                <Ionicons name="lock-closed-outline" size={14} color={Colors.textLight} />
              </View>
              <Text style={styles.editHelp}>Contact hello@washedup.app to update</Text>
            </View>
          )}

          <TouchableOpacity
            accessibilityRole="button" accessibilityLabel={saving ? "Saving profile" : "Save changes"}
            style={[styles.editSaveBtn, (saving || photoBusy || saveDisabledByHandle) && { opacity: 0.7 }]}
            onPress={handleSaveProfile}
            disabled={saving || photoBusy || saveDisabledByHandle}
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <Text style={styles.editSaveBtnText}>{appearance ? 'Save changes' : 'Save Changes'}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.deleteCancelBtn}
            accessibilityRole="button" disabled={saving}
            onPress={closeEditFlow}
          >
            <Text style={styles.deleteCancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
        <BrandedAlert
          appearance={appearance}
          visible={!!alertInfo}
          title={alertInfo?.title ?? ''}
          message={alertInfo?.message}
          buttons={alertInfo?.buttons}
          onClose={() => closeAlert(alertInfo)}
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

        {creatorError && <View style={styles.settingsGroup}><Text style={styles.statusText}>Some creator details couldn’t load.</Text><TouchableOpacity style={styles.retryButton} accessibilityRole="button" accessibilityLabel="Try again to load creator spaces" disabled={loadingCreators} onPress={() => { void fetchCreatorEntries(); }}><Text style={styles.retryText}>{loadingCreators ? 'Checking…' : 'Try again'}</Text></TouchableOpacity></View>}
        {/* Creators: inventory C-01 — a real row per approved entity, not one
            collapsed row that silently picks a single destination. A creator
            who leads 2+ communities, or leads a community AND holds an
            event-host grant, previously could only ever reach ONE of those
            from here. Pending applications now show inline too, instead of
            only being visible after tapping back into the apply screen. */}
        {(() => {
          const creatorRows: {
            key: string;
            label: string;
            sublabel?: string;
            accent?: boolean;
            mark?: string;
            onPress: () => void;
          }[] = [];
          if (CREATOR_PAGES_ENABLED) {
            creatorRows.push({ key: 'pages', label: 'Creator space', accent: true,
              onPress: () => navigate('/creator/pages') });
          } else {
          // Liz, 2026-09-04 (live, over the per-community "identity mark" fix
          // above): distinguishing the rows wasn't the actual problem -- with
          // 2+ led communities, every row lands in the same creator shell
          // anyway (the CommunitySwitcher pills inside it already handle
          // switching), so having one row per community just reads as
          // duplicate buttons to the same place. Her exact words: "we need
          // one button that says go to your communities." Collapse to one
          // row once there are 2+; a single community keeps its own named
          // row since there's nothing to collapse and no ambiguity.
          const led = creatorAccess?.ledCommunities ?? [];
          if (led.length >= 2) {
            creatorRows.push({
              key: 'communities',
              label: 'go to your communities',
              accent: true,
              onPress: () => {
                setSelectedCommunityId(led[0].id);
                navigate('/(creator)/today', true);
              },
            });
          } else {
            led.forEach((c) => {
              creatorRows.push({
                key: c.id,
                label: `switch to ${c.name.toLowerCase()} & your events`,
                sublabel: c.status !== 'active' ? c.status : undefined,
                accent: true,
                mark: c.name.slice(0, 1).toLowerCase(),
                onPress: () => {
                  setSelectedCommunityId(c.id);
                  navigate('/(creator)/today', true);
                },
              });
            });
          }
          if (creatorAccess?.hasEventHostGrant) {
            creatorRows.push({
              key: 'event-host',
              label: organizerName
                ? `switch to ${organizerName.toLowerCase()} & your events`
                : 'switch to your events',
              accent: true,
              onPress: () => navigate('/(creator)/organizer-home', true),
            });
          }
          pendingGrants.forEach((g) => {
            creatorRows.push({
              key: g.id,
              label: g.track === 'event_host' ? 'putting on events' : 'starting a community',
              sublabel: g.status === 'needs_more_info' ? 'needs more info' : 'in review',
              onPress: () => navigate('/creator/apply'),
            });
          });
          if (COMMUNITIES_ENABLED) {
            creatorRows.push({
              key: 'apply',
              label: 'Run things on washedup',
              onPress: () => navigate('/creator/apply'),
            });
          }
          }
          if (creatorRows.length === 0) return null;
          return (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Creators</Text>
              </View>
              <View style={styles.settingsGroup}>
                {creatorRows.map((row, i) => (
                  <TouchableOpacity
                    key={row.key}
                    accessibilityRole="button"
                    style={[styles.settingsRow, i !== creatorRows.length - 1 && styles.settingsRowDivider]}
                    onPress={() => { if (canUseProfile()) row.onPress(); }}
                    activeOpacity={0.7}
                  >
                    {row.mark && (
                      <View style={styles.creatorRowMark}>
                        <Text style={styles.creatorRowMarkLetter}>{row.mark}</Text>
                      </View>
                    )}
                    <View style={styles.settingsLabelStack}>
                      <Text
                        style={[
                          styles.settingsLabel,
                          row.accent && { color: accent, fontFamily: appearance ? appearance.fonts.semibold : Fonts.sansBold },
                        ]}
                      >
                        {row.label}
                      </Text>
                      {row.sublabel && <Text style={styles.creatorLifecycleBadge}>{row.sublabel}</Text>}
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={row.accent ? accent : muted} />
                  </TouchableOpacity>
                ))}
              </View>
            </>
          );
        })()}

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
      />
    </>
  );
}

const baseStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  statusTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt, textAlign: 'center' },
  statusText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.warmGray, paddingVertical: 8 },
  retryButton: { minHeight: 44, paddingVertical: 12, justifyContent: 'center' },
  retryText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingBottom: 48 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 20,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: FontSizes.displayLG,
    fontWeight: '700',
    color: Colors.darkWarm,
  },

  // Profile section — avatar 100px, display name displaySmall, handle bodySmall
  profileSection: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 32,
    gap: 8,
  },
  avatarContainer: {},
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    borderColor: Colors.warmGray,
  },
  avatarFallback: {
    backgroundColor: Colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontWeight: '700',
    fontSize: FontSizes.displayLG,
    color: Colors.terracotta,
  },
  profileName: {
    ...displaySmall,
    color: Colors.asphalt,
    marginTop: 4,
  },
  handleShareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  profileHandle: {
    ...bodySmall,
    color: Colors.warmGray,
  },
  profileHandleLink: {
    ...bodySmall,
    fontFamily: Fonts.sansMedium,
    color: Colors.terracotta,
    marginTop: 2,
  },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  locationText: { ...bodySmall, color: Colors.warmGray },
  bio: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.textMedium,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 24,
  },

  // Settings list — section headers labelSmall, rows with terracotta icon, bodyMedium label, warmGray chevron
  sectionHeader: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  sectionTitle: {
    ...labelSmall,
    color: Colors.warmGray,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  settingsGroup: {
    backgroundColor: Colors.cardBg,
    marginHorizontal: 20,
    borderRadius: 16,
    marginBottom: 24,
    overflow: 'hidden',
  },
  // the tickets group sits right under the profile header, no section title
  ticketsGroup: { marginTop: 8 },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  settingsRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.parchment,
  },
  settingsLabel: {
    ...bodyMedium,
    flex: 1,
    color: Colors.asphalt,
  },
  // inventory C-01: label + lifecycle-state line, stacked, for the Creators
  // entity rows (draft/archived communities, pending applications).
  settingsLabelStack: {
    flex: 1,
    gap: 2,
  },
  creatorLifecycleBadge: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.warmGray,
    textTransform: 'capitalize',
  },
  creatorRowMark: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: Colors.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  creatorRowMarkLetter: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.bodyMD,
    color: Colors.terracotta,
  },
  deleteAccountLink: {
    ...bodyMedium,
    flex: 1,
    color: Colors.cancelRed,
  },
  logOutWrap: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 32,
  },
  logOutBtn: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: Colors.terracotta,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logOutBtnText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.terracotta,
  },

  // Delete flow
  deleteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  deleteHeaderTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.displaySM, color: Colors.asphalt },
  deleteContent: { padding: 24, alignItems: 'center', gap: 16 },
  deleteWarningIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  deleteTitle: { fontWeight: '700', fontSize: FontSizes.displayMD, color: Colors.darkWarm, textAlign: 'center' },
  deleteBody: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium, textAlign: 'center', lineHeight: 22 },
  deleteListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    alignSelf: 'stretch',
  },
  deleteListText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium, flex: 1 },
  deleteInput: {
    alignSelf: 'stretch',
    backgroundColor: Colors.white,
    borderWidth: 1.5,
    borderColor: Colors.inputBg,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
    textAlign: 'center',
    letterSpacing: 2,
  },
  deleteNextBtn: {
    alignSelf: 'stretch',
    backgroundColor: Colors.terracotta,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  deleteNextBtnText: { color: Colors.white, fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD },
  deleteCancelBtn: { paddingVertical: 12 },
  deleteCancelBtnText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.warmGray },
  deleteFinalBtn: {
    alignSelf: 'stretch',
    backgroundColor: Colors.cancelRed,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  deleteFinalBtnDisabled: { backgroundColor: Colors.inputBg },
  deleteFinalBtnText: { color: Colors.white, fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD },

  // Edit Profile button on main profile
  editProfileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.terracotta,
  },
  editProfileBtnText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
  },

  // Edit Profile flow
  editContent: {
    padding: 24,
    alignItems: 'center',
    gap: 4,
  },
  editAvatarWrap: {
    position: 'relative',
    marginBottom: 4,
  },
  editAvatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    borderColor: Colors.warmGray,
  },
  editAvatarBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.terracotta,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.parchment,
  },
  editPhotoHint: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.warmGray,
    marginBottom: 20,
  },
  editFieldGroup: {
    alignSelf: 'stretch',
    marginBottom: 20,
  },
  editLabel: {
    ...labelSmall,
    color: Colors.warmGray,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  editInput: {
    backgroundColor: Colors.cardBg,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 14,
    paddingLeft: 16,
    paddingRight: 16,
    paddingVertical: 14,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
    textAlign: 'left',
  },
  handleInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.cardBg,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 14,
  },
  neighborhoodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  neighborhoodValue: {
    flex: 1,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
  },
  neighborhoodPlaceholder: {
    flex: 1,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyLG,
    color: Colors.textLight,
  },
  neighborhoodSheetOverlay: {
    flex: 1,
    backgroundColor: Colors.overlayDark,
    justifyContent: 'flex-end',
  },
  neighborhoodSheet: {
    backgroundColor: Colors.parchment,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    paddingBottom: 32,
    maxHeight: '80%',
  },
  neighborhoodSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  neighborhoodSheetTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
  },
  neighborhoodSheetList: {
    paddingHorizontal: 12,
  },
  neighborhoodOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 10,
  },
  neighborhoodOptionText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
  },
  neighborhoodOptionTextSelected: {
    fontFamily: Fonts.sansBold,
    color: Colors.terracotta,
  },
  handlePrefix: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyLG, color: Colors.textLight, marginLeft: 16 },
  handleInput: {
    flex: 1,
    paddingVertical: 14,
    paddingLeft: 8,
    paddingRight: 16,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
    textAlign: 'left',
  },
  editBioInput: {
    minHeight: 90,
    paddingTop: 14,
  },
  editCharCount: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.textLight,
    textAlign: 'right',
    marginTop: 4,
  },
  travelOptions: {
    flexDirection: 'row',
    gap: 10,
  },
  travelOption: {
    flex: 1,
    backgroundColor: Colors.white,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  travelOptionActive: {
    backgroundColor: Colors.terracotta,
    borderColor: Colors.terracotta,
  },
  travelOptionText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.asphalt,
  },
  travelOptionTextActive: {
    color: Colors.white,
  },
  editReadOnly: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.inputBg,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  editReadOnlyText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyLG,
    color: Colors.warmGray,
  },
  handleAvailability: { marginTop: 6, marginBottom: 4 },
  handleAvailable: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.gold, marginTop: 6, marginBottom: 4 },
  handleTaken: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.errorRed, marginTop: 6, marginBottom: 4 },
  editHelp: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.textLight,
    marginTop: 4,
  },
  editSaveBtn: {
    alignSelf: 'stretch',
    backgroundColor: Colors.terracotta,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  editSaveBtnText: {
    color: Colors.white,
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
  },

  // Footer
  footer: { textAlign: 'center', fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textLight, marginTop: 8 },
});

function profileSettingsAppearance(fonts: AfterglowFontFamilies) {
  const body = { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted };
  const title = { ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.ink };
  const caption = { ...AfterglowType.caption, fontFamily: fonts.regular, color: AfterglowColors.muted };
  const button = { minHeight: 46, borderRadius: 4, justifyContent: 'center' as const, paddingVertical: 12 };
  const input = { ...baseStyles.editInput, ...AfterglowType.title, fontFamily: fonts.regular, color: AfterglowColors.ink, backgroundColor: AfterglowColors.white, borderColor: AfterglowColors.line, borderWidth: 1, borderRadius: 4, minHeight: 48 };
  return StyleSheet.create({
    container: { ...baseStyles.container, backgroundColor: AfterglowColors.paper },
    centered: { ...baseStyles.centered, padding: 24, gap: 12 },
    header: { ...baseStyles.header, paddingBottom: 12 },
    backButton: { ...baseStyles.backButton, width: 44, height: 44 },
    headerTitle: { ...AfterglowType.contextTitle, fontFamily: fonts.semibold, color: AfterglowColors.ink },
    profileSection: { ...baseStyles.profileSection, paddingBottom: 24, gap: 6 },
    avatar: { ...baseStyles.avatar, width: 80, height: 80, borderRadius: 40, borderWidth: 0 },
    avatarFallback: { ...baseStyles.avatarFallback, backgroundColor: AfterglowColors.avatar },
    avatarInitial: { ...AfterglowType.identity, fontFamily: fonts.semibold, color: AfterglowColors.clay },
    profileName: { ...AfterglowType.identity, fontFamily: fonts.display, color: AfterglowColors.ink, marginTop: 8, textAlign: 'center' },
    handleShareRow: { ...baseStyles.handleShareRow, minHeight: 44 },
    profileHandle: body,
    profileHandleLink: { ...body, color: AfterglowColors.clay, minHeight: 44, paddingVertical: 12 },
    locationText: body,
    bio: { ...baseStyles.bio, ...body, color: AfterglowColors.ink },
    sectionTitle: { ...AfterglowType.contextTitle, fontFamily: fonts.semibold, color: AfterglowColors.ink },
    settingsGroup: { ...baseStyles.settingsGroup, backgroundColor: AfterglowColors.paper, borderRadius: 0, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: AfterglowColors.line, marginBottom: 20 },
    settingsRow: { ...baseStyles.settingsRow, minHeight: 56, paddingHorizontal: 0, paddingVertical: 14 },
    settingsRowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: AfterglowColors.subtleLine },
    settingsLabel: { ...title, fontFamily: fonts.regular, flex: 1 },
    creatorLifecycleBadge: caption,
    creatorRowMark: { ...baseStyles.creatorRowMark, backgroundColor: AfterglowColors.avatar, borderRadius: 4 },
    creatorRowMarkLetter: { ...title, color: AfterglowColors.clay },
    deleteAccountLink: { ...title, fontFamily: fonts.regular, color: Colors.cancelRed, flex: 1 },
    logOutBtn: { ...baseStyles.logOutBtn, ...button, borderWidth: 1, borderColor: AfterglowColors.clay },
    logOutBtnText: { ...title, color: AfterglowColors.clay },
    deleteHeader: { ...baseStyles.deleteHeader, paddingVertical: 6, paddingHorizontal: 16, borderBottomColor: AfterglowColors.line },
    deleteHeaderTitle: { ...AfterglowType.contextTitle, fontFamily: fonts.semibold, color: AfterglowColors.ink },
    deleteWarningIcon: { ...baseStyles.deleteWarningIcon, backgroundColor: AfterglowColors.avatar },
    deleteTitle: { ...AfterglowType.identity, fontFamily: fonts.display, color: AfterglowColors.ink, textAlign: 'center' },
    deleteBody: { ...body, textAlign: 'center' },
    deleteListText: { ...body, flex: 1 },
    deleteInput: { ...input, alignSelf: 'stretch', textAlign: 'center' },
    deleteNextBtn: { ...baseStyles.deleteNextBtn, ...button, backgroundColor: AfterglowColors.clay },
    deleteNextBtnText: { ...title, color: AfterglowColors.white },
    deleteCancelBtn: { ...baseStyles.deleteCancelBtn, minHeight: 44, justifyContent: 'center' },
    deleteCancelBtnText: body,
    deleteFinalBtn: { ...baseStyles.deleteFinalBtn, ...button },
    deleteFinalBtnText: { ...title, color: AfterglowColors.white },
    editProfileBtn: { ...baseStyles.editProfileBtn, ...button, borderColor: AfterglowColors.clay, paddingHorizontal: 20 },
    editProfileBtnText: { ...title, color: AfterglowColors.clay },
    editContent: { ...baseStyles.editContent, padding: 20 },
    editAvatar: { ...baseStyles.editAvatar, width: 80, height: 80, borderRadius: 40, borderWidth: 0 },
    editAvatarBadge: { ...baseStyles.editAvatarBadge, backgroundColor: AfterglowColors.clay, borderColor: AfterglowColors.paper },
    editPhotoHint: { ...body, marginBottom: 20 },
    editLabel: { ...title, ...AfterglowType.body, marginBottom: 8 },
    editInput: input,
    handleInputRow: { ...baseStyles.handleInputRow, backgroundColor: AfterglowColors.white, borderColor: AfterglowColors.line, borderWidth: 1, borderRadius: 4 },
    handlePrefix: { ...title, fontFamily: fonts.regular, color: AfterglowColors.muted, marginLeft: 16 },
    handleInput: { ...baseStyles.handleInput, ...AfterglowType.title, fontFamily: fonts.regular, color: AfterglowColors.ink, minWidth: 0 },
    neighborhoodValue: { ...title, fontFamily: fonts.regular, flex: 1 },
    neighborhoodPlaceholder: { ...body, flex: 1 },
    neighborhoodSheet: { ...baseStyles.neighborhoodSheet, backgroundColor: AfterglowColors.paper, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
    neighborhoodSheetHeader: { ...baseStyles.neighborhoodSheetHeader, borderBottomColor: AfterglowColors.line },
    neighborhoodSheetTitle: { ...AfterglowType.contextTitle, fontFamily: fonts.semibold, color: AfterglowColors.ink },
    neighborhoodOption: { ...baseStyles.neighborhoodOption, minHeight: 48, borderRadius: 4 },
    neighborhoodOptionText: { ...title, fontFamily: fonts.regular, flexShrink: 1 },
    neighborhoodOptionTextSelected: { fontFamily: fonts.semibold, color: AfterglowColors.clay },
    editCharCount: { ...caption, textAlign: 'right', marginTop: 4 },
    travelOption: { ...baseStyles.travelOption, ...button, backgroundColor: AfterglowColors.white, borderColor: AfterglowColors.line, borderWidth: 1 },
    travelOptionActive: { backgroundColor: AfterglowColors.clay, borderColor: AfterglowColors.clay },
    travelOptionText: { ...body, fontFamily: fonts.medium, color: AfterglowColors.ink },
    travelOptionTextActive: { color: AfterglowColors.white },
    editReadOnly: { ...baseStyles.editReadOnly, backgroundColor: AfterglowColors.avatar, borderColor: AfterglowColors.line, borderRadius: 4 },
    editReadOnlyText: body,
    handleAvailable: { ...body, fontFamily: fonts.medium, color: AfterglowColors.ink, marginTop: 6 },
    handleTaken: { ...body, color: Colors.errorRed, marginTop: 6 },
    editHelp: { ...caption, marginTop: 6 },
    editSaveBtn: { ...baseStyles.editSaveBtn, ...button, backgroundColor: AfterglowColors.clay },
    editSaveBtnText: { ...title, color: AfterglowColors.white },
    footer: { ...baseStyles.footer, ...caption },
    statusTitle: { ...AfterglowType.contextTitle, fontFamily: fonts.semibold, color: AfterglowColors.ink, textAlign: 'center' },
    statusText: { ...body, paddingVertical: 8 },
    retryText: { ...title, color: AfterglowColors.clay },
  });
}
