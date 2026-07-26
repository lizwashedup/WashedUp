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
import {
  computeFeePreview,
  formatCents,
  getTiers,
  startTicketCheckout,
  type TicketTier,
} from '../../lib/ticketing';

interface TicketCheckoutSheetProps {
  visible: boolean;
  eventId: string;
  onClose: () => void;
  /** a free ticket confirms in-session -> the caller opens order-complete */
  onFreeConfirmed: (orderId: string) => void;
}

export function TicketCheckoutSheet({ visible, eventId, onClose, onFreeConfirmed }: TicketCheckoutSheetProps) {
  const [tiers, setTiers] = useState<TicketTier[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setProblem(null);
    setQty(1);
    getTiers(eventId).then((all) => {
      const onSale = all.filter((t) => t.status === 'on_sale' && t.visibility !== 'hidden');
      setTiers(onSale);
      setSelectedId(onSale[0]?.id ?? null);
    });
  }, [visible, eventId]);

  const selected = tiers?.find((t) => t.id === selectedId) ?? null;
  const perOrderMax = selected?.per_order_max ?? 10;
  const allIn = selected ? computeFeePreview(selected.price_cents, 0).buyerTotalCents * qty : 0;
  const isFree = selected?.price_cents === 0;

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
              {tiers.map((tier) => {
                const active = tier.id === selectedId;
                const each = computeFeePreview(tier.price_cents, 0).buyerTotalCents;
                return (
                  <TouchableOpacity
                    key={tier.id}
                    style={[styles.tier, active && styles.tierActive]}
                    onPress={() => {
                      hapticLight();
                      setSelectedId(tier.id);
                      setQty(1);
                    }}
                    activeOpacity={0.85}
                  >
                    <View style={styles.tierBody}>
                      <Text style={styles.tierName}>{tier.name}</Text>
                      {!!tier.description && <Text style={styles.tierDesc}>{tier.description}</Text>}
                    </View>
                    <Text style={styles.tierPrice}>
                      {tier.price_cents === 0 ? 'free' : formatCents(each)}
                    </Text>
                  </TouchableOpacity>
                );
              })}

              {!!selected && !isFree && (
                <View style={styles.qtyRow}>
                  {/* copy to the taste gate */}
                  <Text style={styles.qtyLabel}>how many</Text>
                  <View style={styles.stepper}>
                    <TouchableOpacity
                      onPress={() => { hapticLight(); setQty((q) => Math.max(1, q - 1)); }}
                      hitSlop={8}
                      style={styles.stepBtn}
                    >
                      <Minus size={16} color={Colors.darkWarm} strokeWidth={2.5} />
                    </TouchableOpacity>
                    <Text style={styles.qtyValue}>{qty}</Text>
                    <TouchableOpacity
                      onPress={() => { hapticLight(); setQty((q) => Math.min(perOrderMax, q + 1)); }}
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
                /* copy to the taste gate */
                <Text style={styles.feesNote}>all in, fees included. you pay on the next screen.</Text>
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
});
