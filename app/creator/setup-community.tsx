/**
 * Stage 2: name your community. The one client caller of create_community
 * (grant-gated definer RPC, born draft, seats the leader, seeds the five
 * starter blocks). An approved leader with zero led communities lands here
 * from the shell entry state; everyone else bounces to the shell. The page
 * stays a DRAFT only the leader sees until the existing publish-your-page
 * flow opens it.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react-native';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../../components/keyboard/KeyboardDoneBar';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import {
  getCreatorAccess,
  isLeaderAccess,
  createCommunity,
  suggestHandle,
  HANDLE_SHAPE,
} from '../../lib/creatorMode';
import { isHouseCommunity } from '../../lib/houseCommunity';
import { hapticSuccess, hapticError } from '../../lib/haptics';

const NAME_MAX = 80;
const HANDLE_MAX = 40;

export default function SetupCommunityScreen() {
  const queryClient = useQueryClient();
  const { data: access } = useQuery({ queryKey: ['creator-access'], queryFn: getCreatorAccess });

  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [handleTouched, setHandleTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const onNameChange = (v: string) => {
    setName(v);
    if (!handleTouched) setHandle(suggestHandle(v));
  };

  const handleValid = HANDLE_SHAPE.test(handle) && !isHouseCommunity(handle);
  const canCreate = name.trim().length > 0 && handleValid && !busy;

  const handleCreate = async () => {
    if (!canCreate) return;
    setBusy(true);
    setProblem(null);
    try {
      await createCommunity(handle, name.trim());
      hapticSuccess();
      await queryClient.invalidateQueries({ queryKey: ['creator-access'] });
      router.replace('/(creator)/today');
    } catch (e: unknown) {
      hapticError();
      const code = (e as { code?: string })?.code;
      // LIZ COPY (both)
      setProblem(
        code === '23505'
          ? 'that handle is taken. try another.'
          : 'that did not go through. give it another try.',
      );
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2.5} />
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* LIZ COPY */}
        <Text style={styles.kicker}>creator mode</Text>
        {/* LIZ COPY */}
        <Text style={styles.title}>name your community</Text>
        {/* LIZ COPY */}
        <Text style={styles.subtext}>
          you can change the name any time. the handle is your page's address and sticks around.
        </Text>

        {access != null && !isLeaderAccess(access) ? (
          /* LIZ COPY: reachable only by stale links; leaders never see it */
          <Text style={styles.subtext}>this space belongs to approved community creators.</Text>
        ) : (
          <>
            {/* LIZ COPY */}
            <Text style={styles.fieldLabel}>community name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={onNameChange}
              maxLength={NAME_MAX}
              autoCapitalize="words"
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />

            {/* LIZ COPY */}
            <Text style={styles.fieldLabel}>handle</Text>
            <TextInput
              style={styles.input}
              value={handle}
              onChangeText={(v) => { setHandleTouched(true); setHandle(v.toLowerCase()); }}
              maxLength={HANDLE_MAX}
              autoCapitalize="none"
              autoCorrect={false}
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />
            <Text style={styles.handlePreview}>washedup.app/c/{handle || 'your-handle'}</Text>
            {!!handle && !handleValid && (
              /* LIZ COPY */
              <Text style={styles.problem}>
                handles are 3 to 40 characters: lowercase letters, numbers, and hyphens.
              </Text>
            )}

            {!!problem && <Text style={styles.problem}>{problem}</Text>}

            <TouchableOpacity
              style={[styles.createBtn, !canCreate && styles.createBtnOff]}
              onPress={handleCreate}
              disabled={!canCreate}
            >
              {busy ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                /* LIZ COPY: the locked vocabulary, "start a community" */
                <Text style={styles.createBtnText}>start your community</Text>
              )}
            </TouchableOpacity>
            {/* LIZ COPY */}
            <Text style={styles.quietNote}>
              your page starts as a draft only you can see. you choose when it opens.
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  header: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8 },
  content: { padding: 20 },
  kicker: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayLG,
    lineHeight: LineHeights.displayLG,
    color: Colors.darkWarm,
    marginBottom: 6,
  },
  subtext: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    lineHeight: 20,
    color: Colors.secondary,
    marginBottom: 18,
  },
  fieldLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  input: {
    backgroundColor: Colors.inputBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.darkWarm,
    marginBottom: 8,
  },
  handlePreview: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
    marginBottom: 14,
  },
  problem: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.errorRed,
    marginBottom: 10,
  },
  createBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  createBtnOff: { opacity: 0.45 },
  createBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  quietNote: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
    textAlign: 'center',
    marginTop: 10,
  },
});
