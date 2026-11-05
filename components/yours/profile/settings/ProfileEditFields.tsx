import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Keyboard } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Camera } from 'lucide-react-native';
import Colors from '../../../../constants/Colors';
import { NEIGHBORHOOD_OTHER } from '../../../../constants/Neighborhoods';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../../../keyboard/KeyboardDoneBar';
import SettingsPortrait from './SettingsPortrait';
import type { baseStyles, profileSettingsAppearance } from './profileSettingsStyles';
import type { useProfileHandleAvailability } from './useProfileHandleAvailability';

type ProfileSettingsStyles = typeof baseStyles | (Omit<typeof baseStyles, keyof ReturnType<typeof profileSettingsAppearance>> & ReturnType<typeof profileSettingsAppearance>);

interface ProfileEditFieldsProps {
  styles: ProfileSettingsStyles;
  appearance: boolean;
  userId: string;
  displayPhoto: string | null | undefined;
  editName: string;
  editHandle: string;
  editFunFact: string;
  editNeighborhood: string;
  editNeighborhoodOther: string;
  editIsVisitor: boolean;
  gender: string | null | undefined;
  saving: boolean;
  photoBusy: boolean;
  handleCheck: Pick<ReturnType<typeof useProfileHandleAvailability>, 'canSave' | 'status' | 'retry'>;
  onNameChange: (value: string) => void;
  onHandleChange: (value: string) => void;
  onFunFactChange: (value: string) => void;
  onOtherNeighborhoodChange: (value: string) => void;
  onVisitorChange: (value: boolean) => void;
  onOpenNeighborhood: () => void;
  pickEditPhoto: () => void;
  handleSaveProfile: () => void;
  closeEditFlow: () => void;
}

