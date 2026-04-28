import { useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { router } from 'expo-router';
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
import { supabase } from '../../../lib/supabase';
import { friendlyError } from '../../../lib/friendlyError';
import Colors from '../../../constants/Colors';
import { Fonts } from '../../../constants/Typography';

const AVATAR_SIZE = 260;

export default function OnboardingPhotoScreen() {
  const queryClient = useQueryClient();
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{
    title: string;
    message: string;
    buttons?: BrandedAlertButton[];
  } | null>(null);

  const pickFromLibrary = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        setAlertInfo({
          title: 'permission needed',
          message: 'washedup needs access to your photos to set a profile picture.',
          buttons: [
            { text: 'open settings', onPress: () => Linking.openSettings() },
            { text: 'cancel', style: 'cancel' },
          ],
        });
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      });
      if (result.canceled || !result.assets?.[0]) return;
      await processPicked(result.assets[0].uri);
    } catch {
      setAlertInfo({
        title: 'something went wrong',
        message: 'could not open photo library. try again.',
      });
    }
  };

  const takePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        setAlertInfo({
          title: 'permission needed',
          message: 'washedup needs camera access to take a profile photo.',
          buttons: [
            { text: 'open settings', onPress: () => Linking.openSettings() },
            { text: 'cancel', style: 'cancel' },
          ],
        });
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      });
      if (result.canceled || !result.assets?.[0]) return;
      await processPicked(result.assets[0].uri);
    } catch {
      setAlertInfo({
        title: 'something went wrong',
        message: 'could not open camera. try again.',
      });
    }
  };

  const processPicked = async (uri: string) => {
    try {
      const manipulated = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 800, height: 800 } }],
        {
          compress: 0.85,
          format: ImageManipulator.SaveFormat.JPEG,
          base64: true,
        },
      );
      setImageUri(manipulated.uri);
      setImageBase64(manipulated.base64 ?? null);
    } catch {
      setAlertInfo({ title: 'invalid image', message: PHOTO_FORMAT_ERROR_MESSAGE });
    }
  };

  const openPicker = () => {
    hapticLight();
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['take photo', 'choose from library', 'cancel'],
          cancelButtonIndex: 2,
          title: 'add a profile photo',
        },
        (idx) => {
          if (idx === 0) takePhoto();
          if (idx === 1) pickFromLibrary();
        },
      );
    } else {
      setAlertInfo({
        title: 'add a profile photo',
        message: 'choose how to add your photo',
        buttons: [
          { text: 'take photo', onPress: takePhoto },
          { text: 'choose from library', onPress: pickFromLibrary },
          { text: 'cancel', style: 'cancel' },
        ],
      });
    }
  };

  const handleContinue = async () => {
    if (!imageBase64 || loading) return;
    hapticLight();
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setAlertInfo({ title: 'session expired', message: 'please sign in again.' });
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
        .update({ profile_photo_url: avatarUrl, onboarding_status: 'vibes' })
        .eq('id', user.id);
      if (updateError) throw updateError;
      queryClient.invalidateQueries({ queryKey: PROFILE_PHOTO_KEY });
      router.push('/onboarding/vibes');
    } catch (e: unknown) {
      setAlertInfo({
        title: 'upload failed',
        message: friendlyError(e, 'could not upload photo. try again.'),
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = async () => {
    if (skipping) return;
    hapticLight();
    setSkipping(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setAlertInfo({ title: 'session expired', message: 'please sign in again.' });
        supabase.auth.signOut();
        return;
      }
      const { error } = await supabase
        .from('profiles')
        .update({ onboarding_status: 'vibes' })
        .eq('id', user.id);
      if (error) throw error;
      router.push('/onboarding/vibes');
    } catch {
      setAlertInfo({
        title: 'something went wrong',
        message: 'could not advance. try again.',
      });
    } finally {
      setSkipping(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <View style={styles.container}>
        <ProgressHead step={3} totalSteps={4} onBack={() => router.back()} />

        <View style={styles.gap20} />
        <Text style={styles.heading}>
          <Text style={styles.headingSans}>add a photo </Text>
          <Text style={styles.headingItalic}>of you.</Text>
        </Text>
        <Text style={styles.subline}>
          show your face! it helps people feel comfortable meeting up.
        </Text>

        <View style={styles.avatarStage}>
          <TouchableOpacity
            style={[styles.avatarCircle, imageUri && styles.avatarCircleFilled]}
            onPress={openPicker}
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
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Text style={styles.changePillText}>change</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.spacer} />

        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.skipHit}
            onPress={handleSkip}
            disabled={skipping || loading}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.skipText}>
              {skipping ? 'skipping…' : 'skip for now'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.cta, (!imageBase64 || loading || skipping) && styles.ctaDisabled]}
            onPress={handleContinue}
            activeOpacity={0.9}
            disabled={!imageBase64 || loading || skipping}
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
  headingItalic: { fontFamily: Fonts.displayItalic, fontStyle: 'italic' },

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

  skipHit: { alignSelf: 'center', paddingVertical: 6 },
  skipText: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    color: Colors.text3,
  },
});
