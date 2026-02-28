// -----------------------------------------------------------------------------
// FILE: app/(auth)/onboarding/photo.tsx
// INSTRUCTIONS: Replace the ENTIRE contents of this file with everything below.
// -----------------------------------------------------------------------------

import * as Haptics from 'expo-haptics';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { PROFILE_PHOTO_KEY } from '../../../components/ProfileButton';
import { StatusBar } from 'expo-status-bar';
import { Camera, ChevronLeft, RefreshCw } from 'lucide-react-native';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Colors from '../../../constants/Colors';
import { PHOTO_FORMAT_ERROR_MESSAGE } from '../../../constants/PhotoUpload';
import { uploadBase64ToStorage } from '../../../lib/uploadPhoto';
import { supabase } from '../../../lib/supabase';

const AVATAR_SIZE = 180;

export default function OnboardingPhotoScreen() {
  const routerBack = useRouter();
  const queryClient = useQueryClient();
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const pickImageFromLibrary = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Permission needed',
        'Go to Settings → WashedUp → Photos and allow access.',
        [{ text: 'OK' }]
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (result.canceled) return;
    await processPickedImage(result.assets[0].uri);
  };

  const takePhotoFromCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Permission needed',
        'Go to Settings → WashedUp → Camera and allow access.',
        [{ text: 'OK' }]
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (result.canceled) return;
    await processPickedImage(result.assets[0].uri);
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
      Alert.alert('Invalid image', PHOTO_FORMAT_ERROR_MESSAGE, [{ text: 'OK' }]);
    }
  };

  const pickImage = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert('Add a profile photo', 'Choose how to add your photo', [
      { text: 'Take Photo', onPress: takePhotoFromCamera },
      { text: 'Choose from Library', onPress: pickImageFromLibrary },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleContinue = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      let avatarUrl: string | null = null;

      if (imageBase64) {
        const { data: { session }, error: refreshErr } = await supabase.auth.refreshSession();
        if (refreshErr) throw new Error('Session expired. Please log in again.');
        if (!session?.user) throw new Error('Not authenticated');

        const path = `${user.id}/${Date.now()}.jpg`;
        avatarUrl = await uploadBase64ToStorage('profile-photos', path, imageBase64, { upsert: true });
      }

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ profile_photo_url: avatarUrl })
        .eq('id', user.id);

      if (updateError) throw updateError;

      // Invalidate and refetch so ProfileButton gets fresh data when it mounts
      queryClient.invalidateQueries({ queryKey: PROFILE_PHOTO_KEY });
      await queryClient.refetchQueries({ queryKey: PROFILE_PHOTO_KEY });

      // Brief delay so DB write is visible before navigation
      await new Promise((r) => setTimeout(r, 400));

      router.push('/onboarding/vibes');
    } catch (e: any) {
      Alert.alert(
        'Upload failed',
        e?.message ?? 'Could not upload photo. Please try again.',
        [{ text: 'Try Again' }]
      );
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
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              routerBack.back();
            }}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={styles.backButton}
          >
            <ChevronLeft size={28} color={Colors.textDark} />
          </TouchableOpacity>
        </View>

        <Text style={styles.heading}>Add a profile photo</Text>
        <Text style={styles.subtext}>
          People are 3× more likely to join plans when they can see who's going.
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
              <Image source={{ uri: imageUri }} style={styles.avatarImage} />
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
            <RefreshCw size={14} color={Colors.primaryOrange} />
            <Text style={styles.retakeText}>Choose a different photo</Text>
          </TouchableOpacity>
        )}

        <View style={styles.spacer} />

        {/* Continue */}
        <TouchableOpacity
          style={[
            styles.primaryButton,
            (!imageUri || loading) && styles.primaryButtonDisabled,
          ]}
          onPress={handleContinue}
          onPressIn={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
          activeOpacity={0.9}
          disabled={!imageUri || loading}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryButtonText}>Continue →</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.backgroundCream },
  container: { flex: 1, paddingHorizontal: 24 },

  progressWrap: {
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBar: { height: '100%', backgroundColor: Colors.primaryOrange, borderRadius: 2 },

  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  backButton: { padding: 4 },

  heading: { fontSize: 22, fontWeight: '700', color: Colors.textDark },
  subtext: { fontSize: 14, color: Colors.textMedium, marginTop: 6, lineHeight: 20 },

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
    backgroundColor: Colors.cardBackground,
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
    borderColor: Colors.primaryOrange,
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarEmpty: { alignItems: 'center', gap: 8 },
  avatarHint: { fontSize: 13, color: Colors.textLight, fontWeight: '500' },

  cropHint: {
    textAlign: 'center',
    fontSize: 13,
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
    fontSize: 14,
    color: Colors.primaryOrange,
    fontWeight: '600',
  },

  spacer: { flex: 1 },

  primaryButton: {
    height: 52,
    borderRadius: 14,
    backgroundColor: Colors.primaryOrange,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: Colors.primaryOrange,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
    marginBottom: 8,
  },
  primaryButtonDisabled: { opacity: 0.45 },
  primaryButtonText: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
});