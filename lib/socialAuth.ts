import { Platform, Alert } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';

let GoogleSignin: any = null;

const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

try {
  GoogleSignin = require('@react-native-google-signin/google-signin').GoogleSignin;
  if (googleWebClientId && GoogleSignin) {
    GoogleSignin.configure({
      webClientId: googleWebClientId,
      iosClientId: googleIosClientId,
    });
  }
} catch {
  // Native module not available (e.g. Expo Go) -- Google sign-in will be hidden
}

export async function signInWithApple() {
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawNonce,
  );

  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
    nonce: hashedNonce,
  });

  if (!credential.identityToken) {
    throw new Error('No identity token returned from Apple.');
  }

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce: rawNonce,
  });

  if (error) throw error;

  // Apple only returns the name on the very first sign-in
  if (credential.fullName?.givenName && data.user) {
    await supabase
      .from('profiles')
      .update({ first_name_display: credential.fullName.givenName })
      .eq('id', data.user.id);
  }

  return data;
}

export async function signInWithGoogle() {
  if (!GoogleSignin || !googleWebClientId) {
    Alert.alert('Not available', 'Google Sign-In is not available in this build.');
    return null;
  }

  await GoogleSignin.hasPlayServices();
  const response = await GoogleSignin.signIn();
  const idToken = response.data?.idToken;

  if (!idToken) {
    throw new Error('No ID token returned from Google.');
  }

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
  });

  if (error) throw error;

  if (data.user) {
    const meta = data.user.user_metadata;
    const firstName = meta?.full_name?.split(' ')[0] || meta?.name?.split(' ')[0] || null;
    if (firstName) {
      const { data: existing } = await supabase
        .from('profiles')
        .select('first_name_display')
        .eq('id', data.user.id)
        .single();
      if (!existing?.first_name_display) {
        await supabase
          .from('profiles')
          .update({ first_name_display: firstName })
          .eq('id', data.user.id);
      }
    }
  }

  return data;
}

export async function isAppleAuthAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

export function isGoogleAuthConfigured(): boolean {
  return !!googleWebClientId && !!GoogleSignin;
}
