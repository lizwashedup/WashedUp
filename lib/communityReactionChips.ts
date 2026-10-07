/** Presentation only: keep the stored key so legacy reactions can be toggled. */
export interface ReactionCount {
  emoji: string;
  count: number;
  mine: boolean;
}

export interface ReactionChip extends ReactionCount {
  storageKey: string;
}

export function reactionEmoji(storageKey: string): string {
  return storageKey === 'heart' ? '❤️' : storageKey;
}

export function aggregateReactionChips(reactions: readonly ReactionCount[]): ReactionChip[] {
  const chips = new Map<string, ReactionChip>();
  for (const reaction of reactions) {
    if (!reaction.emoji || !Number.isFinite(reaction.count) || reaction.count < 1) continue;
    const emoji = reactionEmoji(reaction.emoji);
    const existing = chips.get(emoji);
    if (existing) {
      existing.count += Math.floor(reaction.count);
      // Removing a selected chip must address the viewer's stored alias,
      // regardless of which spelling arrived first in the query result.
      if (reaction.mine && !existing.mine) existing.storageKey = reaction.emoji;
      existing.mine ||= reaction.mine;
    } else {
      chips.set(emoji, { emoji, storageKey: reaction.emoji, count: Math.floor(reaction.count), mine: reaction.mine });
    }
  }
  return [...chips.values()];
}

export function topicReactionCounts(
  reactions: readonly { reaction: string; user_id: string }[],
  viewerId: string | null,
): ReactionCount[] {
  return reactions.map(reaction => ({ emoji: reaction.reaction, count: 1, mine: !!viewerId && reaction.user_id === viewerId }));
}

/** Reuse an existing key; only a new topic heart defaults to its legacy key. */
export function reactionKeyForEmoji(
  emoji: string,
  reactions: readonly ReactionCount[],
  newHeartKey: '❤️' | 'heart' = '❤️',
): string {
  const display = reactionEmoji(emoji);
  return aggregateReactionChips(reactions).find(chip => chip.emoji === display)?.storageKey
    ?? (display === '❤️' ? newHeartKey : emoji);
}
