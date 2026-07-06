import React from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import BottomSheet from '../primitives/BottomSheet';
import YoursAvatar from '../primitives/YoursAvatar';
import { COPY } from '../state/constants';
import { useProfileCard } from '../../../hooks/useProfileCard';
import {
  usePeopleConnectionMutations,
  friendlyConnectionError,
} from '../../../hooks/usePeopleConnectionMutations';

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

/**
 * Minimal preview for a NOT-yet-connected person (remote search rows): face,
 * name, any shared history, and an Add button. Connected people open the full
 * profile PAGE at /profile/[id], so the former "full card" branch (gear /
 * remove / upcoming / adventures / milestone / generic invite) was unreachable
 * dead code and has been removed (WS-3: full page, not popup cards). If a
 * kind==='full' card does arrive (stale cache race), the Add button hides and
 * the sheet degrades to a read-only face + shared-history summary.
 */
export default function ProfileCardSheet({
  visible,
  onClose,
  userId,
  targetId,
}: {
  visible: boolean;
  onClose: () => void;
  userId: string;
  targetId: string | null;
}) {
  const { data: card, isLoading } = useProfileCard(userId, targetId);
  const { sendRequest } = usePeopleConnectionMutations(userId);

  return (
    <BottomSheet visible={visible} onClose={onClose} heightPct={0.8}>
      {isLoading || !card ? (
        <ActivityIndicator
          color={Colors.terracotta}
          style={{ marginVertical: 48 }}
        />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <YoursAvatar
              name={card.first_name_display}
              photoUrl={card.profile_photo_url}
              size={120}
              bucket="none"
            />
            <Text style={styles.name}>
              {card.first_name_display ?? 'Someone'}
            </Text>
            {card.shared_count > 0 ? (
              <Text style={styles.summary}>
                {`${COPY.backlogPlansTogether(card.shared_count)}${
                  card.since_date ? `, since ${fmtDate(card.since_date)}` : ''
                }`}
              </Text>
            ) : null}
          </View>

          {/* Add only when NOT yet connected. A kind==='full' card can still
              arrive through a stale backlog/paths row (e.g. the person accepted
              while this was open); offering Add to an already-accepted
              connection just round-trips into an error alert. */}
          {card.kind === 'minimal' && (
            <Pressable
              style={styles.primaryBtn}
              onPress={async () => {
                try {
                  await sendRequest.mutateAsync({
                    recipientId: card.user_id,
                    context: 'handle_lookup',
                  });
                  onClose();
                } catch (e) {
                  Alert.alert('', friendlyConnectionError(e));
                }
              }}
              accessibilityRole="button"
              accessibilityLabel={COPY.requestAdd}
            >
              <Text style={styles.primaryText}>{COPY.requestAdd}</Text>
            </Pressable>
          )}
        </ScrollView>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: 8, paddingVertical: 8 },
  name: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.displayMD,
    color: Colors.asphalt,
  },
  summary: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.secondary,
  },
  primaryBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 28,
    marginBottom: 8,
  },
  primaryText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.white,
  },
});
