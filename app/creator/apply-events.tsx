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
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
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

export default function ApplyEventsScreen() {
  const router = useRouter();
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
        if (prior && ['declined', 'needs_more_info'].includes(prior.status)) {
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
  const cleanLinks = proofLinks.map((l) => l.trim()).filter(Boolean);

  const valid =
    !!applicantType &&
    (applicantType !== 'other' || applicantTypeOther.trim().length > 0) &&
    yourName.trim().length > 0 &&
    (isJustMe || publicName.trim().length > 0) &&
    categories.length > 0 &&
    !!frequency &&
    cleanLinks.length > 0 &&
    (!isVenue || venueAddress.trim().length > 0) &&
    !!ticketing &&
    about.trim().length > 0 &&
    terms;

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const application: Record<string, unknown> = {
        applicant_type: applicantType,
        your_name: yourName.trim(),
        event_categories: categories,
        frequency,
        proof_links: cleanLinks,
        ticketing_today: ticketing,
        about: about.trim(),
      };
      if (applicantType === 'other') application.applicant_type_other = applicantTypeOther.trim();
      if (!isJustMe) application.public_name = publicName.trim();
      if (isVenue) application.venue_address = venueAddress.trim();
      if (needsProvider && ticketingProvider.trim()) application.ticketing_provider = ticketingProvider.trim();

      await submitApplication('event_host', application);
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
            <Text style={styles.title}>put on events</Text>
            <Text style={styles.intro}>
              post one-off events to the scene. a human reads every application and replies within a day.
            </Text>

            <ChoiceList
              label="what are you?"
              options={APPLICANT_TYPES}
              selected={applicantType}
              onSelect={setApplicantType}
            />
            {applicantType === 'other' && (
              <Field label="tell us" value={applicantTypeOther} onChange={setApplicantTypeOther} maxLength={120} />
            )}

            <Field label="your name" value={yourName} onChange={setYourName} maxLength={80} />
            {applicantType && !isJustMe && (
              <Field
                label="the name people know you by"
                hint="your business, venue, or producer name. this is the name that shows on your event listings."
                value={publicName}
                onChange={setPublicName}
                maxLength={80}
              />
            )}

            <ChipMulti
              label="what kind of events?"
              options={EVENT_CATEGORIES}
              selected={categories}
              onToggle={(key) =>
                setCategories((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
              }
            />

            <ChoiceList label="how often?" options={EVENT_FREQUENCIES} selected={frequency} onSelect={setFrequency} />

            <LinksInput
              label="show us proof."
              hint="instagram, a past event page, your website, your venue's page."
              links={proofLinks}
              onChange={setProofLinks}
            />

            {isVenue && (
              <Field label="where's your spot?" hint="your venue's address." value={venueAddress} onChange={setVenueAddress} maxLength={160} />
            )}

            <ChoiceList
              label="how do people get tickets today?"
              options={TICKETING_OPTIONS}
              selected={ticketing}
              onSelect={setTicketing}
            />
            {needsProvider && (
              <Field label="which one?" value={ticketingProvider} onChange={setTicketingProvider} placeholder="eventbrite, dice, our own site..." maxLength={80} autoCapitalize="none" />
            )}

            <Field
              label="tell us about what you run."
              hint="two or three sentences, what a stranger should feel at your events."
              value={about}
              onChange={setAbout}
              multiline
              maxLength={400}
            />

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
});
