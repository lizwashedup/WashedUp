/**
 * The organizer profile editor (proposal 36, Liz's addendum). Four fields
 * and a save: display name, optional logo, short bio, one link. Reached
 * from the creator Menu tab card; a stack screen with its own back control
 * (never a dead end). Functionally minimal per decision 15a.
 *
 * Until proposal 36 applies the save fails with the friendly error and
 * nothing else breaks (the block-editor precedent).
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { ArrowLeft, Plus } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../../components/keyboard/KeyboardDoneBar';
import { friendlyError } from '../../lib/friendlyError';
import { hapticSuccess } from '../../lib/haptics';
import {
  getMyOrganizerProfile,
  pickAndUploadOrganizerLogo,
  upsertOrganizerProfile,
} from '../../lib/organizerProfile';

const LOGO_SIZE = 84;

export default function OrganizerProfileScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [displayName, setDisplayName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [bio, setBio] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [seeded, setSeeded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);

  const { data: profile, isLoading } = useQuery({
    queryKey: ['organizer-profile'],
    queryFn: getMyOrganizerProfile,
  });

  useEffect(() => {
    if (!isLoading && !seeded) {
      if (profile) {
        setDisplayName(profile.display_name);
        setLogoUrl(profile.logo_url ?? '');
        setBio(profile.bio ?? '');
        setLinkUrl(profile.link_url ?? '');
      }
      setSeeded(true);
    }
  }, [isLoading, profile, seeded]);

  const handleLogo = async () => {
    setUploading(true);
    try {
      const url = await pickAndUploadOrganizerLogo();
      if (url) setLogoUrl(url);
    } catch (e) {
      setAlertInfo({ title: 'That photo did not upload', message: friendlyError(e, 'Try again in a moment.') });
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (saving) return;
    if (!displayName.trim()) {
      setAlertInfo({ title: 'Almost', message: 'A name is required.' });
      return;
    }
    setSaving(true);
    try {
      await upsertOrganizerProfile({
        display_name: displayName,
        logo_url: logoUrl || null,
        bio: bio || null,
        link_url: linkUrl || null,
      });
      hapticSuccess();
      queryClient.invalidateQueries({ queryKey: ['organizer-profile'] });
      router.back();
    } catch (e) {
      setAlertInfo({ title: 'That did not save', message: friendlyError(e, 'Try again in a moment.') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2.5} />
          </TouchableOpacity>
        </View>

        {!seeded ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={Colors.terracotta} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {/* LIZ COPY */}
            <Text style={styles.title}>your organizer profile</Text>
            {/* LIZ COPY */}
            <Text style={styles.subtitle}>
              the name your events wear. it fronts your listings; each event can still set its own.
            </Text>

            <Text style={styles.fieldLabel}>name</Text>
            <TextInput
              style={styles.input}
              value={displayName}
              onChangeText={setDisplayName}
              maxLength={80}
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />

            <Text style={styles.fieldLabel}>logo</Text>
            {/* LIZ COPY */}
            <Text style={styles.fieldHint}>optional. it sits next to your name on the event page.</Text>
            {logoUrl ? (
              <TouchableOpacity onPress={handleLogo} disabled={uploading}>
                <Image source={{ uri: logoUrl }} style={styles.logo} contentFit="cover" />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.logoAdd} onPress={handleLogo} disabled={uploading}>
                {uploading ? (
                  <ActivityIndicator size="small" color={Colors.terracotta} />
                ) : (
                  <Plus size={20} color={Colors.terracotta} strokeWidth={2.5} />
                )}
              </TouchableOpacity>
            )}

            <Text style={styles.fieldLabel}>about</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={bio}
              onChangeText={setBio}
              multiline
              maxLength={280}
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />

            <Text style={styles.fieldLabel}>link</Text>
            {/* LIZ COPY */}
            <Text style={styles.fieldHint}>your site, instagram, wherever people find you.</Text>
            <TextInput
              style={styles.input}
              value={linkUrl}
              onChangeText={setLinkUrl}
              placeholder="https://"
              placeholderTextColor={Colors.inkSoft}
              autoCapitalize="none"
              keyboardType="url"
              maxLength={300}
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />

            <TouchableOpacity
              style={[styles.saveBtn, saving && styles.saveBtnBusy]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <Text style={styles.saveBtnText}>save</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        )}
      </KeyboardAvoidingView>

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
  container: { flex: 1, backgroundColor: Colors.parchment },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8 },
  content: { padding: 20, paddingBottom: 60 },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayLG,
    lineHeight: LineHeights.displayLG,
    color: Colors.darkWarm,
    marginBottom: 4,
  },
  subtitle: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    marginBottom: 16,
  },
  fieldLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  fieldHint: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.tertiary, marginBottom: 6 },
  input: {
    backgroundColor: Colors.inputBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.darkWarm,
    marginBottom: 14,
  },
  inputMultiline: { minHeight: 90, textAlignVertical: 'top' },
  logo: { width: LOGO_SIZE, height: LOGO_SIZE, borderRadius: 16, marginBottom: 14 },
  logoAdd: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    borderRadius: 16,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.terracotta,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  saveBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 14,
  },
  saveBtnBusy: { opacity: 0.6 },
  saveBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.white },
});
