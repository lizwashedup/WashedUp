/**
 * Help, support, and permissions (inventory C-30). Reached from the creator
 * Menu/More tab, a stack screen with its own back control (never a dead
 * end, matching organizer-profile.tsx / payouts.tsx precedent). Two halves:
 * a real, live permissions summary built from getCreatorAccess() (never a
 * static claim about what "creator mode" can do in general), and a short
 * grounded FAQ that names the actual screens this codebase ships, plus the
 * same contact-support path used everywhere else in creator mode
 * (mailto:hello@washedup.app, see (creator)/_layout.tsx RevokedScreen and
 * tickets/order/[id].tsx).
 *
 * Functionally minimal per decision 15a: no new schema, no new RPC. Every
 * fact on this screen is read from the same getCreatorAccess() the rest of
 * creator mode already trusts for its own gating, so "what can I do here"
 * can never drift from what the app actually enforces.
 */

import React from 'react';
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, LifeBuoy } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { EventSpacing } from '../../constants/EventDesign';
import { getCreatorAccess, isLeaderAccess, type CreatorAccess } from '../../lib/creatorMode';
import { hapticLight } from '../../lib/haptics';

/** The plain-language role line for the identity a real getCreatorAccess()
    result describes -- never a hardcoded "you're an admin" style claim. */
function roleSummary(access: CreatorAccess | undefined): string {
  if (!access) return 'checking your access...';
  const leader = isLeaderAccess(access);
  if (leader && access.hasEventHostGrant) {
    return 'you lead a community and you are approved to put on standalone events.';
  }
  if (leader) {
    const names = access.ledCommunities.map((c) => c.name).join(', ');
    return access.ledCommunities.length > 1
      ? `you lead ${access.ledCommunities.length} communities: ${names}.`
      : `you lead ${names || 'a community'}.`;
  }
  if (access.hasEventHostGrant) {
    return 'you are approved to put on standalone events. no community, no member room -- that is by design for this track.';
  }
  return 'no active creator access found on this account.';
}

interface FaqItem {
  q: string;
  a: string;
}

const FAQ: FaqItem[] = [
  {
    q: 'who can see my attendee list and refund a ticket',
    a: 'only you, an active co-leader of your community (if this event belongs to one), or washedup admin support. it is never visible to other members or to the public.',
  },
  {
    q: 'when does payout money actually land',
    a: 'stripe collects ticket money while the event sells; your payout releases to your bank after the event ends. the 4% commission is all-in, nothing else is taken out. see money > getting paid for your live status.',
  },
  {
    q: 'what is the difference between a community event and a standalone event',
    a: 'a community event posts from your community and can pin to your community chat. a standalone event is put on by you or your organization alone, with no member room attached.',
  },
  {
    q: 'why can’t I see the "attendees" tab',
    a: 'it shows once you have an event with at least one order or rsvp. before that, check who’s coming from the events tab on the event itself.',
  },
  {
    q: 'how do followers work',
    a: 'following is not membership: no chat, no roster, just a quiet way for people to hear when you post something new. message your followers from the menu once you have some.',
  },
];

export default function CreatorHelpScreen() {
  const { data: access, isLoading } = useQuery({ queryKey: ['creator-access'], queryFn: getCreatorAccess });

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="back">
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>help &amp; permissions</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.permCard}>
          <Text style={styles.permKicker}>your access, right now</Text>
          <Text style={styles.permBody}>{isLoading ? 'checking your access...' : roleSummary(access)}</Text>
          {!isLoading && access && access.ledCommunities.length > 0 && (
            <View style={styles.permList}>
              {access.ledCommunities.map((c) => (
                <View key={c.id} style={styles.permRow}>
                  <Text style={styles.permRowName} numberOfLines={1}>{c.name}</Text>
                  <Text style={styles.permRowRole}>{c.role === 'leader' ? 'primary leader' : 'co-leader'}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <Text style={styles.sectionLabel}>common questions</Text>
        <View style={styles.faqCard}>
          {FAQ.map((item, i) => (
            <View key={item.q} style={[styles.faqRow, i === FAQ.length - 1 && styles.faqRowLast]}>
              <Text style={styles.faqQ}>{item.q}</Text>
              <Text style={styles.faqA}>{item.a}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={styles.supportBtn}
          onPress={() => {
            hapticLight();
            Linking.openURL('mailto:hello@washedup.app').catch(() => {});
          }}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="contact support by email"
        >
          <LifeBuoy size={18} color={Colors.white} strokeWidth={2} />
          <Text style={styles.supportBtnText}>contact support</Text>
        </TouchableOpacity>
        <Text style={styles.supportHint}>a real person reads this, not a bot.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, gap: 12 },
  headerTitle: { flex: 1, fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  headerSpacer: { width: 22 },
  content: { padding: 20, paddingBottom: 48, gap: EventSpacing.md },

  permCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
  },
  permKicker: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  permBody: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD, color: Colors.darkWarm },
  permList: { marginTop: 12, gap: 8 },
  permRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  permRowName: { flex: 1, fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.darkWarm },
  permRowRole: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.secondary },

  sectionLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    marginTop: 4,
  },
  faqCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  faqRow: { padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.border, gap: 4 },
  faqRowLast: { borderBottomWidth: 0 },
  faqQ: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.darkWarm },
  faqA: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, lineHeight: LineHeights.bodySM, color: Colors.secondary },

  supportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 14,
    minHeight: 44,
    marginTop: 8,
  },
  supportBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  supportHint: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.tertiary, textAlign: 'center', marginTop: 6 },
});
