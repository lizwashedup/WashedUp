import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  RefreshControl,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, X, ExternalLink } from 'lucide-react-native';
import { supabase } from '../../lib/supabase';
import { friendlyError } from '../../lib/friendlyError';
import { hapticSuccess } from '../../lib/haptics';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { isAdmin } from '../../constants/Admin';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../../components/keyboard/KeyboardDoneBar';
import type { OperatorGrantStatus, OperatorTrack } from '../../lib/operatorApplications';

interface ApplicationRow {
  id: string;
  user_id: string;
  track: OperatorTrack;
  status: OperatorGrantStatus;
  application: Record<string, unknown>;
  review_notes: string | null;
  applicant_message: string | null;
  reviewed_at: string | null;
  created_at: string;
  applicant_name?: string;
}

const TRACK_LABEL: Record<OperatorTrack, string> = {
  event_host: 'Event Host',
  community_leader: 'Community Leader',
};

const STATUS_LABEL: Record<OperatorGrantStatus, string> = {
  applied: 'New',
  in_review: 'In review',
  needs_more_info: 'Waiting on applicant',
  approved: 'Approved',
  declined: 'Declined',
  revoked: 'Revoked',
};

// doc 12 question keys -> reviewer-facing labels
const ANSWER_LABELS: Record<string, string> = {
  applicant_type: 'What are they',
  applicant_type_other: 'Type detail',
  your_name: 'Name',
  public_name: 'Public listing name',
  event_categories: 'Event kinds',
  frequency: 'How often',
  proof_links: 'Proof',
  venue_address: 'Venue address',
  ticketing_today: 'Ticketing today',
  ticketing_provider: 'Ticketing provider',
  about: 'About what they run',
  community_name: 'Community name',
  concept: 'What is it',
  audience: 'Who is it for',
  cadence: 'Cadence',
  cadence_other: 'Cadence detail',
  why_you: 'Why them',
  affiliation: 'Business affiliation',
  affiliation_detail: 'Affiliation detail',
  responsibility_ack: 'Responsibility acknowledged',
};

const ANSWER_ORDER = Object.keys(ANSWER_LABELS);

function formatAnswer(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value ?? '');
}

