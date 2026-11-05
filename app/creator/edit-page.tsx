/**
 * The page builder (Build 35 screens 33-36). Three grouped destinations
 * inside one route -- identity (cover/logo/name/promise/about), sections
 * (cadence/pinned/the two automatic blocks), and gallery & links -- behind
 * a completion overview, replacing the old single long accordion of all 10
 * block types in one flat list. The route stays `creator/edit-page`; the
 * matrix's "(Identity)" / "(Sections)" / "(Gallery & links)" are states of
 * this one screen, not separate routes.
 *
 * Reordering happens WITHIN a group: moving a block re-splices it into the
 * FULL position order next to its in-group neighbor and renumbers from
 * there (saveBlockOrder), rather than swapping the two blocks' raw position
 * values -- a swap can land one of them on a position number that used to
 * belong to a block in a DIFFERENT group (positions are one shared column
 * across all block types), silently relocating it on the real page. Splicing
 * preserves every other block's relative order, so opening "sections" and
 * nudging a block never silently drags an identity or gallery block along
 * with it.
 * Live against community_blocks through leader RLS, plus a direct
 * leader-RLS write to communities.name/purpose for the identity fields
 * (screen 34) -- the app has told creators "you can change the name any
 * time" since setup, with nowhere that actually let them.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, Plus } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import ProfileButton from '../../components/ProfileButton';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../../components/keyboard/KeyboardDoneBar';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { BlockEditorCard } from '../../components/creator/BlockEditorCard';
import { friendlyError } from '../../lib/friendlyError';
import { requestWithDeadline } from '../../lib/requestWithDeadline';
import { hapticLight, hapticSuccess } from '../../lib/haptics';
import { isAdminTierRole, type LedCommunity } from '../../lib/creatorMode';
import { useCreatorAccessRead } from '../../hooks/useCreatorAccessRead';
import { useCreatorPageScope } from '../../hooks/useCreatorPageScope';
import type { CreatorPageScope } from '../../lib/creatorPageReview';
import { PageAction, PageFrame } from '../../components/creator/pages/PageFrame';
import { useLedCommunity } from '../../lib/selectedCommunity';
import {
  addBlock,
  BLOCK_TYPE_INFO,
  deleteBlock,
  getBlocksForEditor,
  getCommunityIdentity,
  IDENTITY_NAME_MAX,
  IDENTITY_NAME_MIN,
  IDENTITY_PURPOSE_MAX,
  IDENTITY_PURPOSE_MIN,
  saveBlockOrder,
  updateCommunityIdentity,
  type CommunityBlock,
  type CommunityBlockType,
} from '../../lib/communityBlocks';

type SectionKey = 'identity' | 'sections' | 'gallery';

/** Every block type falls into exactly one group -- 4 + 4 + 2 = the full 10. */
const SECTION_TYPES: Record<SectionKey, CommunityBlockType[]> = {
  identity: ['cover', 'header', 'founder', 'about'],
  sections: ['cadence', 'pinned', 'events_auto', 'members_auto'],
  gallery: ['gallery', 'links'],
};

// LIZ COPY (proposed)
const SECTION_META: Record<SectionKey, { label: string; hint: string }> = {
  identity: { label: 'Basics', hint: 'Your community’s name, cover photo and introduction.' },
  sections: { label: 'What members see', hint: 'Choose the events, member information and notes shown on your page.' },
  gallery: { label: 'Photos & links', hint: 'Show past meetups and add your website or social links.' },
};

// LIZ COPY (proposed)
const EMPTY_COPY: Record<SectionKey, string> = {
  identity: 'add a cover photo and a few words about why you started this.',
  sections: 'add what membership feels like, a pinned note, or let your events and members show themselves.',
  gallery: 'add a few photos from the vibe, or a link to where else people can find you.',
};

function hasText(block: CommunityBlock | undefined): boolean {
  return !!block && typeof block.content.text === 'string' && block.content.text.trim().length > 0;
}
function hasImages(block: CommunityBlock | undefined): boolean {
  return !!block && Array.isArray(block.content.images) && (block.content.images as string[]).length > 0;
}

