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
  type RestrictedGender,
} from '../../lib/creatorMode';
import { isHouseCommunity } from '../../lib/houseCommunity';
import { hapticSuccess, hapticError } from '../../lib/haptics';
import { GENDER_RESTRICTED_COMMUNITIES_ENABLED } from '../../constants/FeatureFlags';

const NAME_MIN = 2;
const NAME_MAX = 60;
const HANDLE_MAX = 40;
const CITY_MAX = 60;
const PURPOSE_MIN = 10;
const PURPOSE_MAX = 140;

// Liz 2026-09-01: symmetric women-only/men-only, creator's choice at
// creation, never editable after (see the migration's own column comment).
// `null` is "everyone" -- today's only behavior, and the default here.
const RESTRICTION_CHOICES: { value: RestrictedGender | null; label: string }[] = [
  { value: null, label: 'everyone' },
  { value: 'woman', label: 'women only' },
  { value: 'man', label: 'men only' },
];

export default function SetupCommunityScreen() {
  const queryClient = useQueryClient();
  const { data: access } = useQuery({ queryKey: ['creator-access'], queryFn: getCreatorAccess });

  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [handleTouched, setHandleTouched] = useState(false);
  const [city, setCity] = useState('');
  const [purpose, setPurpose] = useState('');
  const [restrictedGender, setRestrictedGender] = useState<RestrictedGender | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const onNameChange = (v: string) => {
    setName(v);
    if (!handleTouched) setHandle(suggestHandle(v));
  };

  const handleValid = HANDLE_SHAPE.test(handle) && !isHouseCommunity(handle);
  // inventory C-04: city required before a community is publicly
  // discoverable (doc says "required before public discovery"); gating it
  // here, at creation, trivially satisfies that -- discovery can only ever
  // happen after creation and publish.
  const nameValid = name.trim().length >= NAME_MIN;
  const cityValid = city.trim().length > 0;
  // inventory C-04: a real, specific pitch, not the longer freeform
  // description -- required before create, same as name/city/handle.
  const purposeValid = purpose.trim().length >= PURPOSE_MIN;
  const canCreate = nameValid && handleValid && cityValid && purposeValid && !busy;

  const handleCreate = async () => {
    if (!canCreate) return;
    setBusy(true);
    setProblem(null);
    try {
      // Flag off -> undefined -> createCommunity never sends p_restricted_gender
      // at all, so this call is byte-identical to before this feature existed.
      await createCommunity(
        handle,
        name.trim(),
        city.trim(),
        purpose.trim(),
        GENDER_RESTRICTED_COMMUNITIES_ENABLED ? restrictedGender : undefined,
      );
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
            {!!name && !nameValid && (
              /* LIZ COPY */
              <Text style={styles.problem}>needs at least {NAME_MIN} characters.</Text>
            )}

            {/* LIZ COPY */}
            <Text style={styles.fieldLabel}>city</Text>
            <TextInput
              style={styles.input}
              value={city}
              onChangeText={setCity}
              maxLength={CITY_MAX}
              autoCapitalize="words"
              placeholder="where your people find you"
              placeholderTextColor={Colors.inkSoft}
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />

            {/* LIZ COPY */}
            <Text style={styles.fieldLabel}>what's it for</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={purpose}
              onChangeText={setPurpose}
              maxLength={PURPOSE_MAX}
              multiline
              placeholder="one real sentence on why someone should join"
              placeholderTextColor={Colors.inkSoft}
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />
            {!!purpose && !purposeValid && (
              /* LIZ COPY */
              <Text style={styles.problem}>needs at least {PURPOSE_MIN} characters.</Text>
            )}

            {GENDER_RESTRICTED_COMMUNITIES_ENABLED && (
              <>
                {/* LIZ COPY */}
                <Text style={styles.fieldLabel}>who's it for</Text>
                <View style={styles.restrictionRow}>
                  {RESTRICTION_CHOICES.map((choice) => {
                    const selected = restrictedGender === choice.value;
                    return (
                      <TouchableOpacity
                        key={choice.label}
                        style={[styles.restrictionPill, selected && styles.restrictionPillSelected]}
                        onPress={() => setRestrictedGender(choice.value)}
                      >
                        <Text style={[styles.restrictionPillText, selected && styles.restrictionPillTextSelected]}>
                          {choice.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {restrictedGender != null && (
                  /* LIZ COPY */
                  <Text style={styles.quietNote}>
                    this can't be changed later. people who aren't {restrictedGender === 'woman' ? 'women' : 'men'} won't be able to find or join this community.
                  </Text>
                )}
              </>
            )}

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
  inputMultiline: {
    minHeight: 64,
    textAlignVertical: 'top',
  },
  restrictionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  restrictionPill: {
    backgroundColor: Colors.inputBg,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  restrictionPillSelected: {
    backgroundColor: Colors.brandSoft,
    borderColor: Colors.terracotta,
  },
  restrictionPillText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
  },
  restrictionPillTextSelected: {
    fontFamily: Fonts.sansBold,
    color: Colors.terracotta,
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
