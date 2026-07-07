import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { ArrowLeft, Check } from 'lucide-react-native';
import { supabase } from '../../lib/supabase';
import { friendlyError } from '../../lib/friendlyError';
import { hapticSuccess, hapticError, hapticLight } from '../../lib/haptics';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import {
  Field,
  ChoiceList,
  LinksInput,
  TermsCheck,
  SubmitButton,
  Confirmation,
} from '../../components/creator/ApplyFormKit';
import { COMMUNITY_CADENCES, fetchMyGrants, submitApplication } from '../../lib/operatorApplications';

const AFFILIATION_OPTIONS = [
  { key: 'no', label: 'no' },
  { key: 'yes', label: 'yes' },
];

export default function ApplyCommunityScreen() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);

  const [yourName, setYourName] = useState('');
  const [communityName, setCommunityName] = useState('');
  const [concept, setConcept] = useState('');
  const [audience, setAudience] = useState('');
  const [cadence, setCadence] = useState<string | null>(null);
  const [cadenceOther, setCadenceOther] = useState('');
  const [whyYou, setWhyYou] = useState('');
  const [proofLinks, setProofLinks] = useState<string[]>(['', '', '']);
  const [affiliation, setAffiliation] = useState<string | null>(null);
  const [affiliationDetail, setAffiliationDetail] = useState('');
  const [responsibilityAck, setResponsibilityAck] = useState(false);
  const [terms, setTerms] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data } = await supabase
          .from('profiles')
          .select('first_name_display')
          .eq('id', user.id)
          .single();
        if (data?.first_name_display) setYourName((v) => v || data.first_name_display);
        const grants = await fetchMyGrants();
        const prior = grants.find((g) => g.track === 'community_leader');
        if (prior && ['declined', 'needs_more_info'].includes(prior.status)) {
          const a = prior.application as Record<string, any>;
          if (a.your_name) setYourName(a.your_name);
          if (a.community_name) setCommunityName(a.community_name);
          if (a.concept) setConcept(a.concept);
          if (a.audience) setAudience(a.audience);
          if (a.cadence) setCadence(a.cadence);
          if (a.cadence_other) setCadenceOther(a.cadence_other);
          if (a.why_you) setWhyYou(a.why_you);
          if (Array.isArray(a.proof_links)) setProofLinks([...a.proof_links, '', '', ''].slice(0, 3));
          if (a.affiliation) setAffiliation(a.affiliation);
          if (a.affiliation_detail) setAffiliationDetail(a.affiliation_detail);
          if (a.responsibility_ack) setResponsibilityAck(true);
        }
      } catch {
        // prefill is best-effort
      }
    })();
  }, []);

  const cleanLinks = proofLinks.map((l) => l.trim()).filter(Boolean);

  const valid =
    yourName.trim().length > 0 &&
    communityName.trim().length > 0 &&
    concept.trim().length > 0 &&
    audience.trim().length > 0 &&
    !!cadence &&
    (cadence !== 'other' || cadenceOther.trim().length > 0) &&
    whyYou.trim().length > 0 &&
    cleanLinks.length > 0 &&
    !!affiliation &&
    (affiliation !== 'yes' || affiliationDetail.trim().length > 0) &&
    responsibilityAck &&
    terms;

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const application: Record<string, unknown> = {
        your_name: yourName.trim(),
        community_name: communityName.trim(),
        concept: concept.trim(),
        audience: audience.trim(),
        cadence,
        why_you: whyYou.trim(),
        proof_links: cleanLinks,
        affiliation,
        responsibility_ack: true,
      };
      if (cadence === 'other') application.cadence_other = cadenceOther.trim();
      if (affiliation === 'yes') application.affiliation_detail = affiliationDetail.trim();

      await submitApplication('community_leader', application);
      hapticSuccess();
      setDone(true);
    } catch (e: any) {
      hapticError();
      setAlertInfo({ title: 'that did not go through', message: friendlyError(e, 'something went wrong, try again in a moment.') });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12}>
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2.5} />
        </TouchableOpacity>
      </View>

      {done ? (
        <Confirmation onDone={() => router.back()} />
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
            <Text style={styles.title}>start a community</Text>
            <Text style={styles.intro}>
              a group people join and belong to, run by you. a human reads every application and replies within a day.
            </Text>

            <Field label="your name" value={yourName} onChange={setYourName} maxLength={80} />

            <Field
              label="name your community."
              hint="working title is fine."
              value={communityName}
              onChange={setCommunityName}
              maxLength={80}
            />

            <Field
              label="what is it?"
              hint="what you'll do together and what makes it feel like something."
              value={concept}
              onChange={setConcept}
              multiline
              maxLength={500}
            />

            <Field
              label="who is it for?"
              hint="the people you want in the room."
              value={audience}
              onChange={setAudience}
              multiline
              maxLength={300}
            />

            <ChoiceList
              label="how often will things happen?"
              hint="a community here is alive, not a page."
              options={COMMUNITY_CADENCES}
              selected={cadence}
              onSelect={setCadence}
            />
            {cadence === 'other' && (
              <Field label="tell us" value={cadenceOther} onChange={setCadenceOther} maxLength={120} />
            )}

            <Field
              label="why you?"
              hint="what makes you the right person to hold this."
              value={whyYou}
              onChange={setWhyYou}
              multiline
              maxLength={300}
            />

            <LinksInput
              label="show us proof."
              hint="socials, past events, an existing group chat you run, anything real."
              links={proofLinks}
              onChange={setProofLinks}
            />

            <ChoiceList
              label="are you connected to a business, venue, or brand?"
              hint="totally fine if yes, we just need to know."
              options={AFFILIATION_OPTIONS}
              selected={affiliation}
              onSelect={setAffiliation}
            />
            {affiliation === 'yes' && (
              <Field label="tell us" value={affiliationDetail} onChange={setAffiliationDetail} maxLength={200} />
            )}

            <TouchableOpacity
              style={styles.ackCard}
              onPress={() => {
                hapticLight();
                setResponsibilityAck((v) => !v);
              }}
              activeOpacity={0.8}
            >
              <View style={[styles.ackCheckbox, responsibilityAck && styles.ackCheckboxActive]}>
                {responsibilityAck && <Check size={14} color={Colors.white} strokeWidth={3} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.ackTitle}>a community is a responsibility.</Text>
                <Text style={styles.ackBody}>
                  members will count on you to show up, keep it safe, and keep it going. you good with that?
                </Text>
                <Text style={styles.ackLabel}>{responsibilityAck ? "i'm in" : 'tap if you are'}</Text>
              </View>
            </TouchableOpacity>

            <TermsCheck checked={terms} onToggle={() => setTerms((t) => !t)} />
            <SubmitButton disabled={!valid} submitting={submitting} onPress={handleSubmit} />
          </ScrollView>
        </KeyboardAvoidingView>
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
  container: { flex: 1, backgroundColor: Colors.parchment },
  header: { paddingHorizontal: 16, paddingVertical: 8 },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 24, paddingBottom: 60 },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayLG,
    lineHeight: LineHeights.displayLG,
    color: Colors.darkWarm,
    marginBottom: 4,
  },
  intro: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    lineHeight: LineHeights.bodyMD,
    color: Colors.secondary,
    marginBottom: 24,
  },

  ackCard: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: Colors.creamWarm,
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.borderWarm,
  },
  ackCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: Colors.borderWarm,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  ackCheckboxActive: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  ackTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm, marginBottom: 4 },
  ackBody: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    lineHeight: LineHeights.bodySM,
    color: Colors.quoteText,
  },
  ackLabel: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.terracotta, marginTop: 8 },
});
