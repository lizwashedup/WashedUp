/**
 * Stage 2: name your community. The one client caller of create_community
 * (grant-gated definer RPC, born draft, seats the leader, seeds the five
 * starter blocks). An approved leader with zero led communities lands here
 * from the shell entry state; everyone else bounces to the shell. The page
 * stays a DRAFT only the leader sees until the existing publish-your-page
 * flow opens it.
 */

import React, { useEffect, useState } from 'react';
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
  findLedCommunityByHandle,
  HANDLE_SHAPE,
  type RestrictedGender,
  type JoinPolicy,
} from '../../lib/creatorMode';
import { isHouseCommunity } from '../../lib/houseCommunity';
import { hapticSuccess, hapticError } from '../../lib/haptics';
import { supabase } from '../../lib/supabase';
import {
  GENDER_RESTRICTED_COMMUNITIES_ENABLED,
  COMMUNITY_JOIN_POLICY_AT_CREATION_ENABLED,
} from '../../constants/FeatureFlags';

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

// Josh 2026-09-02: explicit choice at creation, never editable after (same
// "set once at create" pattern as the restriction choice above) until
// set_community_join_policy() exists for a real after-the-fact edit surface.
const JOIN_POLICY_CHOICES: { value: JoinPolicy; label: string }[] = [
  { value: 'open', label: 'open' },
  { value: 'approval_required', label: 'approval required' },
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
  const [joinPolicy, setJoinPolicyChoice] = useState<JoinPolicy>('open');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Screen 48: availability checked live, before submit, instead of only
  // surfacing via the 23505 unique-violation once they've already tapped
  // create.
  const [handleAvailable, setHandleAvailable] = useState<boolean | null>(null);
  const [checkingHandle, setCheckingHandle] = useState(false);
  // Screen 21: the explicit success state (not just an immediate redirect)
  // with its three named onward actions. Holding the just-created community
  // here is enough -- createCommunity() already returns its id, and the
  // handle/name are exactly what was just submitted.
  const [createdCommunity, setCreatedCommunity] = useState<{ id: string; handle: string; name: string } | null>(null);

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
  // handleAvailable !== false (not === true): an in-flight or failed check
  // reads as unknown/null and must never block submit -- the 23505 catch
  // below is still the real backstop either way. Only a CONFIRMED taken
  // handle disables the button early.
  const canCreate = nameValid && handleValid && cityValid && purposeValid && handleAvailable !== false && !busy;

  // Screen 48: debounced (500ms, same shape as the personal-handle check in
  // app/(tabs)/profile.tsx) live availability check. A dedicated
  // SECURITY DEFINER RPC is required rather than a plain client select:
  // communities_select RLS only surfaces active/member/admin rows, so a
  // draft community someone else just created would otherwise read back as
  // falsely "available".
  useEffect(() => {
    if (!handleValid) { setHandleAvailable(null); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      setCheckingHandle(true);
      try {
        const { data, error } = await supabase.rpc('community_handle_available', { p_handle: handle });
        if (error) throw error;
        if (!cancelled) setHandleAvailable(data as boolean);
      } catch {
        // inconclusive -- never block submit on a check failure, the create
        // call's own 23505 handling is still the real backstop
        if (!cancelled) setHandleAvailable(null);
      } finally {
        if (!cancelled) setCheckingHandle(false);
      }
    }, 500);
    return () => { cancelled = true; clearTimeout(t); };
  }, [handle, handleValid]);

  const handleCreate = async () => {
    if (!canCreate) return;
    setBusy(true);
    setProblem(null);
    try {
      // Flag off -> undefined -> createCommunity never sends p_restricted_gender
      // at all, so this call is byte-identical to before this feature existed.
      const id = await createCommunity(
        handle,
        name.trim(),
        city.trim(),
        purpose.trim(),
        GENDER_RESTRICTED_COMMUNITIES_ENABLED ? restrictedGender : undefined,
        COMMUNITY_JOIN_POLICY_AT_CREATION_ENABLED ? joinPolicy : undefined,
      );
      hapticSuccess();
      await queryClient.invalidateQueries({ queryKey: ['creator-access'] });
      // Screen 21: land on the explicit success state, not an immediate
      // redirect -- today.tsx (11), edit-page (33), and member-invites (56)
      // are all real onward destinations from here now.
      setCreatedCommunity({ id, handle, name: name.trim() });
      setBusy(false);
    } catch (e: unknown) {
      // Screen 48: a network retry must never create a second Community.
      // Before showing retry-eligible copy, check whether this exact create
      // already landed (the request succeeded but the response was lost) --
      // see findLedCommunityByHandle's own comment for why this re-check,
      // not a server-side idempotency key, is the right-sized fix here.
      try {
        const freshAccess = await getCreatorAccess();
        const already = findLedCommunityByHandle(freshAccess, handle);
        if (already) {
          await queryClient.invalidateQueries({ queryKey: ['creator-access'] });
          hapticSuccess();
          setCreatedCommunity({ id: already.id, handle: already.handle, name: already.name });
          setBusy(false);
          return;
        }
      } catch {
        // inconclusive -- fall through to the normal error copy below
      }
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

  // Screen 21: the explicit success state, reached only after a real create
  // (or a retry that discovered one already landed, see the catch block
  // above). Forward-only on purpose -- no back arrow into the now-stale
  // empty form, just the three real onward destinations.
  if (createdCommunity) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.kicker}>creator mode</Text>
          <Text style={styles.title}>you're set.</Text>
          <Text style={styles.subtext}>
            {createdCommunity.name} is up. your page starts as a draft only you can see. you choose when it opens.
          </Text>
          <TouchableOpacity
            style={styles.createBtn}
            onPress={() => router.replace('/(creator)/today')}
            activeOpacity={0.85}
          >
            <Text style={styles.createBtnText}>view community</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => router.push('/creator/edit-page')}
            activeOpacity={0.85}
          >
            <Text style={styles.secondaryBtnText}>edit page</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => router.push('/creator/member-invites' as never)}
            activeOpacity={0.85}
          >
            <Text style={styles.secondaryBtnText}>invite members</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

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

            {COMMUNITY_JOIN_POLICY_AT_CREATION_ENABLED && (
              <>
                {/* LIZ COPY */}
                <Text style={styles.fieldLabel}>who gets in</Text>
                <View style={styles.restrictionRow}>
                  {JOIN_POLICY_CHOICES.map((choice) => {
                    const selected = joinPolicy === choice.value;
                    return (
                      <TouchableOpacity
                        key={choice.value}
                        style={[styles.restrictionPill, selected && styles.restrictionPillSelected]}
                        onPress={() => setJoinPolicyChoice(choice.value)}
                      >
                        <Text style={[styles.restrictionPillText, selected && styles.restrictionPillTextSelected]}>
                          {choice.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {/* LIZ COPY */}
                <Text style={styles.quietNote}>
                  open lets anyone join instantly. approval required means you review each request before they're in.
                </Text>
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
            {/* Screen 48: caught before submit now, not just via the 23505 at
                create time -- same copy as that existing catch below, so the
                two paths never say two different things about the same fact. */}
            {handleValid && !checkingHandle && handleAvailable === false && (
              /* LIZ COPY (reused) */
              <Text style={styles.problem}>that handle is taken. try another.</Text>
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
  // Screen 21: the two secondary onward actions on the success state. Same
  // bordered/terracotta-text secondary pattern as today.tsx's quickActionSecondary.
  secondaryBtn: {
    backgroundColor: Colors.cardBg,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.terracotta,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  secondaryBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  quietNote: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
    textAlign: 'center',
    marginTop: 10,
  },
});
