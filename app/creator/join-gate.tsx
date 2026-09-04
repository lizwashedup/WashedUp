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
import { useRouter, Stack, Redirect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../../components/keyboard/KeyboardDoneBar';
import { friendlyError } from '../../lib/friendlyError';
import { hapticSuccess, hapticLight } from '../../lib/haptics';
import { getCreatorAccess, canManageMembers, creatorLandingRoute, getJoinGateSettings, updateJoinGateSettings, getJoinPolicy, setJoinPolicy, getCommunityMemberCounts, type JoinPolicy } from '../../lib/creatorMode';
import { useLedCommunity } from '../../lib/selectedCommunity';
import { JOIN_GATE_ENABLED } from '../../constants/FeatureFlags';
import { JoinCommunityPopup } from '../../components/communities/JoinCommunityPopup';

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
  const community = useLedCommunity(access);

  const settingsKey = ['join-gate', community?.id];
  const { data: settings, isLoading } = useQuery({
    queryKey: settingsKey,
    queryFn: () => getJoinGateSettings(community!.id),
    enabled: !!community,
  });

  // proposal 91: self-flipping join-policy toggle. null until the column
  // lands, then the toggle persists each tap immediately (its own write,
  // separate from the text-field save).
  const { data: fetchedPolicy = null } = useQuery({
    queryKey: ['join-policy', community?.id],
    queryFn: () => getJoinPolicy(community!.id),
    enabled: !!community,
  });
  const [joinPolicy, setJoinPolicyState] = useState<JoinPolicy | null>(null);
  const [previewVisible, setPreviewVisible] = useState(false);
  useEffect(() => { setJoinPolicyState(fetchedPolicy); }, [fetchedPolicy]);

  // inventory C-08: live counts next to the picker, and the source for the
  // "you have N waiting" confirm copy below.
  const { data: counts } = useQuery({
    queryKey: ['creator-member-counts', community?.id],
    queryFn: () => getCommunityMemberCounts(community!.id),
    enabled: !!community,
  });

  const commitJoinPolicy = async (policy: JoinPolicy) => {
    const prev = joinPolicy;
    setJoinPolicyState(policy); // optimistic
    const ok = await setJoinPolicy(community!.id, policy);
    if (!ok) {
      setJoinPolicyState(prev); // revert on a no-op/denied write
      setAlertInfo({ title: 'That did not save', message: 'give it another try.' });
    }
  };

  // inventory C-08: switching away from "you approve them" never touches
  // anyone already waiting -- they stay pending until reviewed one by one --
  // but a leader should not learn that only after the fact, so it is a real
  // confirm step, not an instant optimistic flip, whenever people are
  // actually waiting right now.
  const setJoinPolicyLocal = (policy: JoinPolicy) => {
    if (!community || policy === joinPolicy) return;
    const pendingCount = counts?.pending ?? 0;
    if (joinPolicy === 'approval_required' && pendingCount > 0) {
      setAlertInfo({
        title: `Switch off review with ${pendingCount} waiting?`,
        message: `They stay exactly as they are, pending, until you approve or decline them yourself. This only changes what happens to new requests from here on.`,
        buttons: [
          { text: 'Keep reviewing', style: 'cancel' },
          { text: 'Switch anyway', onPress: () => commitJoinPolicy(policy) },
        ],
      });
      return;
    }
    commitJoinPolicy(policy);
  };

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

  if (access && !canManageMembers(access)) return <Redirect href={creatorLandingRoute(access)} />;

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
              what people see when they join {community.name}. all three make
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

            {/* proposal 91: the join policy toggle renders only when the
                JOIN_GATE_ENABLED flag is on AND the join_policy column read
                succeeds (getJoinPolicy non-null). Flag off, or column absent,
                keeps it hidden with no dead control. Both platforms flip in
                lockstep on the same flag. Proposal 91's default is OPEN:
                anyone joins instantly, and approval is the opt-in. */}
            {JOIN_GATE_ENABLED && joinPolicy !== null && (
              <>
                <Text style={styles.fieldLabel}>who gets in</Text>
                <Text style={styles.fieldHint}>
                  open lets anyone join instantly. approval means you review each request.
                </Text>
                {counts && (
                  <Text style={styles.policyPreview}>
                    {counts.active} in the community
                    {counts.pending > 0 ? ` · ${counts.pending} waiting for review` : ''}
                  </Text>
                )}
                <View style={styles.policyRow}>
                  <TouchableOpacity
                    style={[styles.policyPill, joinPolicy === 'open' && styles.policyPillOn]}
                    onPress={() => { hapticLight(); setJoinPolicyLocal('open'); }}
                    activeOpacity={0.85}
                  >
                    {/* copy to the taste gate */}
                    <Text style={[styles.policyText, joinPolicy === 'open' && styles.policyTextOn]}>
                      anyone can join
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.policyPill, joinPolicy === 'approval_required' && styles.policyPillOn]}
                    onPress={() => { hapticLight(); setJoinPolicyLocal('approval_required'); }}
                    activeOpacity={0.85}
                  >
                    {/* copy to the taste gate */}
                    <Text style={[styles.policyText, joinPolicy === 'approval_required' && styles.policyTextOn]}>
                      you approve them
                    </Text>
                  </TouchableOpacity>
                </View>
                {/* inventory C-08: invite_only added to the JoinPolicy type
                    and offered here, same self-flipping shape as the two
                    pills above. Deliberately NOT built: real invite-code
                    generation/redemption -- that is its own, larger feature
                    (bigger-rocks list), not a "small" wire-up. Selecting it
                    today behaves like "you approve them" server-side (fails
                    closed into review, never silently opens the door) until
                    that larger feature ships. */}
                <TouchableOpacity
                  style={[styles.policyPill, styles.policyPillWide, joinPolicy === 'invite_only' && styles.policyPillOn]}
                  onPress={() => { hapticLight(); setJoinPolicyLocal('invite_only'); }}
                  activeOpacity={0.85}
                >
                  {/* copy to the taste gate */}
                  <Text style={[styles.policyText, joinPolicy === 'invite_only' && styles.policyTextOn]}>
                    invite only
                  </Text>
                </TouchableOpacity>
                {joinPolicy === 'invite_only' && (
                  <Text style={styles.policyNote}>
                    invite codes aren't built yet. for now, invite only works like "you approve them": you review every request.
                  </Text>
                )}
              </>
            )}

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

            <TouchableOpacity style={styles.previewBtn} onPress={() => { hapticLight(); setPreviewVisible(true); }}>
              <Text style={styles.previewBtnText}>preview</Text>
            </TouchableOpacity>

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

      {community && (
        <JoinCommunityPopup
          visible={previewVisible}
          previewMode
          gate={{
            communityId: community.id,
            name: community.name,
            welcomeMessage: welcome || null,
            introQuestion: question || null,
            guidelinesUrl: guidelines || null,
          }}
          joinsInstantly={joinPolicy === 'open'}
          onClose={() => setPreviewVisible(false)}
          onRequested={() => setPreviewVisible(false)}
        />
      )}

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
    marginBottom: 2,
  },
  fieldHint: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.tertiary, marginBottom: 6 },
  policyPreview: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.terracotta, marginBottom: 8 },
  policyNote: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.tertiary, marginTop: -4, marginBottom: 16 },
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
  policyRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  policyPill: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  policyPillOn: { borderColor: Colors.terracotta, backgroundColor: Colors.brandSoft },
  // overrides policyPill's flex:1 (meant for the two-pill row) so this
  // standalone third pill renders as its own full-width block instead
  policyPillWide: { flex: 0, marginTop: 8, marginBottom: 8 },
  policyText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.darkWarm },
  policyTextOn: { fontFamily: Fonts.sansBold, color: Colors.terracotta },
  saveBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  saveBtnBusy: { opacity: 0.6 },
  saveBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.white },
  previewBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 10,
  },
  previewBtnText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
});
