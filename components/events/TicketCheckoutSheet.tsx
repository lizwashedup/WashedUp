/**
 * C1 - the buyer's tier selector and checkout handoff (doc 78 §4, doc 79
 * C1; mirror of web). Shows on-sale tiers with the ALL-IN price the buyer
 * will actually pay (law 9, fees never surprise), a quantity stepper
 * capped to the tier's per-order max and real remaining inventory, then
 * hands off to the create-ticket-checkout edge fn: a paid tier opens the
 * hosted Stripe Checkout url, a free tier confirms in-session.
 *
 * TEST MODE until Liz's live word; the edge fn refuses a non-test key and
 * this surfaces that as a plain note rather than a dead button.
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Minus, Plus, X } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { EventAction, EventSpacing } from '../../constants/EventDesign';
import { hapticLight, hapticSuccess, hapticError } from '../../lib/haptics';
import { openUrl } from '../../lib/url';
import { supabase } from '../../lib/supabase';
import {
  computeFeePreview,
  formatCents,
  getTiers,
  startTicketCheckout,
  type TicketTier,
} from '../../lib/ticketing';

// doc 109 (group tickets): a tier the buyer cannot lawfully buy renders
// sold-out-style and is never selectable, so the server's 409 is
// unreachable from here. Availability is real (get_ticket_tier_availability,
// orders + holds) and fail-closed to "unknown" = buyable, the same reading
// getPublicTicketSummary uses; the server still holds the real gate.
interface SellableTier {
  tier: TicketTier;
  /** null = uncapped or unknown */
  remaining: number | null;
  /** capped, counted, and nothing left */
  soldOut: boolean;
  /** capped, counted, and fewer left than the tier's per-order minimum */
  underMinimum: boolean;
}

function tierMin(t: TicketTier): number {
  return Math.max(1, t.per_order_min ?? 1);
}

// LIZ COPY RULED verbatim (accuracy-approved, shipped on her word 7-31):
// the checkout-modal refund disclosure, doc 96's §5 state-it-at-checkout
// condition. Never reworded here.
const CHECKOUT_REFUND_DISCLOSURE =
  "refunds follow this event's policy. if you get one, the ticket price comes back to you, not the card processing. if the organizer cancels or makes a big change, you get all of it back.";

async function loadSellableTiers(eventId: string): Promise<SellableTier[]> {
  const all = await getTiers(eventId);
  const onSale = all.filter((t) => t.status === 'on_sale' && t.visibility !== 'hidden');
  return Promise.all(
    onSale.map(async (tier) => {
      const { data: left } = await supabase.rpc('get_ticket_tier_availability', { p_tier_id: tier.id });
      const remaining = typeof left === 'number' ? left : null;
      const counted = tier.quantity_cap !== null && remaining !== null;
      const soldOut = counted && (remaining as number) <= 0;
      const underMinimum = counted && !soldOut && (remaining as number) < tierMin(tier);
      return { tier, remaining, soldOut, underMinimum };
    }),
  );
}

interface TicketCheckoutSheetProps {
  visible: boolean;
  eventId: string;
  onClose: () => void;
  /** a free ticket confirms in-session -> the caller opens order-complete */
  onFreeConfirmed: (orderId: string) => void;
}