export default function EditPageScreen() {
  const { communityId } = useLocalSearchParams<{ communityId?: string }>();
  const access = useCreatorAccessRead();
  const selected = useLedCommunity(access.data);
  // An explicit community never falls back to another identity after access changes.
  const requested = communityId === undefined ? selected : access.data?.ledCommunities.find(item => item.id === communityId);
  const community = requested && isAdminTierRole(requested.role) ? requested : null;
  const { scope, account } = useCreatorPageScope(`community-editor:${community?.id}:${community?.role}`);
  if (access.isLoading || access.isError || !community || !scope) return <PageFrame title="Edit community">
    {access.isLoading ? <ActivityIndicator accessibilityLabel="Checking community access" color={Colors.terracotta} /> : <>
      <Text style={styles.hint}>{access.isError ? 'Couldn’t check your community access.' : 'You don’t have editing access to this community.'}</Text>
      {access.isError && <PageAction title="Try again" onPress={() => void access.refetch()} />}
    </>}
  </PageFrame>;
  return <CommunityPageEditor key={`${scope.userId}:${account.epoch}:${community.id}:${community.role}`} community={community} scope={scope} />;
}

function CommunityPageEditor({ community, scope }: { community: LedCommunity; scope: CreatorPageScope }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [activeSection, setActiveSection] = useState<SectionKey | null>(null);
  const [adding, setAdding] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);

  const blocksKey = ['community-blocks', community?.id];
  const blocksRead = useQuery({
    queryKey: blocksKey,
    queryFn: () => requestWithDeadline(getBlocksForEditor(community.id), 12_000),
    enabled: !!community,
    retry: false,
  });
  const blocks = blocksRead.data ?? [];

  // Opening the editor is read-only. New sections are added explicitly below;
  // never seed missing sections just because a creator visits their page.

  // identity (screen 34): name + promise live on communities, not a block
  const identityKey = ['community-identity', community?.id];
  const identityRead = useQuery({
    queryKey: identityKey,
    queryFn: () => requestWithDeadline(getCommunityIdentity(community.id), 12_000),
    enabled: !!community,
    retry: false,
  });
  const identity = identityRead.data;
  // A failed read is not an empty page. Keep an already loaded editor mounted
  // during refresh failures so its unsaved text and block edits survive.
  const pageReady = Array.isArray(blocksRead.data) && !!identity;
  const readFailed = blocksRead.isError || identityRead.isError;
  const loadingPage = blocksRead.isLoading || identityRead.isLoading;
  const refreshingPage = blocksRead.isFetching || identityRead.isFetching;
  const refreshPage = async () => {
    await Promise.allSettled([blocksRead.refetch(), identityRead.refetch()]);
  };
  const [nameDraft, setNameDraft] = useState('');
  const [purposeDraft, setPurposeDraft] = useState('');
  const [identitySave, setIdentitySave] = useState<{ scope: CreatorPageScope; busy: boolean; saved: boolean }>();
  const identityLock = React.useRef<object | null>(null);
  const identitySaving = identitySave?.scope === scope && identitySave.busy;
  const identitySaved = identitySave?.scope === scope && identitySave.saved;
  // The deployed communities_update policy permits leader/co_leader;
  // an admin's page-section access does not grant identity-field writes.
  const canEditIdentity = ['leader', 'co_leader'].includes(community.role);
  const identitySeeded = React.useRef(false);
  React.useEffect(() => {
    if (identity && !identitySeeded.current) {
      setNameDraft(identity.name);
      setPurposeDraft(identity.purpose ?? '');
      identitySeeded.current = true;
    }
  }, [identity]);

  const showError = (title: string, message: string) => setAlertInfo({ title, message });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: blocksKey });

  const openSection = (key: SectionKey | null) => {
    hapticLight();
    setAdding(false);
    setActiveSection(key);
  };

  const handleHeaderBack = () => {
    if (activeSection !== null) {
      openSection(null);
    } else {
      router.back();
    }
  };

  const handleSaveIdentity = async () => {
    if (!scope.isCurrent() || !pageReady || !canEditIdentity || identityLock.current) return;
    const name = nameDraft.trim();
    const purpose = purposeDraft.trim();
    if (name.length < IDENTITY_NAME_MIN || name.length > IDENTITY_NAME_MAX) {
      // LIZ COPY (proposed)
      showError('Check the name', `between ${IDENTITY_NAME_MIN} and ${IDENTITY_NAME_MAX} characters.`);
      return;
    }
    if (purpose.length < IDENTITY_PURPOSE_MIN || purpose.length > IDENTITY_PURPOSE_MAX) {
      // LIZ COPY (proposed)
      showError('Check the description', `between ${IDENTITY_PURPOSE_MIN} and ${IDENTITY_PURPOSE_MAX} characters.`);
      return;
    }
    const owned = scope, task = {};
    identityLock.current = task;
    const current = () => owned.isCurrent() && identityLock.current === task;
    setIdentitySave({ scope: owned, busy: true, saved: false });
    try {
      await updateCommunityIdentity(community.id, { name, purpose }, { userId: owned.userId, isCurrent: current });
      if (!current()) return;
      setIdentitySave({ scope: owned, busy: true, saved: true });
      hapticSuccess();
      // the switcher, nav, and every other creator surface reads the name
      // from creator-access -- refresh it too, not just this screen's copy.
      queryClient.invalidateQueries({ queryKey: identityKey });
      queryClient.invalidateQueries({ queryKey: ['creator-access'] });
    } catch (e) {
      if (current()) showError('Couldn’t confirm save', friendlyError(e, 'Your edits are still here. Check the saved details before trying again.'));
    } finally {
      if (current()) setIdentitySave(old => old?.scope === owned ? { ...old, busy: false } : old);
      if (identityLock.current === task) identityLock.current = null;
    }
  };

  const blocksInSection = (key: SectionKey) =>
    blocks.filter((b) => SECTION_TYPES[key].includes(b.block_type));

  const availableTypesFor = (key: SectionKey) => {
    const used = new Set(blocks.map((b) => b.block_type));
    return SECTION_TYPES[key].filter((t) => !used.has(t));
  };

  const sectionSummary = (key: SectionKey): string => {
    const group = blocksInSection(key);
    if (key === 'identity') {
      const cover = group.find((b) => b.block_type === 'cover');
      const words = group.find((b) => b.block_type === 'about') ?? group.find((b) => b.block_type === 'founder');
      const coverDone = hasImages(cover);
      const wordsDone = hasText(words);
      // LIZ COPY (proposed)
      if (coverDone && wordsDone) return 'looks good — a cover photo and your words are both in';
      if (coverDone) return 'cover photo is in — add a few words next';
      if (wordsDone) return 'your words are in — add a cover photo next';
      return 'Add a cover photo and an introduction.';
    }
    if (key === 'sections') {
      const count = group.filter((b) => b.visible).length;
      // LIZ COPY (proposed)
      return count === 0
        ? 'empty for now — add what membership feels like, a pinned note, or your events'
        : `${count} section${count === 1 ? '' : 's'} shown on your page`;
    }
    const gallery = group.find((b) => b.block_type === 'gallery');
    const links = group.find((b) => b.block_type === 'links');
    const photoCount = gallery && Array.isArray(gallery.content.images) ? (gallery.content.images as string[]).length : 0;
    const linkCount = links && Array.isArray(links.content.links) ? (links.content.links as unknown[]).length : 0;
    if (photoCount === 0 && linkCount === 0) return 'empty for now — add a few photos or a link'; // LIZ COPY (proposed)
    const parts: string[] = [];
    if (photoCount > 0) parts.push(`${photoCount} photo${photoCount === 1 ? '' : 's'}`);
    if (linkCount > 0) parts.push(`${linkCount} link${linkCount === 1 ? '' : 's'}`);
    return parts.join(', ');
  };

  const handleAdd = async (type: CommunityBlockType) => {
    if (!pageReady || addBusy) return;
    setAddBusy(true);
    try {
      const nextPosition = blocks.length > 0 ? Math.max(...blocks.map((b) => b.position)) + 1 : 0;
      await addBlock(community.id, type, nextPosition);
      hapticSuccess();
      setAdding(false);
      invalidate();
    } catch (e) {
      showError('That did not save', friendlyError(e, 'Try again in a moment.'));
    } finally {
      setAddBusy(false);
    }
  };

  /** Move `a` to swap sides with its in-group neighbor `b` by re-splicing it
      into the FULL position order and renumbering -- every other block keeps
      its exact relative order, so a block from a different group can never
      appear to jump across it (see the file-header comment for why a raw
      position-value swap is unsafe here). */
  const handleMoveInSection = async (group: CommunityBlock[], index: number, direction: -1 | 1) => {
    if (!pageReady) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= group.length) return;
    const a = group[index];
    const b = group[targetIndex];
    const fullOrder = [...blocks].sort((x, y) => x.position - y.position).map((blk) => blk.id);
    const aPos = fullOrder.indexOf(a.id);
    fullOrder.splice(aPos, 1);
    const bPos = fullOrder.indexOf(b.id);
    fullOrder.splice(direction === -1 ? bPos : bPos + 1, 0, a.id);
    hapticLight();
    queryClient.setQueryData<CommunityBlock[]>(blocksKey, (prev = []) => {
      const byId = new Map(prev.map((blk) => [blk.id, blk]));
      return fullOrder.map((id, position) => ({ ...(byId.get(id) as CommunityBlock), position }));
    });
    try {
      await saveBlockOrder(fullOrder);
    } catch (e) {
      showError('That did not save', friendlyError(e, 'Try again in a moment.'));
    } finally {
      invalidate();
    }
  };

  const confirmDelete = (block: CommunityBlock) => {
    if (!pageReady) return;
    setAlertInfo({
      title: 'remove this block?',
      message: `your ${BLOCK_TYPE_INFO[block.block_type].label} block comes off the page. you can add it back fresh anytime.`,
      buttons: [
        { text: 'keep it', style: 'cancel' },
        {
          text: 'remove',
          onPress: async () => {
            try {
              await deleteBlock(block.id);
              hapticLight();
              invalidate();
            } catch (e) {
              showError('That did not save', friendlyError(e, 'Try again in a moment.'));
            }
          },
        },
      ],
    });
  };

  const renderIdentityFields = () => (
    <View style={styles.identityCard}>
      {!canEditIdentity && <Text style={styles.hint}>Only this community’s leader or co-leader can change its name and short description.</Text>}
      <Text style={styles.fieldLabel}>community name</Text>
      <TextInput
        style={styles.input}
        value={nameDraft}
        onChangeText={value => { setNameDraft(value); setIdentitySave(undefined); }}
        maxLength={IDENTITY_NAME_MAX}
        autoCapitalize="words"
        inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
        accessibilityLabel="community name"
        editable={canEditIdentity && !identitySaving}
      />
      {/* LIZ COPY (proposed) */}
      <Text style={styles.fieldLabel}>short description</Text>
      <TextInput
        style={[styles.input, styles.inputMultiline]}
        value={purposeDraft}
        onChangeText={value => { setPurposeDraft(value); setIdentitySave(undefined); }}
        maxLength={IDENTITY_PURPOSE_MAX}
        multiline
        placeholder="What do you do together?" /* LIZ COPY */
        placeholderTextColor={Colors.inkSoft}
        inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
        accessibilityLabel="Short community description"
        editable={canEditIdentity && !identitySaving}
      />
      {canEditIdentity && <TouchableOpacity
        style={[styles.saveBtn, identitySaving && styles.saveBtnDisabled]}
        onPress={handleSaveIdentity}
        disabled={identitySaving}
        accessibilityRole="button"
        accessibilityLabel="Save name and description"
      >
        {identitySaving ? (
          <ActivityIndicator size="small" color={Colors.white} />
        ) : (
          <Text style={styles.saveBtnText}>save</Text>
        )}
      </TouchableOpacity>}
      {identitySaved && <Text accessibilityLiveRegion="polite" style={styles.hint}>Saved.</Text>}
    </View>
  );

  const renderOverview = () => (
    <>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Edit community</Text>
        {/* inventory C-05: the draft/published state is real (see
            community.tsx's own banner) but was only ever shown one screen
            away -- visible right here while actually editing, not
            duplicated, just not hidden from this screen either. */}
        <View style={[styles.statusPill, community!.status === 'active' && styles.statusPillLive]}>
          <Text style={[styles.statusPillText, community!.status === 'active' && styles.statusPillTextLive]}>
            {community!.status === 'active' ? 'Published' : community!.status === 'archived' ? 'Archived' : 'Draft'}
          </Text>
        </View>
      </View>
      {/* LIZ COPY (proposed) */}
      <Text style={styles.hint}>
        Update {community!.name}. Choose what you want to change below.
      </Text>

      {/* preview (doc 37 §2): see the page as others do, before and
          after publishing; the page forces the projection client-side */}
      <View style={styles.previewRow}>
        <TouchableOpacity
          onPress={() => router.push(`/community/${community!.id}?preview=visitor` as never)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="preview your page as a visitor"
        >
          {/* LIZ COPY */}
          <Text style={styles.previewLink}>see it as a visitor</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => router.push(`/community/${community!.id}?preview=member` as never)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="preview your page as a member"
        >
          {/* LIZ COPY */}
          <Text style={styles.previewLink}>see it as a member</Text>
        </TouchableOpacity>
      </View>

      {(Object.keys(SECTION_TYPES) as SectionKey[]).map((key) => (
        <TouchableOpacity
          key={key}
          style={styles.sectionRow}
          onPress={() => openSection(key)}
          accessibilityRole="button"
          accessibilityLabel={`${SECTION_META[key].label}. ${sectionSummary(key)}`}
        >
          <View style={styles.sectionRowText}>
            <Text style={styles.sectionRowTitle}>{SECTION_META[key].label}</Text>
            <Text style={styles.sectionRowSummary}>{sectionSummary(key)}</Text>
          </View>
          <ChevronRight size={20} color={Colors.tertiary} strokeWidth={2.5} />
        </TouchableOpacity>
      ))}
    </>
  );

  const renderSectionDetail = (key: SectionKey) => {
    const group = blocksInSection(key);
    const availableTypes = availableTypesFor(key);
    return (
      <>
        <TouchableOpacity
          style={styles.backRow}
          onPress={() => openSection(null)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="back to your page overview"
        >
          <ArrowLeft size={16} color={Colors.terracotta} strokeWidth={2.5} />
          {/* LIZ COPY (proposed) */}
          <Text style={styles.backRowText}>your page</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{SECTION_META[key].label}</Text>
        <Text style={styles.hint}>{SECTION_META[key].hint}</Text>

        {key === 'identity' && renderIdentityFields()}

        {group.map((block, i) => (
          <BlockEditorCard
            key={block.id}
            block={block}
            communityId={community!.id}
            communityName={community!.name}
            isFirst={i === 0}
            isLast={i === group.length - 1}
            onMoveUp={() => handleMoveInSection(group, i, -1)}
            onMoveDown={() => handleMoveInSection(group, i, 1)}
            onChanged={invalidate}
            onDeleteRequest={() => confirmDelete(block)}
            onError={showError}
          />
        ))}

        {group.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>{EMPTY_COPY[key]}</Text>
          </View>
        )}

        {availableTypes.length > 0 && !adding && (
          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => { hapticLight(); setAdding(true); }}
            accessibilityRole="button"
            accessibilityLabel="add a block"
          >
            <Plus size={16} color={Colors.terracotta} strokeWidth={2.5} />
            <Text style={styles.addBtnText}>add a block</Text>
          </TouchableOpacity>
        )}

        {adding && (
          <View style={styles.addSheet}>
            {availableTypes.map((type) => (
              <TouchableOpacity
                key={type}
                style={styles.addRow}
                onPress={() => handleAdd(type)}
                disabled={addBusy}
                accessibilityRole="button"
                accessibilityLabel={`add ${BLOCK_TYPE_INFO[type].label}`}
              >
                <Text style={styles.addRowLabel}>{BLOCK_TYPE_INFO[type].label}</Text>
                <Text style={styles.addRowHint}>{BLOCK_TYPE_INFO[type].hint}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              onPress={() => setAdding(false)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="never mind, don't add a block"
            >
              <Text style={styles.addCancel}>never mind</Text>
            </TouchableOpacity>
          </View>
        )}
      </>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={handleHeaderBack}
            style={styles.headerBtn}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={activeSection !== null ? 'back to your page overview' : 'back'}
          >
            <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2.5} />
          </TouchableOpacity>
          <View style={styles.flex} /><ProfileButton compact />
        </View>

        {!pageReady && loadingPage && !readFailed ? (
          <View style={styles.centered}>
            <ActivityIndicator accessibilityLabel="Loading community details" size="large" color={Colors.terracotta} />
          </View>
        ) : !pageReady ? (
          <View style={styles.centered}>
            <Text style={styles.hint} accessibilityRole="alert">Couldn’t load community details. Try again to edit your page.</Text>
            <PageAction title="Try again" disabled={!!refreshingPage} onPress={() => void refreshPage()} />
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={!!refreshingPage} onRefresh={() => void refreshPage()} tintColor={Colors.terracotta} />}
          >
            {readFailed && <View style={styles.readWarning}>
              <Text style={styles.hint} accessibilityRole="alert">Couldn’t refresh your page. Your edits are still here.</Text>
              <PageAction title="Try again" quiet compact disabled={!!refreshingPage} onPress={() => void refreshPage()} />
            </View>}
            {activeSection === null ? renderOverview() : renderSectionDetail(activeSection)}
          </ScrollView>
        )}
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
  readWarning: { marginBottom: 16, gap: 8 },
  container: { flex: 1, backgroundColor: Colors.parchment },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  headerBtn: { padding: 4 },
  content: { padding: 20, paddingBottom: 60 },
  titleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 8 },
  title: {
    flexShrink: 1, maxWidth: '100%',
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayLG,
    lineHeight: LineHeights.displayLG,
    color: Colors.darkWarm,
  },
  statusPill: {
    backgroundColor: Colors.inputBg,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusPillLive: { backgroundColor: Colors.goldBadgeSoft },
  statusPillText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  statusPillTextLive: { color: Colors.darkWarm },
  hint: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    lineHeight: LineHeights.bodySM,
    marginBottom: 16,
  },
  previewRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 20, marginBottom: 20 },
  previewLink: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  backRowText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    marginBottom: 10,
  },
  sectionRowText: { flex: 1, gap: 3 },
  sectionRowTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.darkWarm, textTransform: 'none' },
  sectionRowSummary: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary, lineHeight: LineHeights.bodySM },
  identityCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    marginBottom: 10,
  },
  fieldLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  input: {
    backgroundColor: Colors.inputBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.darkWarm,
    marginBottom: 10,
  },
  inputMultiline: { minHeight: 80, textAlignVertical: 'top' },
  saveBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  emptyCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.borderWarm,
    padding: 16,
    marginBottom: 10,
  },
  emptyText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary, lineHeight: LineHeights.bodySM },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    paddingVertical: 12,
    marginTop: 6,
  },
  addBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  addSheet: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    marginTop: 6,
    gap: 12,
  },
  addRow: { gap: 2 },
  addRowLabel: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  addRowHint: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.secondary },
  addCancel: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.tertiary, marginTop: 2 },
});