export default function AdminApplicationsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ApplicationRow | null>(null);
  const [applicantMessage, setApplicantMessage] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const [acting, setActing] = useState<OperatorGrantStatus | null>(null);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  useEffect(() => {
    if (userId !== null && !isAdmin(userId)) router.back();
  }, [userId, router]);

  const { data: applications = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['admin-operator-applications'],
    queryFn: async (): Promise<ApplicationRow[]> => {
      const { data, error } = await supabase
        .from('operator_grants')
        .select('id, user_id, track, status, application, review_notes, applicant_message, reviewed_at, created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as ApplicationRow[];
      if (rows.length === 0) return rows;
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, first_name_display')
        .in('id', Array.from(new Set(rows.map((r) => r.user_id))));
      const names = new Map((profiles ?? []).map((p: any) => [p.id, p.first_name_display]));
      return rows.map((r) => ({ ...r, applicant_name: names.get(r.user_id) ?? undefined }));
    },
    staleTime: 15_000,
  });

  const review = async (outcome: OperatorGrantStatus) => {
    if (!selected) return;
    setActing(outcome);
    try {
      const { error } = await supabase.rpc('admin_review_operator_grant', {
        p_grant_id: selected.id,
        p_outcome: outcome,
        p_notes: internalNote.trim() || null,
        p_applicant_message: applicantMessage.trim() || null,
      });
      if (error) throw error;
      hapticSuccess();
      queryClient.invalidateQueries({ queryKey: ['admin-operator-applications'] });
      setSelected(null);
      setApplicantMessage('');
      setInternalNote('');
    } catch (e: any) {
      setAlertInfo({ title: 'Error', message: friendlyError(e, 'Could not save the review. Make sure the applications migration has been run.') });
    } finally {
      setActing(null);
    }
  };

  const openReview = (row: ApplicationRow) => {
    setSelected(row);
    setApplicantMessage(row.applicant_message ?? '');
    setInternalNote(row.review_notes ?? '');
  };

  const newOnes = applications.filter((a) => a.status === 'applied' || a.status === 'in_review');
  const waiting = applications.filter((a) => a.status === 'needs_more_info');
  const decided = applications.filter((a) => ['approved', 'declined', 'revoked'].includes(a.status));

  const renderSection = (label: string, rows: ApplicationRow[]) =>
    rows.length > 0 && (
      <>
        <Text style={styles.sectionLabel}>{label} ({rows.length})</Text>
        {rows.map((row) => (
          <TouchableOpacity key={row.id} style={styles.card} onPress={() => openReview(row)} activeOpacity={0.8}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>
                {row.applicant_name ?? 'Someone'}
                {typeof row.application.public_name === 'string' && row.application.public_name
                  ? ` · ${row.application.public_name}`
                  : ''}
              </Text>
              <Text style={styles.cardMeta}>
                {TRACK_LABEL[row.track]} · {new Date(row.created_at).toLocaleDateString()}
              </Text>
            </View>
            <View style={[styles.statusChip, row.status === 'approved' && styles.statusChipApproved]}>
              <Text style={styles.statusChipText}>{STATUS_LABEL[row.status]}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </>
    );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12}>
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Applications</Text>
        <View style={styles.headerBtn} />
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.terracotta} />
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.terracotta} />}
        >
          {applications.length === 0 && (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No applications yet</Text>
              <Text style={styles.emptySubtext}>New creator applications land here</Text>
            </View>
          )}
          {renderSection('Needs review', newOnes)}
          {renderSection('Waiting on applicant', waiting)}
          {renderSection('Decided', decided)}
        </ScrollView>
      )}

      {/* Review modal */}
      <Modal visible={!!selected} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelected(null)} statusBarTranslucent>
        <SafeAreaView style={styles.modalContainer} edges={['top', 'bottom']}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setSelected(null)} hitSlop={12}>
                <X size={22} color={Colors.asphalt} strokeWidth={2} />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>
                {selected ? `${selected.applicant_name ?? 'Someone'} · ${TRACK_LABEL[selected.track]}` : ''}
              </Text>
              <View style={{ width: 22 }} />
            </View>

            {selected && (
              <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
                <View style={[styles.statusChip, styles.statusChipInline]}>
                  <Text style={styles.statusChipText}>{STATUS_LABEL[selected.status]}</Text>
                </View>

                {ANSWER_ORDER.filter((key) => selected.application[key] !== undefined && selected.application[key] !== '').map((key) => (
                  <View key={key} style={styles.answerBlock}>
                    <Text style={styles.answerLabel}>{ANSWER_LABELS[key]}</Text>
                    {key === 'proof_links' && Array.isArray(selected.application[key]) ? (
                      (selected.application[key] as string[]).map((link) => (
                        <TouchableOpacity key={link} style={styles.linkRow} onPress={() => Linking.openURL(link)}>
                          <ExternalLink size={14} color={Colors.terracotta} strokeWidth={2} />
                          <Text style={styles.linkText} numberOfLines={1}>{link}</Text>
                        </TouchableOpacity>
                      ))
                    ) : (
                      <Text style={styles.answerValue}>{formatAnswer(selected.application[key])}</Text>
                    )}
                  </View>
                ))}

                <Text style={styles.answerLabel}>Message to applicant</Text>
                <TextInput
                  style={styles.notesInput}
                  value={applicantMessage}
                  onChangeText={setApplicantMessage}
                  placeholder="Goes in their inbox note. For needs-more-info: the one specific ask. For declines: the kind why."
                  placeholderTextColor={Colors.inkSoft}
                  multiline
                  maxLength={500}
                  inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
                />

                <Text style={styles.answerLabel}>Internal note (never shown to them)</Text>
                <TextInput
                  style={styles.notesInput}
                  value={internalNote}
                  onChangeText={setInternalNote}
                  placeholder="Your own read on this one."
                  placeholderTextColor={Colors.inkSoft}
                  multiline
                  maxLength={500}
                  inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
                />

                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.approveBtn]}
                    onPress={() => review('approved')}
                    disabled={!!acting}
                  >
                    {acting === 'approved' ? (
                      <ActivityIndicator size="small" color={Colors.white} />
                    ) : (
                      <Text style={styles.approveBtnText}>Approve</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.infoBtn]}
                    onPress={() => review('needs_more_info')}
                    disabled={!!acting}
                  >
                    {acting === 'needs_more_info' ? (
                      <ActivityIndicator size="small" color={Colors.darkWarm} />
                    ) : (
                      <Text style={styles.infoBtnText}>Needs more info</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.declineBtn]}
                    onPress={() => review('declined')}
                    disabled={!!acting}
                  >
                    {acting === 'declined' ? (
                      <ActivityIndicator size="small" color={Colors.terracotta} />
                    ) : (
                      <Text style={styles.declineBtnText}>Decline</Text>
                    )}
                  </TouchableOpacity>
                </View>

                {selected.status === 'approved' && (
                  <TouchableOpacity style={styles.revokeLink} onPress={() => review('revoked')} disabled={!!acting}>
                    <Text style={styles.revokeLinkText}>Revoke this grant</Text>
                  </TouchableOpacity>
                )}
              </ScrollView>
            )}
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

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
  container: { flex: 1, backgroundColor: Colors.parchment },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: Fonts.display, fontSize: FontSizes.displayLG, color: Colors.asphalt },

  listContent: { padding: 20, gap: 12, paddingBottom: 40 },
  sectionLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.warmGray,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 4,
    marginTop: 8,
  },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
  },
  cardTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.asphalt, marginBottom: 4 },
  cardMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium },

  statusChip: {
    backgroundColor: Colors.creamWarm,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusChipApproved: { backgroundColor: Colors.goldBadgeSoft },
  statusChipInline: { alignSelf: 'flex-start', marginBottom: 16 },
  statusChipText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.quoteText },

  empty: { alignItems: 'center', marginTop: 60, gap: 8 },
  emptyText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.displaySM, color: Colors.asphalt },
  emptySubtext: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium },

  modalContainer: { flex: 1, backgroundColor: Colors.parchment },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt, flex: 1, textAlign: 'center' },
  modalContent: { padding: 20, paddingBottom: 60 },

  answerBlock: { marginBottom: 14 },
  answerLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.warmGray,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  answerValue: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    lineHeight: LineHeights.bodyMD,
    color: Colors.darkWarm,
  },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  linkText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.terracotta, flex: 1 },

  notesInput: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.borderWarm,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.darkWarm,
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: 20,
  },

  actionRow: { gap: 10 },
  actionBtn: { borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
  approveBtn: { backgroundColor: Colors.terracotta },
  approveBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  infoBtn: { backgroundColor: Colors.creamWarm, borderWidth: 1, borderColor: Colors.borderWarm },
  infoBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  declineBtn: { borderWidth: 1.5, borderColor: Colors.terracotta, backgroundColor: 'transparent' },
  declineBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },

  revokeLink: { alignItems: 'center', marginTop: 20 },
  revokeLinkText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.tertiary },
});
