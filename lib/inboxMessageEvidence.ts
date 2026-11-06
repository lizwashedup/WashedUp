import { compareChatTimestamps } from './chatTimestamp';

export type InboxMessageEvidence = {
  ids: readonly string[];
  readThrough?: string;
  // At or before this time a bounded sample (or a count-only card) may
  // already include an ID it could not return. Re-read instead of guessing.
  uncertainThrough?: string;
};

type Identified = { id?: string; created_at?: string };
export function messageEvidence(peers: Identified[], latest: Identified | undefined, readThrough: string | undefined, limit: number): InboxMessageEvidence {
  return {
    ids: [...new Set([latest?.id, ...peers.map(row => row.id)].filter((id): id is string => !!id))],
    readThrough,
    uncertainThrough: peers.length >= limit ? peers[peers.length - 1]?.created_at : undefined,
  };
}

export function classifyInboxInsert(evidence: InboxMessageEvidence | undefined, id: string, at: string) {
  if (!evidence || !id) return 'new';
  if (evidence.ids.includes(id)) return 'known';
  if (evidence.readThrough && compareChatTimestamps(at,evidence.readThrough) <= 0) return 'read';
  if (evidence.uncertainThrough && compareChatTimestamps(at,evidence.uncertainThrough) <= 0) return 'check';
  return 'new';
}

export function withInboxDelivery(evidence: InboxMessageEvidence | undefined, id: string, at: string, latest: string | null): InboxMessageEvidence | undefined {
  if (!id) return evidence;
  const ids = [id, ...(evidence?.ids ?? []).filter(previous => previous !== id)];
  let uncertainThrough = evidence?.uncertainThrough;
  if (ids.length > 64) {
    // The oldest identity is about to be forgotten. A later replay outside
    // this bounded window must refresh the count instead of incrementing it.
    for (const stamp of [at, latest]) if (stamp && compareChatTimestamps(stamp, uncertainThrough) > 0) uncertainThrough = stamp;
  }
  return { ...evidence, uncertainThrough, ids: ids.slice(0,64) };
}
