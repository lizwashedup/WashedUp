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
import Colors, { SceneDetailColors as Scene } from '../../constants/Colors';
import { LinearGradient } from 'expo-linear-gradient';
import ProfileButton from '../../components/ProfileButton';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { FontSizes, LineHeights, type AfterglowFontFamilies } from '../../constants/Typography';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import {
  Field,
  FieldError,
  ChoiceList,
  LinksInput,
  TermsCheck,
  SubmitButton,
  Confirmation,
} from '../../components/creator/ApplyFormKit';
import { COMMUNITY_CADENCES, fetchMyGrants, submitApplication } from '../../lib/operatorApplications';
import { useApplicationFormGuidance } from '../../components/creator/useApplicationFormGuidance';
import { buildCommunityApplication, missingCommunityApplicationFields } from '../../lib/operatorApplicationForms';

const AFFILIATION_OPTIONS = [
  { key: 'no', label: 'No' },
  { key: 'yes', label: 'Yes' },
];


const COMMUNITY_CADENCE_LABELS = COMMUNITY_CADENCES.map(option => ({ ...option, label: option.label.charAt(0).toUpperCase() + option.label.slice(1) }));
const FIELD_ERRORS: Record<string, string> = {
  "your name": "Enter your name.",
  "name your community": "Enter a name for your community.",
  "what is it?": "Describe what your community will do.",
  "who is it for?": "Tell us who your community is for.",
  "how often will things happen?": "Choose how often you plan to meet.",
  "tell us (how often)": "Enter your planned schedule.",
  "why you?": "Tell us about yourself.",
  "show us proof (at least one link)": "Add at least one link.",
  "are you connected to a business, venue, or brand?": "Choose Yes or No.",
  "tell us (affiliation)": "Describe the affiliation.",
  "agree to the terms": "Agree to the creator terms to submit.",
  "agree a community is a responsibility": "Confirm the community responsibility acknowledgement."
};

