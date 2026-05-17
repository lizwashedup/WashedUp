/**
 * Redesigned post-plan survey UI. Same Props / DB writes as the legacy
 * PostPlanSurvey (plan_feedback + no_show_reports, identical column
 * semantics: rating thumbs_up | thumbs_down | null), plus a new screen 3
 * that sends people requests. Flag-gated from PostPlanSurvey.
 *
 * Warm, typography-forward, no emoji/stars. Copy is dash-free.
 */
import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  TextInput,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { supabase } from '../../../lib/supabase';
import { hapticSelection, hapticSuccess } from '../../../lib/haptics';
import YoursAvatar from '../primitives/YoursAvatar';
import { COPY } from '../state/constants';
import type {
  SurveyPlan,
  SurveyMember,
} from '../../PostPlanSurvey';

type Step = 'how' | 'who' | 'add' | 'done';
type Rating = 'thumbs_up' | 'thumbs_down' | null;

export default function SurveyV2({
  visible,
  plan,
  members,
  userId,
  onComplete,
}: {
  visible: boolean;
  plan: SurveyPlan;
  members: SurveyMember[];
  userId: string;
  onComplete: () => void;
}) {
  const others = members.filter((m) => m.id !== userId);
  const [step, setStep] = useState<Step>('how');
  const [rating, setRating] = useState<Rating>(null);
  const [comment, setComment] = useState('');
  const [showComment, setShowComment] = useState(false);
  const [noShows, setNoShows] = useState<Set<string>>(new Set());
  const [addSel, setAddSel] = useState<Set<string>>(
    new Set(others.map((m) => m.id)),
  );
  const [busy, setBusy] = useState(false);

  const close = () => {
    setStep('how');
    onComplete();
  };

  const writeFeedback = async (r: Rating) => {
    await supabase.from('plan_feedback').insert({
      event_id: plan.id,
      user_id: userId,
      attended: true,
      rating: r,
      comment: r === 'thumbs_down' ? comment.trim() || null : null,
    });
  };

  const pick = async (label: 'good' | 'fine' | 'bad') => {
    hapticSelection();
    if (label === 'bad') {
      setRating('thumbs_down');
      setShowComment(true);
      return; // wait for optional comment + explicit Next
    }
    setRating(label === 'good' ? 'thumbs_up' : null);
    setStep('who');
  };

  const submitWho = async () => {
    setBusy(true);
    try {
      await writeFeedback(rating);
      if (noShows.size > 0) {
        await supabase.from('no_show_reports').insert(
          Array.from(noShows).map((id) => ({
            event_id: plan.id,
            reporter_user_id: userId,
            no_show_user_id: id,
          })),
        );
      }
    } finally {
      setBusy(false);
    }
    const attendees = others.filter((m) => !noShows.has(m.id));
    if (attendees.length > 0) {
      setAddSel(new Set(attendees.map((m) => m.id)));
      setStep('add');
    } else {
      close();
    }
  };

  const submitAdd = async () => {
    setBusy(true);
    hapticSuccess();
    await Promise.allSettled(
      Array.from(addSel).map((id) =>
        supabase.rpc('send_people_request', {
          p_recipient: id,
          p_context: 'plan_history',
          p_context_event_id: plan.id,
        }),
      ),
    );
    setBusy(false);
    close();
  };

  const attendees = others.filter((m) => !noShows.has(m.id));

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={close}>
      <SafeAreaView style={styles.container}>
        {step === 'how' && (
          <View style={styles.body}>
            <Text style={styles.planTitle}>{plan.title}</Text>
            <Text style={styles.q}>{COPY.surveyHow}</Text>
            <Pressable
              style={[styles.pill, styles.pillGood]}
              onPress={() => pick('good')}
            >
              <Text style={styles.pillGoodText}>{COPY.surveyGood}</Text>
            </Pressable>
            <Pressable
              style={[styles.pill, styles.pillFine]}
              onPress={() => pick('fine')}
            >
              <Text style={styles.pillFineText}>{COPY.surveyFine}</Text>
            </Pressable>
            <Pressable
              style={[styles.pill, styles.pillBad]}
              onPress={() => pick('bad')}
            >
              <Text style={styles.pillBadText}>{COPY.surveyBad}</Text>
            </Pressable>

            {showComment && (
              <View style={styles.commentWrap}>
                <TextInput
                  value={comment}
                  onChangeText={setComment}
                  placeholder={COPY.surveyBadFollowup}
                  placeholderTextColor={Colors.tertiary}
                  style={styles.comment}
                  multiline
                />
                <Pressable
                  style={styles.next}
                  onPress={() => setStep('who')}
                >
                  <Text style={styles.nextText}>{COPY.surveyNext}</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}

        {step === 'who' && (
          <View style={styles.body}>
            <Text style={styles.q}>{COPY.surveyWhoMadeIt}</Text>
            <ScrollView style={{ alignSelf: 'stretch' }}>
              {others.map((m) => {
                const out = noShows.has(m.id);
                return (
                  <Pressable
                    key={m.id}
                    style={styles.memberRow}
                    onPress={() => {
                      hapticSelection();
                      setNoShows((s) => {
                        const n = new Set(s);
                        n.has(m.id) ? n.delete(m.id) : n.add(m.id);
                        return n;
                      });
                    }}
                  >
                    <View style={{ opacity: out ? 0.4 : 1 }}>
                      <YoursAvatar
                        name={m.first_name_display}
                        photoUrl={m.profile_photo_url}
                        size={44}
                        bucket="none"
                      />
                    </View>
                    <Text
                      style={[
                        styles.memberName,
                        out && styles.memberNameOut,
                      ]}
                    >
                      {m.first_name_display ?? 'Someone'}
                    </Text>
                    {out && (
                      <Text style={styles.didnt}>
                        {COPY.surveyDidntMakeIt}
                      </Text>
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable
              style={styles.next}
              onPress={submitWho}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color={Colors.white} />
              ) : (
                <Text style={styles.nextText}>{COPY.surveyNext}</Text>
              )}
            </Pressable>
          </View>
        )}

        {step === 'add' && (
          <View style={styles.body}>
            <Text style={styles.q}>{COPY.surveyAddPrompt}</Text>
            <ScrollView contentContainerStyle={styles.chipWrap}>
              {attendees.map((m) => {
                const on = addSel.has(m.id);
                return (
                  <Pressable
                    key={m.id}
                    style={styles.chip}
                    onPress={() => {
                      hapticSelection();
                      setAddSel((s) => {
                        const n = new Set(s);
                        n.has(m.id) ? n.delete(m.id) : n.add(m.id);
                        return n;
                      });
                    }}
                  >
                    <YoursAvatar
                      name={m.first_name_display}
                      photoUrl={m.profile_photo_url}
                      size={56}
                      bucket={on ? 'full' : 'none'}
                    />
                    <Text style={styles.chipName} numberOfLines={1}>
                      {m.first_name_display ?? ''}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable
              style={[styles.next, addSel.size === 0 && styles.nextOff]}
              disabled={busy || addSel.size === 0}
              onPress={submitAdd}
            >
              {busy ? (
                <ActivityIndicator color={Colors.white} />
              ) : (
                <Text style={styles.nextText}>{COPY.surveyAddButton}</Text>
              )}
            </Pressable>
            <Pressable style={styles.skip} onPress={close}>
              <Text style={styles.skipText}>{COPY.surveySkip}</Text>
            </Pressable>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  body: { flex: 1, paddingHorizontal: 24, paddingTop: 40, gap: 14 },
  planTitle: {
    fontFamily: Fonts.displayItalic,
    fontSize: FontSizes.displayLG,
    color: Colors.asphalt,
    textAlign: 'center',
  },
  q: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.displaySM,
    color: Colors.secondary,
    textAlign: 'center',
    marginBottom: 12,
  },
  pill: {
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillGood: { backgroundColor: Colors.terracotta },
  pillGoodText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.white,
  },
  pillFine: { backgroundColor: Colors.surface },
  pillFineText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
  },
  pillBad: { backgroundColor: Colors.yoursGhostBg },
  pillBadText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyLG,
    color: Colors.secondary,
  },
  commentWrap: { marginTop: 16, gap: 12 },
  comment: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    minHeight: 80,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
    textAlignVertical: 'top',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  memberName: {
    flex: 1,
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  memberNameOut: {
    color: Colors.tertiary,
    textDecorationLine: 'line-through',
  },
  didnt: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.tertiary,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    justifyContent: 'center',
  },
  chip: { width: 72, alignItems: 'center' },
  chipName: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.micro,
    color: Colors.secondary,
    marginTop: 4,
  },
  next: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  nextOff: { opacity: 0.4 },
  nextText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.white,
  },
  skip: { alignItems: 'center', paddingVertical: 12 },
  skipText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.tertiary,
  },
});
