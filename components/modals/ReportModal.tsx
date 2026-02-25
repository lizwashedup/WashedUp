import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Alert,
  ActivityIndicator,
  ScrollView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';

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
  eventId: string;
}

export function ReportModal({
  visible,
  onClose,
  reportedUserId,
  reportedUserName,
  eventId,
}: ReportModalProps) {
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleClose = () => {
    if (submitting) return;
    setSelectedReason(null);
    onClose();
  };

  const handleSubmit = async () => {
    if (!selectedReason || submitting) return;
    setSubmitting(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase.from('reports').insert({
        reporter_user_id: user.id,
        reported_user_id: reportedUserId,
        reason: selectedReason,
        reported_event_id: eventId,
        details: 'Reported from plan chat',
      });

      if (error) throw error;

      setSelectedReason(null);
      onClose();

      // Slight delay so the modal has time to close before the alert appears
      setTimeout(() => {
        Alert.alert(
          'Report submitted',
          'Thank you. We review all reports within 24 hours.',
        );
      }, 350);
    } catch {
      Alert.alert(
        'Could not submit report',
        'Please email hello@washedup.app and we\'ll look into it.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={handleClose}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            disabled={submitting}
          >
            <Ionicons name="close" size={22} color="#1C1917" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Report User</Text>
          {/* Spacer to keep title centered */}
          <View style={{ width: 22 }} />
        </View>

        <ScrollView
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
                      <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.disclaimer}>
            Your report is anonymous. We review all reports within 24 hours.
          </Text>
        </ScrollView>

        {/* Sticky submit button */}
        <View style={[styles.footer, { paddingBottom: Platform.OS === 'ios' ? 32 : 20 }]}>
          <TouchableOpacity
            style={[styles.submitBtn, !selectedReason && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={!selectedReason || submitting}
            activeOpacity={0.9}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.submitBtnText}>Submit Report</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFF8F0',
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
    borderBottomColor: '#F0E6D3',
    backgroundColor: '#FFFFFF',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1C1917',
  },

  // Body
  content: {
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 24,
    gap: 20,
  },
  subtitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1C1917',
    textAlign: 'center',
    lineHeight: 26,
  },
  subtitleName: {
    color: '#C4652A',
    fontWeight: '700',
  },

  // Reason list
  reasonList: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#F0E6D3',
    shadowColor: '#1C1917',
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
    borderBottomColor: '#F0E6D3',
  },
  reasonText: {
    flex: 1,
    fontSize: 15,
    color: '#1C1917',
    fontWeight: '500',
  },
  reasonTextSelected: {
    color: '#C4652A',
    fontWeight: '600',
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#D0C4B5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkSelected: {
    backgroundColor: '#C4652A',
    borderColor: '#C4652A',
  },

  disclaimer: {
    fontSize: 13,
    color: '#9B8B7A',
    textAlign: 'center',
    lineHeight: 18,
  },

  // Footer
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F0E6D3',
  },
  submitBtn: {
    backgroundColor: '#C4652A',
    borderRadius: 14,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#C4652A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  submitBtnDisabled: {
    backgroundColor: '#F0E6D3',
    shadowOpacity: 0,
    elevation: 0,
  },
  submitBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