/** Presentation only. The Profile screen owns drafts, permissions and writes. */
export function ProfileEditFields({ styles, appearance, userId, displayPhoto, editName, editHandle, editFunFact, editNeighborhood, editNeighborhoodOther, editIsVisitor, gender, saving, photoBusy, handleCheck, onNameChange, onHandleChange, onFunFactChange, onOtherNeighborhoodChange, onVisitorChange, onOpenNeighborhood, pickEditPhoto, handleSaveProfile, closeEditFlow }: ProfileEditFieldsProps) {
  const saveDisabledByHandle = !handleCheck.canSave;
  return (
        <ScrollView
          decelerationRate="normal"
          contentContainerStyle={styles.editContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity onPress={pickEditPhoto} disabled={saving || photoBusy} accessibilityRole="button" accessibilityLabel="Change photo" activeOpacity={0.8} style={styles.editAvatarWrap}>
            <SettingsPortrait key={JSON.stringify([userId, displayPhoto])} uri={displayPhoto ?? null} name={editName} style={styles.editAvatar} fallbackStyle={styles.avatarFallback} textStyle={styles.avatarInitial}/>
            <View style={styles.editAvatarBadge}>
              <Camera size={14} color={Colors.white} strokeWidth={2.5} />
            </View>
          </TouchableOpacity>
          <Text style={styles.editPhotoHint}>{photoBusy ? 'Preparing photo…' : 'Tap to change photo'}</Text>

          <View style={styles.editFieldGroup}>
            <Text style={styles.editLabel}>{appearance ? 'Display name' : 'Display Name'}</Text>
            <TextInput
              style={styles.editInput}
              value={editName}
              onChangeText={onNameChange}
              editable={!saving && !photoBusy}
              accessibilityLabel="Display name"
              placeholder="Your name"
              placeholderTextColor={Colors.textLight}
              maxLength={30}
              autoCorrect={false}
              returnKeyType="next"
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />
          </View>

          <View style={styles.editFieldGroup}>
            <Text style={styles.editLabel}>Handle</Text>
            <View style={styles.handleInputRow}>
              <Text style={styles.handlePrefix}>@</Text>
              <TextInput
                style={styles.handleInput}
                value={editHandle}
                onChangeText={onHandleChange}
                editable={!saving && !photoBusy}
                accessibilityLabel="Handle"
                placeholder="yourhandle"
                placeholderTextColor={Colors.textLight}
                maxLength={20}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
              />
            </View>
            <View accessibilityLiveRegion="polite">
              {handleCheck.status === 'checking' ? <Text style={styles.editHelp}>Checking handle…</Text> :
               handleCheck.status === 'available' ? <Text style={styles.handleAvailable}>Available</Text> :
               handleCheck.status === 'taken' ? <Text style={styles.handleTaken}>This handle is taken.</Text> :
               handleCheck.status === 'invalid' ? <Text style={styles.handleTaken}>Use at least 2 characters.</Text> :
               handleCheck.status === 'error' ? <><Text style={styles.handleTaken}>Couldn’t check this handle.</Text><TouchableOpacity style={styles.retryButton} accessibilityRole="button" accessibilityLabel="Try again to check handle" onPress={handleCheck.retry}><Text style={styles.retryText}>Try again</Text></TouchableOpacity></> : null}
            </View>
            <Text style={styles.editHelp}>This is how people find you on washedup</Text>
          </View>

          <View style={styles.editFieldGroup}>
            <Text style={styles.editLabel}>{appearance ? 'Fun fact' : 'Fun Fact'}</Text>
            <TextInput
              style={[styles.editInput, styles.editBioInput]}
              value={editFunFact}
              onChangeText={onFunFactChange}
              editable={!saving && !photoBusy}
              accessibilityLabel="Fun fact"
              placeholder="Something fun about you (e.g. I know every taco spot in Silver Lake)"
              placeholderTextColor={Colors.textLight}
              maxLength={120}
              multiline
              textAlignVertical="top"
              returnKeyType="default"
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />
            <Text style={styles.editCharCount}>{editFunFact.length}/120</Text>
            <Text style={styles.editHelp}>This shows on your profile and when people tap your picture</Text>
          </View>

          <View style={styles.editFieldGroup}>
            <Text style={styles.editLabel}>Neighborhood</Text>
            <TouchableOpacity
              style={styles.editInput}
              onPress={onOpenNeighborhood}
              accessibilityRole="button" accessibilityLabel="Neighborhood"
              activeOpacity={0.8}
            >
              <View style={styles.neighborhoodRow}>
                <Text style={editNeighborhood ? styles.neighborhoodValue : styles.neighborhoodPlaceholder}>
                  {editNeighborhood || 'Select your neighborhood'}
                </Text>
                <Ionicons name="chevron-down" size={18} color={Colors.textLight} />
              </View>
            </TouchableOpacity>
            {editNeighborhood === NEIGHBORHOOD_OTHER && (
              <TextInput
                style={[styles.editInput, { marginTop: 8 }]}
                value={editNeighborhoodOther}
                onChangeText={onOtherNeighborhoodChange}
                editable={!saving && !photoBusy}
                accessibilityLabel="Other neighborhood"
                placeholder="Where are you based?"
                placeholderTextColor={Colors.textLight}
                maxLength={40}
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
                inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
              />
            )}
            <Text style={styles.editHelp}>Where you're based (shown on your mini profile)</Text>
          </View>

          <View style={styles.editFieldGroup}>
            <Text style={styles.editLabel}>Do you live in LA?</Text>
            <View style={styles.travelOptions}>
              <TouchableOpacity
                style={[styles.travelOption, !editIsVisitor && styles.travelOptionActive]}
                onPress={() => onVisitorChange(false)} accessibilityRole="radio" accessibilityState={{ checked: !editIsVisitor }} accessibilityLabel="I live in LA"
                activeOpacity={0.7}
              >
                <Text style={[styles.travelOptionText, !editIsVisitor && styles.travelOptionTextActive]}>
                  Yes, I live here
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.travelOption, editIsVisitor && styles.travelOptionActive]}
                onPress={() => onVisitorChange(true)} accessibilityRole="radio" accessibilityState={{ checked: editIsVisitor }} accessibilityLabel="I am visiting LA"
                activeOpacity={0.7}
              >
                <Text style={[styles.travelOptionText, editIsVisitor && styles.travelOptionTextActive]}>
                  I'm visiting LA
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {gender && (
            <View style={styles.editFieldGroup}>
              <Text style={styles.editLabel}>{appearance ? 'Gender identity' : 'Gender Identity'}</Text>
              <View style={styles.editReadOnly}>
                <Text style={styles.editReadOnlyText}>
                  {gender === 'woman' ? 'Woman' : gender === 'man' ? 'Man' : 'Non-binary'}
                </Text>
                <Ionicons name="lock-closed-outline" size={14} color={Colors.textLight} />
              </View>
              <Text style={styles.editHelp}>Contact hello@washedup.app to update</Text>
            </View>
          )}

          <TouchableOpacity
            accessibilityRole="button" accessibilityLabel={saving ? "Saving profile" : "Save changes"}
            style={[styles.editSaveBtn, (saving || photoBusy || saveDisabledByHandle) && { opacity: 0.7 }]}
            onPress={handleSaveProfile}
            disabled={saving || photoBusy || saveDisabledByHandle}
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <Text style={styles.editSaveBtnText}>{appearance ? 'Save changes' : 'Save Changes'}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.deleteCancelBtn}
            accessibilityRole="button" disabled={saving}
            onPress={closeEditFlow}
          >
            <Text style={styles.deleteCancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </ScrollView>
  );
}
