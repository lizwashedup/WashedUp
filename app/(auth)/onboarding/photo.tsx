import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { router, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { ChevronLeft, Camera } from 'lucide-react-native';
import { supabase } from '../../../lib/supabase';
import Colors from '../../../constants/Colors';

const AVATAR_SIZE = 150;

export default function OnboardingPhotoScreen() {
  const routerBack = useRouter();
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const pickImage = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow access to your photos to add a profile photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled) return;
    const uri = result.assets[0].uri;
    setImageUri(uri);
  };

  const handleContinue = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      let avatarUrl: string | null = null;
      if (imageUri) {
        const path = `${user.id}.jpg`;
        const response = await fetch(imageUri);
        const blob = await response.blob();
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
        avatarUrl = urlData.publicUrl;
      }

      await supabase.from('profiles').update({ avatar_url: avatarUrl }).eq('id', user.id);
      router.push('/onboarding/vibes');
    } catch (e) {
      Alert.alert('Upload failed', 'Could not upload photo. Try again or skip for now.');
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/onboarding/vibes');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <View style={styles.container}>
        <View style={styles.progressWrap}>
          <View style={[styles.progressBar, { width: '75%' }]} />
        </View>
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); routerBack.back(); }}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={styles.backButton}
          >
            <ChevronLeft size={28} color={Colors.textDark} />
          </TouchableOpacity>
        </View>

        <Text style={styles.heading}>Add a profile photo</Text>
        <Text style={styles.subtext}>People are more likely to join plans with a real photo</Text>
        <View style={styles.gap32} />

        <TouchableOpacity
          style={styles.avatarCircle}
          onPress={pickImage}
          activeOpacity={0.8}
        >
          {imageUri ? (
            <Image source={{ uri: imageUri }} style={styles.avatarImage} />
          ) : (
            <Camera size={40} color={Colors.textLight} />
          )}
        </TouchableOpacity>
        <View style={styles.gap12} />
        <TouchableOpacity onPress={handleSkip} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.skipText}>Skip for now</Text>
        </TouchableOpacity>

        <View style={styles.spacer} />
        <TouchableOpacity
          style={[styles.primaryButton, loading && styles.primaryButtonDisabled]}
          onPress={handleContinue}
          onPressIn={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
          activeOpacity={0.9}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryButtonText}>Continue</Text>
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
  subtext: { fontSize: 14, color: Colors.textMedium, marginTop: 4 },
  gap32: { height: 32 },
  gap12: { height: 12 },
  avatarCircle: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: Colors.cardBackground,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  skipText: { fontSize: 14, color: Colors.textLight, textAlign: 'center' },
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
  },
  primaryButtonDisabled: { opacity: 0.7 },
  primaryButtonText: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
});
