import React, { useMemo, type ReactNode, type RefObject } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, TextInput, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { ImagePlus, X } from 'lucide-react-native';
import { GooglePlacesAutocomplete, type GooglePlacesAutocompleteRef } from 'react-native-google-places-autocomplete';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScaledText as Text } from '../ScaledText';
import WashedUpCalendar from '../calendar/WashedUpCalendar';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../keyboard/KeyboardDoneBar';
import Colors, { AfterglowColors } from '../../constants/Colors';
import { MAX_GROUP, MIN_GROUP, FEATURED_MIN_CAPACITY, FEATURED_MAX_CAPACITY, FEATURED_DEFAULT_CAPACITY } from '../../constants/GroupLimits';
import type { AfterglowFontFamilies } from '../../constants/Typography';
import type { usePlanEditDraft } from '../../hooks/usePlanEditDraft';
import type { usePlanEdit } from '../../hooks/usePlanEdit';
import { AGE_RANGES, type AgeRange } from '../../lib/planEditDraft';
import { savedAgeLabel } from '../../lib/planEditRules';
import { hapticLight } from '../../lib/haptics';
import { GOOGLE_MAPS_API_KEY } from '../../lib/googleMapsKey';
import { detailAppearance } from './planDetailAppearance';
import { legacyManagePlacesStyles, legacyManageStyles, manageAppearance } from './managePlanEditorStyles';

const MANAGE_CATEGORIES = [
  'Art', 'Business', 'Comedy', 'Film', 'Fitness',
  'Food', 'Gaming', 'Music', 'Nightlife', 'Outdoors',
  'Sports', 'Tech', 'Wellness', 'Other',
] as const;

// Manage-Plan description limit. Matches the composer's DESC_LIMIT (2000) so
// editing never silently truncates a description created at the higher cap.
const EDIT_DESC_LIMIT = 2000;
const EDIT_DESC_WARN_MARGIN = 200; // counter turns warn-colored within this many chars of the cap

// ─── Date/time picker constants ───────────────────────────────────────────────
// Keep display values aligned with the shared creation controls.

const MINUTE_OPTIONS = ['00', '15', '30', '45'];
const PERIODS: ('AM' | 'PM')[] = ['AM', 'PM'];

function displayPickerTime(hour: number, minute: string, period: 'AM' | 'PM'): string {
  return `${hour}:${minute} ${period}`;
}

type Props = {
  editor: Omit<ReturnType<typeof usePlanEditDraft>, 'reset' | 'closePickers'>;
  edit: Pick<ReturnType<typeof usePlanEdit>, 'isBusy' | 'unknown' | 'error' | 'isSaving' | 'isPhotoPending' | 'canChange' | 'check' | 'pickPhoto'>;
  managePlacesRef: RefObject<GooglePlacesAutocompleteRef | null>;
  manageGenderOptions: { label: string; value: string }[];
  appearance?: { fonts: AfterglowFontFamilies };
  isCirclePlan: boolean;
  isCreator: boolean;
  isOfficialCreator: boolean;
  onClose: () => void;
  onSave: () => void;
  onCancel: () => void;
  onDuplicate?: () => void;
  onOpenDatePicker: () => void;
  onOpenTimePicker: () => void;
  onConfirmTime: () => void;
  onToggleAgeRange: (range: AgeRange) => void;
  children?: ReactNode;
};

/** Form presentation only. The parent retains the Modal and its dismissal
 * transition, current-account gates, save preparation, and navigation actions.
 * The draft stays in the parent, independent of the native modal presentation.
 */
