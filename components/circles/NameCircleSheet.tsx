/**
 * NameCircleSheet - name an unnamed circle, or edit a prefilled identity.
 * Named-circle editing is opt-in and requires a caller-owned admin scope.
 *
 * An unnamed circle (a DM that grew a third person) renders as its member names
 * until someone gives it an identity. This bottom sheet is that "Name this
 * circle" action, surfaced on the View-circle page for admins only (update_circle
 * is admin-gated; the DM's original pair are both admins). Name is required; the
 * description is optional. The monogram preview updates live as you type, mirroring
 * the create-circle IdentityStep so the two naming surfaces feel the same.
 */
import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Modal,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, ImagePlus } from 'lucide-react-native';
import * as Crypto from 'expo-crypto';
import Colors, { AfterglowColors } from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights, AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';
import { CIRCLE_CREATE } from '../../constants/YoursDesign';
import { COPY } from '../yours/state/constants';
import { useUpdateCircle, isObsoleteCircleUpdate, type UpdateCircleScope } from '../../hooks/useUpdateCircle';
import { useObservedUser, type ObservedUser } from '../../hooks/useObservedUser';
import { supabase } from '../../lib/supabase';
import { uploadBase64ToStorage } from '../../lib/uploadPhoto';
import { pickCoverPhoto } from '../../lib/circles/pickCover';
import { buildCircleCoverUrl } from '../../lib/circles/coverUrl';
import CircleCover from '../yours/circles/CircleCover';

const FEEDBACK = {
  pick: 'Couldn’t open your photos. Try adding a cover again.',
  upload: 'Your cover didn’t upload, so your circle details haven’t been saved. Try again.',
  save: 'Couldn’t confirm the save. Your details are still here; try again.',
  identity: 'Couldn’t confirm your account. Try again before saving.',
  checking: 'Checking your account…',
  editUnavailable: 'Circle editing isn’t available right now. Close this sheet and reopen your circle.',
  retry: 'Try again',
};
type Failure = 'pick' | 'upload' | 'save' | 'identity';
let nextNamingVisit = 0;

export interface NameCircleSheetProps {
  visible: boolean;
  circleId: string;
  userId: string | null | undefined;
  /** Default naming behavior remains unchanged. Editing requires complete
   * initial identity and a current admin-owned scope; the caller owns role checks. */
  mode?: 'name' | 'edit';
  initialName?: string | null;
  /** Pass null for an existing empty description, not undefined/loading data. */
  initialDescription?: string | null;
  /** The circle's existing manual cover, if any; enables "Remove cover". */
  currentCoverUploadId?: string | null;
  onClose: () => void;
  onNamed?: () => void;
  scope?: UpdateCircleScope | null;
  appearance?: { fonts: AfterglowFontFamilies };
}

export default function NameCircleSheet(props: NameCircleSheetProps) {
  return props.visible ? <OpenNameCircleSheet key={props.circleId} {...props} /> : null;
}

type RegisterVisitClose = (close: () => void) => () => void;

function OpenNameCircleSheet(props: NameCircleSheetProps) {
  const viewer = useObservedUser();
  const visitId = useMemo(() => ++nextNamingVisit,
    [props.circleId, props.userId, props.scope, props.mode, viewer.viewerId, viewer.epoch]);
  const activeClose = useRef<{ visitId: number; close: () => void } | null>(null);
  const currentVisit = useRef(visitId); currentVisit.current = visitId;
  const registerClose = useCallback<RegisterVisitClose>(close => {
    const owner = { visitId, close };
    activeClose.current = owner;
    return () => { if (activeClose.current === owner) activeClose.current = null; };
  }, [visitId]);
  const closeCurrentVisit = useCallback(() => {
    const owner = activeClose.current;
    if (owner?.visitId === currentVisit.current) owner.close();
  }, []);

  // Initial identity resolution resets sensitive drafts, but must not replace
  // an iOS Modal host while its presentation animation is still running.
  return <Modal visible={props.visible} transparent animationType="slide"
    onRequestClose={closeCurrentVisit} onAccessibilityEscape={closeCurrentVisit} statusBarTranslucent>
    <NameCircleVisit key={visitId} {...props} viewer={viewer} registerClose={registerClose} />
  </Modal>;
}

