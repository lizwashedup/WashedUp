/**
 * Free RSVP settings (Build 35 Screen 59): a cohesive, RSVP-flavored page for
 * a price_cents = 0 ticket tier, reached as its own named destination from
 * tickets.tsx's "add an rsvp" action and from tapping an existing free tier
 * (Screen 23's other gap: "the Free RSVP branch as a named destination").
 * Same shell shape as question-editor.tsx (Screen 58): a routed screen with
 * id + entityId=new|<id>, hydrate-once, one save mutation.
 *
 * Deliberately reuses createTier/updateTier and every existing ticket_tiers
 * column (quantity_cap, per_order_min/max, sales_open_at/close_at,
 * visibility) -- no new schema, no new migration. "additional guests" is
 * per_order_max in RSVP language (how many people one RSVP covers,
 * themselves included), which the schema already supports; this page just
 * gives it a name and a home instead of the generic "most per purchase"
 * ticket-editor copy.
 *
 * NOT built here, named and left out rather than faked: an approval
 * workflow (a pending-until-organizer-approves RSVP state), a "maybe" RSVP
 * answer, and named guest invitations (inviting specific other people onto
 * one RSVP). None of the three has any backing column, table, or enum value
 * anywhere in this repo's tracked migrations (grepped clean across
 * ticket_tiers, ticket_orders, and the separate explore_event_rsvps table) --
 * each is real new schema, and this session has no live Supabase connection
 * to verify a new migration against the production database before writing
 * one. Shipping a toggle for any of the three with nothing behind it would
 * be exactly the fake-working-control this project's Release Discipline
 * rule exists to prevent.
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router, Redirect } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { hapticLight, hapticSuccess, hapticError } from '../../lib/haptics';
import { getCreatorAccess, canManageEvents, creatorLandingRoute } from '../../lib/creatorMode';
import { getLAWallParts, laWallTimeToUTC } from '../../lib/laDate';
import CollapsibleCalendar from '../../components/composer/CollapsibleCalendar';
import TimePicker from '../../components/composer/TimePicker';
import { type CalendarDay } from '../../components/calendar/WashedUpCalendar';
import {
  createTier,
  getTiers,
  TIER_DESCRIPTION_MAX,
  TIER_NAME_MAX,
  updateTier,
  type TicketTier,
} from '../../lib/ticketing';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' <-> CalendarDay (month 0-based). Same shape as
 *  TierEditorSheet's own local helper (that file's own comment notes it in
 *  turn mirrors event-form.tsx) -- a third small copy rather than exporting
 *  across files this session doesn't otherwise need to touch. */
function parseDateString(s: string): CalendarDay | null {
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? { year: Number(m[1]), month: Number(m[2]) - 1, day: Number(m[3]) } : null;
}

