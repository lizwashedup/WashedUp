import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { router, useFocusEffect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { hapticLight } from '../../../lib/haptics';
import { BrandedAlert, type BrandedAlertButton } from '../../../components/BrandedAlert';
import ProgressHead from '../../../components/onboarding/ProgressHead';
import { PROFILE_PHOTO_KEY } from '../../../constants/QueryKeys';
import { PHOTO_FORMAT_ERROR_MESSAGE } from '../../../constants/PhotoUpload';
import { uploadBase64ToStorage } from '../../../lib/uploadPhoto';
import { useSubmitGuard } from '../../../hooks/useSubmitGuard';
import { invalidateAuthProfile } from '../../../hooks/useProfile';
import { supabase } from '../../../lib/supabase';
import { getUserBounded } from '../../../lib/authGate';
import { clearAllDrafts } from '../../../lib/onboardingDraft';
import { friendlyError } from '../../../lib/friendlyError';
import Colors from '../../../constants/Colors';
import { Fonts } from '../../../constants/Typography';

const AVATAR_SIZE = 260;
type PickerVisit = { active: boolean; userId: string | null };
type PickerSelection = { visit: PickerVisit; kind: 'camera' | 'library' | null | undefined; started: boolean };

export default function OnboardingPhotoScreen() {
  const queryClient = useQueryClient();
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [pickerSelection, setPickerSelection] = useState<PickerSelection | null>(null);
  const pickerVisit = useRef<PickerVisit | null>(null);
  const pendingPicker = useRef<PickerSelection | null>(null);
  const [alertInfo, setAlertInfo] = useState<{
    title: string;
    message: string;
    buttons?: BrandedAlertButton[];
  } | null>(null);

  useFocusEffect(useCallback(() => {
    const visit: PickerVisit = { active: true, userId: null };
    pickerVisit.current = visit;
    pendingPicker.current = null;
    setPickerOpen(false);
    setPickerBusy(false);
    setPickerSelection(null);
    setImageUri(null);
    setImageBase64(null);
    setAlertInfo(null);
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const userId = session?.user?.id ?? null;
      if (event === 'SIGNED_OUT' || (visit.userId && userId && visit.userId !== userId)) {
        visit.active = false;
        pendingPicker.current = null;
        setPickerOpen(false);
        setPickerBusy(false);
        setPickerSelection(null);
        setImageUri(null);
        setImageBase64(null);
        setAlertInfo(null);
      } else if (userId) visit.userId = userId;
    });
    return () => {
      visit.active = false;
      pendingPicker.current = null;
      subscription.unsubscribe();
    };
  }, []));

  const isCurrentPicker = (selection: PickerSelection) =>
    selection.visit.active && pickerVisit.current === selection.visit && pendingPicker.current === selection;

  const runPicker = async (selection: PickerSelection) => {
    const camera = selection.kind === 'camera';
    try {
      const permission = camera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!isCurrentPicker(selection)) return;
      if (permission.status !== 'granted') {
        setAlertInfo({
          title: 'permission needed',
          message: camera ? 'washedup needs camera access to take a profile photo.' : 'washedup needs access to your photos to set a profile picture.',
          buttons: [
            { text: 'open settings', onPress: () => { if (selection.visit.active && pickerVisit.current === selection.visit) void Linking.openSettings(); } },
            { text: 'cancel', style: 'cancel' },
          ],
        });
        return;
      }
      const options = { allowsEditing: true, aspect: [1, 1] as [number, number], quality: 1 };
      const result = camera
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync({ ...options, mediaTypes: ['images'] });
      if (!isCurrentPicker(selection) || result.canceled || !result.assets?.[0]) return;
      try {
        const manipulated = await ImageManipulator.manipulateAsync(
          result.assets[0].uri,
          [{ resize: { width: 800, height: 800 } }],
          { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true },
        );
        if (!isCurrentPicker(selection)) return;
        setImageUri(manipulated.uri);
        setImageBase64(manipulated.base64 ?? null);
      } catch {
        if (isCurrentPicker(selection)) setAlertInfo({ title: 'invalid image', message: PHOTO_FORMAT_ERROR_MESSAGE });
      }
    } catch {
      if (isCurrentPicker(selection)) setAlertInfo({
        title: 'something went wrong',
        message: camera ? 'could not open camera. try again.' : 'could not open photo library. try again.',
      });
    } finally {
      if (isCurrentPicker(selection)) {
        pendingPicker.current = null;
        setPickerSelection(null);
        setPickerBusy(false);
      }
    }
  };

  const openPicker = () => {
    const visit = pickerVisit.current;
    if (!visit?.active || pendingPicker.current || loading) return;
    hapticLight();
    const selection: PickerSelection = { visit, kind: undefined, started: false };
    pendingPicker.current = selection;
    setPickerSelection(selection);
    setPickerBusy(true);
    setPickerOpen(true);
  };

  const choosePicker = (kind: PickerSelection['kind']) => {
    const selection = pendingPicker.current;
    if (!selection || !isCurrentPicker(selection) || selection.kind !== undefined) return;
    selection.kind = kind;
    setPickerOpen(false);
  };
  const closePicker = () => choosePicker(null);
  const finishPickerDismissal = (selection: PickerSelection | null) => {
    if (!selection || !isCurrentPicker(selection) || selection.started || selection.kind === undefined) return;
    selection.started = true;
    if (selection.kind === null) {
      pendingPicker.current = null;
      setPickerSelection(null);
      setPickerBusy(false);
    } else void runPicker(selection);
  };
  useEffect(() => {
    // Android does not emit Modal.onDismiss; wait for the hidden state to commit.
    if (Platform.OS !== 'ios' && !pickerOpen) finishPickerDismissal(pickerSelection);
  }, [pickerOpen, pickerSelection]);

  const leavePhoto = () => {
    if (pickerVisit.current) pickerVisit.current.active = false;
    pendingPicker.current = null;
    setPickerOpen(false);
    setPickerSelection(null);
    setPickerBusy(false);
    router.replace('/onboarding/referral');
  };

  const submit = useSubmitGuard();

  const handleContinue = async () => {
    if (!imageBase64 || loading || pendingPicker.current) return;
    if (!submit.tryAcquire()) return;
    hapticLight();
    setLoading(true);
    try {
      const { user, resolved } = await getUserBounded();
      if (!user) {
        if (!resolved) {
          // Transient (timeout/network): do NOT sign out a valid session.
          setAlertInfo({ title: 'something went wrong', message: "couldn't reach the server. try again." });
          return;
        }
        setAlertInfo({ title: 'session expired', message: 'please sign in again.' });
        clearAllDrafts();
        supabase.auth.signOut();
        return;
      }
      const path = `${user.id}/${Date.now()}.jpg`;
      const avatarUrl = await uploadBase64ToStorage(
        'profile-photos',
        path,
        imageBase64,
        { upsert: true },
      );
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ profile_photo_url: avatarUrl, onboarding_status: 'complete' })
        .eq('id', user.id);
      if (updateError) throw updateError;
      queryClient.invalidateQueries({ queryKey: PROFILE_PHOTO_KEY });
      // Force the tabs onboarding guard to read fresh status on next mount,
      // otherwise the cache seeded at login still says 'photo'/'la_check'
      // and the guard bounces the user out of /(tabs)/plans.
      invalidateAuthProfile(queryClient, user.id);
      // Push permission is no longer cold-fired here. The root pre-permission
      // primer (app/_layout.tsx) shows a context screen first, and covers
      // existing users / reinstalls / new-device installs, not just this step.
      // Completed signup opens Plans, the member’s primary discovery feed.
      router.replace('/(tabs)/plans');
    } catch (e: unknown) {
      setAlertInfo({
        title: 'upload failed',
        message: friendlyError(e, 'could not upload photo. try again.'),
      });
    } finally {
      submit.release();
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <View style={styles.container}>
        <ProgressHead step={4} totalSteps={5} onBack={leavePhoto} />

        <View style={styles.gap20} />
        <Text style={styles.heading}>
          <Text style={styles.headingSans}>add a photo of </Text>
          <Text style={styles.headingItalic}>you</Text>
          <Text style={styles.headingSans}>.</Text>
        </Text>
        <Text style={styles.subline}>
          show your face! it helps people feel comfortable meeting up.
        </Text>

        <View style={styles.avatarStage}>
          <TouchableOpacity
            style={[styles.avatarCircle, imageUri && styles.avatarCircleFilled]}
            onPress={openPicker}
            disabled={loading || pickerBusy}
            activeOpacity={0.85}
          >
            {imageUri ? (
              <Image source={{ uri: imageUri }} style={styles.avatarImage} contentFit="cover" />
            ) : (
              <View style={styles.avatarEmpty}>
                <Ionicons name="add" size={48} color={Colors.brand} />
              </View>
            )}
          </TouchableOpacity>
          {imageUri && (
            <TouchableOpacity
              style={styles.changePill}
              onPress={openPicker}
              disabled={loading || pickerBusy}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Text style={styles.changePillText}>change</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.spacer} />

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.cta, (!imageBase64 || loading || pickerBusy) && styles.ctaDisabled]}
            onPress={handleContinue}
            activeOpacity={0.9}
            disabled={!imageBase64 || loading || pickerBusy}
          >
            {loading ? (
              <ActivityIndicator color={Colors.surface} />
            ) : (
              <Text style={[styles.ctaText, !imageBase64 && styles.ctaTextDisabled]}>
                continue
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
      <BrandedAlert
        visible={!!alertInfo}
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message}
        buttons={alertInfo?.buttons}
        onClose={() => setAlertInfo(null)}
      />
      <Modal
        visible={pickerOpen}
        transparent
        animationType="fade"
        onRequestClose={closePicker}
        onDismiss={() => finishPickerDismissal(pickerSelection)}
        statusBarTranslucent
      >
        <Pressable style={styles.pickerOverlay} onPress={closePicker}>
          <Pressable style={styles.pickerCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.pickerTitle}>add a profile photo</Text>
            <TouchableOpacity
              style={styles.pickerButton}
              onPress={() => choosePicker('camera')}
              activeOpacity={0.9}
            >
              <Text style={styles.pickerButtonText}>take photo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.pickerButton}
              onPress={() => choosePicker('library')}
              activeOpacity={0.9}
            >
              <Text style={styles.pickerButtonText}>choose from library</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.cream },
  container: { flex: 1, paddingHorizontal: 28 },

  gap20: { height: 20 },

  heading: {
    fontSize: 32,
    lineHeight: 36,
    color: Colors.text1,
    marginTop: 16,
  },
  headingSans: { fontFamily: Fonts.headline },
  headingItalic: { fontFamily: Fonts.display },

  subline: {
    fontFamily: Fonts.sans,
    fontSize: 15,
    lineHeight: 22,
    color: Colors.text2,
    marginTop: 6,
  },

  avatarStage: {
    alignSelf: 'center',
    marginTop: 36,
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    position: 'relative',
  },
  avatarCircle: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: Colors.brandSoft,
    borderWidth: 2.5,
    borderColor: Colors.brand,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarCircleFilled: {
    borderStyle: 'solid',
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarEmpty: { alignItems: 'center', justifyContent: 'center' },

  changePill: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: Colors.brand,
    borderRadius: 999,
    shadowColor: Colors.brandDeep,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 4,
  },
  changePillText: {
    fontFamily: Fonts.sansSemibold,
    fontSize: 12,
    color: Colors.surface,
    letterSpacing: 0.2,
  },

  spacer: { flex: 1 },
  footer: {
    paddingTop: 12,
    paddingBottom: 8,
    gap: 14,
  },
  cta: {
    height: 52,
    borderRadius: 8,
    backgroundColor: Colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.brandDeep,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.45,
    shadowRadius: 28,
    elevation: 6,
  },
  ctaDisabled: {
    backgroundColor: Colors.borderWarm,
    shadowOpacity: 0,
    elevation: 0,
  },
  ctaText: {
    fontFamily: Fonts.sansBold,
    fontSize: 16,
    color: Colors.surface,
    letterSpacing: 0.2,
  },
  ctaTextDisabled: { color: Colors.text3 },

  pickerOverlay: {
    flex: 1,
    backgroundColor: Colors.overlayMedium,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  pickerCard: {
    backgroundColor: Colors.cream,
    borderRadius: 20,
    paddingTop: 22,
    paddingBottom: 18,
    paddingHorizontal: 22,
    width: '100%',
    maxWidth: 320,
    gap: 12,
  },
  pickerTitle: {
    fontFamily: Fonts.sansMedium,
    fontSize: 16,
    color: Colors.text1,
    textAlign: 'center',
    marginBottom: 6,
  },
  pickerButton: {
    height: 48,
    borderRadius: 999,
    backgroundColor: Colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.brandDeep,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 4,
  },
  pickerButtonText: {
    fontFamily: Fonts.sansBold,
    fontSize: 16,
    color: Colors.surface,
    letterSpacing: 0.2,
  },
});
