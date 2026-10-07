import {useAfterglowFonts} from '../../hooks/useAfterglowFonts';
import {useMemo} from 'react';
import React, { useEffect, useRef, useState } from 'react';
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
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Colors from '../../constants/Colors';
import { type AfterglowFontFamilies, FontSizes } from '../../constants/Typography';
import { hapticLight, hapticSuccess, hapticError } from '../../lib/haptics';
import { randomUUID } from 'expo-crypto';
import { CreatorTicketEditorGate } from '../../components/creator/CreatorTicketEditorGate';
import type { CreatorPageScope } from '../../lib/creatorPageReview';
import { saveCreatorTier } from '../../lib/creatorTierEditor';
import { getLAWallParts, laWallTimeToUTC } from '../../lib/laDate';
import CollapsibleCalendar from '../../components/composer/CollapsibleCalendar';
import TimePicker from '../../components/composer/TimePicker';
import { type CalendarDay } from '../../components/calendar/WashedUpCalendar';
import {
  getTiers,
  TIER_DESCRIPTION_MAX,
  TIER_NAME_MAX,
  type TicketTier,
  type TierDraft,
} from '../../lib/ticketing';

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
  return <CreatorTicketEditorGate eventId={id} recordId={tierId} title="Free RSVP">{(scope,active)=><RsvpEditor id={id!} tierId={tierId!} scope={scope} active={active}/>}</CreatorTicketEditorGate>;
}
function RsvpEditor({id,tierId,scope,active}:{id:string;tierId:string;scope:CreatorPageScope;active:boolean}) {
  const {fonts}=useAfterglowFonts(true, 'creator');
  const styles=useMemo(()=>createStyles(fonts),[fonts]);
  const queryClient = useQueryClient();
  const {data:tiers,isLoading:tiersLoading,error:tiersError,refetch} = useQuery({
    queryKey:['ticket-tiers',id,scope.userId],queryFn:()=>getTiers(id,true,scope),enabled:active,staleTime:0,
  });
  const [recordId] = useState(()=>tierId==='new'?randomUUID():tierId);
  const baseline = useRef<TicketTier|null>(null);
  const saveLock = useRef(false);
  const pendingDraft = useRef<TierDraft|null>(null);
  const scroll = useRef<ScrollView>(null);
  const revealProblem = useRef(false);
  const [descriptionHeight,setDescriptionHeight] = useState(104);
  const [saveProblem,setSaveProblem] = useState<string>();
  const [uncertain,setUncertain] = useState(false);
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

  useEffect(() => {
    if (hydrated) return;
    if (isNew) { setHydrated(true); return; }
    if (!tier || tier.price_cents !== 0) return;
    baseline.current = tier;
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

  const capDraft = capText.trim() ? Number(capText.trim()) : null;
  const guestMaxDraft = guestMaxText.trim() ? Number(guestMaxText.trim()) : null;
  const guestMaxProblem =
    guestMaxDraft === null
      ? null
      : !/^\d+$/.test(guestMaxText.trim()) || !Number.isSafeInteger(guestMaxDraft) || guestMaxDraft < 1
        ? /* copy to the taste gate */ 'Use a positive whole number of people.'
        : capDraft !== null && !isNaN(capDraft) && guestMaxDraft > capDraft
          ? /* copy to the taste gate */ "one rsvp can't cover more people than the whole cap."
          : null;

  const openParsedDay = parseDateString(openDate);
  const openTimeMatch = openTime.trim().match(/^(\d{2}):(\d{2})$/);
  const closeParsedDay = parseDateString(closeDate);
  const closeTimeMatch = closeTime.trim().match(/^(\d{2}):(\d{2})$/);
  const windowProblem = (() => {
    if ((openTime && !openParsedDay) || (closeTime && !closeParsedDay)) return 'Choose a day as well as a time.';
    if (closeParsedDay && !closeTimeMatch) return 'Choose a closing time.';
    if (openParsedDay && !openTimeMatch) return 'Choose an opening time.';
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

  const capProblem = capDraft !== null && (!/^\d+$/.test(capText.trim()) || !Number.isSafeInteger(capDraft) || capDraft < 1) ? 'Total places must be a positive whole number.' : null;
  const canSave = name.trim().length > 0 && !capProblem && !guestMaxProblem && !windowProblem && hydrated && !tiersError && !tiersLoading && (isNew || !!tier && tier.price_cents === 0);

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
      const draft:TierDraft = pendingDraft.current ?? {
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
      pendingDraft.current=draft;
      return saveCreatorTier(id,recordId,draft,baseline.current,scope);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ticket-tiers', id, scope.userId] });
      if (!scope.isCurrent()) return;
      hapticSuccess(); router.back();
    },
    onError: () => {
      if (!scope.isCurrent()) return;
      hapticError(); setUncertain(true); revealProblem.current=true; setSaveProblem('Couldn’t confirm the save. Your RSVP details are kept. Retry to check their saved status.');
    },
  });

  const handleSave = async () => {
    if (saveLock.current || saveMutation.isPending || !active || !scope.isCurrent()) return;
    if (!canSave) { revealProblem.current=true; setSaveProblem(capProblem ?? guestMaxProblem ?? windowProblem ?? 'Give this RSVP a name.'); hapticError(); return; }
    saveLock.current=true;setSaveProblem(undefined);
    try { await saveMutation.mutateAsync(); } catch {} finally { saveLock.current=false; }
  };
  const close = () => { if (!saveLock.current && scope.isCurrent()) router.back(); };
  const locked = saveMutation.isPending || uncertain || !active;
  if (tiersLoading || tiersError || (!isNew && (!tier || tier.price_cents!==0))) return <SafeAreaView style={styles.sheet} edges={['top','bottom']}>
    <Stack.Screen options={{headerShown:false}}/>
    <View style={styles.header}><TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" style={styles.headerAction} onPress={close}><Text style={styles.cancel}>Back</Text></TouchableOpacity><Text accessibilityRole="header" style={styles.headerTitle}>Free RSVP</Text></View>
    <View style={styles.content}>{tiersLoading?<ActivityIndicator accessibilityLabel="Loading RSVP" color={Colors.terracotta}/>:<>
      <Text accessibilityRole="alert" style={styles.freeNote}>{tiersError?'Couldn’t load the saved RSVP.':'This free RSVP is no longer available.'}</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry RSVP lookup" style={styles.headerAction} onPress={()=>{void refetch();}}><Text style={styles.cancel}>Try again</Text></TouchableOpacity>
    </>}</View>
  </SafeAreaView>;

  return (
    <SafeAreaView style={styles.sheet} edges={['top', 'bottom']}>
      <Stack.Screen options={{headerShown:false}}/>
      <View style={styles.header}>
        <TouchableOpacity onPress={close} disabled={saveMutation.isPending} style={styles.headerAction} accessibilityRole="button" accessibilityLabel="cancel">
          {/* LIZ COPY */}
          <Text style={styles.cancel}>Close</Text>
        </TouchableOpacity>
        {/* copy to the taste gate */}
        <Text accessibilityRole="header" style={styles.headerTitle}>Free RSVP</Text>
        <TouchableOpacity onPress={()=>void handleSave()} disabled={saveMutation.isPending} style={[styles.headerAction,{alignItems:'flex-end'}]} accessibilityRole="button" accessibilityLabel="save">
          <Text style={[styles.save, (!canSave || saveMutation.isPending) && styles.saveOff]}>{saveMutation.isPending?'Saving…':uncertain?'Retry':'Save'}</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView ref={scroll} onContentSizeChange={()=>{if(revealProblem.current){revealProblem.current=false;scroll.current?.scrollTo({y:0,animated:false});}}} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          {saveProblem && <Text accessibilityRole="alert" style={[styles.problem,{marginBottom:12}]}>{saveProblem}</Text>}
          <View pointerEvents={locked ? 'none' : 'auto'}>
          <View style={styles.panel}>
          <Text style={[styles.label,{marginTop:0}]}>RSVP name</Text>
          <TextInput
            style={styles.input}
            accessibilityLabel="RSVP name"
            editable={!locked}
            value={name}
            onChangeText={setName}
            placeholder="rsvp"
            placeholderTextColor={Colors.textLight}
            maxLength={TIER_NAME_MAX}
          />

          <Text style={styles.label}>Description (optional)</Text>
          <TextInput
            style={[styles.input, styles.inputMultiline, {height:descriptionHeight}]}
            onContentSizeChange={event=>setDescriptionHeight(Math.max(104,Math.min(180,event.nativeEvent.contentSize.height)))}
            accessibilityLabel="RSVP description"
            editable={!locked}
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

          </View><Text style={styles.section}>Places & guests</Text><View style={styles.panel}>
          <Text style={[styles.label,{marginTop:0}]}>Total places</Text>
          <TextInput
            style={styles.input}
            accessibilityLabel="Total places"
            editable={!locked}
            value={capText}
            onChangeText={setCapText}
            placeholder="no cap"
            placeholderTextColor={Colors.textLight}
            keyboardType="number-pad"
          />

          {/* copy to the taste gate: "additional guests" in rsvp language */}
          <Text style={styles.label}>People per RSVP</Text>
          <Text style={styles.labelHint}>Optional limit, including the person signing up.</Text>
          <TextInput
            style={styles.input}
            accessibilityLabel="People per RSVP"
            editable={!locked}
            value={guestMaxText}
            onChangeText={setGuestMaxText}
            placeholder="No extra limit"
            placeholderTextColor={Colors.textLight}
            keyboardType="number-pad"
          />
          {!!capProblem && <Text style={styles.problem}>{capProblem}</Text>}
          {!!guestMaxProblem && <Text style={styles.problem}>{guestMaxProblem}</Text>}

          <TouchableOpacity accessibilityRole="checkbox" aria-checked={hidden} accessibilityLabel="Hidden RSVP" accessibilityState={{checked:hidden,disabled:locked}} disabled={locked} style={styles.checkRow} onPress={() => setHidden(!hidden)} activeOpacity={0.7}>
            <View style={[styles.checkbox, hidden && styles.checkboxChecked]}>
              {hidden && <Text style={styles.checkmark}>✓</Text>}
            </View>
            {/* copy to the taste gate */}
            <Text style={styles.checkLabel}>Hidden RSVP</Text>
          </TouchableOpacity>

          </View><Text style={styles.section}>RSVP window</Text><View style={styles.panel}>
          <Text style={styles.labelHint}>Optional · Los Angeles time. Leave blank to use the event’s sales window.</Text>

          <Text style={styles.label}>opens</Text>
          <View style={styles.pickerBlock}>
            <CollapsibleCalendar
                  appearance={{fonts}}
              selected={openParsedDay}
              onSelect={(d) => {if(!saveLock.current && !pendingDraft.current && scope.isCurrent())setOpenDate(`${d.year}-${pad2(d.month + 1)}-${pad2(d.day)}`);}}
              placeholder="opens right away"
            />
          </View>
          <View style={styles.pickerBlock}>
            <TimePicker
                  appearance={{fonts,sunset:true}}
              hour={openTimeMatch ? (Number(openTimeMatch[1]) % 12 === 0 ? 12 : Number(openTimeMatch[1]) % 12) : 12}
              minute={openTimeMatch ? openTimeMatch[2] : '00'}
              period={openTimeMatch && Number(openTimeMatch[1]) >= 12 ? 'PM' : 'AM'}
              selected={!!openTimeMatch}
              onChange={(hour, minute, period) => {
                if(saveLock.current || pendingDraft.current || !scope.isCurrent())return;
                const h = period === 'PM' ? (hour % 12) + 12 : hour % 12;
                setOpenTime(`${pad2(h)}:${minute}`);
              }}
            />
            {!openParsedDay && !!openTime && <Text style={styles.problem}>pick an opening day too.</Text>}
            {!!openTimeMatch && (
              <TouchableOpacity disabled={locked} onPress={() => {if(saveLock.current || pendingDraft.current)return; hapticLight(); setOpenDate(''); setOpenTime(''); }} hitSlop={8}>
                <Text style={styles.clearLink}>opens right away instead</Text>
              </TouchableOpacity>
            )}
          </View>

          <Text style={styles.label}>closes</Text>
          <View style={styles.pickerBlock}>
            <CollapsibleCalendar
                  appearance={{fonts}}
              selected={closeParsedDay}
              onSelect={(d) => {if(!saveLock.current && !pendingDraft.current && scope.isCurrent())setCloseDate(`${d.year}-${pad2(d.month + 1)}-${pad2(d.day)}`);}}
              placeholder="never closes"
            />
          </View>
          <View style={styles.pickerBlock}>
            <TimePicker
                  appearance={{fonts,sunset:true}}
              hour={closeTimeMatch ? (Number(closeTimeMatch[1]) % 12 === 0 ? 12 : Number(closeTimeMatch[1]) % 12) : 12}
              minute={closeTimeMatch ? closeTimeMatch[2] : '00'}
              period={closeTimeMatch && Number(closeTimeMatch[1]) >= 12 ? 'PM' : 'AM'}
              selected={!!closeTimeMatch}
              onChange={(hour, minute, period) => {
                if(saveLock.current || pendingDraft.current || !scope.isCurrent())return;
                const h = period === 'PM' ? (hour % 12) + 12 : hour % 12;
                setCloseTime(`${pad2(h)}:${minute}`);
              }}
            />
            {!closeParsedDay && !!closeTime && <Text style={styles.problem}>pick a closing day too.</Text>}
            {!!closeTimeMatch && (
              <TouchableOpacity disabled={locked} onPress={() => {if(saveLock.current || pendingDraft.current)return; hapticLight(); setCloseDate(''); setCloseTime(''); }} hitSlop={8}>
                <Text style={styles.clearLink}>never closes instead</Text>
              </TouchableOpacity>
            )}
          </View>
          {!!windowProblem && <Text style={styles.problem}>{windowProblem}</Text>}
          </View></View>
        </ScrollView>
      </KeyboardAvoidingView>


    </SafeAreaView>
  );
}

function createStyles(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  panel: { backgroundColor: Colors.white, borderRadius:16, padding:16 },
  section: {fontFamily:fonts.semibold,fontSize:FontSizes.bodyLG,color:Colors.asphalt,marginTop:22,marginBottom:10},
  headerAction: {minWidth:64,minHeight:44,justifyContent:'center'},
  sheet: { flex: 1, backgroundColor: Colors.parchment },
  flex: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border,
  },
  cancel: { fontFamily: fonts.medium, fontSize: FontSizes.bodyMD, color: Colors.textMedium },
  headerTitle: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  save: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  saveOff: { color: Colors.textLight },
  content: { padding: 20, paddingBottom: 40 },
  label: { fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: Colors.textMedium, marginTop: 16, marginBottom: 6 },
  labelHint: { fontFamily: fonts.regular, fontSize: FontSizes.caption, color: Colors.textMedium, marginBottom: 6, marginTop: -2 },
  input: {
    backgroundColor: Colors.white, borderWidth:1,borderColor:Colors.border,borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12,
    fontFamily: fonts.regular, fontSize: FontSizes.bodyLG, color: Colors.asphalt,
  },
  inputMultiline: { minHeight: 64, textAlignVertical: 'top' },
  freeNote: { fontFamily: fonts.regular, fontSize: FontSizes.bodySM, color: Colors.textMedium, marginTop: 8 },
  problem: { fontFamily: fonts.regular, fontSize: FontSizes.bodySM, color: Colors.errorBrand, marginTop: 6 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, minHeight:44 },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: Colors.textMedium,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  checkmark: { color: Colors.white, fontSize: FontSizes.bodySM, fontFamily: fonts.semibold },
  checkLabel: { flex: 1, fontFamily: fonts.regular, fontSize: FontSizes.bodySM, color: Colors.asphalt },
  pickerBlock: { marginBottom: 10 },
  clearLink: { fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: Colors.textLight, marginTop: 6 },
}); }
