import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { BrandedAlert } from '../BrandedAlert';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';

const REPORT_REASONS = [
  'Inappropriate behavior',
  'Harassment or bullying',
  'Fake profile or spam',
  'No-show to plan',
  'Made me feel unsafe',
  'Other',
] as const;

export interface ReportModalProps {
  visible: boolean;
  onClose: () => void;
  reportedUserId: string;
  reportedUserName: string;
  eventId?: string;
  /**
   * Fired after a successful report submit. When provided, replaces the
   * built-in "Report submitted" success alert so the consumer can show
   * its own follow-up (e.g. "also block X?" prompt). Old call sites that
   * omit this prop keep the original success-alert behavior.
   */
  onReportComplete?: (reportedUserId: string, reportedUserName: string) => void;
}

export function ReportModal({
  visible,
  onClose,
  reportedUserId,
  reportedUserName,
  eventId,
  onReportComplete,
}: ReportModalProps) {
  const insets = useSafeAreaInsets();
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string } | null>(null);

  const handleClose = () => {
    if (submitting) return;
    setSelectedReason(null);
    setDescription('');
    onClose();
  };

  const handleSubmit = async () => {
    if (!selectedReason || submitting) return;
    setSubmitting(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const context = eventId ? 'Reported from plan' : 'Reported from user search';
      const trimmed = description.trim();
      const details = trimmed ? `${context}\n\n${trimmed}` : context;

      const { error } = await supabase.from('reports').insert({
        reporter_user_id: user.id,
        reported_user_id: reportedUserId,
        reason: selectedReason,
        reported_event_id: eventId ?? null,
        details,
      });

      if (error) throw error;

      setSelectedReason(null);
      setDescription('');
      onClose();

      // Slight delay so the modal has time to close before the next UI lands
      setTimeout(() => {
        if (onReportComplete) {
          onReportComplete(reportedUserId, reportedUserName);
        } else {
          setAlertInfo({
            title: 'Report submitted',
            message: 'Thank you. We review all reports within 24 hours.',
          });
        }
      }, 350);
    } catch (err) {
      // Close the modal first so the error alert can render on top of it
      // (iOS pageSheet Modal blocks any other Modal sibling).
      console.log('[ReportModal] submit failed:', err);
      onClose();
      setTimeout(() => {
        setAlertInfo({
          title: 'Could not submit report',
          message: 'Please email hello@washedup.app and we\'ll look into it.',
        });
      }, 350);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={handleClose}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            disabled={submitting}
          >
            <Ionicons name="close" size={22} color={Colors.asphalt} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Report User</Text>
          {/* Spacer to keep title centered */}
          <View style={{ width: 22 }} />
        </View>

        <ScrollView
          decelerationRate="normal"
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.subtitle}>
            Why are you reporting{'\n'}
            <Text style={styles.subtitleName}>{reportedUserName}</Text>?
          </Text>

          {/* Reason list */}
          <View style={styles.reasonList}>
            {REPORT_REASONS.map((reason, i) => {
              const isSelected = selectedReason === reason;
              return (
                <TouchableOpacity
                  key={reason}
                  style={[
                    styles.reasonRow,
                    i < REPORT_REASONS.length - 1 && styles.reasonRowBorder,
                  ]}
                  onPress={() => setSelectedReason(reason)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.reasonText, isSelected && styles.reasonTextSelected]}>
                    {reason}
                  </Text>
                  <View style={[styles.check, isSelected && styles.checkSelected]}>
                    {isSelected && (
                      <Ionicons name="checkmark" size={14} color={Colors.white} />
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Optional description */}
          <View style={styles.detailsBlock}>
            <Text style={styles.detailsLabel}>add details (optional)</Text>
            <TextInput
              style={styles.detailsInput}
              value={description}
              onChangeText={setDescription}
              placeholder="what happened?"
              placeholderTextColor={Colors.warmGray}
              multiline
              maxLength={1000}
              editable={!submitting}
              textAlignVertical="top"
            />
          </View>

          <Text style={styles.disclaimer}>
            Your report is anonymous. We review all reports within 24 hours.
          </Text>
        </ScrollView>

        {/* Sticky submit button */}
        <View
          style={[
            styles.footer,
            {
              // Android edge-to-edge: add nav/gesture bar inset so submit
              // button stays tappable. iOS keeps its existing 32px.
              paddingBottom:
                Platform.OS === 'ios' ? 32 : 20 + insets.bottom,
            },
          ]}
        >
          <TouchableOpacity
            style={[styles.submitBtn, !selectedReason && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={!selectedReason || submitting}
            activeOpacity={0.9}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <Text style={styles.submitBtnText}>Submit Report</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

    </Modal>

    <BrandedAlert
      visible={!!alertInfo}
      title={alertInfo?.title ?? ''}
      message={alertInfo?.message}
      onClose={() => setAlertInfo(null)}
    />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.parchment,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.inputBg,
    backgroundColor: Colors.white,
  },
  headerTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },

  // Body
  content: {
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 24,
    gap: 20,
  },
  subtitle: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.displaySM,
    color: Colors.asphalt,
    textAlign: 'center',
    lineHeight: 26,
  },
  subtitleName: {
    color: Colors.terracotta,
    fontFamily: Fonts.sansBold,
  },

  // Reason list
  reasonList: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.inputBg,
    shadowColor: Colors.asphalt,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  reasonRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.inputBg,
  },
  reasonText: {
    flex: 1,
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  reasonTextSelected: {
    color: Colors.terracotta,
    fontFamily: Fonts.sansBold,
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkSelected: {
    backgroundColor: Colors.terracotta,
    borderColor: Colors.terracotta,
  },

  // Optional description
  detailsBlock: {
    gap: 8,
    marginTop: 4,
  },
  detailsLabel: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.warmGray,
    letterSpacing: 0.3,
  },
  detailsInput: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.inputBg,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    minHeight: 96,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
    shadowColor: Colors.asphalt,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },

  disclaimer: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.warmGray,
    textAlign: 'center',
    lineHeight: 18,
  },

  // Footer
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.inputBg,
  },
  submitBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 14,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.terracotta,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  submitBtnDisabled: {
    backgroundColor: Colors.inputBg,
    shadowOpacity: 0,
    elevation: 0,
  },
  submitBtnText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.white,
  },
});
