// Next Time! — Settings management for the user's outgoing interest signals.
// Lists every active signal the user has sent ("Plans you're interested in"),
// with a Remove action that calls the remove_interest_signal RPC.

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ArrowLeft } from 'lucide-react-native';
import { supabase } from '../../lib/supabase';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { hapticLight, hapticWarning } from '../../lib/haptics';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { friendlyError } from '../../lib/friendlyError';

type InterestRow = {
  signal_id: string;
  event_id: string;
  event_title: string | null;
  creator_id: string;
  creator_name: string | null;
  created_at: string;
};

function formatSentDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function InterestsSettingsScreen() {
  const [rows, setRows] = useState<InterestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [alertInfo, setAlertInfo] = useState<{
    title: string;
    message?: string;
    buttons?: BrandedAlertButton[];
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_user_interest_signals');
      if (error) throw error;
      setRows((data ?? []) as InterestRow[]);
    } catch (e) {
      setAlertInfo({
        title: 'Oops',
        message: friendlyError(e, "Couldn't load your interests."),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const confirmRemove = (row: InterestRow) => {
    setAlertInfo({
      title: 'Remove this?',
      message: `${row.creator_name ?? 'They'} won’t see your interest anymore.`,
      buttons: [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => doRemove(row),
        },
      ],
    });
  };

  const doRemove = async (row: InterestRow) => {
    hapticWarning();
    setRows(prev => prev.filter(r => r.signal_id !== row.signal_id));
    const { error } = await supabase.rpc('remove_interest_signal', { p_signal_id: row.signal_id });
    if (error) {
      // Restore the row on failure.
      load();
      setAlertInfo({
        title: 'Oops',
        message: friendlyError(error, "Couldn't remove that. Try again."),
      });
      return;
    }
    setAlertInfo({
      title: 'Removed',
      message: `${row.creator_name ?? 'They'} won’t see your interest anymore.`,
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => { hapticLight(); router.back(); }}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Plans you’re interested in</Text>
        <View style={{ width: 22 }} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.terracotta} />
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="heart-outline" size={32} color={Colors.warmGray} />
          <Text style={styles.emptyText}>
            Nothing here. When you tell someone you’d go next time, it shows up here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={r => r.signal_id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {item.event_title ?? 'A plan'}
                </Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {(item.creator_name ?? 'Someone') + ' · ' + formatSentDate(item.created_at)}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.removeBtn}
                onPress={() => confirmRemove(item)}
                activeOpacity={0.7}
              >
                <Text style={styles.removeBtnText}>Remove</Text>
              </TouchableOpacity>
            </View>
          )}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
        />
      )}

      <BrandedAlert
        visible={!!alertInfo}
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message}
        buttons={alertInfo?.buttons}
        onClose={() => setAlertInfo(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.parchment },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
    flex: 1,
    textAlign: 'center',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.textMedium,
    textAlign: 'center',
    lineHeight: 22,
  },
  list: { padding: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  rowSub: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.textMedium,
    marginTop: 2,
  },
  removeBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  removeBtnText: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
  },
  sep: {
    height: 1,
    backgroundColor: Colors.border,
  },
});
