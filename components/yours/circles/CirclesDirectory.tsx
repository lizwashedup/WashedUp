/**
 * CirclesDirectory - the Yours > Circles tab body. A list of rich cards for the
 * circles you're in, each deep-linking to the circle home, with a summary header
 * card (count, tagline, branded "New circle" button) pinned at the top. Full
 * loading / error / empty coverage.
 *
 * Gated by GROUPS_ENABLED upstream (the Circles tab only mounts when on).
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  FlatList,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { COPY } from '../state/constants';
import { useMyCircles } from '../../../hooks/useMyCircles';
import { useCircleMemberPreviews } from '../../../hooks/useCircleMemberPreviews';
import { useCircleSuggestions, useSetSuggestionStatus } from '../../../hooks/useCircleSuggestions';
import { isDmCircle } from '../../../lib/circles/display';
import type { MyCircle, CircleSuggestion } from '../../../lib/circles/types';
import CircleCard from './CircleCard';
import CirclesSummaryHeader from './CirclesSummaryHeader';
import CirclesEmptyState from './CirclesEmptyState';
import SuggestionCard from './SuggestionCard';

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
  const [retryPressed, setRetryPressed] = useState(false);
  const { data: rawCircles = [], isLoading, isError, refetch, isRefetching } =
    useMyCircles(userId);
  // DMs are unnamed 2-person circles; they live in Chats, not this directory.
  const circles = rawCircles.filter((c) => !isDmCircle(c.name, c.member_count));
  // Member faces for the cards' overlapping-avatar rows. Degrades quietly: if it
  // fails, cards still render their tile + name + meta.
  const { data: memberPreviews = {} } = useCircleMemberPreviews(
    circles.map((c) => c.id),
    userId,
  );
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
      <CirclesSummaryHeader count={circles.length} onCreate={onCreate} />
      {suggestions.map((s) => (
        <SuggestionCard
          key={s.id}
          suggestion={s}
          onStart={onStartSuggestion}
          onDismiss={onDismissSuggestion}
        />
      ))}
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
          onPressIn={() => setRetryPressed(true)}
          onPressOut={() => setRetryPressed(false)}
          style={[styles.retry, retryPressed && styles.rowPressed]}
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
        <CircleCard
          circle={item}
          members={memberPreviews[item.id] ?? []}
          onPress={onOpenCircle}
        />
      )}
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
  rowPressed: { backgroundColor: Colors.warmTint },
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