export function TicketCheckoutSheet({ visible, eventId, onClose, onFreeConfirmed }: TicketCheckoutSheetProps) {
  const [tiers, setTiers] = useState<SellableTier[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setProblem(null);
    loadSellableTiers(eventId).then((rows) => {
      setTiers(rows);
      // a blocked tier is never the default selection (doc 109)
      const first = rows.find((r) => !r.soldOut && !r.underMinimum) ?? null;
      setSelectedId(first?.tier.id ?? null);
      setQty(first ? tierMin(first.tier) : 1);
    });
  }, [visible, eventId]);

  const selectedRow = tiers?.find((r) => r.tier.id === selectedId) ?? null;
  const selected = selectedRow?.tier ?? null;
  // the stepper's floor is the tier's minimum (doc 109); its ceiling is the
  // per-order max, never past what actually remains on a counted tier
  const qtyMin = selected ? tierMin(selected) : 1;
  const perOrderMax = selected?.per_order_max ?? 10;
  const qtyMax = Math.max(
    qtyMin,
    selectedRow?.remaining != null && selected?.quantity_cap != null
      ? Math.min(perOrderMax, selectedRow.remaining)
      : perOrderMax,
  );
  // §3: the 30 cent fixed fee is per ORDER, so the shown total runs the
  // formula over the order's combined face, never per-ticket-times-qty
  // (2 x $20 charges $41.51; the old multiply showed $41.82). The
  // per-ticket "each" line below stays per-unit by design.
  const allIn = selected ? computeFeePreview(selected.price_cents * qty, 0).buyerTotalCents : 0;
  const isFree = selected?.price_cents === 0;
  // a free tier with a real minimum still needs the stepper (doc 109);
  // a plain free tier keeps its one-tap reserve
  const showStepper = !!selected && (!isFree || qtyMin > 1);

  const handleGo = async () => {
    if (!selected || busy) return;
    hapticLight();
    setBusy(true);
    setProblem(null);
    const result = await startTicketCheckout(selected.id, qty);
    setBusy(false);
    if (result.kind === 'error') {
      hapticError();
      setProblem(result.message);
      return;
    }
    if (result.kind === 'free') {
      hapticSuccess();
      onFreeConfirmed(result.orderId);
      return;
    }
    // paid: hand off to hosted Stripe Checkout
    hapticSuccess();
    openUrl(result.url);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.headerRow}>
            {/* copy to the taste gate */}
            <Text style={styles.title}>get tickets</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <X size={22} color={Colors.textMedium} strokeWidth={2} />
            </TouchableOpacity>
          </View>

          {tiers === null ? (
            <ActivityIndicator size="small" color={EventAction.primary} style={styles.loading} />
          ) : tiers.length === 0 ? (
            /* copy to the taste gate */
            <Text style={styles.empty}>tickets are not on sale right now.</Text>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {tiers.map(({ tier, soldOut, underMinimum }) => {
                const active = tier.id === selectedId;
                const blocked = soldOut || underMinimum;
                const each = computeFeePreview(tier.price_cents, 0).buyerTotalCents;
                const min = tierMin(tier);
                return (
                  <TouchableOpacity
                    key={tier.id}
                    style={[styles.tier, active && styles.tierActive, blocked && styles.tierBlocked]}
                    onPress={() => {
                      hapticLight();
                      setSelectedId(tier.id);
                      setQty(min);
                    }}
                    disabled={blocked}
                    accessibilityState={{ disabled: blocked, selected: active }}
                    activeOpacity={0.85}
                  >
                    <View style={styles.tierBody}>
                      <Text style={[styles.tierName, blocked && styles.tierTextBlocked]}>{tier.name}</Text>
                      {!!tier.description && !blocked && <Text style={styles.tierDesc}>{tier.description}</Text>}
                      {/* doc 109: a real minimum names itself on the card */}
                      {min > 1 && !blocked && (
                        /* copy to the taste gate */
                        <Text style={styles.tierMinNote}>{min} ticket minimum</Text>
                      )}
                      {soldOut && (
                        /* copy to the taste gate */
                        <Text style={styles.tierBlockedNote}>sold out</Text>
                      )}
                      {underMinimum && (
                        /* RULED copy (doc 109): the buyer never reaches the server 409 */
                        <Text style={styles.tierBlockedNote}>not enough left for this ticket's minimum</Text>
                      )}
                    </View>
                    <Text style={[styles.tierPrice, blocked && styles.tierTextBlocked]}>
                      {tier.price_cents === 0 ? 'free' : formatCents(each)}
                    </Text>
                  </TouchableOpacity>
                );
              })}

              {showStepper && (
                <View style={styles.qtyRow}>
                  {/* copy to the taste gate */}
                  <Text style={styles.qtyLabel}>how many</Text>
                  <View style={styles.stepper}>
                    <TouchableOpacity
                      onPress={() => { hapticLight(); setQty((q) => Math.max(qtyMin, q - 1)); }}
                      hitSlop={8}
                      style={styles.stepBtn}
                    >
                      <Minus size={16} color={Colors.darkWarm} strokeWidth={2.5} />
                    </TouchableOpacity>
                    <Text style={styles.qtyValue}>{qty}</Text>
                    <TouchableOpacity
                      onPress={() => { hapticLight(); setQty((q) => Math.min(qtyMax, q + 1)); }}
                      hitSlop={8}
                      style={styles.stepBtn}
                    >
                      <Plus size={16} color={Colors.darkWarm} strokeWidth={2.5} />
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {!!problem && <Text style={styles.problem}>{problem}</Text>}

              <TouchableOpacity
                style={[styles.cta, (!selected || busy) && styles.ctaDisabled]}
                onPress={handleGo}
                disabled={!selected || busy}
                activeOpacity={0.85}
              >
                {busy ? (
                  <ActivityIndicator size="small" color={EventAction.onPrimary} />
                ) : (
                  <Text style={styles.ctaText}>
                    {/* law 9: the all-in total, fees included, before the handoff */}
                    {isFree ? 'reserve' : `pay ${formatCents(allIn)}`}
                  </Text>
                )}
              </TouchableOpacity>
              {!isFree && !!selected && (
                <>
                  {/* copy to the taste gate */}
                  <Text style={styles.feesNote}>all in, fees included. you pay on the next screen.</Text>
                  {/* the §5 processing-treatment disclosure, stated AT checkout
                      (doc 96); free tiers have no money to disclose */}
                  <Text style={styles.refundNote}>{CHECKOUT_REFUND_DISCLOSURE}</Text>
                </>
              )}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: Colors.overlayDark, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.parchment,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 34,
    maxHeight: '85%',
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: EventSpacing.md },
  title: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  loading: { marginVertical: EventSpacing.lg },
  empty: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium, marginVertical: EventSpacing.md },
  tier: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.white,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    padding: 14,
    marginBottom: EventSpacing.sm,
  },
  tierActive: { borderColor: EventAction.primary },
  // sold-out style (doc 109): quiet, never selectable, no new accents
  tierBlocked: { opacity: 0.55 },
  tierTextBlocked: { color: Colors.textLight },
  tierMinNote: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  tierBlockedNote: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  tierBody: { flex: 1, gap: 2 },
  tierName: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  tierDesc: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  tierPrice: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: EventSpacing.sm, marginBottom: EventSpacing.sm },
  qtyLabel: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  stepBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyValue: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt, minWidth: 20, textAlign: 'center' },
  problem: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: EventAction.error, marginTop: EventSpacing.sm },
  cta: {
    backgroundColor: EventAction.primary,
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: EventSpacing.md,
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: EventAction.onPrimary },
  feesNote: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium, textAlign: 'center', marginTop: EventSpacing.sm },
  refundNote: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium, textAlign: 'center', marginTop: EventSpacing.xs },
});
