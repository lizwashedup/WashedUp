import { hapticLight, hapticMedium, hapticHeavy, hapticSelection, hapticSuccess, hapticWarning, hapticError } from '../../../lib/haptics';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { BrandedAlert, type BrandedAlertButton } from '../../../components/BrandedAlert';
import { PROFILE_PHOTO_KEY } from '../../../constants/QueryKeys';
import { StatusBar } from 'expo-status-bar';
import { Camera, ChevronLeft, RefreshCw } from 'lucide-react-native';
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
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { PHOTO_FORMAT_ERROR_MESSAGE } from '../../../constants/PhotoUpload';
import { uploadBase64ToStorage } from '../../../lib/uploadPhoto';
import { supabase } from '../../../lib/supabase';
import { friendlyError } from '../../../lib/friendlyError';

const AVATAR_SIZE = 180;

export default function OnboardingPhotoScreen() {
  const routerBack = useRouter();
  const queryClient = useQueryClient();
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message: string; buttons?: BrandedAlertButton[] } | null>(null);

  const pickImageFromLibrary = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        setAlertInfo({
          title: 'Permission needed',
          message: 'washedup needs access to your photos to set a profile picture.',
          buttons: [
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
            { text: 'Cancel', style: 'cancel' },
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
      await processPickedImage(result.assets[0].uri);
    } catch {
      setAlertInfo({ title: 'Something went wrong', message: 'Could not open photo library. Please try again.' });
    }
  };

  const takePhotoFromCamera = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        setAlertInfo({
          title: 'Permission needed',
          message: 'washedup needs access to your camera to take a profile photo.',
          buttons: [
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
            { text: 'Cancel', style: 'cancel' },
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
      await processPickedImage(result.assets[0].uri);
    } catch {
      setAlertInfo({ title: 'Something went wrong', message: 'Could not open camera. Please try again.' });
    }
  };

  const processPickedImage = async (uri: string) => {
    try {
      const manipulated = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 800, height: 800 } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      setImageUri(manipulated.uri);
      setImageBase64(manipulated.base64 ?? null);
    } catch {
      setAlertInfo({ title: 'Invalid image', message: PHOTO_FORMAT_ERROR_MESSAGE });
    }
  };

  const pickImage = () => {
    hapticLight();
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Take Photo', 'Choose from Library', 'Cancel'],
          cancelButtonIndex: 2,
          title: 'Add a profile photo',
        },
        (idx) => {
          if (idx === 0) takePhotoFromCamera();
          if (idx === 1) pickImageFromLibrary();
        },
      );
    } else {
      setAlertInfo({
        title: 'Add a profile photo',
        message: 'Choose how to add your photo',
        buttons: [
          { text: 'Take Photo', onPress: takePhotoFromCamera },
          { text: 'Choose from Library', onPress: pickImageFromLibrary },
          { text: 'Cancel', style: 'cancel' },
        ],
      });
    }
  };

  const handleContinue = async () => {
    if (!imageBase64) return; // should never happen — button is disabled without it
    hapticLight();
    setLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setAlertInfo({ title: 'Session expired', message: 'Please sign in again.' });
        supabase.auth.signOut();
        return;
      }

      const path = `${user.id}/${Date.now()}.jpg`;
      const avatarUrl = await uploadBase64ToStorage('profile-photos', path, imageBase64, { upsert: true });

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ profile_photo_url: avatarUrl, onboarding_status: 'vibes' })
        .eq('id', user.id);

      if (updateError) throw updateError;

      // Invalidate so ProfileButton refetches when it mounts. Don't await — the
      // next screen doesn't need the photo, and awaiting just delays navigation.
      queryClient.invalidateQueries({ queryKey: PROFILE_PHOTO_KEY });

      router.push('/onboarding/vibes');
    } catch (e: any) {
      setAlertInfo({
        title: 'Upload failed',
        message: friendlyError(e, 'Could not upload photo. Please try again.'),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <View style={styles.container}>
        {/* Progress bar */}
        <View style={styles.progressWrap}>
          <View style={[styles.progressBar, { width: '75%' }]} />
        </View>

        {/* Back button */}
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => {
              hapticLight();
              routerBack.back();
            }}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={styles.backButton}
          >
            <ChevronLeft size={28} color={Colors.asphalt} />
          </TouchableOpacity>
        </View>

        <Text style={styles.heading}>Add a profile photo</Text>
        <Text style={styles.subtext}>
          please upload a profile picture so people can get excited about meeting you
        </Text>
        <View style={styles.gap32} />

        {/* Photo circle — tap to pick, shows crop hint when empty */}
        <View style={styles.avatarWrap}>
          <TouchableOpacity
            style={styles.avatarCircle}
            onPress={pickImage}
            activeOpacity={0.85}
          >
            {imageUri ? (
              <Image source={{ uri: imageUri }} style={styles.avatarImage} contentFit="cover" />
            ) : (
              <View style={styles.avatarEmpty}>
                <Camera size={44} color={Colors.textLight} />
                <Text style={styles.avatarHint}>Tap to add photo</Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Orange ring around circle */}
          {imageUri && (
            <View style={styles.avatarRing} pointerEvents="none" />
          )}
        </View>

        {/* Crop hint text — only shown before picking */}
        {!imageUri && (
          <Text style={styles.cropHint}>
            After choosing, you can pinch, zoom, and drag{'\n'}to get your face perfectly centred
          </Text>
        )}

        {/* Retake option after photo is set */}
        {imageUri && (
          <TouchableOpacity
            style={styles.retakeButton}
            onPress={pickImage}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <RefreshCw size={14} color={Colors.terracotta} />
            <Text style={styles.retakeText}>Choose a different photo</Text>
          </TouchableOpacity>
        )}

        <View style={styles.spacer} />

        {/* Continue */}
        <TouchableOpacity
          style={[
            styles.primaryButton,
            (!imageUri || !imageBase64 || loading) && styles.primaryButtonDisabled,
          ]}
          onPress={handleContinue}
          onPressIn={() => hapticLight()}
          activeOpacity={0.9}
          disabled={!imageUri || !imageBase64 || loading}
        >
          {loading ? (
            <ActivityIndicator color={Colors.white} />
          ) : (
            <Text style={styles.primaryButtonText}>Continue →</Text>
          )}
        </TouchableOpacity>

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
  safe: { flex: 1, backgroundColor: Colors.parchment },
  container: { flex: 1, paddingHorizontal: 24 },

  progressWrap: {
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBar: { height: '100%', backgroundColor: Colors.terracotta, borderRadius: 2 },

  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  backButton: { padding: 4 },

  heading: { fontFamily: Fonts.sansBold, fontSize: FontSizes.displayMD, color: Colors.asphalt },
  subtext: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium, marginTop: 6, lineHeight: 20 },

  gap32: { height: 32 },
  gap12: { height: 12 },

  avatarWrap: {
    alignSelf: 'center',
    position: 'relative',
  },
  avatarCircle: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: Colors.cardBg,
    borderWidth: 1.5,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  avatarRing: {
    position: 'absolute',
    top: -3,
    left: -3,
    width: AVATAR_SIZE + 6,
    height: AVATAR_SIZE + 6,
    borderRadius: (AVATAR_SIZE + 6) / 2,
    borderWidth: 3,
    borderColor: Colors.terracotta,
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarEmpty: { alignItems: 'center', gap: 8 },
  avatarHint: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.textLight },

  cropHint: {
    textAlign: 'center',
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.textLight,
    marginTop: 14,
    lineHeight: 19,
  },

  retakeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 14,
  },
  retakeText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.terracotta,
  },

  spacer: { flex: 1 },

  primaryButton: {
    height: 52,
    borderRadius: 14,
    backgroundColor: Colors.terracotta,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: Colors.terracotta,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
    marginBottom: 8,
  },
  primaryButtonDisabled: { opacity: 0.45 },
  primaryButtonText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.displaySM, color: Colors.white },
});