/**
 * Creator mode: the join gate settings (doc 09). The three things a leader
 * writes once and every joiner sees: the welcome message at the top of the
 * join popup, the intro question whose answer becomes the newcomer's
 * introduction in chat, and the guidelines link behind the required
 * checkbox. Saved straight to communities through leader RLS. Functionally
 * minimal per decision 15a.
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
import { ArrowLeft } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../../components/keyboard/KeyboardDoneBar';
import { friendlyError } from '../../lib/friendlyError';
import { hapticSuccess } from '../../lib/haptics';
import { getCreatorAccess, getJoinGateSettings, updateJoinGateSettings } from '../../lib/creatorMode';

export default function JoinGateScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [welcome, setWelcome] = useState('');
  const [question, setQuestion] = useState('');
  const [guidelines, setGuidelines] = useState('');
  const [seeded, setSeeded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);

  const { data: access, isLoading: accessLoading } = useQuery({
    queryKey: ['creator-access'],
    queryFn: getCreatorAccess,
  });
  const community = access?.ledCommunities[0] ?? null;

  const settingsKey = ['join-gate', community?.id];
  const { data: settings, isLoading } = useQuery({
    queryKey: settingsKey,
    queryFn: () => getJoinGateSettings(community!.id),
    enabled: !!community,
  });

  useEffect(() => {
    if (settings && !seeded) {
      setWelcome(settings.join_welcome_message ?? '');
      setQuestion(settings.join_intro_question ?? '');
      setGuidelines(settings.guidelines_url ?? '');
      setSeeded(true);
    }
  }, [settings, seeded]);

  const handleSave = async () => {
    if (!community || saving) return;
    const url = guidelines.trim();
    if (url && !/^https?:\/\//i.test(url)) {
      setAlertInfo({ title: 'Check the link', message: 'The guidelines link needs to start with https://' });
      return;
    }
    setSaving(true);
    try {
      await updateJoinGateSettings(community.id, {
        join_welcome_message: welcome,
        join_intro_question: question,
        guidelines_url: guidelines,
      });
      hapticSuccess();
      queryClient.invalidateQueries({ queryKey: settingsKey });
      setAlertInfo({ title: 'saved', message: 'your join gate is set. every joiner sees it.' });
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
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12}>
            <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2.5} />
          </TouchableOpacity>
        </View>

        {accessLoading || (community && isLoading) ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={Colors.terracotta} />
          </View>
        ) : !community ? (
          <View style={styles.centered}>
            <Text style={styles.hint}>no community on this account yet.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>your join gate</Text>
            <Text style={styles.hint}>
              what people see when they ask to join {community.name}. all three make
              the door feel like yours.
            </Text>

            <Text style={styles.fieldLabel}>your welcome message</Text>
            <Text style={styles.fieldHint}>shows at the top of the join popup, in your voice.</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={welcome}
              onChangeText={setWelcome}
              multiline
              maxLength={1000}
              placeholder="hey, glad you found us."
              placeholderTextColor={Colors.inkSoft}
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />

            <Text style={styles.fieldLabel}>your intro question</Text>
            <Text style={styles.fieldHint}>
              their answer becomes their introduction, posted into the community chat
              when you approve them.
            </Text>
            <TextInput
              style={styles.input}
              value={question}
              onChangeText={setQuestion}
              maxLength={200}
              placeholder="what's your go-to taco spot?"
              placeholderTextColor={Colors.inkSoft}
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />

            <Text style={styles.fieldLabel}>guidelines link</Text>
            <Text style={styles.fieldHint}>
              joiners accept these before they can ask. leave empty to use the
              washedup guidelines.
            </Text>
            <TextInput
              style={styles.input}
              value={guidelines}
              onChangeText={setGuidelines}
              autoCapitalize="none"
              keyboardType="url"
              placeholder="https://"
              placeholderTextColor={Colors.inkSoft}
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />

            <TouchableOpacity style={[styles.saveBtn, saving && styles.saveBtnBusy]} onPress={handleSave} disabled={saving}>
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
  headerBtn: { padding: 4 },
  content: { padding: 20, paddingBottom: 60 },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayLG,
    lineHeight: LineHeights.displayLG,
    color: Colors.darkWarm,
    marginBottom: 8,
  },
  hint: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    lineHeight: LineHeights.bodySM,
    marginBottom: 18,
  },
  fieldLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 2,
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
    marginBottom: 16,
  },
  inputMultiline: { minHeight: 90, textAlignVertical: 'top' },
  saveBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  saveBtnBusy: { opacity: 0.6 },
  saveBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.white },
});
