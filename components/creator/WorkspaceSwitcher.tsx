import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { hapticLight } from '../../lib/haptics';
import type { CreatorAccess } from '../../lib/creatorMode';
import {
  hasMultipleWorkspaces,
  setWorkspace,
  useWorkspace,
  type Workspace,
} from '../../lib/workspaceContext';

interface Props {
  access: CreatorAccess | null | undefined;
  stayOnEvents?: boolean;
}

/**
 * The explicit product-level switch required by Build 35. This is separate
 * from CommunitySwitcher, which chooses one Community record after the
 * creator has already chosen the Community product.
 */
export function WorkspaceSwitcher({ access, stayOnEvents = false }: Props) {
  const current = useWorkspace(access);
  const showWorkspaceTabs = hasMultipleWorkspaces(access);

  const choose = (next: Workspace) => {
    if (next === current) return;
    hapticLight();
    setWorkspace(next);
    if (!stayOnEvents) {
      router.replace(next === 'organization' ? '/(creator)/organizer-home' : '/(creator)/today');
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>working as {current}</Text>
        <TouchableOpacity
          onPress={() => router.replace('/(tabs)/profile')}
          accessibilityRole="button"
          accessibilityLabel="Switch back to your personal profile"
          hitSlop={8}
        >
          <Text style={styles.personalLink}>back to you</Text>
        </TouchableOpacity>
      </View>
      {showWorkspaceTabs && <View style={styles.tabs} accessibilityRole="tablist" accessibilityLabel="choose creator workspace">
        {(['organization', 'community'] as const).map((item) => {
          const selected = current === item;
          return (
            <TouchableOpacity
              key={item}
              style={[styles.tab, selected && styles.tabSelected]}
              onPress={() => choose(item)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={item}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabText, selected && styles.tabTextSelected]}>{item}</Text>
            </TouchableOpacity>
          );
        })}
      </View>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6, marginBottom: 12 },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  label: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  personalLink: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: Colors.inputBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 3,
  },
  tab: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
  },
  tabSelected: { backgroundColor: Colors.cardBg },
  tabText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
  },
  tabTextSelected: { fontFamily: Fonts.sansBold, color: Colors.darkWarm },
});
