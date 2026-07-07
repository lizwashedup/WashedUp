/**
 * One community = one card in Chats (doc 09: the WhatsApp Communities
 * container). Name, latest broadcast preview, one unread badge across
 * broadcasts and topics. The accent color is the community's own, the
 * opt-in branding made visible. Functionally minimal per decision 15a.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import type { CommunityChatCard as CardData } from '../../lib/communityChat';

interface Props {
  card: CardData;
  onPress: () => void;
}

export function CommunityChatCard({ card, onPress }: Props) {
  return (
    <TouchableOpacity
      style={[styles.card, card.accent_color ? { borderLeftColor: card.accent_color } : null]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>{card.name}</Text>
        <Text style={styles.preview} numberOfLines={1}>
          {card.latest_broadcast?.body ?? 'you are in. the leader posts here first.'}
        </Text>
      </View>
      {card.unread_total > 0 && (
        <View style={styles.unreadDot}>
          <Text style={styles.unreadText}>{card.unread_total > 99 ? '99' : card.unread_total}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    borderLeftWidth: 3,
    borderLeftColor: Colors.gold,
    padding: 14,
    marginBottom: 8,
  },
  text: { flex: 1 },
  name: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  preview: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary, marginTop: 2 },
  unreadDot: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.terracotta,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  unreadText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.caption, color: Colors.white },
});
