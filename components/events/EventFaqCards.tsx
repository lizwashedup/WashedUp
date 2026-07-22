/**
 * The good-to-know cards (doc 61 §4c, doc 76): organizer-authored Q/A
 * rendered at the body's faq marker, or after the body when no marker
 * is placed (70's block-order default). Public read is Live-only
 * server-side; an empty read renders nothing.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { hapticLight } from '../../lib/haptics';
import { supabase } from '../../lib/supabase';

interface EventFaq {
  id: string;
  question: string;
  answer: string;
}

interface EventFaqCardsProps {
  eventId: string;
}

export function EventFaqCards({ eventId }: EventFaqCardsProps) {
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: faqs = [] } = useQuery({
    queryKey: ['event-faq-cards', eventId],
    queryFn: async () => {
      const { data } = await supabase
        .from('event_faqs')
        .select('id, question, answer')
        .eq('event_id', eventId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      return (data ?? []) as EventFaq[];
    },
    staleTime: 60_000,
  });

  if (faqs.length === 0) return null;

  return (
    <View style={styles.section}>
      {/* copy to the taste gate (doc 76 §2) */}
      <Text style={styles.sectionTitle}>good to know</Text>
      {faqs.map((faq) => {
        const open = openId === faq.id;
        return (
          <TouchableOpacity
            key={faq.id}
            style={styles.card}
            onPress={() => {
              hapticLight();
              setOpenId(open ? null : faq.id);
            }}
            activeOpacity={0.85}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.question}>{faq.question}</Text>
              <ChevronDown
                size={16}
                color={Colors.warmGray}
                strokeWidth={2}
                style={open ? styles.chevronOpen : undefined}
              />
            </View>
            {open && <Text style={styles.answer}>{faq.answer}</Text>}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8, marginTop: 8 },
  sectionTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.displaySM, color: Colors.asphalt, marginBottom: 2 },
  card: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.inputBg,
    padding: 14,
    gap: 8,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  question: { flex: 1, fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  chevronOpen: { transform: [{ rotate: '180deg' }] },
  answer: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium, lineHeight: 21 },
});
