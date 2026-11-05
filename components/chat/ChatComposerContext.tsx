import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors, { AfterglowColors } from '../../constants/Colors';
import type { ChatComposerDraft } from '../../lib/chatComposerDraft';
import type { createChatComposerAppearance } from './chatComposerAppearance';
import { chatStyles } from './chatThreadStyles';

type Props = {
  composerDraft: { ready: boolean; error: boolean; draft: ChatComposerDraft };
  composerAppearance: ReturnType<typeof createChatComposerAppearance> | null;
  sendingText: boolean;
  checkingDraft: boolean;
  writable: boolean;
  replyingTo: ChatComposerDraft['reply'];
  editingMessageId: string | null;
  onRetryDraft: () => void;
  onCheckOriginal: () => void;
  onRetryOriginal: () => void;
  onCancelReply: () => void;
  onCancelEdit: () => void;
};

/** Presentation only. Draft persistence, request ownership, and guarded actions
 * remain in ChatThread so a retired conversation cannot mutate a new visit. */
export function ChatComposerContext({ composerDraft, composerAppearance, sendingText,
  checkingDraft, writable, replyingTo, editingMessageId, onRetryDraft,
  onCheckOriginal, onRetryOriginal, onCancelReply, onCancelEdit }: Props) {
  return <>
            {(!composerDraft.ready || composerDraft.error || composerDraft.draft.attempt && !sendingText) && (
              <View style={chatStyles.replyBar}>
                <View style={chatStyles.replyBarContent}>
                  <Text style={[chatStyles.replyBarName, composerAppearance?.contextName]}>{composerDraft.error ? 'Your draft could not be saved or checked.' : !composerDraft.ready ? 'Checking your draft…' : 'Your previous message is not confirmed.'}</Text>
                  {!!composerDraft.draft.attempt && <Text style={[chatStyles.replyBarText, composerAppearance?.contextBody]} numberOfLines={2}>{composerDraft.draft.attempt.text}</Text>}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
                    {composerDraft.error ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry message draft" style={chatStyles.draftRecoveryAction} onPress={onRetryDraft}><Text style={[chatStyles.replyBarName, composerAppearance?.contextName]}>Try again</Text></TouchableOpacity>
                      : composerDraft.draft.attempt && <>
                        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Check original message" style={chatStyles.draftRecoveryAction} disabled={checkingDraft} onPress={onCheckOriginal}><Text style={[chatStyles.replyBarName, composerAppearance?.contextName]}>Check message</Text></TouchableOpacity>
                        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry original message" style={chatStyles.draftRecoveryAction} disabled={checkingDraft || !writable} onPress={onRetryOriginal}><Text style={[chatStyles.replyBarName, composerAppearance?.contextName]}>Retry original</Text></TouchableOpacity>
                      </>}
                  </View>
                </View>
              </View>
            )}
            {replyingTo && (
              <View style={chatStyles.replyBar}>
                <View style={chatStyles.replyBarLeft}>
                  <Ionicons name="arrow-undo-outline" size={16} color={composerAppearance ? AfterglowColors.clay : Colors.terracotta} />
                  <View style={chatStyles.replyBarContent}>
                    <Text style={[chatStyles.replyBarName, composerAppearance?.contextName]}>{replyingTo.senderName}</Text>
                    <Text style={[chatStyles.replyBarText, composerAppearance?.contextBody]} numberOfLines={1}>{replyingTo.content}</Text>
                  </View>
                </View>
                <TouchableOpacity onPress={onCancelReply} style={chatStyles.composerCancel} accessibilityRole="button" accessibilityLabel="Cancel reply">
                  <Ionicons name="close" size={18} color={composerAppearance ? AfterglowColors.muted : Colors.warmGray} />
                </TouchableOpacity>
              </View>
            )}
            {editingMessageId && (
              <View style={chatStyles.editingBar}>
                <Ionicons name="create-outline" size={16} color={composerAppearance ? AfterglowColors.clay : Colors.terracotta} />
                <Text style={[chatStyles.editingText, composerAppearance?.contextName]}>Editing message</Text>
                <TouchableOpacity onPress={onCancelEdit} style={chatStyles.composerCancel} accessibilityRole="button" accessibilityLabel="Cancel edit">
                  <Ionicons name="close" size={18} color={composerAppearance ? AfterglowColors.muted : Colors.warmGray} />
                </TouchableOpacity>
              </View>
            )}
  </>;
}