function NameCircleVisit({
  circleId, userId, currentCoverUploadId, onClose, onNamed, scope, viewer, appearance,
  mode = 'name', initialName, initialDescription, registerClose,
}: NameCircleSheetProps & { viewer: ObservedUser; registerClose: RegisterVisitClose }) {
  const insets = useSafeAreaInsets();
  const editing = mode === 'edit';
  // Capture the opening identity once. A metadata refresh must not replace a
  // draft or turn a cover-only save into an accidental blank-description write.
  const [initialIdentity] = useState(() => ({
    name: editing ? initialName ?? '' : '',
    description: editing ? initialDescription ?? null : null,
    complete: !editing || (typeof initialName === 'string' && initialName.trim().length > 0
      && initialDescription !== undefined),
  }));
  const editConfigured = !editing || (initialIdentity.complete && !!scope);

  const styles = useMemo(() => appearance ? { ...baseStyles, ...identityAppearance(appearance.fonts) } : baseStyles, [appearance?.fonts]);
  const mounted = useRef(false);
  const retired = useRef(false);
  const pending = useRef<object | null>(null);
  const uploadedCover = useRef<{ base64: string; id: string; complete: boolean } | null>(null);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; pending.current = null; };
  }, []);
  const identityReady = editConfigured && !!userId && viewer.viewerId === userId && !viewer.error && !viewer.isLoading &&
    viewer.isCurrent() && scope !== null && (!scope || (scope.userId === userId && scope.isCurrent()));
  const isCurrent = useCallback(() => editConfigured && mounted.current && !retired.current && !!userId &&
    viewer.viewerId === userId && viewer.isCurrent() && !viewer.error && !viewer.isLoading &&
    scope !== null && (!scope || (scope.userId === userId && scope.isCurrent())),
  [editConfigured, userId, viewer.viewerId, viewer.isCurrent, viewer.error, viewer.isLoading, scope]);
  const operationScope = useMemo(() => ({ userId: userId ?? '', isCurrent }), [userId, isCurrent]);
  const update = useUpdateCircle(circleId, userId, operationScope);
  const [name, setName] = useState(initialIdentity.name);
  const [description, setDescription] = useState(initialIdentity.description ?? '');
  const [coverBase64, setCoverBase64] = useState<string | null>(null);
  const [coverPreviewUri, setCoverPreviewUri] = useState<string | null>(null);
  const [removeCover, setRemoveCover] = useState(false);
  const [working, setWorking] = useState<'picking' | 'saving' | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  const busy = working !== null || update.isPending;
  const canSave = identityReady && name.trim().length > 0 && !busy;
  const currentCoverUrl = buildCircleCoverUrl(circleId, currentCoverUploadId);
  const previewCoverUrl = coverPreviewUri ?? (removeCover ? null : currentCoverUrl);
  const showRemoveCover = editing ? !!previewCoverUrl : !!currentCoverUrl && !coverPreviewUri && !removeCover;
  const editUnavailable = editing && (!editConfigured || !scope || scope.userId !== userId || !scope.isCurrent());
  const removeSelectedCover = () => {
    if (!isCurrent() || pending.current) return;
    uploadedCover.current = null;
    setCoverBase64(null); setCoverPreviewUri(null); setRemoveCover(true); setFailure(null);
  };
  const close = useCallback(() => {
    if (!mounted.current || retired.current) return;
    // Dismissal retires UI work; an upload or RPC already sent may still finish.
    retired.current = true;
    onClose();
  }, [onClose]);
  useLayoutEffect(() => registerClose(close), [registerClose, close]);

  const onPickCover = async () => {
    if (!isCurrent() || pending.current) return;
    const attempt = {}; pending.current = attempt; setWorking('picking'); setFailure(null);
    try {
      const picked = await pickCoverPhoto();
      if (!isCurrent() || pending.current !== attempt) return;
      if (picked) {
        uploadedCover.current = null;
        setCoverBase64(picked.base64);
        setCoverPreviewUri(picked.uri);
        setRemoveCover(false);
      }
    } catch {
      if (isCurrent() && pending.current === attempt) setFailure('pick');
    } finally {
      if (pending.current === attempt) {
        pending.current = null;
        if (isCurrent()) setWorking(null);
      }
    }
  };

  const save = async () => {
    if (!isCurrent() || pending.current || name.trim().length === 0) return;
    const attempt = {}; pending.current = attempt; setWorking('saving'); setFailure(null);
    const identity = {
      // Leave untouched stored identity exactly as supplied for cover-only edits.
      name: editing && name === initialIdentity.name ? initialIdentity.name : name.trim(),
      description: editing && description === (initialIdentity.description ?? '')
        ? initialIdentity.description : description.trim() || null,
      clearCover: removeCover,
    };
    let stage: Failure = 'save';
    try {
      let coverUploadId: string | undefined;
      if (coverBase64) {
        if (!uploadedCover.current || uploadedCover.current.base64 !== coverBase64) {
          uploadedCover.current = { base64: coverBase64, id: Crypto.randomUUID(), complete: false };
        }
        const cover = uploadedCover.current;
        coverUploadId = cover.id;
        if (!cover.complete) {
          stage = 'identity';
          const account = await supabase.auth.getUser();
          if (!isCurrent() || pending.current !== attempt) return;
          if (account.error || account.data.user?.id !== userId) throw new Error(FEEDBACK.identity);
          stage = 'upload';
          await uploadBase64ToStorage('circle-covers', `${circleId}/${cover.id}`, cover.base64, { upsert: true });
          if (!isCurrent() || pending.current !== attempt) return;
          cover.complete = true;
        }
      }
      if (!isCurrent() || pending.current !== attempt) return;
      stage = 'save';
      await update.mutateAsync({ ...identity, coverUploadId });
      if (!isCurrent() || pending.current !== attempt) return;
      onNamed?.();
      if (isCurrent()) { retired.current = true; onClose(); }
    } catch (error) {
      if (isCurrent() && pending.current === attempt && !isObsoleteCircleUpdate(error)) setFailure(stage);
    } finally {
      if (pending.current === attempt) {
        pending.current = null;
        if (isCurrent()) setWorking(null);
      }
    }
  };
  const retryIdentity = async () => {
    if (!mounted.current || retired.current || pending.current) return;
    const attempt = {}; pending.current = attempt;
    try { await viewer.retry(); }
    finally { if (pending.current === attempt) pending.current = null; }
  };

  return (
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable style={styles.backdropTap} onPress={close} accessibilityLabel={COPY.circlePlusCancel} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">{editing ? 'Edit circle' : COPY.circleNameSheetTitle}</Text>
            <Pressable onPress={close} style={styles.closeButton} hitSlop={12} accessibilityRole="button" accessibilityLabel={COPY.circlePlusCancel}>
              <X size={22} color={appearance ? AfterglowColors.ink : Colors.secondary} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <Text style={styles.sub}>{editing ? 'Update your cover photo or circle details. Changes are saved when you tap Save.' : appearance ? 'Give your people a name to gather around.' : COPY.circleNameSheetSub}</Text>

          <View style={styles.coverWrap}>
            <CircleCover
              name={name}
              coverUrl={previewCoverUrl}
              size={CIRCLE_CREATE.coverPreview}
              radius={appearance ? 6 : CIRCLE_CREATE.coverPreviewRadius}
              appearance={appearance}
              monogramSize={CIRCLE_CREATE.coverMonogram}
            />
            <Pressable
              onPress={onPickCover}
              disabled={!identityReady || busy}
              accessibilityState={{ disabled: !identityReady || busy, busy: working === 'picking' }}
              android_ripple={{ color: Colors.border }}
              style={styles.coverBtn}
              accessibilityRole="button"
              accessibilityLabel={previewCoverUrl ? COPY.circleCoverChange : COPY.circleCoverAdd}
            >
              <ImagePlus size={16} color={appearance ? AfterglowColors.clay : Colors.terracotta} strokeWidth={1.75} />
              <Text style={styles.coverBtnText}>
                {previewCoverUrl ? COPY.circleCoverChange : COPY.circleCoverAdd}
              </Text>
            </Pressable>
            {showRemoveCover && (
              <Pressable
                onPress={removeSelectedCover}
                disabled={!identityReady || busy}
                accessibilityState={{ disabled: !identityReady || busy }}
                hitSlop={8}
                style={styles.removeCoverBtn}
                accessibilityRole="button"
                accessibilityLabel={COPY.circleCoverRemove}
              >
                <Text style={styles.removeCoverText}>{COPY.circleCoverRemove}</Text>
              </Pressable>
            )}
          </View>

          {editing && removeCover && (
            <Text style={styles.sub} accessibilityLiveRegion="polite">
              Your manual cover will be removed when you save. A shared photo may appear instead.
            </Text>
          )}
          <Text style={styles.fieldLabel}>Name (required)</Text>
          <TextInput
            accessibilityLabel="Circle name, required"
            style={styles.field}
            value={name}
            onChangeText={value => { if (isCurrent() && !pending.current) setName(value.slice(0, 60)); }}
            editable={identityReady && !busy}
            placeholder={COPY.circleNamePlaceholder}
            placeholderTextColor={appearance ? AfterglowColors.muted : Colors.tertiary}
            maxLength={60}
            autoFocus={!editing}
            returnKeyType="next"
          />
          <Text style={styles.fieldLabel}>Description (optional)</Text>
          <TextInput
            accessibilityLabel="Circle description, optional"
            style={[styles.field, styles.desc]}
            value={description}
            onChangeText={value => { if (isCurrent() && !pending.current) setDescription(value.slice(0, 140)); }}
            editable={identityReady && !busy}
            placeholder={COPY.circleDescPlaceholder}
            placeholderTextColor={appearance ? AfterglowColors.muted : Colors.tertiary}
            multiline
            maxLength={140}
          />

          {(!identityReady || failure) && (
            <View style={styles.feedback}>
              <Text style={styles.feedbackText} accessibilityLiveRegion="polite">
                {!identityReady ? (editUnavailable ? FEEDBACK.editUnavailable : viewer.isLoading ? FEEDBACK.checking : FEEDBACK.identity) : FEEDBACK[failure!]}
              </Text>
              {!identityReady && !editUnavailable && !viewer.isLoading && (
                <Pressable onPress={retryIdentity} accessibilityRole="button" accessibilityLabel="Retry account check" style={styles.retry}>
                  <Text style={styles.coverBtnText} numberOfLines={1}>{FEEDBACK.retry}</Text>
                </Pressable>
              )}
            </View>
          )}
          <Pressable
            onPress={save}
            disabled={!canSave}
            android_ripple={{ color: Colors.border }}
            style={[styles.cta, !canSave && styles.ctaDisabled]}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSave, busy: working === 'saving' }}
            accessibilityLabel={failure && failure !== 'pick' ? FEEDBACK.retry : COPY.circleNameSheetSave}
          >
            {busy ? (
              <ActivityIndicator color={Colors.white} />
            ) : (
              <Text style={styles.ctaLabel} numberOfLines={1}>{failure && failure !== 'pick' ? FEEDBACK.retry : COPY.circleNameSheetSave}</Text>
            )}
          </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
  );
}

