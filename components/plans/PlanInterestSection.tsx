import React from 'react';
import { ActivityIndicator, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { ScaledText as Text } from '../ScaledText';
import Colors from '../../constants/Colors';
import type { usePlanInterest } from '../../hooks/usePlanInterest';
import type { legacyStyles } from './planDetailStyles';

type InterestedPerson = {
  signal_id: string;
  interested_photo_url?: string | null;
  interested_name?: string | null;
};
type Props = {
  styles: typeof legacyStyles;
  creatorName?: string | null;
  canShowInterestButton: boolean;
  interestAvailable: boolean;
  interestAlreadySent: boolean;
  isCreator: boolean;
  isMember: boolean;
  interest: ReturnType<typeof usePlanInterest>;
  creatorInterestQuery: { isError: boolean; isFetching: boolean; refetch: () => unknown };
  creatorInterestList: InterestedPerson[];
};

/** Display only. Account, visit, eligibility and write ownership stay in the route. */
export function PlanInterestSection({
  styles, creatorName, canShowInterestButton, interestAvailable,
  interestAlreadySent, isCreator, isMember, interest,
  creatorInterestQuery, creatorInterestList,
}: Props) {
  return <>
    {/* F-2. Next Time! — interest signal button (non-creator, non-member, plan still upcoming) */}
    {canShowInterestButton && (
      <View>
      <Text style={[styles.ctaSub,{marginBottom:10}]}>Can’t make this one? Let {creatorName ?? 'the creator'} know you’d join another time.</Text>
      <TouchableOpacity
        style={styles.interestButton}
        accessibilityRole="button"
        accessibilityLabel={`Tell ${creatorName ?? 'them'} I would go next time`}
        onPress={() => {void interest.send();}}
        activeOpacity={0.8}
        disabled={interest.busy}
      >
        {interest.busy ? (
          <ActivityIndicator size="small" color={Colors.quoteText} />
        ) : (
          <>
            <Ionicons name="heart-outline" size={18} color={Colors.quoteText} />
            <Text numberOfLines={1} style={styles.interestButtonText}>Next time</Text>
          </>
        )}
      </TouchableOpacity>
      </View>
    )}
    {(interestAvailable || interest.phase === 'unknown' || interest.busy) && (interest.error || interest.phase) && (
      <View style={{marginBottom:16}}>
        <Text accessibilityLiveRegion="polite" style={[styles.ctaSub,{marginBottom:8}]}>{interest.busy ? 'Saving your interest…' : interest.error ?? 'Check your interest before trying again.'}</Text>
        {!interest.busy && <TouchableOpacity accessibilityRole="button" disabled={interest.loading} onPress={()=>{void interest.retry();}} style={styles.interestButton}>
          <Text numberOfLines={1} style={styles.interestButtonText}>{interest.loading ? 'Checking…' : interest.phase === 'unknown' ? 'Check interest' : 'Try again'}</Text>
        </TouchableOpacity>}
      </View>
    )}
    {interestAlreadySent && !isCreator && !isMember && (
      <View style={styles.interestSent}>
        <Ionicons name="checkmark-circle" size={18} color={Colors.quoteText} />
        <Text style={styles.interestSentText}>
          Interest saved
        </Text>
      </View>
    )}

    {isCreator && creatorInterestQuery.isError && <View style={styles.creatorInterestBlock}>
      <Text style={styles.ctaSub}>Couldn’t load who would go next time.</Text>
      <TouchableOpacity accessibilityRole="button" disabled={creatorInterestQuery.isFetching} onPress={()=>{void creatorInterestQuery.refetch();}}>
        <Text style={styles.interestButtonText}>Try again</Text>
      </TouchableOpacity>
    </View>}
    {/* F-3. Next Time! — creator-only "Would go next time" section */}
    {isCreator && creatorInterestList.length > 0 && (
      <View style={styles.creatorInterestBlock}>
        <Text style={styles.creatorInterestTitle}>Would go next time</Text>
        <View style={styles.memberAvatarRow}>
          {creatorInterestList.map((row) => (
            <View key={row.signal_id} style={styles.memberAvatarWrapper}>
              {row.interested_photo_url ? (
                <Image source={{ uri: row.interested_photo_url }} style={styles.memberAvatar} />
              ) : (
                <View style={[styles.memberAvatar, styles.memberAvatarPlaceholder]}>
                  <Text style={styles.memberAvatarInitial}>
                    {row.interested_name?.[0]?.toUpperCase() ?? '?'}
                  </Text>
                </View>
              )}
              <Text style={styles.memberAvatarName} numberOfLines={1}>
                {row.interested_name ?? 'Someone'}
              </Text>
            </View>
          ))}
        </View>
        <Text style={styles.creatorInterestSub}>
          {creatorInterestList.length === 1
            ? '1 person wants to go next time'
            : `${creatorInterestList.length} people want to go next time`}
        </Text>
      </View>
    )}

  </>;
}
