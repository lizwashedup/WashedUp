import { ScaledText } from '../../ScaledText';
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../../constants/Typography';
import YoursAvatar from '../primitives/YoursAvatar';
import { COPY } from '../state/constants';

/** Shared backlog / search result row. */
export default function PersonRow({
  name,
  photoUrl,
  sharedCount,
  state,
  onAdd,
  onPressPerson,
  appearance,
  isAdding = false,
}: {
  name: string | null;
  photoUrl: string | null;
  sharedCount: number;
  /* 'none' shows Add; 'requested' shows Requested; 'connected' hides CTA.
   * The staged incoming row opens the existing profile; it does not promise
   * request decisions on that destination. Pending requests use isAdding. */
  state: 'none' | 'requested' | 'incoming' | 'connected';
  onAdd: () => void;
  onPressPerson: () => void;
  appearance?: { fonts: AfterglowFontFamilies };
  isAdding?: boolean;
}) {
  const displayName = name?.trim() || 'Someone';
  const fonts = appearance?.fonts;
  const { width, fontScale } = useWindowDimensions();
  const [rowWidth, setRowWidth] = useState<number | null>(null);
  // Reserve readable name space beside the portrait. At larger text sizes,
  // move the action below the identity rather than squeezing the name.
  const actionBelow = state !== 'connected' && (rowWidth ?? width - 40) < 78 + 184 * fontScale;

  if (fonts) {
    return (
      <View style={[afterglow.row, actionBelow && afterglow.stackedRow]} onLayout={event => {
        const available = event.nativeEvent.layout.width;
        if (Number.isFinite(available) && available > 0) setRowWidth(available);
      }}>
        <Pressable
          style={[afterglow.person, actionBelow && afterglow.stackedPerson]}
          onPress={onPressPerson}
          accessibilityRole="button"
          accessibilityLabel={`View ${displayName}`}
        >
          <PersonPhoto key={`${displayName}:${photoUrl ?? ''}`} name={displayName} photoUrl={photoUrl} fonts={fonts} />
          <View style={afterglow.mid}>
            <ScaledText style={[afterglow.name, { fontFamily: fonts.semibold }]}>{displayName}</ScaledText>
            {sharedCount > 0 && (
              <ScaledText style={[afterglow.meta, { fontFamily: fonts.regular }]} numberOfLines={1}>
                {sharedCount === 1 ? '1 shared plan' : `${sharedCount} shared plans`}
              </ScaledText>
            )}
          </View>
        </Pressable>
        {state !== 'connected' && <View style={actionBelow ? afterglow.actionBelow : undefined}>{state === 'none' ? (
          <Pressable
            style={[afterglow.addBtn, isAdding && afterglow.pendingBtn]}
            onPress={onAdd}
            disabled={isAdding}
            accessibilityRole="button"
            accessibilityLabel={isAdding ? `Sending request to ${displayName}` : `Add ${displayName}`}
            accessibilityState={{ disabled: isAdding, busy: isAdding }}
          >
            <ScaledText style={[afterglow.addText, { fontFamily: fonts.semibold }]} numberOfLines={actionBelow ? undefined : 1}>
              {isAdding ? 'Sending…' : COPY.addButton}
            </ScaledText>
          </Pressable>
        ) : state === 'incoming' ? (
          <Pressable
            style={afterglow.respondBtn}
            onPress={onPressPerson}
            accessibilityRole="button"
            accessibilityLabel={`View profile for ${displayName}`}
          >
            <ScaledText style={[afterglow.respondText, { fontFamily: fonts.semibold }]} numberOfLines={1}>View</ScaledText>
          </Pressable>
        ) : state === 'requested' ? (
          <ScaledText style={[afterglow.requested, { fontFamily: fonts.medium }]} accessibilityLiveRegion="polite">
            {COPY.stateRequested}
          </ScaledText>
        ) : null}</View>}
      </View>
    );
  }
  return (
    <Pressable style={styles.row} onPress={onPressPerson}>
      <YoursAvatar
        name={name}
        photoUrl={photoUrl}
        size={48}
        bucket="none"
      />
      <View style={styles.mid}>
        <Text style={styles.name} numberOfLines={1}>
          {name ?? 'Someone'}
        </Text>
        {sharedCount > 0 && (
          <Text style={styles.meta}>
            {COPY.backlogPlansTogether(sharedCount)}
          </Text>
        )}
      </View>
      {state === 'none' ? (
        <Pressable
          style={styles.addBtn}
          onPress={(event) => { event.stopPropagation(); onAdd(); }}
          disabled={isAdding}
          accessibilityState={{ disabled: isAdding, busy: isAdding }}
          accessibilityRole="button"
          accessibilityLabel={`${COPY.addButton} ${name ?? ''}`}
        >
          <Text style={styles.addText} numberOfLines={1}>{isAdding ? 'Sending…' : COPY.addButton}</Text>
        </Pressable>
      ) : state === 'requested' ? (
        <Text style={styles.requested}>{COPY.stateRequested}</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
  },
  mid: { flex: 1 },
  name: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  meta: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    marginTop: 2,
  },
  addBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 8,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.white,
  },
  requested: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.tertiary,
  },
});

function PersonPhoto({ name, photoUrl, fonts }: { name: string; photoUrl: string | null; fonts: AfterglowFontFamilies }) {
  const [failed, setFailed] = useState(false);
  return (
    <View style={afterglow.avatar}>
      {photoUrl && !failed ? (
        <Image source={{ uri: photoUrl }} style={afterglow.photo} contentFit="cover" cachePolicy="memory-disk"
          recyclingKey={photoUrl} onError={() => setFailed(true)} accessible={false} />
      ) : (
        <ScaledText style={[afterglow.initial, { fontFamily: fonts.semibold }]} accessible={false}>{name.slice(0, 1).toUpperCase()}</ScaledText>
      )}
    </View>
  );
}

const afterglow = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 82, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: AfterglowColors.subtleLine, backgroundColor: AfterglowColors.paper },
  stackedRow: { flexDirection: 'column', alignItems: 'stretch', gap: 0, paddingBottom: 12 },
  stackedPerson: { flex: 0 },
  actionBelow: { marginLeft: 66, alignSelf: 'stretch', alignItems: 'flex-start' },
  person: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, minHeight: 82 },
  avatar: { flexShrink: 0, width: 54, height: 54, borderRadius: 27, overflow: 'hidden', backgroundColor: AfterglowColors.avatar, alignItems: 'center', justifyContent: 'center' },
  photo: { width: 54, height: 54, opacity: 1 },
  initial: { ...AfterglowType.contextTitle, color: AfterglowColors.muted },
  mid: { flex: 1, minWidth: 0 },
  name: { ...AfterglowType.title, color: AfterglowColors.ink },
  meta: { ...AfterglowType.body, color: AfterglowColors.muted, marginTop: 3 },
  addBtn: { maxWidth: '100%', minWidth: 54, minHeight: 44, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 5, backgroundColor: AfterglowColors.clay, alignItems: 'center', justifyContent: 'center' },
  pendingBtn: { backgroundColor: AfterglowColors.muted },
  addText: { ...AfterglowType.section, color: AfterglowColors.white, textAlign: 'center' },
  respondBtn: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' },
  respondText: { ...AfterglowType.section, color: AfterglowColors.clay },
  requested: { ...AfterglowType.caption, color: AfterglowColors.muted, flexShrink: 0 },
});
