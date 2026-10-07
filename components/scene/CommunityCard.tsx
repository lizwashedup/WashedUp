/**
 * The community card, reference anatomy (Liz's second sim pass, doc 37
 * amended): cover on top; the founder's FACE CHIP overlapping the
 * cover/text boundary — larger than the corner chip, it is the trust
 * element (face as ingredient, never the whole card); then name,
 * "by <first name>", the member line (social-proof threshold: a raw count
 * only from five up), and the creator's own one-line message, quoted like
 * a plan's line. The message renders tagline ?? trimmed description —
 * self-flipping when proposal 46 lands; the full description stays inside
 * on the community page.
 */

import React, { useState } from 'react';
import { PublishedPageCover } from '../creator/pages/PublishedPageCover';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import Colors, { SceneDetailColors as Scene } from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { HOUSE_MARK_LABEL, isHouseCommunity } from '../../lib/houseCommunity';
import { MEMBER_COUNT_THRESHOLD } from '../../lib/socialProof';
import type { DiscoverableCommunity } from '../../lib/sceneDiscovery';
import type { LeaderCard } from '../../lib/communityLeader';

const COVER_HEIGHT = 120;
const FACE_CHIP = 40;

interface CommunityCardProps {
  community: DiscoverableCommunity;
  leaderCard: LeaderCard | null;
  width: number;
  surface?: 'light' | 'scene';
  onPress: () => void;
}

export function CommunityCard({ community: c, leaderCard, width, onPress, surface = 'light' }: CommunityCardProps) {
  const [brokenCover, setBrokenCover] = useState<string | null>(null);
  const sunset = surface === 'scene';
  const coverHeight = sunset ? width : COVER_HEIGHT;
  const textColor = sunset ? { color: Scene.text } : undefined;
  const mutedColor = sunset ? { color: Scene.supporting } : undefined;
  const message = (c.tagline ?? c.description ?? '').trim();
  const firstName = leaderCard?.display_name?.trim().split(/\s+/)[0] ?? null;
  return (
    <TouchableOpacity style={[styles.card, { width }, sunset && { backgroundColor: Scene.surface, borderColor: Scene.border, borderRadius: 8 }]} onPress={onPress} activeOpacity={0.85}
      accessibilityRole="button" accessibilityLabel={`${c.name}, community${message ? `. ${message}` : ''}`}>
      {c.cover_media_id ? <PublishedPageCover pageId={c.id} mediaId={c.cover_media_id} height={coverHeight} surface={surface} /> : c.cover_image && brokenCover !== c.cover_image ? (
        <Image source={{ uri: c.cover_image }} style={[styles.cover, { height: coverHeight }]} contentFit="cover" onError={() => setBrokenCover(c.cover_image)} />
      ) : (
        <View style={[styles.cover, { height: coverHeight, backgroundColor: sunset ? Scene.middle : c.accent_color ?? Colors.accentSubtle, alignItems: 'center', justifyContent: 'center' }]}>
          {sunset && <Text accessible={false} style={[styles.name, { color: Scene.text }]}>{c.name.slice(0, 1).toUpperCase()}</Text>}
        </View>
      )}
      {!!leaderCard?.avatar_url && (
        <Image source={{ uri: leaderCard.avatar_url }} style={[styles.faceChip, { top: coverHeight - FACE_CHIP / 2 }]} contentFit="cover" />
      )}
      <View style={[styles.body, !leaderCard?.avatar_url && { paddingTop: 12 }]}>
        {isHouseCommunity(c.handle) && <Text style={[styles.houseMark, textColor]}>{HOUSE_MARK_LABEL}</Text>}
        <Text style={[styles.name, textColor]} numberOfLines={2}>{c.name}</Text>
        {!!firstName && (
          /* decision 16 adjacent: the person is visible and accountable */
          <Text style={[styles.byLine, mutedColor]}>by {firstName.toLowerCase()}</Text>
        )}
        <Text style={[styles.memberLine, mutedColor]}>
          {c.member_count >= MEMBER_COUNT_THRESHOLD
            ? `${c.member_count} in`
            : /* LIZ COPY: warmth instead of arithmetic under the threshold */ 'founding members'}
        </Text>
        {!!message && (
          <Text style={[styles.message, mutedColor]} numberOfLines={1}>
            {message}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  cover: { width: '100%', height: COVER_HEIGHT },
  faceChip: {
    position: 'absolute',
    left: 14,
    top: COVER_HEIGHT - FACE_CHIP / 2,
    width: FACE_CHIP,
    height: FACE_CHIP,
    borderRadius: FACE_CHIP / 2,
    borderWidth: 2,
    borderColor: Colors.white,
    backgroundColor: Colors.cardBg,
  },
  body: { paddingHorizontal: 14, paddingBottom: 12, paddingTop: FACE_CHIP / 2 + 6 },
  houseMark: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1,
    marginBottom: 2,
  },
  name: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  byLine: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.secondary, marginTop: 1 },
  memberLine: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.secondary, marginTop: 4 },
  // the plan-card quoted-line treatment, sized for the card
  message: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.quoteText,
    borderLeftWidth: 2,
    borderLeftColor: Colors.goldAccent,
    paddingLeft: 8,
    marginTop: 8,
  },
});
