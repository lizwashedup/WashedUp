import React, { useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import { fetchPlans, Plan } from '../lib/fetchPlans';
import { PlanCard } from '../components/plans/PlanCard';
import { ReportModal } from '../components/modals/ReportModal';
import { BrandedAlert } from '../components/BrandedAlert';
import { useBlockConfirmation } from '../hooks/useBlockConfirmation';
import Colors from '../constants/Colors';
import { Fonts, FontSizes } from '../constants/Typography';

// Map Plan (from fetchPlans) to PlanCard shape
function toPlanCardPlan(plan: Plan) {
  return {
    id: plan.id,
    title: plan.title,
    host_message: plan.host_message ?? null,
    start_time: plan.start_time,
    location_text: plan.location_text ?? null,
    category: plan.category ?? null,
    max_invites: plan.max_invites ?? 0,
    member_count: plan.member_count ?? 0,
    creator: {
      first_name_display: plan.creator?.first_name_display ?? 'Creator',
      profile_photo_url: plan.creator?.profile_photo_url ?? null,
      plans_posted: plan.creator?.plans_posted ?? undefined,
    },
  };
}

export default function PlansSectionScreen() {
  const router = useRouter();
  const { title, from, to } = useLocalSearchParams<{ title: string; from: string; to: string }>();

  const fromDate = useMemo(() => (from ? new Date(from) : new Date(0)), [from]);
  const toDate = useMemo(() => (to ? new Date(to) : new Date(9999, 0, 1)), [to]);

  const [userId, setUserId] = React.useState<string | null>(null);
  const [reportTarget, setReportTarget] = React.useState<{ userId: string; userName: string; eventId: string } | null>(null);
  const { requestBlock, blockNow, modals: blockModals } = useBlockConfirmation();
  const [pendingBlockAfterReport, setPendingBlockAfterReport] = React.useState<{ id: string; name: string } | null>(null);
  const [reportFromBlock, setReportFromBlock] = React.useState(false);
  const [reportSuccessAlert, setReportSuccessAlert] = React.useState(false);
  React.useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  // Read from the same cache as the feed — no extra network request
  const { data: allPlans = [], isLoading } = useQuery({
    queryKey: ['events', 'feed', userId],
    queryFn: () => fetchPlans(userId!),
    enabled: !!userId,
    staleTime: 60_000,
  });

  const sectionPlans = useMemo(
    () => allPlans.filter((p: Plan) => {
      const t = new Date(p.start_time);
      return t >= fromDate && t <= toDate;
    }),
    [allPlans, fromDate, toDate],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{title ?? 'Plans'}</Text>
        <View style={styles.backButton} />
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.terracotta} />
        </View>
      ) : (
        <FlatList
          decelerationRate="normal"
          data={sectionPlans}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <PlanCard
              plan={toPlanCardPlan(item)}
              isMember={false}
              onReport={(planId) => {
                const plan = sectionPlans.find((p) => p.id === planId);
                if (plan?.creator?.id) {
                  setReportFromBlock(false);
                  setReportTarget({ userId: plan.creator.id, userName: plan.creator.first_name_display ?? 'User', eventId: planId });
                }
              }}
              onBlock={(planId) => {
                const plan = sectionPlans.find((p) => p.id === planId);
                if (plan?.creator?.id) {
                  const creatorId = plan.creator.id;
                  const creatorName = plan.creator.first_name_display ?? 'User';
                  requestBlock(creatorId, creatorName, {
                    onRequestReport: (uid, uname) => {
                      setReportFromBlock(true);
                      setReportTarget({ userId: uid, userName: uname, eventId: planId });
                    },
                  });
                }
              }}
            />
          )}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No plans for this period.</Text>
            </View>
          }
        />
      )}

      {reportTarget && (
        <ReportModal
          visible
          onClose={() => setReportTarget(null)}
          reportedUserId={reportTarget.userId}
          reportedUserName={reportTarget.userName}
          eventId={reportTarget.eventId}
          onReportComplete={(uid, uname) => {
            setReportTarget(null);
            if (reportFromBlock) {
              setReportSuccessAlert(true);
            } else {
              setPendingBlockAfterReport({ id: uid, name: uname });
            }
            setReportFromBlock(false);
          }}
        />
      )}

      <BrandedAlert
        visible={!!pendingBlockAfterReport}
        title="report submitted"
        message={
          pendingBlockAfterReport
            ? `also block ${pendingBlockAfterReport.name}? they won't be able to see or join your plans.`
            : undefined
        }
        buttons={[
          { text: 'no thanks', style: 'cancel' },
          {
            text: 'block',
            style: 'destructive',
            onPress: () => {
              if (pendingBlockAfterReport) {
                void blockNow(pendingBlockAfterReport.id, pendingBlockAfterReport.name);
              }
            },
          },
        ]}
        onClose={() => setPendingBlockAfterReport(null)}
      />

      <BrandedAlert
        visible={reportSuccessAlert}
        title="thanks for the report"
        message="we review all reports within 24 hours."
        buttons={[{ text: 'ok' }]}
        onClose={() => setReportSuccessAlert(false)}
      />

      {blockModals}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayLG,
    color: Colors.asphalt,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 20, gap: 16 },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyLG, color: Colors.textLight },
});
