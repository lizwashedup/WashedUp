/**
 * One block in the page editor: label row (eye toggle, up/down reorder),
 * expandable content editor per block type. Functionally minimal per
 * decision 15a; the design pass comes later with Liz.
 *
 * Content jsonb shapes are the shared contract with web (see
 * lib/communityBlocks.ts header). Text-ish blocks save on an explicit
 * button; image adds and removes persist immediately.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { ChevronDown, ChevronUp, Eye, EyeOff, Plus, X } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../keyboard/KeyboardDoneBar';
import { hapticLight, hapticSuccess } from '../../lib/haptics';
import { friendlyError } from '../../lib/friendlyError';
import {
  BLOCK_TYPE_INFO,
  COVER_MAX_IMAGES,
  GALLERY_MAX_IMAGES,
  mutateBlockImages,
  pickAndUploadBlockImage,
  setBlockVisible,
  updateBlockContent,
  type CommunityBlock,
} from '../../lib/communityBlocks';

const THUMB_SIZE = 72;
const LOGO_SIZE = 56;

interface LinkDraft {
  label: string;
  url: string;
}

interface Props {
  block: CommunityBlock;
  communityId: string;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onChanged: () => void;
  onDeleteRequest: () => void;
  onError: (title: string, message: string) => void;
}

export function BlockEditorCard({
  block,
  communityId,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onChanged,
  onDeleteRequest,
  onError,
}: Props) {
  const info = BLOCK_TYPE_INFO[block.block_type];
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  // drafts, seeded from content when the card expands
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [tagline, setTagline] = useState('');
  const [links, setLinks] = useState<LinkDraft[]>([]);

  const images: string[] = Array.isArray(block.content.images)
    ? (block.content.images as string[])
    : [];
  const logoUrl = typeof block.content.logo_url === 'string' ? block.content.logo_url : null;
  const maxImages = block.block_type === 'cover' ? COVER_MAX_IMAGES : GALLERY_MAX_IMAGES;

  const toggleExpanded = () => {
    if (!expanded) {
      setText(typeof block.content.text === 'string' ? block.content.text : '');
      setTitle(typeof block.content.title === 'string' ? block.content.title : '');
      setTagline(typeof block.content.tagline === 'string' ? block.content.tagline : '');
      setLinks(
        Array.isArray(block.content.links) ? (block.content.links as LinkDraft[]).map((l) => ({ ...l })) : [],
      );
    }
    hapticLight();
    setExpanded((e) => !e);
  };

  const toggleVisible = async () => {
    setBusy(true);
    try {
      await setBlockVisible(block.id, !block.visible);
      hapticLight();
      onChanged();
    } catch (e) {
      onError('That did not save', friendlyError(e, 'Try again in a moment.'));
    } finally {
      setBusy(false);
    }
  };

  const persistContent = async (content: Record<string, unknown>) => {
    setSaving(true);
    try {
      await updateBlockContent(block.id, content);
      hapticSuccess();
      onChanged();
    } catch (e) {
      onError('That did not save', friendlyError(e, 'Try again in a moment.'));
    } finally {
      setSaving(false);
    }
  };

  const addImage = async () => {
    setBusy(true);
    try {
      const url = await pickAndUploadBlockImage(communityId);
      if (url) {
        await mutateBlockImages(block.id, (current) =>
          current.length < maxImages ? [...current, url] : current,
        );
        hapticSuccess();
        onChanged();
      }
    } catch (e) {
      onError('That photo did not upload', friendlyError(e, 'Try again in a moment.'));
    } finally {
      setBusy(false);
    }
  };

  const removeImage = async (url: string) => {
    setBusy(true);
    try {
      await mutateBlockImages(block.id, (current) => current.filter((i) => i !== url));
      onChanged();
    } catch (e) {
      onError('That did not save', friendlyError(e, 'Try again in a moment.'));
    } finally {
      setBusy(false);
    }
  };

  const setLogo = async () => {
    setBusy(true);
    try {
      const url = await pickAndUploadBlockImage(communityId);
      if (url) {
        await updateBlockContent(block.id, { ...block.content, logo_url: url });
        hapticSuccess();
        onChanged();
      }
    } catch (e) {
      onError('That photo did not upload', friendlyError(e, 'Try again in a moment.'));
    } finally {
      setBusy(false);
    }
  };

  const clearLogo = async () => {
    const { logo_url: _dropped, ...rest } = block.content;
    setBusy(true);
    try {
      await updateBlockContent(block.id, rest);
      onChanged();
    } catch (e) {
      onError('That did not save', friendlyError(e, 'Try again in a moment.'));
    } finally {
      setBusy(false);
    }
  };

  const renderImagesEditor = () => (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbRow}>
        {images.map((url) => (
          <View key={url} style={styles.thumbWrap}>
            <Image source={{ uri: url }} style={styles.thumb} />
            <TouchableOpacity style={styles.thumbRemove} onPress={() => removeImage(url)} hitSlop={8}>
              <X size={12} color={Colors.white} strokeWidth={3} />
            </TouchableOpacity>
          </View>
        ))}
        {images.length < maxImages && (
          <TouchableOpacity style={styles.thumbAdd} onPress={addImage} disabled={busy}>
            {busy ? (
              <ActivityIndicator size="small" color={Colors.terracotta} />
            ) : (
              <Plus size={20} color={Colors.terracotta} strokeWidth={2.5} />
            )}
          </TouchableOpacity>
        )}
      </ScrollView>
      <Text style={styles.fieldHint}>
        {images.length} of {maxImages} photos
      </Text>
    </View>
  );

  const renderHeaderEditor = () => (
    <View>
      <Text style={styles.fieldLabel}>one-liner</Text>
      <TextInput
        style={styles.input}
        value={tagline}
        onChangeText={setTagline}
        placeholder="what you tell people this is"
        placeholderTextColor={Colors.inkSoft}
        maxLength={120}
        inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
      />
      <Text style={styles.fieldLabel}>logo</Text>
      <View style={styles.logoRow}>
        {logoUrl ? (
          <View style={styles.thumbWrap}>
            <Image source={{ uri: logoUrl }} style={styles.logo} />
            <TouchableOpacity style={styles.thumbRemove} onPress={clearLogo} hitSlop={8}>
              <X size={12} color={Colors.white} strokeWidth={3} />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.logoAdd} onPress={setLogo} disabled={busy}>
            {busy ? (
              <ActivityIndicator size="small" color={Colors.terracotta} />
            ) : (
              <Plus size={18} color={Colors.terracotta} strokeWidth={2.5} />
            )}
          </TouchableOpacity>
        )}
      </View>
      <TouchableOpacity
        style={styles.saveBtn}
        onPress={() => persistContent({ ...block.content, tagline: tagline.trim() })}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator size="small" color={Colors.white} />
        ) : (
          <Text style={styles.saveBtnText}>save</Text>
        )}
      </TouchableOpacity>
    </View>
  );

  const renderTextEditor = (multiline: boolean, withTitle: boolean) => (
    <View>
      {withTitle && (
        <>
          <Text style={styles.fieldLabel}>title</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="optional"
            placeholderTextColor={Colors.inkSoft}
            maxLength={80}
            inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
          />
        </>
      )}
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline]}
        value={text}
        onChangeText={setText}
        placeholder={block.block_type === 'about' ? 'what this community is' : 'the note itself'}
        placeholderTextColor={Colors.inkSoft}
        multiline={multiline}
        maxLength={4000}
        inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
      />
      <TouchableOpacity
        style={styles.saveBtn}
        onPress={() =>
          persistContent(
            withTitle
              ? { ...block.content, title: title.trim(), text: text.trim() }
              : { ...block.content, text: text.trim() },
          )
        }
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator size="small" color={Colors.white} />
        ) : (
          <Text style={styles.saveBtnText}>save</Text>
        )}
      </TouchableOpacity>
    </View>
  );

  const renderLinksEditor = () => (
    <View>
      {links.map((link, i) => (
        <View key={i} style={styles.linkRow}>
          <View style={styles.linkInputs}>
            <TextInput
              style={styles.input}
              value={link.label}
              onChangeText={(v) => setLinks(links.map((l, j) => (j === i ? { ...l, label: v } : l)))}
              placeholder="label, like instagram"
              placeholderTextColor={Colors.inkSoft}
              maxLength={60}
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />
            <TextInput
              style={styles.input}
              value={link.url}
              onChangeText={(v) => setLinks(links.map((l, j) => (j === i ? { ...l, url: v } : l)))}
              placeholder="https://"
              placeholderTextColor={Colors.inkSoft}
              autoCapitalize="none"
              keyboardType="url"
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />
          </View>
          <TouchableOpacity onPress={() => setLinks(links.filter((_, j) => j !== i))} hitSlop={8}>
            <X size={16} color={Colors.tertiary} strokeWidth={2.5} />
          </TouchableOpacity>
        </View>
      ))}
      <TouchableOpacity style={styles.addLinkBtn} onPress={() => setLinks([...links, { label: '', url: '' }])}>
        <Plus size={14} color={Colors.terracotta} strokeWidth={2.5} />
        <Text style={styles.addLinkText}>add a link</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.saveBtn}
        onPress={() =>
          persistContent({
            ...block.content,
            links: links
              .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
              .filter((l) => l.label && l.url),
          })
        }
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator size="small" color={Colors.white} />
        ) : (
          <Text style={styles.saveBtnText}>save</Text>
        )}
      </TouchableOpacity>
    </View>
  );

  const renderEditor = () => {
    switch (block.block_type) {
      case 'cover':
      case 'gallery':
        return renderImagesEditor();
      case 'header':
        return renderHeaderEditor();
      case 'about':
        return renderTextEditor(true, false);
      case 'pinned':
        return renderTextEditor(true, true);
      case 'links':
        return renderLinksEditor();
      case 'events_auto':
      case 'members_auto':
        return <Text style={styles.autoNote}>{BLOCK_TYPE_INFO[block.block_type].hint}</Text>;
    }
  };

  return (
    <View style={[styles.card, !block.visible && styles.cardHidden]}>
      <View style={styles.titleRow}>
        <TouchableOpacity style={styles.titleTap} onPress={toggleExpanded} hitSlop={6}>
          <Text style={styles.blockLabel}>{info.label}</Text>
          {!block.visible && <Text style={styles.hiddenTag}>hidden</Text>}
        </TouchableOpacity>
        <View style={styles.controls}>
          <TouchableOpacity onPress={onMoveUp} disabled={isFirst} hitSlop={6} style={isFirst && styles.controlOff}>
            <ChevronUp size={18} color={Colors.secondary} strokeWidth={2.5} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onMoveDown} disabled={isLast} hitSlop={6} style={isLast && styles.controlOff}>
            <ChevronDown size={18} color={Colors.secondary} strokeWidth={2.5} />
          </TouchableOpacity>
          <TouchableOpacity onPress={toggleVisible} disabled={busy} hitSlop={6}>
            {block.visible ? (
              <Eye size={18} color={Colors.terracotta} strokeWidth={2.5} />
            ) : (
              <EyeOff size={18} color={Colors.tertiary} strokeWidth={2.5} />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {expanded && (
        <View style={styles.editor}>
          {renderEditor()}
          <TouchableOpacity onPress={onDeleteRequest} hitSlop={6}>
            <Text style={styles.removeText}>remove this block</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    marginBottom: 10,
  },
  cardHidden: { opacity: 0.65 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  blockLabel: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  hiddenTag: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  controlOff: { opacity: 0.25 },
  editor: { marginTop: 12, gap: 10 },
  autoNote: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary, lineHeight: LineHeights.bodySM },
  fieldLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  fieldHint: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.tertiary, marginTop: 6 },
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
  inputMultiline: { minHeight: 100, textAlignVertical: 'top' },
  thumbRow: { gap: 10, paddingVertical: 4 },
  thumbWrap: { position: 'relative' },
  thumb: { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 10 },
  logo: { width: LOGO_SIZE, height: LOGO_SIZE, borderRadius: 999 },
  logoRow: { flexDirection: 'row', marginBottom: 10 },
  thumbRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: Colors.asphalt,
    borderRadius: 999,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbAdd: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 10,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.terracotta,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoAdd: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    borderRadius: 999,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.terracotta,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  linkInputs: { flex: 1 },
  addLinkBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  addLinkText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  saveBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: 'center',
  },
  saveBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  removeText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.tertiary,
    marginTop: 4,
  },
});
