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
import { ArrowLeft } from 'lucide-react-native';
import { supabase } from '../../lib/supabase';
import { friendlyError } from '../../lib/friendlyError';
import { hapticSuccess, hapticError } from '../../lib/haptics';
import { SceneDetailColors as Scene } from '../../constants/Colors';
import { LinearGradient } from 'expo-linear-gradient';
import ProfileButton from '../../components/ProfileButton';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { FontSizes, LineHeights, type AfterglowFontFamilies } from '../../constants/Typography';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import {
  Field,
  ChoiceList,
  ChipMulti,
  LinksInput,
  TermsCheck,
  SubmitButton,
  Confirmation,
} from '../../components/creator/ApplyFormKit';
import {
  APPLICANT_TYPES,
  EVENT_CATEGORIES,
  EVENT_FREQUENCIES,
  TICKETING_OPTIONS,
  fetchMyGrants,
  submitApplication,
} from '../../lib/operatorApplications';
import { useApplicationFormGuidance } from '../../components/creator/useApplicationFormGuidance';
import { buildEventApplication, missingEventApplicationFields } from '../../lib/operatorApplicationForms';


const sentenceCaseOptions = (options: typeof EVENT_CATEGORIES) => options.map(option => ({ ...option, label: option.label.charAt(0).toUpperCase() + option.label.slice(1) }));
const APPLICANT_TYPE_LABELS = APPLICANT_TYPES.map(option => ({
  ...option,
  label: ({ just_me: 'Just me', producer_promoter: 'Event producer or promoter', venue: 'Venue', artist: 'Artist or performer', business_brand: 'Business or brand', other: 'Something else' } as Record<string, string>)[option.key] ?? option.label,
}));
const FIELD_ERRORS: Record<string, string> = {
  "what are you?": "Choose the option that best describes you.",
  "tell us": "Describe your work.",
  "your name": "Enter your name.",
  "the name people know you by": "Enter the name people will see on your events.",
  "what kind of events?": "Choose at least one event category.",
  "how often?": "Choose how often you put on events.",
  "show us proof (at least one link)": "Add at least one link.",
  "where's your spot?": "Enter your venue’s address.",
  "how do people get tickets today?": "Choose how people get tickets.",
  "tell us about what you run": "Tell us about your events.",
  "agree to the terms": "Agree to the creator terms to submit."
};

