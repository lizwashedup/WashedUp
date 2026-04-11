import { Platform, Alert } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';

/**
 * Returns true if the given Supabase user is signed in via Apple AND the
 * Apple `sub` claim is in the server-side banned list. Fails open on any
 * transient error (RPC unreachable, unexpected payload) so a temporary
 * DB outage doesn't kick legitimate users out — the ban check runs
 * opportunistically, not as a hard gate.
 */
export async function isBannedAppleUser(user: User | null | undefined): Promise<boolean> {
  if (!user) return false;
  const sub = (user.user_metadata as { sub?: unknown } | null | undefined)?.sub;
  if (typeof sub !== 'string' || !sub) return false;
  const providerList = [
    user.app_metadata?.provider,
    ...((user.app_metadata?.providers as string[] | undefined) ?? []),
  ].filter((p): p is string => typeof p === 'string');
  if (!providerList.includes('apple')) return false;
  try {
    const { data, error } = await supabase.rpc('check_banned_apple_sub', {
      p_apple_sub: sub,
    });
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

export const BANNED_USER_MESSAGE = 'This account has been suspended.';

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

  // Ban check — run BEFORE any profile writes so we don't leak data to a
  // banned sub. If the user is banned, sign them out and surface a clear
  // error so the caller can display the suspended message.
  if (await isBannedAppleUser(data.user)) {
    await supabase.auth.signOut();
    throw new Error(BANNED_USER_MESSAGE);
  }

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

  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawNonce,
  );

  await GoogleSignin.hasPlayServices();
  const response = await GoogleSignin.signIn({ nonce: hashedNonce });

  if (response.type === 'cancelled') return null;

  const idToken = response.data?.idToken;
  if (!idToken) {
    throw new Error('No ID token returned from Google.');
  }

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
    nonce: rawNonce,
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
