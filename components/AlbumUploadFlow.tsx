import React, { useCallback, useImperativeHandle, useMemo, useState, forwardRef } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
// Use the legacy import path. expo-file-system v19 (SDK 54) replaced the
// flat module API with File/Directory classes and now THROWS at runtime
// when you call legacy methods (e.g. readAsStringAsync) from the top-level
// 'expo-file-system' import. The /legacy subpath preserves the old API.
import * as FileSystem from 'expo-file-system/legacy';
import { Camera, Check, X } from 'lucide-react-native';
import { decode } from 'base64-arraybuffer';
import { useQueryClient } from '@tanstack/react-query';
import { hapticLight, hapticMedium, hapticSuccess } from '../lib/haptics';
import { supabase } from '../lib/supabase';
import Colors from '../constants/Colors';
import { Fonts, FontSizes } from '../constants/Typography';

interface Member {
  id: string;
  user_id: string;
  first_name_display: string | null;
  profile_photo_url: string | null;
}

interface Props {
  eventId: string;
  currentUserId: string;
  members: Member[];
}

export interface AlbumUploadFlowHandle {
  startFlow: () => void;
}

type Step = 'idle' | 'picking' | 'attendance' | 'uploading' | 'done';

function getNextRevealAt(): string {
  // Next day at 9:00 AM Pacific (America/Los_Angeles).
  // Use Intl.DateTimeFormat to get the current Pacific date parts reliably.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false, timeZoneName: 'short',
  });
  const parts = fmt.formatToParts(new Date());
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const tzName = get('timeZoneName'); // "PDT" or "PST"
  const offsetHours = tzName === 'PDT' ? 7 : 8; // PDT = UTC-7, PST = UTC-8

  // Build tomorrow 9:00 AM Pacific as UTC
  // Date.UTC(year, month-1, day+1, 9+offset) gives us 9am Pacific in UTC
  const revealUtc = Date.UTC(year, month - 1, day + 1, 9 + offsetHours, 0, 0, 0);
  return new Date(revealUtc).toISOString();
}

