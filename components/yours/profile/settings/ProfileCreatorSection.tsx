import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Fonts, type AfterglowFontFamilies } from '../../../../constants/Typography';
import { COMMUNITIES_ENABLED, CREATOR_PAGES_ENABLED } from '../../../../constants/FeatureFlags';
import { setSelectedCommunityId } from '../../../../lib/selectedCommunity';
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

/** Render the existing creator destinations; Profile owns their reads and visit. */
export function ProfileCreatorSection({ styles, appearance, accent, muted, creatorError,
  loadingCreators, creatorAccess, organizerName, pendingGrants, fetchCreatorEntries,
  canUseProfile, navigate }: Props) {
  return <>
        {creatorError && <View style={styles.settingsGroup}><Text style={styles.statusText}>Some creator details couldn’t load.</Text><TouchableOpacity style={styles.retryButton} accessibilityRole="button" accessibilityLabel="Try again to load creator spaces" disabled={loadingCreators} onPress={() => { void fetchCreatorEntries(); }}><Text style={styles.retryText}>{loadingCreators ? 'Checking…' : 'Try again'}</Text></TouchableOpacity></View>}
        {/* Creators: inventory C-01 — a real row per approved entity, not one
            collapsed row that silently picks a single destination. A creator
            who leads 2+ communities, or leads a community AND holds an
            event-host grant, previously could only ever reach ONE of those
            from here. Pending applications now show inline too, instead of
            only being visible after tapping back into the apply screen. */}
        {(() => {
          const creatorRows: {
            key: string;
            label: string;
            sublabel?: string;
            accent?: boolean;
            mark?: string;
            onPress: () => void;
          }[] = [];
          if (CREATOR_PAGES_ENABLED) {
            creatorRows.push({ key: 'pages', label: 'Creator space', accent: true,
              onPress: () => navigate('/creator/pages') });
          } else {
          // Liz, 2026-09-04 (live, over the per-community "identity mark" fix
          // above): distinguishing the rows wasn't the actual problem -- with
          // 2+ led communities, every row lands in the same creator shell
          // anyway (the CommunitySwitcher pills inside it already handle
          // switching), so having one row per community just reads as
          // duplicate buttons to the same place. Her exact words: "we need
          // one button that says go to your communities." Collapse to one
          // row once there are 2+; a single community keeps its own named
          // row since there's nothing to collapse and no ambiguity.
          const led = creatorAccess?.ledCommunities ?? [];
          if (led.length >= 2) {
            creatorRows.push({
              key: 'communities',
              label: 'go to your communities',
              accent: true,
              onPress: () => {
                setSelectedCommunityId(led[0].id);
                navigate('/(creator)/today', true);
              },
            });
          } else {
            led.forEach((c) => {
              creatorRows.push({
                key: c.id,
                label: `switch to ${c.name.toLowerCase()} & your events`,
                sublabel: c.status !== 'active' ? c.status : undefined,
                accent: true,
                mark: c.name.slice(0, 1).toLowerCase(),
                onPress: () => {
                  setSelectedCommunityId(c.id);
                  navigate('/(creator)/today', true);
                },
              });
            });
          }
          if (creatorAccess?.hasEventHostGrant) {
            creatorRows.push({
              key: 'event-host',
              label: organizerName
                ? `switch to ${organizerName.toLowerCase()} & your events`
                : 'switch to your events',
              accent: true,
              onPress: () => navigate('/(creator)/organizer-home', true),
            });
          }
          pendingGrants.forEach((g) => {
            creatorRows.push({
              key: g.id,
              label: g.track === 'event_host' ? 'putting on events' : 'starting a community',
              sublabel: g.status === 'needs_more_info' ? 'needs more info' : 'in review',
              onPress: () => navigate('/creator/apply'),
            });
          });
          if (COMMUNITIES_ENABLED) {
            creatorRows.push({
              key: 'apply',
              label: 'Run things on washedup',
              onPress: () => navigate('/creator/apply'),
            });
          }
          }
          if (creatorRows.length === 0) return null;
          return (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Creators</Text>
              </View>
              <View style={styles.settingsGroup}>
                {creatorRows.map((row, i) => (
                  <TouchableOpacity
                    key={row.key}
                    accessibilityRole="button"
                    style={[styles.settingsRow, i !== creatorRows.length - 1 && styles.settingsRowDivider]}
                    onPress={() => { if (canUseProfile()) row.onPress(); }}
                    activeOpacity={0.7}
                  >
                    {row.mark && (
                      <View style={styles.creatorRowMark}>
                        <Text style={styles.creatorRowMarkLetter}>{row.mark}</Text>
                      </View>
                    )}
                    <View style={styles.settingsLabelStack}>
                      <Text
                        style={[
                          styles.settingsLabel,
                          row.accent && { color: accent, fontFamily: appearance ? appearance.fonts.semibold : Fonts.sansBold },
                        ]}
                      >
                        {row.label}
                      </Text>
                      {row.sublabel && <Text style={styles.creatorLifecycleBadge}>{row.sublabel}</Text>}
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={row.accent ? accent : muted} />
                  </TouchableOpacity>
                ))}
              </View>
            </>
          );
        })()}

  </>;
}