const baseStyles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: Colors.overlayDark40 },
  backdropTap: { flex: 1 },
  sheet: {
    backgroundColor: Colors.parchment,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 16,
    maxHeight: '90%',
  },
  content: { paddingBottom: 4 },
  closeButton: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  fieldLabel: { marginHorizontal: 20, marginBottom: 6, fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  title: { fontFamily: Fonts.displayBold, fontSize: FontSizes.displaySM, color: Colors.darkWarm },
  sub: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    lineHeight: LineHeights.bodyMD,
    color: Colors.secondary,
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 8,
  },
  coverWrap: { alignItems: 'center', marginVertical: 12 },
  coverBtn: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
  },
  coverBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  removeCoverBtn: { minHeight: 44, justifyContent: 'center', marginTop: 8, paddingHorizontal: 8, paddingVertical: 4 },
  removeCoverText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.secondary },
  field: {
    backgroundColor: Colors.inputBg,
    borderRadius: CIRCLE_CREATE.fieldRadius,
    minHeight: CIRCLE_CREATE.fieldMinHeight,
    marginHorizontal: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyLG,
    color: Colors.darkWarm,
    marginBottom: 12,
  },
  desc: { minHeight: CIRCLE_CREATE.descMinHeight, textAlignVertical: 'top' },
  feedback: { marginHorizontal: 20, marginBottom: 12 },
  feedbackText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD, color: Colors.secondary },
  retry: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  cta: {
    minHeight: 44,
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    marginHorizontal: 20,
    marginTop: 4,
    paddingVertical: 15,
    alignItems: 'center',
  },
  ctaDisabled: { opacity: 0.4 },
  pressed: { opacity: 0.85 },
  ctaLabel: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.white },
});