export default function ApplyEventsScreen() {
  const router = useRouter();
  const { fonts } = useAfterglowFonts(true, 'creator');
  const appearance = React.useMemo(() => ({ fonts, application: true }), [fonts]);
  const styles = React.useMemo(() => createStyles(fonts), [fonts]);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);

  const [applicantType, setApplicantType] = useState<string | null>(null);
  const [applicantTypeOther, setApplicantTypeOther] = useState('');
  const [yourName, setYourName] = useState('');
  const [publicName, setPublicName] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [frequency, setFrequency] = useState<string | null>(null);
  const [proofLinks, setProofLinks] = useState<string[]>(['', '', '']);
  const [venueAddress, setVenueAddress] = useState('');
  const [ticketing, setTicketing] = useState<string | null>(null);
  const [ticketingProvider, setTicketingProvider] = useState('');
  const [about, setAbout] = useState('');
  const [terms, setTerms] = useState(false);

  // prefill name from profile, and prior answers if resubmitting
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
        const prior = grants.find((g) => g.track === 'event_host');
        // Screen 47 "resumable applications" (delta matrix): a withdrawn
        // application is the applicant's own reversible choice, not a no --
        // "apply again anytime" (apply.tsx statusLine) should resume with
        // what they already wrote, same as declined/needs_more_info.
        if (prior && ['declined', 'needs_more_info', 'withdrawn'].includes(prior.status)) {
          const a = prior.application as Record<string, any>;
          if (a.applicant_type) setApplicantType(a.applicant_type);
          if (a.applicant_type_other) setApplicantTypeOther(a.applicant_type_other);
          if (a.your_name) setYourName(a.your_name);
          if (a.public_name) setPublicName(a.public_name);
          if (Array.isArray(a.event_categories)) setCategories(a.event_categories);
          if (a.frequency) setFrequency(a.frequency);
          if (Array.isArray(a.proof_links)) setProofLinks([...a.proof_links, '', '', ''].slice(0, 3));
          if (a.venue_address) setVenueAddress(a.venue_address);
          if (a.ticketing_today) setTicketing(a.ticketing_today);
          if (a.ticketing_provider) setTicketingProvider(a.ticketing_provider);
          if (a.about) setAbout(a.about);
        }
      } catch {
        // prefill is best-effort
      }
    })();
  }, []);

  const isJustMe = applicantType === 'just_me';
  const isVenue = applicantType === 'venue';
  const needsProvider = ticketing === 'other_site' || ticketing === 'both';
  const applicationDraft = {
    applicantType, applicantTypeOther, yourName, publicName, categories, frequency,
    proofLinks, venueAddress, ticketing, ticketingProvider, about, terms,
  };
  const missingFields = missingEventApplicationFields(applicationDraft);
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
      await submitApplication('event_host', buildEventApplication(applicationDraft));
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
        <Text style={styles.headerLabel}>Organization application</Text>
        <ProfileButton surface="scene" />
      </View>

      {done ? (
        <Confirmation appearance={appearance} title="Application received" doneLabel="Done" onDone={() => router.back()} />
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView ref={guidance.scrollRef} onLayout={guidance.onViewportLayout} onContentSizeChange={guidance.onContentSizeChange} onScrollBeginDrag={guidance.cancelReveal} onTouchStart={guidance.cancelReveal} style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
            <Text accessibilityRole="header" style={styles.title}>Apply for an organization</Text>
            <Text style={styles.intro}>
              Tell us about your business, venue, team, or the events you create yourself.
            </Text>
            <Text style={styles.reviewNote}>We’ll review new applications when the refreshed Scene is ready.</Text>

            <ChoiceList guidance={guidance.field("what are you?")} appearance={appearance}
              label="Which best describes you?"
              options={APPLICANT_TYPE_LABELS}
              selected={applicantType}
              onSelect={setApplicantType}
            />
            {applicantType === 'other' && (
              <Field guidance={guidance.field("tell us")} appearance={appearance} label="How would you describe your work?" value={applicantTypeOther} onChange={setApplicantTypeOther} maxLength={120} />
            )}

            <Field guidance={guidance.field("your name")} appearance={appearance} label="Your name" value={yourName} onChange={setYourName} maxLength={80} />
            {applicantType && !isJustMe && (
              <Field guidance={guidance.field("the name people know you by")} appearance={appearance}
                label="Public name"
                hint="The business, venue, or creator name people will see on your event listings."
                value={publicName}
                onChange={setPublicName}
                maxLength={80}
              />
            )}

            <ChipMulti guidance={guidance.field("what kind of events?")} appearance={appearance}
              label="What kinds of events do you create?"
              options={sentenceCaseOptions(EVENT_CATEGORIES)}
              selected={categories}
              onToggle={(key) =>
                setCategories((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
              }
            />

            <ChoiceList guidance={guidance.field("how often?")} appearance={appearance} label="How often do you put on events?" options={sentenceCaseOptions(EVENT_FREQUENCIES)} selected={frequency} onSelect={setFrequency} />

            <LinksInput guidance={guidance.field("show us proof (at least one link)")} appearance={appearance}
              label="Links to your work"
              hint="Add at least one link to your website, social profile, venue, or a past event."
              links={proofLinks}
              onChange={setProofLinks}
            />

            {isVenue && (
              <Field guidance={guidance.field("where's your spot?")} appearance={appearance} label="Venue address" hint="The address of your venue." value={venueAddress} onChange={setVenueAddress} maxLength={160} />
            )}

            <ChoiceList guidance={guidance.field("how do people get tickets today?")} appearance={appearance}
              label="How do people get tickets today?"
              options={sentenceCaseOptions(TICKETING_OPTIONS)}
              selected={ticketing}
              onSelect={setTicketing}
            />
            {needsProvider && (
              <Field appearance={appearance} label="Ticketing provider (optional)" value={ticketingProvider} onChange={setTicketingProvider} placeholder="Eventbrite, DICE, or your own website" maxLength={80} autoCapitalize="none" />
            )}

            <Field guidance={guidance.field("tell us about what you run")} appearance={appearance}
              label="Tell us about your events"
              hint="In two or three sentences, describe what people can expect."
              value={about}
              onChange={setAbout}
              multiline
              maxLength={400}
            />

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
});
