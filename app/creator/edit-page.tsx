/**
 * The page block editor (creator mode). One column of blocks, three verbs:
 * add, reorder, eye-toggle. Live against community_blocks through leader
 * RLS. One block per type, the doc 09 set of 8. Functionally minimal per
 * decision 15a; reorder is up/down arrows until the design pass decides
 * the drag gesture.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { BlockEditorCard } from '../../components/creator/BlockEditorCard';
import { friendlyError } from '../../lib/friendlyError';
import { hapticLight, hapticSuccess } from '../../lib/haptics';
import { getCreatorAccess } from '../../lib/creatorMode';
import { useLedCommunity } from '../../lib/selectedCommunity';
import {
  addBlock,
  BLOCK_TYPE_INFO,
  BLOCK_TYPE_ORDER,
  deleteBlock,
  getBlocksForEditor,
  saveBlockOrder,
  type CommunityBlock,
  type CommunityBlockType,
} from '../../lib/communityBlocks';

export default function EditPageScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);

  const { data: access, isLoading: accessLoading } = useQuery({
    queryKey: ['creator-access'],
    queryFn: getCreatorAccess,
  });
  const community = useLedCommunity(access);

  const blocksKey = ['community-blocks', community?.id];
  const { data: blocks = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: blocksKey,
    queryFn: () => getBlocksForEditor(community!.id),
    enabled: !!community,
  });

  const usedTypes = new Set(blocks.map((b) => b.block_type));
  const availableTypes = BLOCK_TYPE_ORDER.filter((t) => !usedTypes.has(t));

  const showError = (title: string, message: string) => setAlertInfo({ title, message });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: blocksKey });

  const handleAdd = async (type: CommunityBlockType) => {
    if (!community || addBusy) return;
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

  const handleMove = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= blocks.length) return;
    const reordered = [...blocks];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    hapticLight();
    queryClient.setQueryData<CommunityBlock[]>(blocksKey, reordered.map((b, i) => ({ ...b, position: i })));
    try {
      await saveBlockOrder(reordered.map((b) => b.id));
    } catch (e) {
      showError('That did not save', friendlyError(e, 'Try again in a moment.'));
    } finally {
      invalidate();
    }
  };

  const confirmDelete = (block: CommunityBlock) => {
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

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12}>
            <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2.5} />
          </TouchableOpacity>
        </View>

        {accessLoading || (community && isLoading) ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={Colors.terracotta} />
          </View>
        ) : !community ? (
          <View style={styles.centered}>
            <Text style={styles.hint}>no community on this account yet.</Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.terracotta} />}
          >
            <Text style={styles.title}>your page</Text>
            <Text style={styles.hint}>
              the blocks that make up {community.name}. tap one to fill it in, use the
              arrows to reorder, the eye to show or hide. this is what members and
              visitors see, in this order.
            </Text>

            {/* preview (doc 37 §2): see the page as others do, before and
                after publishing; the page forces the projection client-side */}
            <View style={styles.previewRow}>
              <TouchableOpacity
                onPress={() => router.push(`/community/${community.id}?preview=visitor` as never)}
                hitSlop={8}
              >
                {/* LIZ COPY */}
                <Text style={styles.previewLink}>see it as a visitor</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => router.push(`/community/${community.id}?preview=member` as never)}
                hitSlop={8}
              >
                {/* LIZ COPY */}
                <Text style={styles.previewLink}>see it as a member</Text>
              </TouchableOpacity>
            </View>

            {blocks.map((block, i) => (
              <BlockEditorCard
                key={block.id}
                block={block}
                communityId={community.id}
                isFirst={i === 0}
                isLast={i === blocks.length - 1}
                onMoveUp={() => handleMove(i, -1)}
                onMoveDown={() => handleMove(i, 1)}
                onChanged={invalidate}
                onDeleteRequest={() => confirmDelete(block)}
                onError={showError}
              />
            ))}

            {blocks.length === 0 && (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>
                  a blank page, all yours. start with cover photos and an about block.
                </Text>
              </View>
            )}

            {availableTypes.length > 0 && !adding && (
              <TouchableOpacity style={styles.addBtn} onPress={() => { hapticLight(); setAdding(true); }}>
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
                  >
                    <Text style={styles.addRowLabel}>{BLOCK_TYPE_INFO[type].label}</Text>
                    <Text style={styles.addRowHint}>{BLOCK_TYPE_INFO[type].hint}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity onPress={() => setAdding(false)} hitSlop={6}>
                  <Text style={styles.addCancel}>never mind</Text>
                </TouchableOpacity>
              </View>
            )}
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
  container: { flex: 1, backgroundColor: Colors.parchment },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8 },
  headerBtn: { padding: 4 },
  content: { padding: 20, paddingBottom: 60 },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayLG,
    lineHeight: LineHeights.displayLG,
    color: Colors.darkWarm,
    marginBottom: 8,
  },
  hint: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    lineHeight: LineHeights.bodySM,
    marginBottom: 16,
  },
  previewRow: { flexDirection: 'row', gap: 20, marginBottom: 16 },
  previewLink: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.terracotta },
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