function identityAppearance(fonts: AfterglowFontFamilies) {
  return StyleSheet.create({
    sheet: { ...baseStyles.sheet, backgroundColor: AfterglowColors.paper, borderTopLeftRadius: 8, borderTopRightRadius: 8 },
    header: { ...baseStyles.header, paddingBottom: 4 },
    title: { ...AfterglowType.identity, fontFamily: fonts.display, color: AfterglowColors.ink, flex: 1 },
    sub: { ...baseStyles.sub, ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted },
    coverWrap: { ...baseStyles.coverWrap, marginVertical: 16 },
    coverBtn: { ...baseStyles.coverBtn, borderRadius: 4, borderColor: AfterglowColors.line },
    coverBtnText: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.clay },
    removeCoverText: { ...AfterglowType.body, fontFamily: fonts.medium, color: AfterglowColors.muted },
    fieldLabel: { ...baseStyles.fieldLabel, ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.ink },
    field: { ...baseStyles.field, ...AfterglowType.message, fontFamily: fonts.regular, color: AfterglowColors.ink, backgroundColor: AfterglowColors.white, borderWidth: 1, borderColor: AfterglowColors.line, borderRadius: 4 },
    feedbackText: { ...AfterglowType.body, fontFamily: fonts.medium, color: AfterglowColors.clay },
    cta: { ...baseStyles.cta, backgroundColor: AfterglowColors.clay, borderRadius: 4, paddingHorizontal: 16, minHeight: 48 },
    ctaLabel: { ...AfterglowType.message, fontFamily: fonts.semibold, color: AfterglowColors.white },
  });
}
