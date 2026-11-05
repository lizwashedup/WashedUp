import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { type AfterglowFontFamilies } from '../../../../constants/Typography';
import { COMMUNITIES_ENABLED, CREATOR_PAGES_ENABLED } from '../../../../constants/FeatureFlags';
import type { CreatorAccess } from '../../../../lib/creatorMode';
import type { OperatorGrant } from '../../../../lib/operatorApplications';
import type { ProfileSettingsStyles } from './profileSettingsStyles';

type Props = {
  styles: ProfileSettingsStyles;
  appearance?: { fonts: AfterglowFontFamilies };
  accent: string;
  muted: string;
  creatorError: boolean;
  loadingCreators: boolean;
  creatorAccess: CreatorAccess | null;
  organizerName: string | null;
  pendingGrants: OperatorGrant[];
  fetchCreatorEntries: () => Promise<void>;
  canUseProfile: () => boolean;
  navigate: (href: string, replace?: boolean) => void;
};

/** One management entry; Profile retains creator reads and account/visit guards. */
export function ProfileCreatorSection({ styles, accent, creatorError,
  loadingCreators, creatorAccess, pendingGrants, fetchCreatorEntries,
  canUseProfile, navigate }: Props) {
  return <>
    {creatorError && <View style={styles.settingsGroup}>
      <Text style={styles.statusText}>Some creator details couldn’t load.</Text>
      <TouchableOpacity style={styles.retryButton} accessibilityRole="button"
        accessibilityLabel="Try again to load creator spaces" disabled={loadingCreators}
        onPress={() => { void fetchCreatorEntries(); }}>
        <Text style={styles.retryText}>{loadingCreators ? 'Checking…' : 'Try again'}</Text>
      </TouchableOpacity>
    </View>}
    {(CREATOR_PAGES_ENABLED || COMMUNITIES_ENABLED || creatorAccess || pendingGrants.length > 0) && <>
      <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>You manage</Text></View>
      <View style={styles.settingsGroup}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Open your management tools"
          style={styles.settingsRow} onPress={() => { if (canUseProfile()) navigate('/(tabs)/friends/manage'); }}>
          <View style={styles.settingsLabelStack}>
            <Text style={styles.settingsLabel}>Communities & events</Text>
            <Text style={styles.creatorLifecycleBadge}>Manage your spaces and check application status</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={accent} />
        </TouchableOpacity>
      </View>
    </>}
  </>;
}