export function ManagePlanEditor({ editor, edit, managePlacesRef, manageGenderOptions,
  appearance, isCirclePlan, isCreator, isOfficialCreator, onClose, onSave, onCancel,
  onDuplicate, onOpenDatePicker, onOpenTimePicker, onConfirmTime, onToggleAgeRange, children,
}: Props) {
  const insets = useSafeAreaInsets();
  const { draft, original: editOriginal } = editor;
  const editSaving = edit.isSaving, editImageLoading = edit.isPhotoPending;
  const manageStyles = useMemo(() => appearance ? manageAppearance(legacyManageStyles, appearance.fonts) : legacyManageStyles, [appearance]);
  const managePlacesStyles = useMemo(() => appearance ? detailAppearance(legacyManagePlacesStyles, appearance.fonts) : legacyManagePlacesStyles, [appearance]);
  return (
    <KeyboardAvoidingView style={manageStyles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={manageStyles.sheet}>
        <View style={manageStyles.headerRow}>
          <Text style={manageStyles.title}>Manage Plan</Text>
          <TouchableOpacity style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }} accessibilityRole="button" accessibilityLabel="Close editor" disabled={edit.isBusy} onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={manageStyles.closeX}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          decelerationRate="normal"
          showsVerticalScrollIndicator={true}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{
            // Android edge-to-edge: Modal renders full-screen behind
            // the nav/gesture bar, so the ScrollView needs explicit
            // insets.bottom padding or the last item (Cancel This Plan)
            // ends up clipped by the system bar. iOS unchanged.
            paddingBottom: 24 + (Platform.OS === 'android' ? insets.bottom : 0),
          }}
          scrollIndicatorInsets={{ right: 2 }}
        >
    <View pointerEvents={edit.isBusy || edit.unknown ? "none" : "auto"}>
          {/* Title */}
          <Text style={manageStyles.label}>Title</Text>
          <TextInput
            editable={!edit.isBusy && !edit.unknown}
            style={manageStyles.input}
            accessibilityLabel="Plan title"
            value={draft.title}
            onChangeText={(value) => editor.setField('title', value)}
            maxLength={80}
            placeholder="Plan title"
            placeholderTextColor={Colors.textLight}
            returnKeyType="done"
            onSubmitEditing={Keyboard.dismiss}
            inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
          />

          {/* Plan photo */}
          <Text style={manageStyles.label}>Plan photo</Text>
          <View style={manageStyles.photoRow}>
            {draft.imageUrl ? (
              <View style={manageStyles.photoThumbWrap}>
                <Image source={{ uri: draft.imageUrl }} style={manageStyles.photoThumb} contentFit="cover" />
                {editImageLoading ? (
                  <View style={manageStyles.photoThumbOverlay}><ActivityIndicator color={Colors.white} /></View>
                ) : (
                  <TouchableOpacity accessibilityRole="button" style={manageStyles.photoRemove} accessibilityLabel="Remove photo" disabled={edit.isBusy || edit.unknown} onPress={() => { if (edit.canChange()) { hapticLight(); editor.setField('imageUrl', null); } }} hitSlop={8}>
                    <X size={13} color={Colors.white} strokeWidth={2.5} />
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <TouchableOpacity accessibilityRole="button" style={manageStyles.photoAdd} disabled={edit.isBusy || edit.unknown} onPress={edit.pickPhoto} activeOpacity={0.7}>
                <ImagePlus size={15} color={Colors.secondary} strokeWidth={2} />
                <Text style={manageStyles.photoAddText} numberOfLines={1}>Add photo</Text>
              </TouchableOpacity>
            )}
            {draft.imageUrl && <TouchableOpacity accessibilityRole="button" disabled={edit.isBusy || edit.unknown} onPress={edit.pickPhoto} style={manageStyles.photoAdd}>
              <Text style={manageStyles.photoAddText} numberOfLines={1}>Change photo</Text>
            </TouchableOpacity>}
            {editImageLoading && <Text accessibilityLiveRegion="polite" style={manageStyles.hint}>Adding photo…</Text>}
          </View>

          {/* Date & time */}
          <Text style={manageStyles.label}>Date & time</Text>
          <View style={manageStyles.dateTimeRow}>
            <TouchableOpacity accessibilityRole="button"
              disabled={edit.isBusy || edit.unknown}
            style={[manageStyles.input, manageStyles.dateTimeBtn]}
              onPress={() => { hapticLight(); onOpenDatePicker(); }}
              activeOpacity={0.85}
            >
              <Text numberOfLines={1} adjustsFontSizeToFit style={manageStyles.dateTimeBtnText}>
                {new Date(draft.year, draft.month, draft.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button"
              disabled={edit.isBusy || edit.unknown}
            style={[manageStyles.input, manageStyles.dateTimeBtn, { marginLeft: 8 }]}
              onPress={() => { hapticLight(); onOpenTimePicker(); }}
              activeOpacity={0.85}
            >
              <Text numberOfLines={1} adjustsFontSizeToFit style={manageStyles.dateTimeBtnText}>
                {displayPickerTime(draft.hour, draft.minute, draft.period)}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Description */}
          <View style={manageStyles.descLabelRow}>
            <Text style={[manageStyles.label, { marginTop: 0, marginBottom: 0 }]}>Plan description</Text>
            <Text
              style={[
                manageStyles.charCounter,
                draft.description.length >= EDIT_DESC_LIMIT - EDIT_DESC_WARN_MARGIN && manageStyles.charCounterWarn,
              ]}
            >
              {draft.description.length}/{EDIT_DESC_LIMIT}
            </Text>
          </View>
          <TextInput
            editable={!edit.isBusy && !edit.unknown}
            style={[manageStyles.input, manageStyles.textArea]}
            accessibilityLabel="Plan description"
            value={draft.description}
            onChangeText={(value) => editor.setField('description', value)}
            multiline
            maxLength={EDIT_DESC_LIMIT}
            placeholder="What's the plan? Dress code, what to expect..."
            placeholderTextColor={Colors.textLight}
            inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
          />

          {/* Creator note */}
          <Text style={manageStyles.label}>Your message</Text>
          <TextInput
            editable={!edit.isBusy && !edit.unknown}
            style={[manageStyles.input, manageStyles.creatorMessageInput]}
            accessibilityLabel="Your message"
            value={draft.creatorMessage}
            onChangeText={(value) => editor.setField('creatorMessage', value)}
            multiline
            maxLength={150}
            placeholder="A personal note to people joining"
            placeholderTextColor={Colors.textLight}
            inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
          />
          <Text style={manageStyles.hint}>Up to 150 characters</Text>

          {/* Location */}
          <Text style={manageStyles.label}>Location</Text>
          <View style={{ zIndex: 10, elevation: 10 }}>
            <GooglePlacesAutocomplete
              ref={managePlacesRef}
              placeholder="Venue or neighborhood"
              fetchDetails
              disableScroll={true}
              onPress={(data, details) => {
                if (!edit.canChange()) return;
                const lat = details?.geometry?.location?.lat ?? null;
                const lng = details?.geometry?.location?.lng ?? null;
                const name = data.structured_formatting?.main_text ?? data.description;
                editor.setField('location', name || data.description);
                editor.setField('locationLat', lat);
                editor.setField('locationLng', lng);
                hapticLight();
              }}
              query={{
                key: GOOGLE_MAPS_API_KEY,
                language: 'en',
                components: 'country:us',
                location: '34.0522,-118.2437',
                radius: '50000',
              }}
              styles={managePlacesStyles}
              textInputProps={{
                accessibilityLabel: "Location",
                editable: !edit.isBusy && !edit.unknown,
                onChangeText: (text: string) => {
                  if (!edit.canChange()) return;
                  editor.setField('location', text); editor.setField('locationLat', null); editor.setField('locationLng', null);
                },
                placeholderTextColor: Colors.textLight,
              }}
              enablePoweredByContainer={false}
              debounce={300}
              keepResultsAfterBlur={false}
              nearbyPlacesAPI="GooglePlacesSearch"
            />
          </View>

          {/* Ticket link */}
          <Text style={manageStyles.label}>Ticket link</Text>
          <TextInput
            editable={!edit.isBusy && !edit.unknown}
            style={manageStyles.input}
            accessibilityLabel="Ticket link"
            value={draft.ticketUrl}
            onChangeText={(value) => editor.setField('ticketUrl', value)}
            placeholder="https://..."
            placeholderTextColor={Colors.textLight}
            autoCapitalize="none"
            keyboardType="url"
            returnKeyType="done"
            onSubmitEditing={Keyboard.dismiss}
            inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
          />

          {/* Category */}
          <Text style={manageStyles.label}>Category</Text>
          <View style={manageStyles.pillWrap}>
            {MANAGE_CATEGORIES.map((cat) => {
              const isSelected = draft.category === cat;
              return (
                <TouchableOpacity accessibilityRole="button"
                  key={cat}
                  accessibilityState={{ selected: isSelected, disabled: edit.isBusy || edit.unknown }}
                  disabled={edit.isBusy || edit.unknown}
                  style={[manageStyles.pill, isSelected && manageStyles.pillSelected]}
                  onPress={() => {
                    hapticLight();
                    editor.setField('category', cat);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={[manageStyles.pillText, isSelected && manageStyles.pillTextSelected]}>{cat}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Who can join */}
          <Text style={manageStyles.label}>Who can join</Text>
          <View style={manageStyles.genderRow}>
            {manageGenderOptions.map((opt) => {
              const isSelected = draft.genderRule === opt.value;
              return (
                <TouchableOpacity accessibilityRole="button"
                  key={opt.value}
                  accessibilityState={{ selected: isSelected, disabled: edit.isBusy || edit.unknown }}
                  disabled={edit.isBusy || edit.unknown}
                  style={[manageStyles.genderPill, isSelected && manageStyles.pillSelected]}
                  onPress={() => {
                    hapticLight();
                    editor.setField('genderRule', opt.value);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={[manageStyles.pillText, isSelected && manageStyles.pillTextSelected]}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Age range */}
          <Text style={manageStyles.label}>Age range</Text>
          <View style={manageStyles.pillWrap}>
            {AGE_RANGES.map((range) => {
              const isSelected = draft.ageRanges.includes(range);
              return (
                <TouchableOpacity accessibilityRole="button"
                  key={range}
                  accessibilityState={{ selected: isSelected, disabled: edit.isBusy || edit.unknown }}
                  disabled={edit.isBusy || edit.unknown}
                  style={[manageStyles.pill, isSelected && manageStyles.pillSelected]}
                  onPress={() => onToggleAgeRange(range)}
                  activeOpacity={0.8}
                >
                  <Text style={[manageStyles.pillText, isSelected && manageStyles.pillTextSelected]}>{range}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={manageStyles.hint}>{!draft.ageChanged && draft.ageRanges.length === 0 && editOriginal ? `${savedAgeLabel(editOriginal.target_age_min, editOriginal.target_age_max)}. Kept unless you choose a range.` : 'Select up to 2 ranges, or All Ages'}</Text>

          {/* Ordinary capacity does not describe a Circle’s outsider allowance. */}
          {isCirclePlan ? <><Text style={manageStyles.label}>Circle plan</Text><Text style={manageStyles.hint}>Circle members aren’t included in the public spot limit. Your Circle’s existing joining settings stay the same.</Text></> : !draft.featured ? <>
          <Text style={manageStyles.label}>How many to invite</Text>
          <View style={manageStyles.stepperRow}>
            <TouchableOpacity accessibilityRole="button"
              style={[manageStyles.stepperBtn, draft.groupSize <= (MIN_GROUP - 1) && manageStyles.stepperBtnDisabled]}
              onPress={() => {
                if (draft.groupSize > (MIN_GROUP - 1)) {
                  hapticLight();
                  editor.setField('groupChanged', true); editor.setField('groupSize', (g) => g - 1);
                }
              }}
              accessibilityLabel="Fewer people"
              disabled={edit.isBusy || edit.unknown || draft.groupSize <= (MIN_GROUP - 1)}
            >
              <Text style={manageStyles.stepperBtnText}>−</Text>
            </TouchableOpacity>
            <View style={manageStyles.stepperValue}>
              <Text style={manageStyles.stepperValueText}>{draft.groupSize + 1}</Text>
              <Text style={manageStyles.stepperValueSub}>people total</Text>
            </View>
            <TouchableOpacity accessibilityRole="button"
              style={[manageStyles.stepperBtn, draft.groupSize >= (MAX_GROUP - 1) && manageStyles.stepperBtnDisabled]}
              onPress={() => {
                if (draft.groupSize < (MAX_GROUP - 1)) {
                  hapticLight();
                  editor.setField('groupChanged', true); editor.setField('groupSize', (g) => g + 1);
                }
              }}
              accessibilityLabel="More people"
              disabled={edit.isBusy || edit.unknown || draft.groupSize >= (MAX_GROUP - 1)}
            >
              <Text style={manageStyles.stepperBtnText}>+</Text>
            </TouchableOpacity>
          </View>
          <Text style={manageStyles.stepperValueSub}>including you</Text></> : null}

          {/* Featured Event toggle — official creators only */}
          {isCreator && isOfficialCreator && !isCirclePlan && (
            <View style={manageStyles.featuredSection}>
              <View style={manageStyles.featuredRow}>
                <View style={{ flex: 1 }}>
                  <Text style={manageStyles.label}>Feature this Plan</Text>
                  <Text style={manageStyles.hint}>Allows custom capacity (50 to 500)</Text>
                </View>
                <Switch
                  accessibilityLabel="Feature this plan"
                  disabled={edit.isBusy || edit.unknown}                      value={draft.featured}
                  onValueChange={(val) => {
                    if (!edit.canChange()) return;
                    hapticLight();
                    editor.setField('featuredChanged', true); editor.setField('featured', val);
                    if (val) {
                      editor.setField('featuredCapacity', editOriginal?.is_featured ? (editOriginal.max_invites ?? 99) + 1 : FEATURED_DEFAULT_CAPACITY);
                    }
                  }}
                  trackColor={{ false: appearance ? AfterglowColors.line : Colors.border, true: appearance ? AfterglowColors.clay : draft.featuredType === 'birthday_party' ? Colors.birthdayPink : draft.featuredType === 'special_event' ? Colors.specialEventMaroon : Colors.goldenAmber }}
                  thumbColor={Colors.white}
                />
              </View>
              {draft.featured && (
                <View style={manageStyles.featuredTypeRow}>
                  <TouchableOpacity accessibilityRole="button"
                    style={[
                      manageStyles.featuredTypePill,
                      { backgroundColor: appearance ? (draft.featuredType === 'washedup_event' ? AfterglowColors.clay : AfterglowColors.white) : (draft.featuredType === 'washedup_event' ? Colors.goldenAmberTint15 : Colors.inputBg) },
                    ]}
                    disabled={edit.isBusy || edit.unknown}
                    accessibilityState={{selected: draft.featuredType === "washedup_event"}}
                    onPress={() => { if (!edit.canChange()) return; hapticLight(); editor.setField('featuredChanged', true); editor.setField('featuredType', 'washedup_event'); }}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={[
                        manageStyles.featuredTypePillText,
                        { color: appearance ? (draft.featuredType === 'washedup_event' ? AfterglowColors.white : AfterglowColors.ink) : (draft.featuredType === 'washedup_event' ? Colors.goldenAmber : Colors.tertiary) },
                      ]}
                    >
                      washedup event
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity accessibilityRole="button"
                    style={[
                      manageStyles.featuredTypePill,
                      { backgroundColor: appearance ? (draft.featuredType === 'birthday_party' ? AfterglowColors.clay : AfterglowColors.white) : (draft.featuredType === 'birthday_party' ? Colors.birthdayPinkTint15 : Colors.inputBg) },
                    ]}
                    disabled={edit.isBusy || edit.unknown}
                    accessibilityState={{selected: draft.featuredType === "birthday_party"}}
                    onPress={() => { if (!edit.canChange()) return; hapticLight(); editor.setField('featuredChanged', true); editor.setField('featuredType', 'birthday_party'); }}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={[
                        manageStyles.featuredTypePillText,
                        { color: appearance ? (draft.featuredType === 'birthday_party' ? AfterglowColors.white : AfterglowColors.ink) : (draft.featuredType === 'birthday_party' ? Colors.birthdayPink : Colors.tertiary) },
                      ]}
                    >
                      birthday party
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity accessibilityRole="button"
                    style={[
                      manageStyles.featuredTypePill,
                      { backgroundColor: appearance ? (draft.featuredType === 'special_event' ? AfterglowColors.clay : AfterglowColors.white) : (draft.featuredType === 'special_event' ? Colors.specialEventMaroon : Colors.inputBg) },
                    ]}
                    disabled={edit.isBusy || edit.unknown}
                    accessibilityState={{selected: draft.featuredType === "special_event"}}
                    onPress={() => { if (!edit.canChange()) return; hapticLight(); editor.setField('featuredChanged', true); editor.setField('featuredType', 'special_event'); }}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={[
                        manageStyles.featuredTypePillText,
                        { color: appearance ? (draft.featuredType === 'special_event' ? AfterglowColors.white : AfterglowColors.ink) : (draft.featuredType === 'special_event' ? Colors.specialEventCream : Colors.tertiary) },
                      ]}
                    >
                      special event
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
              {draft.featured && (
                <View style={manageStyles.capacitySection}>
                  <Text style={manageStyles.capacityValue}>{draft.featuredCapacity} people</Text>
                  <View style={manageStyles.stepperRow}>
                    <TouchableOpacity accessibilityRole="button"
                      style={[manageStyles.stepperBtn, draft.featuredCapacity <= FEATURED_MIN_CAPACITY && manageStyles.stepperBtnDisabled]}
                      onPress={() => {
                        if (draft.featuredCapacity > FEATURED_MIN_CAPACITY) {
                          hapticLight();
                          editor.setField('featuredChanged', true); editor.setField('featuredCapacity', (c) => Math.max(FEATURED_MIN_CAPACITY, c - 50));
                        }
                      }}
                      accessibilityLabel="Lower capacity" disabled={edit.isBusy || edit.unknown || draft.featuredCapacity <= FEATURED_MIN_CAPACITY}
                    >
                      <Text style={manageStyles.stepperBtnText}>−</Text>
                    </TouchableOpacity>
                    <View style={manageStyles.stepperValue}>
                      <Text style={manageStyles.stepperValueText}>{draft.featuredCapacity}</Text>
                      <Text style={manageStyles.stepperValueSub}>capacity</Text>
                    </View>
                    <TouchableOpacity accessibilityRole="button"
                      style={[manageStyles.stepperBtn, draft.featuredCapacity >= FEATURED_MAX_CAPACITY && manageStyles.stepperBtnDisabled]}
                      onPress={() => {
                        if (draft.featuredCapacity < FEATURED_MAX_CAPACITY) {
                          hapticLight();
                          editor.setField('featuredChanged', true); editor.setField('featuredCapacity', (c) => Math.min(FEATURED_MAX_CAPACITY, c + 50));
                        }
                      }}
                      accessibilityLabel="Higher capacity" disabled={edit.isBusy || edit.unknown || draft.featuredCapacity >= FEATURED_MAX_CAPACITY}
                    >
                      <Text style={manageStyles.stepperBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          )}

    </View>
          {/* Duplicate: reuse the exact prefill pipeline the waitlist
              "Post your own" path uses, from the creator's own plan */}
          {onDuplicate && (
            <TouchableOpacity accessibilityRole="button"
              disabled={edit.isBusy || edit.unknown}
              style={manageStyles.duplicateBtn}
              onPress={onDuplicate}
              activeOpacity={0.7}
            >
              <Text numberOfLines={1} style={manageStyles.duplicateBtnText}>Post again</Text>
            </TouchableOpacity>
          )}

          {/* Cancel plan */}
          <TouchableOpacity accessibilityRole="button"
            style={manageStyles.cancelBtn}
            disabled={edit.isBusy || edit.unknown}
            onPress={onCancel}
            activeOpacity={0.7}
          >
            <Text numberOfLines={1} style={manageStyles.cancelBtnText}>Cancel plan</Text>
          </TouchableOpacity>
        </ScrollView>
        <View style={[manageStyles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          {edit.unknown && <View style={manageStyles.recovery}>
            <Text style={manageStyles.label}>Check your changes</Text>
            <Text style={manageStyles.hint}>Your changes may have saved, but we didn’t receive confirmation. Check before saving again.</Text>
          </View>}
          {edit.error && <Text accessibilityRole="alert" style={manageStyles.editError}>{edit.error}</Text>}
          {/* Save button */}
          <TouchableOpacity accessibilityRole="button"
            style={[manageStyles.saveBtn, (editSaving || editImageLoading || draft.title.trim().length === 0) && manageStyles.saveBtnDisabled]}
            onPress={edit.unknown ? edit.check : onSave}
            disabled={editSaving || editImageLoading || draft.title.trim().length === 0}
            activeOpacity={0.85}
          >
            {editSaving ? (
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><ActivityIndicator size="small" color={Colors.white} /><Text numberOfLines={1} style={manageStyles.saveBtnText}>{edit.unknown ? "Checking…" : "Saving…"}</Text></View>
            ) : (
              <Text numberOfLines={1} style={manageStyles.saveBtnText}>{edit.unknown ? "Check changes" : "Save changes"}</Text>
            )}
          </TouchableOpacity>


        </View>
      </View>
      {/* Date picker overlay — child of the manage modal overlay so we
          avoid the Modal-inside-Modal stacking issue on iOS. */}
      {editor.datePickerVisible && (
        <Pressable
          accessible={false}
          style={manageStyles.pickerOverlay}
          onPress={() => editor.closeDatePicker()}
        >
          <Pressable accessible={false} style={manageStyles.pickerSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={manageStyles.pickerTitle}>Select date</Text>
            <WashedUpCalendar
              mode="pick"
              selected={editor.dateSelection}
              onSelect={(day) => {
                if (!edit.canChange()) return;
                editor.selectDate(day);
              }}
            />
          </Pressable>
        </Pressable>
      )}

      {/* Time picker overlay */}
      {editor.timePickerVisible && (
        <Pressable
          accessible={false}
          style={manageStyles.pickerOverlay}
          onPress={() => editor.closeTimePicker()}
        >
          <Pressable accessible={false} style={manageStyles.pickerSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={manageStyles.pickerTitle}>Select time</Text>
            <View style={manageStyles.pickerRow}>
              <TextInput style={manageStyles.directTimeInput} value={editor.timeSelection.hour ? String(editor.timeSelection.hour) : ''} onChangeText={(value) => editor.setTimeField('hour', Number(value.replace(/\D/g, '').slice(0, 2)))} keyboardType="number-pad" maxLength={2} selectTextOnFocus accessibilityLabel="Hour, 1 through 12" />
              <Text style={manageStyles.pickerItemText}>:</Text>
              <TextInput style={manageStyles.directTimeInput} value={editor.timeSelection.minute} onChangeText={(value) => editor.setTimeField('minute', value.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" maxLength={2} selectTextOnFocus accessibilityLabel="Minute, 0 through 59" />
              {PERIODS.map((p) => (
                <Pressable key={p} style={[manageStyles.directPeriod, editor.timeSelection.period === p && manageStyles.pickerItemSelected]} onPress={() => editor.setTimeField('period', p)} accessibilityRole="button" accessibilityState={{ selected: editor.timeSelection.period === p }}>
                  <Text style={[manageStyles.pickerItemText, editor.timeSelection.period === p && manageStyles.pickerItemTextSel]}>{p}</Text>
                </Pressable>
              ))}
            </View>
            <View style={manageStyles.directMinutes}>
              {MINUTE_OPTIONS.map((m) => (
                <Pressable key={m} style={[manageStyles.directPeriod, editor.timeSelection.minute === m && manageStyles.pickerItemSelected]} onPress={() => editor.setTimeField('minute', m)} accessibilityRole="button" accessibilityLabel={`${m} minutes`}>
                  <Text style={[manageStyles.pickerItemText, editor.timeSelection.minute === m && manageStyles.pickerItemTextSel]}>:{m}</Text>
                </Pressable>
              ))}
            </View>
            {!editor.validTime && <Text style={manageStyles.directTimeError}>Enter an hour from 1–12 and minutes from 00–59.</Text>}
            <TouchableOpacity style={[manageStyles.pickerDoneBtn, !editor.validTime && { opacity: 0.45 }]} onPress={onConfirmTime} disabled={!editor.validTime} accessibilityRole="button" accessibilityState={{ disabled: !editor.validTime }}>
              <Text style={manageStyles.pickerDoneBtnText}>Done</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      )}

      {children}
    </KeyboardAvoidingView>
  );
}
