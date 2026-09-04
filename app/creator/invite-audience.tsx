/**
 * Invite audience (Liz decision #6, 2026-09-03, net-new half). A creator
 * inviting people who are NOT yet registered for THIS event to consider
 * it: past attendees of the creator's other events, followers, or (when
 * this event belongs to a community) community members. See the long
 * comment at the top of lib/inviteAudience.ts for the real audience
 * queries and the unresolved legal question on the "past attendees"
 * audience specifically -- that question is why Send stays disabled here
 * regardless of INVITE_AUDIENCE_ENABLED. This screen is real and honest up
 * to a draft: live preview counts against real data, a real compose box.
 * There is no send backend for this yet (same situation as "Message
 * attendees" -- see EVENT_SUMMARY_ENABLED's note in constants/FeatureFlags.ts),
 * so Send shows why instead of pretending to work.
 */

import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { EventSpacing } from '../../constants/EventDesign';
import { getOperatorEvent } from '../../lib/creatorEvents';
import { getFollowerCount } from '../../lib/organizerFollows';
import { getCommunityMemberCount, getInviteAudienceOptions, getPastAttendeesCount, type InviteAudienceType } from '../../lib/inviteAudience';
import { supabase } from '../../lib/supabase';

const MAX_LEN = 2000;

export default function InviteAudienceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [audienceType, setAudienceType] = useState<InviteAudienceType>('past_attendees');
  const [body, setBody] = useState('');

  const { data: event, isLoading: eventLoading } = useQuery({
    queryKey: ['event-summary', id],
    queryFn: () => getOperatorEvent(id!),
    enabled: !!id,
    staleTime: 10_000,
  });

  const options = getInviteAudienceOptions(event?.community_id ?? null);

  const { data: previewCount } = useQuery({
    queryKey: ['invite-audience-preview', id, audienceType, event?.host_user_id, event?.community_id],
    queryFn: async () => {
      if (audienceType === 'followers') {
        return event?.host_user_id ? getFollowerCount({ kind: 'organizer', id: event.host_user_id }) : null;
      }
      if (audienceType === 'community_members') {
        return event?.community_id ? getCommunityMemberCount(event.community_id) : null;
      }
      const { data: userRes } = await supabase.auth.getUser();
      const creatorId = event?.host_user_id ?? userRes.user?.id ?? null;
      return creatorId ? getPastAttendeesCount(creatorId, id ?? null) : null;
    },
    enabled: !!event,
    staleTime: 10_000,
  });

  const trimmed = body.trim();

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="back">
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2} />
        </TouchableOpacity>
        {/* copy to the taste gate */}
        <Text style={styles.headerTitle} numberOfLines={1}>invite people</Text>
      </View>

      {eventLoading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={Colors.terracotta} /></View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={12}>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {/* copy to the taste gate */}
            <Text style={styles.sectionLabel}>who should hear about this</Text>
            {options.map((opt) => {
              const selected = opt.type === audienceType;
              return (
                <TouchableOpacity
                  key={opt.type}
                  style={[styles.optionRow, selected && styles.optionRowSelected]}
                  onPress={() => setAudienceType(opt.type)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={opt.label}
                >
                  <View style={[styles.radio, selected && styles.radioSelected]}>
                    {selected && <Check size={12} color={Colors.white} strokeWidth={3} />}
                  </View>
                  <Text style={styles.optionLabel}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}

            <View style={styles.previewCard}>
              {/* copy to the taste gate -- same honest-preview idiom as organizer-broadcast.tsx */}
              <Text style={styles.previewText}>
                {previewCount == null
                  ? 'checking who this reaches…'
                  : previewCount === 0
                    ? "nobody's in this group yet -- this would go nowhere."
                    : `reaches ${previewCount} ${previewCount === 1 ? 'person' : 'people'}.`}
              </Text>
            </View>

            <TextInput
              style={styles.input}
              value={body}
              onChangeText={setBody}
              placeholder="what do you want to tell them about this one?"
              placeholderTextColor={Colors.textLight}
              multiline
              maxLength={MAX_LEN}
              accessibilityLabel="Invite message"
            />
            <Text style={styles.counter}>{trimmed.length}/{MAX_LEN}</Text>

            <View style={styles.sendCard}>
              {/* copy to the taste gate -- honest, not a fake working button. See
                  lib/inviteAudience.ts for why: no send backend exists yet, and
                  the past-attendees audience has a real open legal question. */}
              <Text style={styles.sendCardText}>
                sending isn&apos;t turned on yet -- this is a preview of who you&apos;d reach and a place to draft
                what you&apos;d say. nothing goes out from here.
              </Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, gap: 12 },
  backBtn: { padding: 4, marginLeft: -4 },
  headerTitle: { flex: 1, fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 20, paddingBottom: 40, gap: EventSpacing.sm },

  sectionLabel: {
    fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.textMedium,
    textTransform: 'uppercase', letterSpacing: 0.5, marginTop: EventSpacing.xs,
  },
  optionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 14, minHeight: 52,
  },
  optionRowSelected: { borderColor: Colors.terracotta },
  radio: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  radioSelected: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  optionLabel: { flex: 1, fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.asphalt },

  previewCard: {
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    padding: 14,
  },
  previewText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, lineHeight: LineHeights.bodySM, color: Colors.textMedium },

  input: {
    minHeight: 140, backgroundColor: Colors.white, borderRadius: 16, borderWidth: 1, borderColor: Colors.border,
    padding: EventSpacing.md, fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.asphalt,
    textAlignVertical: 'top',
  },
  counter: { alignSelf: 'flex-end', fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.textLight },

  sendCard: {
    backgroundColor: Colors.inputBg, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    padding: 14, marginTop: EventSpacing.xs,
  },
  sendCardText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, lineHeight: LineHeights.bodySM, color: Colors.textMedium },
});
