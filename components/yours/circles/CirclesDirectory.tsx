/**
 * CirclesDirectory - the Yours > Circles tab body. A thin list of the circles
 * you're in, each deep-linking to the circle home, with a first-class "make a
 * circle" affordance pinned at the top. Full loading / error / empty coverage.
 *
 * Gated by GROUPS_ENABLED upstream (the Circles tab only mounts when on).
 */
import React from 'react';
import {
  View,
  Text,
  Pressable,
  FlatList,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Plus } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { CIRCLE } from '../../../constants/YoursDesign';
import { COPY } from '../state/constants';
import { hapticSelection } from '../../../lib/haptics';
import { useMyCircles } from '../../../hooks/useMyCircles';
import { useCircleSuggestions, useSetSuggestionStatus } from '../../../hooks/useCircleSuggestions';
import type { MyCircle, CircleSuggestion } from '../../../lib/circles/types';
import CircleRow from './CircleRow';
import CirclesEmptyState from './CirclesEmptyState';
import SuggestionCard from './SuggestionCard';

/** First-class "make a circle" affordance, shaped like a directory row. */
function CreateCircleRow({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        hapticSelection();
        onPress();
      }}
      style={({ pressed }) => [styles.createRow, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={COPY.circleMakeCta}
    >
      <View style={styles.createTile}>
        <Plus size={CIRCLE.createIcon} color={Colors.terracotta} strokeWidth={2.5} />
      </View>
      <View style={styles.createBody}>
        <Text style={styles.createTitle}>{COPY.circleMakeCta}</Text>
        <Text style={styles.createSub}>{COPY.circleMakeSub}</Text>
      </View>
    </Pressable>
  );
}

export default function CirclesDirectory({
  userId,
  hasPeople,
  onOpenCircle,
  onCreate,
  onAddPeople,
}: {
  userId: string;
  hasPeople: boolean;
  onOpenCircle: (id: string) => void;
  onCreate: () => void;
  onAddPeople: () => void;
}) {
  const router = useRouter();
  const { data: circles = [], isLoading, isError, refetch, isRefetching } =
    useMyCircles(userId);
  // Suggestions degrade quietly: if they fail to load the directory still works.
  const { data: suggestions = [] } = useCircleSuggestions(userId);
  const setSuggestionStatus = useSetSuggestionStatus(userId);

  const onStartSuggestion = (s: CircleSuggestion) => {
    const seed = s.suggested_user_ids.join(',');
    router.push(`/circle/new?seed=${seed}&suggestion=${s.id}` as never);
  };
  const onDismissSuggestion = (s: CircleSuggestion) => {
    setSuggestionStatus.mutate({ id: s.id, status: 'dismissed' });
  };

  const header = (
    <>
      {suggestions.map((s) => (
        <SuggestionCard
          key={s.id}
          suggestion={s}
          onStart={onStartSuggestion}
          onDismiss={onDismissSuggestion}
        />
      ))}
      <CreateCircleRow onPress={onCreate} />
    </>
  );

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.terracotta} />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{COPY.circlesError}</Text>
        <Pressable
          onPress={() => refetch()}
          style={({ pressed }) => [styles.retry, pressed && styles.rowPressed]}
          accessibilityRole="button"
          accessibilityLabel={COPY.circlesRetry}
        >
          <Text style={styles.retryLabel}>{COPY.circlesRetry}</Text>
        </Pressable>
      </View>
    );
  }

  // Only the truly-empty case (no circles AND no suggestions) gets the full
  // empty state; a suggestion alone is worth showing the list for.
  if (circles.length === 0 && suggestions.length === 0) {
    return (
      <CirclesEmptyState
        hasPeople={hasPeople}
        onCreate={onCreate}
        onAddPeople={onAddPeople}
      />
    );
  }

  return (
    <FlatList<MyCircle>
      data={circles}
      keyExtractor={(c) => c.id}
      ListHeaderComponent={header}
      renderItem={({ item }) => (
        <CircleRow circle={item} onPress={onOpenCircle} />
      )}
      ItemSeparatorComponent={() => <View style={styles.divider} />}
      contentContainerStyle={styles.listContent}
      refreshing={isRefetching}
      onRefresh={refetch}
      showsVerticalScrollIndicator={false}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  listContent: { paddingBottom: 32 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
    marginLeft: CIRCLE.dividerInset + CIRCLE.rowCover + CIRCLE.rowGap,
  },
  rowPressed: { backgroundColor: Colors.warmTint },
  // Create affordance
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: CIRCLE.rowVerticalPad,
    paddingHorizontal: CIRCLE.dividerInset,
  },
  createTile: {
    width: CIRCLE.rowCover,
    height: CIRCLE.rowCover,
    borderRadius: CIRCLE.rowCoverRadius,
    backgroundColor: Colors.brandSoft,
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  createBody: { flex: 1, marginLeft: CIRCLE.rowGap },
  createTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.terracotta,
  },
  createSub: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    marginTop: 3,
  },
  errorText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.secondary,
    textAlign: 'center',
    marginBottom: 16,
  },
  retry: {
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  retryLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
  },
});