export default function RsvpSettingsScreen() {
  const { id, tierId } = useLocalSearchParams<{ id: string; tierId: string }>();
  const queryClient = useQueryClient();

  const { data: access } = useQuery({ queryKey: ['creator-access'], queryFn: getCreatorAccess });

  // same queryKey tickets.tsx uses for its own tier list -- invalidating it
  // on save is what makes that list pick up the change on the way back.
  const { data: tiers, isLoading: tiersLoading } = useQuery({
    queryKey: ['ticket-tiers', id],
    queryFn: () => getTiers(id!),
    enabled: !!id,
    staleTime: 15_000,
  });

  const isNew = tierId === 'new';
  const tier = isNew ? null : (tiers ?? []).find((t) => t.id === tierId) ?? null;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [capText, setCapText] = useState('');
  const [guestMaxText, setGuestMaxText] = useState('');
  const [hidden, setHidden] = useState(false);
  const [openDate, setOpenDate] = useState('');
  const [openTime, setOpenTime] = useState('');
  const [closeDate, setCloseDate] = useState('');
  const [closeTime, setCloseTime] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);

  useEffect(() => {
    if (hydrated) return;
    if (isNew) { setHydrated(true); return; }
    if (!tier) return; // list still loading
    setName(tier.name);
    setDescription(tier.description ?? '');
    setCapText(tier.quantity_cap ? String(tier.quantity_cap) : '');
    setGuestMaxText(tier.per_order_max ? String(tier.per_order_max) : '');
    setHidden(tier.visibility === 'hidden');
    const openWall = tier.sales_open_at ? getLAWallParts(tier.sales_open_at) : null;
    setOpenDate(openWall ? `${openWall.y}-${pad2(openWall.m + 1)}-${pad2(openWall.d)}` : '');
    setOpenTime(openWall ? `${pad2(openWall.hour24)}:${pad2(openWall.minute)}` : '');
    const closeWall = tier.sales_close_at ? getLAWallParts(tier.sales_close_at) : null;
    setCloseDate(closeWall ? `${closeWall.y}-${pad2(closeWall.m + 1)}-${pad2(closeWall.d)}` : '');
    setCloseTime(closeWall ? `${pad2(closeWall.hour24)}:${pad2(closeWall.minute)}` : '');
    setHydrated(true);
  }, [hydrated, isNew, tier]);

  const capDraft = capText.trim() ? parseInt(capText, 10) : null;
  const guestMaxDraft = guestMaxText.trim() ? parseInt(guestMaxText, 10) : null;
  const guestMaxProblem =
    guestMaxDraft === null
      ? null
      : isNaN(guestMaxDraft) || guestMaxDraft < 1
        ? /* copy to the taste gate */ 'that has to be at least 1.'
        : capDraft !== null && !isNaN(capDraft) && guestMaxDraft > capDraft
          ? /* copy to the taste gate */ "one rsvp can't cover more people than the whole cap."
          : null;

  const openParsedDay = parseDateString(openDate);
  const openTimeMatch = openTime.trim().match(/^(\d{2}):(\d{2})$/);
  const closeParsedDay = parseDateString(closeDate);
  const closeTimeMatch = closeTime.trim().match(/^(\d{2}):(\d{2})$/);
  const windowProblem = (() => {
    if (closeParsedDay && !closeTimeMatch) return 'the closing time did not parse.';
    if (openParsedDay && !openTimeMatch) return 'the opening time did not parse.';
    if (!closeParsedDay || !closeTimeMatch) return null;
    const closeInstant = laWallTimeToUTC(
      closeParsedDay.year, closeParsedDay.month, closeParsedDay.day,
      Number(closeTimeMatch[1]), Number(closeTimeMatch[2]),
    );
    if (openParsedDay && openTimeMatch) {
      const openInstant = laWallTimeToUTC(
        openParsedDay.year, openParsedDay.month, openParsedDay.day,
        Number(openTimeMatch[1]), Number(openTimeMatch[2]),
      );
      if (closeInstant.getTime() <= openInstant.getTime()) {
        return /* copy to the taste gate */ 'it closes before it opens. pick a later time.';
      }
    }
    return null;
  })();

  const canSave = name.trim().length > 0 && guestMaxProblem === null && windowProblem === null;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const salesOpenAt =
        openParsedDay && openTimeMatch
          ? laWallTimeToUTC(openParsedDay.year, openParsedDay.month, openParsedDay.day, Number(openTimeMatch[1]), Number(openTimeMatch[2])).toISOString()
          : null;
      const salesCloseAt =
        closeParsedDay && closeTimeMatch
          ? laWallTimeToUTC(closeParsedDay.year, closeParsedDay.month, closeParsedDay.day, Number(closeTimeMatch[1]), Number(closeTimeMatch[2])).toISOString()
          : null;
      const draft = {
        name: name.trim().slice(0, TIER_NAME_MAX),
        description: description.trim() ? description.trim().slice(0, TIER_DESCRIPTION_MAX) : null,
        price_cents: 0,
        quantity_cap: capDraft && capDraft > 0 ? capDraft : null,
        per_order_min: 1,
        per_order_max: guestMaxDraft && guestMaxDraft >= 1 ? guestMaxDraft : null,
        visibility: hidden ? ('hidden' as const) : ('visible' as const),
        status: tier?.status ?? ('draft' as const),
        sales_open_at: salesOpenAt,
        sales_close_at: salesCloseAt,
      };
      const result = tier
        ? await updateTier(tier.id, draft)
        : await createTier(id!, draft, tiers?.length ?? 0);
      if (!result.ok) throw new Error(result.message ?? 'save failed');
    },
    onSuccess: () => {
      hapticSuccess();
      queryClient.invalidateQueries({ queryKey: ['ticket-tiers', id] });
      router.back();
    },
    onError: (e: any) => {
      hapticError();
      setAlertInfo({ title: 'that did not save', message: e?.message ?? 'give it another try.' });
    },
  });

  const handleSave = () => {
    if (!canSave || saveMutation.isPending) { if (!canSave) hapticError(); return; }
    saveMutation.mutate();
  };

  if (access && !access.hasEventHostGrant && !canManageEvents(access)) {
    return <Redirect href={creatorLandingRoute(access)} />;
  }

  if (!isNew && tiersLoading && !tier) {
    return (
      <SafeAreaView style={styles.sheet} edges={['top', 'bottom']}>
        <View style={styles.loading}><ActivityIndicator size="small" color={Colors.terracotta} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.sheet} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="cancel">
          {/* LIZ COPY */}
          <Text style={styles.cancel}>cancel</Text>
        </TouchableOpacity>
        {/* copy to the taste gate */}
        <Text style={styles.headerTitle}>rsvp settings</Text>
        <TouchableOpacity onPress={handleSave} disabled={saveMutation.isPending} hitSlop={12} accessibilityRole="button" accessibilityLabel="save">
          <Text style={[styles.save, (!canSave || saveMutation.isPending) && styles.saveOff]}>save</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="rsvp"
            placeholderTextColor={Colors.textLight}
            maxLength={TIER_NAME_MAX}
          />

          <Text style={styles.label}>description (optional)</Text>
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            value={description}
            onChangeText={setDescription}
            placeholder="what to expect"
            placeholderTextColor={Colors.textLight}
            multiline
            maxLength={TIER_DESCRIPTION_MAX}
          />
          {/* copy to the taste gate: free is free at the code level, same
              note TierEditorSheet already gives a creator setting price to 0 */}
          <Text style={styles.freeNote}>free means free. no fees, no card, just an rsvp.</Text>

          <Text style={styles.label}>how many can come (blank = no cap)</Text>
          <TextInput
            style={styles.input}
            value={capText}
            onChangeText={setCapText}
            placeholder="no cap"
            placeholderTextColor={Colors.textLight}
            keyboardType="number-pad"
          />

          {/* copy to the taste gate: "additional guests" in rsvp language */}
          <Text style={styles.label}>people per rsvp, themselves included (blank = 1)</Text>
          <Text style={styles.labelHint}>lets one person rsvp for the group they&apos;re bringing.</Text>
          <TextInput
            style={styles.input}
            value={guestMaxText}
            onChangeText={setGuestMaxText}
            placeholder="1"
            placeholderTextColor={Colors.textLight}
            keyboardType="number-pad"
          />
          {!!guestMaxProblem && <Text style={styles.problem}>{guestMaxProblem}</Text>}

          <TouchableOpacity style={styles.checkRow} onPress={() => setHidden(!hidden)} activeOpacity={0.7}>
            <View style={[styles.checkbox, hidden && styles.checkboxChecked]}>
              {hidden && <Text style={styles.checkmark}>✓</Text>}
            </View>
            {/* copy to the taste gate */}
            <Text style={styles.checkLabel}>hidden. only people with the direct link see it</Text>
          </TouchableOpacity>

          <Text style={styles.label}>rsvp window (optional)</Text>
          <Text style={styles.labelHint}>blank opens right away and never closes on its own.</Text>

          <Text style={styles.label}>opens</Text>
          <View style={styles.pickerBlock}>
            <CollapsibleCalendar
              selected={openParsedDay}
              onSelect={(d) => setOpenDate(`${d.year}-${pad2(d.month + 1)}-${pad2(d.day)}`)}
              placeholder="opens right away"
            />
          </View>
          <View style={styles.pickerBlock}>
            <TimePicker
              hour={openTimeMatch ? (Number(openTimeMatch[1]) % 12 === 0 ? 12 : Number(openTimeMatch[1]) % 12) : 12}
              minute={openTimeMatch ? openTimeMatch[2] : '00'}
              period={openTimeMatch && Number(openTimeMatch[1]) >= 12 ? 'PM' : 'AM'}
              selected={!!openTimeMatch}
              onChange={(hour, minute, period) => {
                const h = period === 'PM' ? (hour % 12) + 12 : hour % 12;
                setOpenTime(`${pad2(h)}:${minute}`);
              }}
            />
            {!openParsedDay && !!openTime && <Text style={styles.problem}>pick an opening day too.</Text>}
            {!!openTimeMatch && (
              <TouchableOpacity onPress={() => { hapticLight(); setOpenDate(''); setOpenTime(''); }} hitSlop={8}>
                <Text style={styles.clearLink}>opens right away instead</Text>
              </TouchableOpacity>
            )}
          </View>

          <Text style={styles.label}>closes</Text>
          <View style={styles.pickerBlock}>
            <CollapsibleCalendar
              selected={closeParsedDay}
              onSelect={(d) => setCloseDate(`${d.year}-${pad2(d.month + 1)}-${pad2(d.day)}`)}
              placeholder="never closes"
            />
          </View>
          <View style={styles.pickerBlock}>
            <TimePicker
              hour={closeTimeMatch ? (Number(closeTimeMatch[1]) % 12 === 0 ? 12 : Number(closeTimeMatch[1]) % 12) : 12}
              minute={closeTimeMatch ? closeTimeMatch[2] : '00'}
              period={closeTimeMatch && Number(closeTimeMatch[1]) >= 12 ? 'PM' : 'AM'}
              selected={!!closeTimeMatch}
              onChange={(hour, minute, period) => {
                const h = period === 'PM' ? (hour % 12) + 12 : hour % 12;
                setCloseTime(`${pad2(h)}:${minute}`);
              }}
            />
            {!closeParsedDay && !!closeTime && <Text style={styles.problem}>pick a closing day too.</Text>}
            {!!closeTimeMatch && (
              <TouchableOpacity onPress={() => { hapticLight(); setCloseDate(''); setCloseTime(''); }} hitSlop={8}>
                <Text style={styles.clearLink}>never closes instead</Text>
              </TouchableOpacity>
            )}
          </View>
          {!!windowProblem && <Text style={styles.problem}>{windowProblem}</Text>}
        </ScrollView>
      </KeyboardAvoidingView>

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
  sheet: { flex: 1, backgroundColor: Colors.parchment },
  flex: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  cancel: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.textMedium },
  headerTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  save: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  saveOff: { color: Colors.textLight },
  content: { padding: 20, paddingBottom: 40 },
  label: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.textMedium, marginTop: 16, marginBottom: 6 },
  labelHint: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.textLight, marginBottom: 6, marginTop: -2 },
  input: {
    backgroundColor: Colors.inputBg, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.asphalt,
  },
  inputMultiline: { minHeight: 64, textAlignVertical: 'top' },
  freeNote: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium, marginTop: 8 },
  problem: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.errorRed, marginTop: 6 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  checkmark: { color: Colors.white, fontSize: FontSizes.bodySM, fontFamily: Fonts.sansBold },
  checkLabel: { flex: 1, fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.asphalt },
  pickerBlock: { marginBottom: 10 },
  clearLink: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.textLight, marginTop: 6 },
});