const AlbumUploadFlow = forwardRef<AlbumUploadFlowHandle, Props>(function AlbumUploadFlow({ eventId, currentUserId, members }, ref) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('idle');
  const [selectedAssets, setSelectedAssets] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [attendance, setAttendance] = useState<Record<string, boolean>>({});
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);

  // Initialize attendance with everyone checked
  const otherMembers = useMemo(
    () => members.filter(m => m.user_id !== currentUserId),
    [members, currentUserId],
  );

  const initAttendance = useCallback(() => {
    const init: Record<string, boolean> = {};
    otherMembers.forEach(m => { init[m.user_id] = true; });
    setAttendance(init);
  }, [otherMembers]);

  const toggleAttendance = useCallback((userId: string) => {
    hapticLight();
    setAttendance(prev => ({ ...prev, [userId]: !prev[userId] }));
  }, []);

  // Step 1: Open picker
  const startFlow = useCallback(async () => {
    hapticLight();
    setStep('picking');

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      quality: 1, // Full quality, no compression
      exif: false,
    });

    if (result.canceled || result.assets.length === 0) {
      setStep('idle');
      return;
    }

    setSelectedAssets(result.assets);
    initAttendance();
    setStep('attendance');
  }, [initAttendance]);

  useImperativeHandle(ref, () => ({ startFlow }), [startFlow]);

  // Step 2: Save attendance and upload
  const confirmAndUpload = useCallback(async () => {
    hapticMedium();
    setStep('uploading');
    setUploadProgress(0);
    setUploadTotal(selectedAssets.length);

    try {
      // Save attendance
      const attendanceRows = Object.entries(attendance).map(([userId, wasPresent]) => ({
        event_id: eventId,
        user_id: userId,
        was_present: wasPresent,
        marked_by: currentUserId,
      }));

      if (attendanceRows.length > 0) {
        await supabase.from('plan_attendance').upsert(attendanceRows, {
          onConflict: 'event_id,user_id,marked_by',
        });
      }

      // Upload photos
      const revealAt = getNextRevealAt();
      let uploaded = 0;

      for (const asset of selectedAssets) {
        const ext = asset.uri.split('.').pop()?.toLowerCase() ?? 'jpg';
        const isVideo = asset.type === 'video';
        const filename = `${Date.now()}_${uploaded}.${ext}`;
        const storagePath = `${eventId}/${currentUserId}/${filename}`;

        // Read file as base64 — no compression. Pass the string literal
        // 'base64' instead of FileSystem.EncodingType.Base64 because the
        // EncodingType enum was removed from the top-level expo-file-system
        // export in v19. The literal is the supported public API.
        const base64 = await FileSystem.readAsStringAsync(asset.uri, {
          encoding: 'base64',
        });

        const contentType = isVideo
          ? `video/${ext === 'mov' ? 'quicktime' : ext}`
          : `image/${ext === 'jpg' ? 'jpeg' : ext}`;

        const { error: uploadError } = await supabase.storage
          .from('plan-albums')
          .upload(storagePath, decode(base64), { contentType });

        if (uploadError) {
          console.warn('[WashedUp] Photo upload failed:', uploadError);
          continue;
        }

        const { error: insertError } = await supabase.from('plan_photos').insert({
          event_id: eventId,
          uploaded_by: currentUserId,
          storage_path: storagePath,
          media_type: isVideo ? 'video' : 'photo',
          is_developing: true,
          reveal_at: revealAt,
        });

        if (insertError) {
          console.warn('[WashedUp] plan_photos insert failed:', insertError);
          continue;
        }

        uploaded++;
        setUploadProgress(uploaded);
      }

      hapticSuccess();
      queryClient.invalidateQueries({ queryKey: ['plan-photos', eventId] });
      queryClient.invalidateQueries({ queryKey: ['has-uploaded-photos'] });
      setStep('done');
    } catch (err) {
      console.warn('[WashedUp] Album upload flow failed:', err);
      setStep('idle');
    }
  }, [selectedAssets, attendance, eventId, currentUserId, queryClient]);

  const dismiss = useCallback(() => {
    setStep('idle');
    setSelectedAssets([]);
    setAttendance({});
    setUploadProgress(0);
    setUploadTotal(0);
  }, []);

  return (
    <>
      {/* Add to album button */}
      <TouchableOpacity style={styles.albumBtn} onPress={startFlow} activeOpacity={0.85}>
        <Camera size={18} color={Colors.white} />
        <Text style={styles.albumBtnText}>Add to album</Text>
      </TouchableOpacity>

      {/* Attendance modal */}
      <Modal visible={step === 'attendance'} transparent animationType="fade" onRequestClose={() => setStep('attendance')} statusBarTranslucent>
        <Pressable style={styles.overlay} onPress={() => setStep('idle')}>
          <Pressable style={styles.sheet} onPress={e => e.stopPropagation()}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Who was there?</Text>
              <TouchableOpacity onPress={() => setStep('idle')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <X size={20} color={Colors.textLight} />
              </TouchableOpacity>
            </View>
            <Text style={styles.sheetSubtitle}>
              Uncheck anyone who didn't show up. They won't see the album.
            </Text>

            <ScrollView style={styles.attendanceList} bounces={false}>
              {otherMembers.map(member => {
                const checked = attendance[member.user_id] ?? true;
                return (
                  <TouchableOpacity
                    key={member.user_id}
                    style={styles.attendanceRow}
                    onPress={() => toggleAttendance(member.user_id)}
                    activeOpacity={0.7}
                  >
                    {member.profile_photo_url ? (
                      <Image source={{ uri: member.profile_photo_url }} style={styles.attendanceAvatar} contentFit="cover" />
                    ) : (
                      <View style={[styles.attendanceAvatar, styles.attendanceAvatarFallback]}>
                        <Text style={styles.attendanceInitial}>
                          {(member.first_name_display ?? '?')[0].toUpperCase()}
                        </Text>
                      </View>
                    )}
                    <Text style={styles.attendanceName}>{member.first_name_display ?? 'Unknown'}</Text>
                    <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                      {checked && <Check size={14} color={Colors.white} strokeWidth={3} />}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Text style={styles.photoCount}>
              {selectedAssets.length} {selectedAssets.length === 1 ? 'photo' : 'photos'} selected
            </Text>

            <TouchableOpacity style={styles.confirmBtn} onPress={confirmAndUpload} activeOpacity={0.85}>
              <Text style={styles.confirmBtnText}>Upload Photos</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Upload progress modal */}
      <Modal visible={step === 'uploading'} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={styles.progressCard}>
            <ActivityIndicator size="large" color={Colors.terracotta} />
            <Text style={styles.progressText}>
              Uploading {uploadProgress} of {uploadTotal}...
            </Text>
            <Text style={styles.progressSub}>Keep the app open</Text>
          </View>
        </View>
      </Modal>

      {/* Done modal */}
      <Modal visible={step === 'done'} transparent animationType="fade" onRequestClose={() => setStep('idle')} statusBarTranslucent>
        <Pressable style={styles.overlay} onPress={dismiss}>
          <Pressable style={styles.doneCard} onPress={e => e.stopPropagation()}>
            <Text style={styles.doneEmoji}>📸</Text>
            <Text style={styles.doneTitle}>Your photos are developing</Text>
            <Text style={styles.doneBody}>
              They'll be ready tomorrow.
            </Text>
            <TouchableOpacity style={styles.doneBtn} onPress={dismiss} activeOpacity={0.85}>
              <Text style={styles.doneBtnText}>Got it</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
});

export default AlbumUploadFlow;

const styles = StyleSheet.create({
  albumBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.terracotta,
    borderRadius: 14,
    paddingVertical: 14,
    flex: 1,
  },
  albumBtnText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.white,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sheet: {
    backgroundColor: Colors.white,
    borderRadius: 20,
    padding: 20,
    width: '88%',
    maxHeight: '75%',
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  sheetTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
  },
  sheetSubtitle: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.textMedium,
    marginBottom: 16,
    lineHeight: 18,
  },
  attendanceList: {
    maxHeight: 320,
  },
  attendanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  attendanceAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  attendanceAvatarFallback: {
    backgroundColor: Colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attendanceInitial: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.terracotta,
  },
  attendanceName: {
    flex: 1,
    marginLeft: 12,
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: Colors.terracotta,
    borderColor: Colors.terracotta,
  },
  photoCount: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.textLight,
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 8,
  },
  confirmBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  confirmBtnText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.white,
  },
  progressCard: {
    backgroundColor: Colors.white,
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    gap: 16,
    width: '75%',
  },
  progressText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  progressSub: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.textLight,
  },
  doneCard: {
    backgroundColor: Colors.white,
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    width: '82%',
  },
  doneEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  doneTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
    textAlign: 'center',
    marginBottom: 8,
  },
  doneBody: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.textMedium,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  doneBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 40,
  },
  doneBtnText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.white,
  },
});