export default function ApplyCommunityScreen() {
  const router = useRouter();
  const { fonts } = useAfterglowFonts(true, 'creator');
  const appearance = React.useMemo(() => ({ fonts, application: true }), [fonts]);
  const styles = React.useMemo(() => createStyles(fonts), [fonts]);
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
        // Screen 47 "resumable applications" (delta matrix): a withdrawn
        // application is the applicant's own reversible choice, not a no --
        // "apply again anytime" (apply.tsx statusLine) should resume with
        // what they already wrote, same as declined/needs_more_info.
        if (prior && ['declined', 'needs_more_info', 'withdrawn'].includes(prior.status)) {
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

  const applicationDraft = {
    yourName, communityName, concept, audience, cadence, cadenceOther, whyYou,
    proofLinks, affiliation, affiliationDetail, responsibilityAck, terms,
  };
  const missingFields = missingCommunityApplicationFields(applicationDraft);
  const valid = missingFields.length === 0;
  const guidance = useApplicationFormGuidance(missingFields, FIELD_ERRORS);

  // What's still unfilled, in the form's own words, so a tap on the greyed
  // submit action explains itself instead of doing nothing.
  const attemptSubmit = () => {
    if (submitting) return;
    if (!valid) {
      hapticError();
      guidance.revealFirstInvalid();
      return;
    }
    handleSubmit();
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await submitApplication('community_leader', buildCommunityApplication(applicationDraft));
      hapticSuccess();
      setDone(true);
    } catch (e: any) {
      hapticError();
      setAlertInfo({ title: 'That did not go through', message: friendlyError(e, 'Try again in a moment. Your answers are still here.') });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <LinearGradient colors={[Scene.upper, Scene.middle, Scene.lower]} locations={Scene.gradientLocations} style={styles.container}>
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.headerBtn} hitSlop={8}>
          <ArrowLeft size={22} color={Scene.text} strokeWidth={2.5} />
        </TouchableOpacity>
        <Text style={styles.headerLabel}>Community application</Text>
        <ProfileButton surface="scene" />
      </View>

      {done ? (
        <Confirmation appearance={appearance} title="Application received" doneLabel="Done" onDone={() => router.back()} />
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView ref={guidance.scrollRef} onLayout={guidance.onViewportLayout} onContentSizeChange={guidance.onContentSizeChange} onScrollBeginDrag={guidance.cancelReveal} onTouchStart={guidance.cancelReveal} style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
            <Text accessibilityRole="header" style={styles.title}>Apply for a community</Text>
            <Text style={styles.intro}>
              Tell us about the people you want to bring together and what you’ll do as a community.
            </Text>
            <Text style={styles.reviewNote}>We’ll review new applications when the refreshed Scene is ready.</Text>

            <Field guidance={guidance.field("your name")} appearance={appearance} label="Your name" value={yourName} onChange={setYourName} maxLength={80} />

            <Field guidance={guidance.field("name your community")} appearance={appearance}
              label="Community name"
              hint="A working name is fine."
              value={communityName}
              onChange={setCommunityName}
              maxLength={80}
            />

            <Field guidance={guidance.field("what is it?")} appearance={appearance}
              label="What will your community do?"
              hint="Describe the activities or interests that will bring people together."
              value={concept}
              onChange={setConcept}
              multiline
              maxLength={500}
            />

            <Field guidance={guidance.field("who is it for?")} appearance={appearance}
              label="Who is your community for?"
              hint="Tell us who you hope will join."
              value={audience}
              onChange={setAudience}
              multiline
              maxLength={300}
            />

            <ChoiceList guidance={guidance.field("how often will things happen?")} appearance={appearance}
              label="How often will you meet?"
              hint="Choose the schedule you have in mind."
              options={COMMUNITY_CADENCE_LABELS}
              selected={cadence}
              onSelect={setCadence}
            />
            {cadence === 'other' && (
              <Field guidance={guidance.field("tell us (how often)")} appearance={appearance} label="Your planned schedule" value={cadenceOther} onChange={setCadenceOther} maxLength={120} />
            )}

            <Field guidance={guidance.field("why you?")} appearance={appearance}
              label="Tell us about yourself"
              hint="Share why you want to create this community and any relevant experience."
              value={whyYou}
              onChange={setWhyYou}
              multiline
              maxLength={300}
            />

            <LinksInput guidance={guidance.field("show us proof (at least one link)")} appearance={appearance}
              label="Links to your work"
              hint="Add at least one link to your website, social profile, past events, or an existing community."
              links={proofLinks}
              onChange={setProofLinks}
            />

            <ChoiceList guidance={guidance.field("are you connected to a business, venue, or brand?")} appearance={appearance}
              label="Is this connected to a business, venue, or brand?"
              hint="Let us know about any affiliation."
              options={AFFILIATION_OPTIONS}
              selected={affiliation}
              onSelect={setAffiliation}
            />
            {affiliation === 'yes' && (
              <Field guidance={guidance.field("tell us (affiliation)")} appearance={appearance} label="Describe the affiliation" value={affiliationDetail} onChange={setAffiliationDetail} maxLength={200} />
            )}

            <View onLayout={guidance.field("agree a community is a responsibility").onLayout} style={styles.ackField}>
            <TouchableOpacity
              style={styles.ackCard}
              accessibilityHint={guidance.field("agree a community is a responsibility").error}
              accessibilityRole="checkbox"
              accessibilityLabel="A community is a responsibility"
              accessibilityState={{ checked: responsibilityAck }}
              onPress={() => {
                hapticLight();
                setResponsibilityAck((v) => !v);
              }}
              activeOpacity={0.8}
            >
              <View style={[styles.ackCheckbox, responsibilityAck && styles.ackCheckboxActive]}>
                {responsibilityAck && <Check size={14} color={Colors.white} strokeWidth={3} />}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.ackTitle}>a community is a responsibility.</Text>
                <Text style={styles.ackBody}>
                  members will count on you to show up, keep it safe, and keep it going. you good with that?
                </Text>
                <Text style={styles.ackLabel}>{responsibilityAck ? "i'm in" : 'tap if you are'}</Text>
              </View>
            </TouchableOpacity>
            <FieldError message={guidance.field("agree a community is a responsibility").error} appearance={appearance} />
            </View>

            <TermsCheck guidance={guidance.field("agree to the terms")} appearance={appearance} checked={terms} onToggle={() => setTerms((t) => !t)} />
            <SubmitButton appearance={appearance} label="Submit application" inactive={!valid} submitting={submitting} onPress={attemptSubmit} />
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
    </LinearGradient>
  );
}

const createStyles = (fonts: AfterglowFontFamilies) => StyleSheet.create({
  container: { flex: 1, backgroundColor: Scene.lower },
  safe: { flex: 1 },
  scroll: { flex: 1 },
  header: { paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerLabel: { flex: 1, minWidth: 0, fontFamily: fonts.medium, fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD, color: Scene.text },
  headerBtn: { width: 44, height: 44, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 },
  reviewNote: { fontFamily: fonts.regular, fontSize: FontSizes.bodySM, lineHeight: LineHeights.bodySM, color: Scene.supporting, borderLeftWidth: 2, borderLeftColor: Scene.action, paddingLeft: 12, marginBottom: 24 },
  title: {
    fontFamily: fonts.display,
    fontSize: FontSizes.displayLG,
    lineHeight: LineHeights.displayLG,
    color: Scene.text,
    marginBottom: 12,
  },
  intro: {
    fontFamily: fonts.regular,
    fontSize: FontSizes.bodyLG,
    lineHeight: LineHeights.bodyLG,
    color: Scene.supporting,
    marginBottom: 16,
  },

  ackField: { width: '100%', marginBottom: 20 },
  ackCard: {
    flexDirection: 'row',
    minHeight: 44,
    width: '100%',
    gap: 12,
    backgroundColor: Scene.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 0,
    borderWidth: 1,
    borderColor: Scene.border,
  },
  ackCheckbox: {
    width: 22,
    height: 22,
    flexShrink: 0,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: Scene.border,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  ackCheckboxActive: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  ackTitle: { fontFamily: fonts.medium, fontSize: FontSizes.bodyMD, color: Scene.text, marginBottom: 4 },
  ackBody: {
    fontFamily: fonts.regular,
    fontSize: FontSizes.bodySM,
    lineHeight: LineHeights.bodySM,
    color: Colors.quoteText,
  },
  ackLabel: { fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: Colors.terracotta, marginTop: 8 },
});
