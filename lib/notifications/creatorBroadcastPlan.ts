export type BroadcastChannel = 'in_app' | 'push' | 'email' | 'sms';

export interface BroadcastMember {
  userId: string;
  active: boolean;
  muted: boolean;
  consent: Partial<Record<BroadcastChannel, boolean>>;
}

export interface BroadcastDeliveryJob {
  recipientUserId: string;
  channel: BroadcastChannel;
  idempotencyKey: string;
}

export function planCreatorBroadcast(
  broadcastId: string,
  senderUserId: string,
  members: readonly BroadcastMember[],
  requestedChannels: readonly BroadcastChannel[],
  activation: Record<BroadcastChannel, boolean>,
): BroadcastDeliveryJob[] {
  const jobs: BroadcastDeliveryJob[] = [];
  const uniqueChannels = [...new Set(requestedChannels)];
  const uniqueMembers = new Map(members.map((member) => [member.userId, member]));
  for (const member of uniqueMembers.values()) {
    if (member.userId === senderUserId || !member.active || member.muted) continue;
    for (const channel of uniqueChannels) {
      if (!activation[channel] || member.consent[channel] !== true) continue;
      jobs.push({
        recipientUserId: member.userId,
        channel,
        idempotencyKey: `${broadcastId}:${member.userId}:${channel}`,
      });
    }
  }
  return jobs.sort((a, b) =>
    a.recipientUserId.localeCompare(b.recipientUserId) || a.channel.localeCompare(b.channel),
  );
}
