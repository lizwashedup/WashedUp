/** Local rehearsal only. No database, SDK, credentials, writes or notifications. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Exact legacy rows must survive the additive routing stage. New room-role and
// preference records belong in separate tables, outside this preservation set.
export const PRESERVED_TABLES = Object.freeze({
  communities: ['id'],
  community_members: ['id'],
  community_member_answers: ['member_id'],
  community_broadcasts: ['id'],
  community_broadcast_replies: ['id'],
  community_broadcast_reactions: ['broadcast_id', 'user_id', 'emoji'],
  community_broadcast_reads: ['community_id', 'user_id'],
  community_topics: ['id'],
  community_topic_members: ['topic_id', 'user_id'],
  community_topic_messages: ['id'],
  community_topic_message_reactions: ['id'],
  community_topic_reads: ['topic_id', 'user_id'],
});

// Minimum known source columns. The exporter must also declare every actual
// column from information_schema; each row must contain that exact column set.
export const REQUIRED_COLUMNS = Object.freeze({
  communities: ['id', 'handle', 'name', 'description', 'accent_color', 'status', 'created_by', 'created_at', 'updated_at', 'main_chat_name'],
  community_members: ['id', 'community_id', 'user_id', 'role', 'status', 'join_answers', 'joined_at', 'created_at', 'updated_at', 'broadcasts_muted'],
  community_member_answers: ['member_id', 'community_id', 'user_id', 'answers', 'created_at', 'updated_at'],
  community_broadcasts: ['id', 'community_id', 'sender_id', 'body', 'pinned', 'created_at', 'kind', 'payload', 'image_url', 'edited_at'],
  community_broadcast_replies: ['id', 'broadcast_id', 'sender_id', 'body', 'created_at'],
  community_broadcast_reactions: ['broadcast_id', 'user_id', 'emoji', 'created_at'],
  community_broadcast_reads: ['community_id', 'user_id', 'last_read_at'],
  community_topics: ['id', 'community_id', 'name', 'created_by', 'archived', 'created_at', 'explore_event_id', 'is_default'],
  community_topic_members: ['topic_id', 'user_id', 'notifications_on', 'joined_at'],
  community_topic_messages: ['id', 'topic_id', 'sender_id', 'body', 'created_at', 'image_url', 'edited_at', 'reply_to_message_id'],
  community_topic_message_reactions: ['id', 'message_id', 'user_id', 'reaction', 'created_at'],
  community_topic_reads: ['topic_id', 'user_id', 'last_read_at'],
});

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const sameKeys = (a, b) => JSON.stringify(Object.keys(a).sort()) === JSON.stringify(Object.keys(b).sort());
const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const sourceKey = source => JSON.stringify([source.kind, source.id]);

/** Explicit assignments only: names and is_default never infer room roles. */
export function validateRoomManifest(manifest) {
  const errors = [];
  const fail = code => { if (!errors.includes(code)) errors.push(code); };
  if (!object(manifest) || manifest.version !== 1 || !nonempty(manifest.communityId) ||
      manifest.inventoryComplete !== true || !Array.isArray(manifest.sources) ||
      !Array.isArray(manifest.rooms)) return { ok: false, errors: ['incomplete-inventory'] };

  const sources = new Map();
  for (const source of manifest.sources) {
    if (!object(source) || !['broadcast-intros', 'broadcast-main', 'topic'].includes(source.kind) ||
        !nonempty(source.id) || source.communityId !== manifest.communityId ||
        typeof source.archived !== 'boolean' ||
        !(source.eventId === null || nonempty(source.eventId))) {
      fail('invalid-source'); continue;
    }
    if (source.kind !== 'topic' && (source.id !== manifest.communityId || source.eventId !== null)) {
      fail('invalid-broadcast-source'); continue;
    }
    const key = sourceKey(source);
    if (sources.has(key)) fail('duplicate-source');
    sources.set(key, source);
  }
  // Empty streams are still included, so a later write cannot vanish from the
  // mapping. These are disjoint predicates over one unchanged broadcast table.
  for (const kind of ['broadcast-intros', 'broadcast-main']) {
    if (!sources.has(sourceKey({ kind, id: manifest.communityId }))) fail('missing-broadcast-partition');
  }

  const roomIds = new Set(), assigned = new Map();
  const roles = { intros: 0, main: 0 };
  for (const room of manifest.rooms) {
    if (!object(room) || !nonempty(room.id) || !nonempty(room.name) || room.name.trim().length > 60 ||
        !['intros', 'main', 'optional', 'legacy'].includes(room.role) ||
        !Array.isArray(room.sources) || room.sources.length !== 1) {
      fail('invalid-room-or-history-merge'); continue;
    }
    if (roomIds.has(room.id)) fail('duplicate-room-id');
    roomIds.add(room.id);
    if (room.role in roles) roles[room.role]++;
    const ref = room.sources[0];
    if (!object(ref)) { fail('unknown-room-source'); continue; }
    const key = sourceKey(ref), source = sources.get(key);
    if (!source) { fail('unknown-room-source'); continue; }
    assigned.set(key, (assigned.get(key) ?? 0) + 1);
    if (source.eventId !== null) fail('event-room-in-persistent-hub');
    if (source.archived && room.role !== 'legacy') fail('archived-room-reopened');
    if (room.role === 'intros' && source.kind !== 'broadcast-intros') fail('mixed-history-as-intros');
    if (source.kind === 'broadcast-intros' && room.role !== 'intros') fail('introductions-outside-intros');
  }
  if (roles.intros !== 1 || roles.main !== 1) fail('required-room-roles');
  for (const [key, source] of sources) {
    const count = assigned.get(key) ?? 0;
    if (source.eventId === null && count !== 1) fail(count ? 'history-mapped-twice' : 'unmapped-history');
    if (source.eventId !== null && count) fail('event-room-in-persistent-hub');
  }
  return { ok: errors.length === 0, errors };
}

/** Compare full legacy rows on a quiescent database copy, not a partial inbox
 * page. Diagnostics deliberately exclude IDs, content, answers and hashes.
 * before/after must declare every protected table, including empty ones. */
export function compareLegacySnapshots(before, after) {
  const errors = [], counts = {};
  const add = (table, code) => errors.push({ table, code });
  for (const [table, primaryKey] of Object.entries(PRESERVED_TABLES)) {
    const left = before?.[table], right = after?.[table];
    if (!Array.isArray(left) || !Array.isArray(right)) { add(table, 'missing-table'); continue; }
    const index = rows => {
      const result = new Map();
      for (const row of rows) {
        if (!object(row) || primaryKey.some(key => !nonempty(row[key]))) {
          add(table, 'invalid-row-identity'); continue;
        }
        const key = JSON.stringify(primaryKey.map(column => row[column]));
        if (result.has(key)) add(table, 'duplicate-row-identity');
        result.set(key, row);
      }
      return result;
    };
    const baseline = index(left), candidate = index(right);
    let changed = 0, missing = 0, added = 0;
    for (const [key, row] of baseline) {
      const next = candidate.get(key);
      if (!next) missing++;
      else if (!sameKeys(row, next) || digest(row) !== digest(next)) changed++;
    }
    for (const key of candidate.keys()) if (!baseline.has(key)) added++;
    if (changed) add(table, 'legacy-rows-changed');
    if (missing) add(table, 'legacy-rows-missing');
    if (added) add(table, 'unexpected-legacy-rows-added');
    counts[table] = { before: left.length, after: right.length, changed, missing, added };
  }
  return { ok: errors.length === 0, errors, counts };
}

export function rehearseCommunityRooms(input) {
  const mapping = validateRoomManifest(input?.manifest);
  const preservation = compareLegacySnapshots(input?.before, input?.after);
  const inventory = validateSnapshotInventory(input?.manifest, input?.before);
  const columns = validateExportColumns(input?.schema, input?.before, input?.after);
  const linkage = validateSnapshotLinkage(input?.before, input?.communityId);
  const complete = input?.snapshotComplete === true && nonempty(input?.snapshotId) &&
    nonempty(input?.communityId) && input.communityId === input?.manifest?.communityId;
  return { ok: complete && mapping.ok && preservation.ok && inventory.ok && columns.ok && linkage.ok,
    scope: 'additive-routing-rehearsal-only', declaredComplete: complete,
    mapping, inventory, columns, linkage, preservation };
}

function validateExportColumns(schema, before, after) {
  const errors = [];
  if (schema?.version !== 1 || !object(schema.columns)) return { ok: false, errors: ['missing-export-schema'] };
  for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
    const columns = schema.columns[table];
    if (!Array.isArray(columns) || columns.some(column => !nonempty(column)) ||
        new Set(columns).size !== columns.length || required.some(column => !columns.includes(column))) {
      errors.push({ table, code: 'incomplete-column-contract' }); continue;
    }
    const expected = JSON.stringify([...columns].sort());
    for (const snapshot of [before, after]) {
      if (!Array.isArray(snapshot?.[table]) || snapshot[table].some(row => !object(row) ||
          JSON.stringify(Object.keys(row).sort()) !== expected)) {
        errors.push({ table, code: 'incomplete-row-columns' });
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

function validateSnapshotLinkage(snapshot, communityId) {
  const errors = [];
  if (!object(snapshot) || Object.keys(PRESERVED_TABLES).some(table =>
    !Array.isArray(snapshot[table]) || snapshot[table].some(row => !object(row)))) {
    return { ok: false, errors: ['incomplete-linkage-input'] };
  }
  const index = table => new Map(snapshot[table].map(row => [row.id, row]));
  const members = index('community_members'), broadcasts = index('community_broadcasts');
  const topics = index('community_topics'), messages = index('community_topic_messages');
  const check = (table, predicate) => {
    if (snapshot[table].some(row => !predicate(row))) errors.push({ table, code: 'invalid-parent-link' });
  };
  for (const table of ['community_members', 'community_broadcasts', 'community_broadcast_reads', 'community_topics']) {
    check(table, row => row.community_id === communityId);
  }
  check('community_member_answers', row => row.community_id === communityId &&
    members.has(row.member_id) && members.get(row.member_id).user_id === row.user_id);
  for (const table of ['community_broadcast_replies', 'community_broadcast_reactions']) {
    check(table, row => broadcasts.has(row.broadcast_id));
  }
  for (const table of ['community_topic_members', 'community_topic_messages', 'community_topic_reads']) {
    check(table, row => topics.has(row.topic_id));
  }
  check('community_broadcasts', row => ['intro', 'message', 'broadcast'].includes(row.kind));
  check('community_topic_messages', row => row.reply_to_message_id === null ||
    messages.has(row.reply_to_message_id) && messages.get(row.reply_to_message_id).topic_id === row.topic_id);
  check('community_topic_message_reactions', row => messages.has(row.message_id));
  for (const [table, keys] of [
    ['community_members', ['community_id', 'user_id']],
    ['community_topic_message_reactions', ['message_id', 'user_id']],
  ]) {
    const values = snapshot[table].map(row => JSON.stringify(keys.map(key => row[key])));
    if (new Set(values).size !== values.length) errors.push({ table, code: 'duplicate-unique-key' });
  }
  // Event-only topic subscribers are deliberately NOT required to be community
  // members; past senders also need not retain a current membership.
  return { ok: errors.length === 0, errors };
}

function validateSnapshotInventory(manifest, before) {
  const errors = [];
  const communityId = manifest?.communityId;
  const communities = before?.communities, topics = before?.community_topics;
  if (!Array.isArray(communities) || !Array.isArray(topics) || !Array.isArray(manifest?.sources)) {
    return { ok: false, errors: ['missing-source-inventory'] };
  }
  // Archived/draft communities need a separate retention plan; never reopen
  // them by applying the active-member room transition.
  if (communities.length !== 1 || communities[0]?.id !== communityId || communities[0]?.status !== 'active') {
    errors.push('active-community-snapshot-required');
  }
  const expected = ['broadcast-intros', 'broadcast-main'].map(kind =>
    ({ kind, id: communityId, communityId, eventId: null, archived: false }));
  for (const topic of topics) {
    if (!object(topic) || topic.community_id !== communityId || !nonempty(topic.id) ||
        typeof topic.archived !== 'boolean' ||
        !(topic.explore_event_id === null || nonempty(topic.explore_event_id))) {
      errors.push('invalid-topic-inventory'); continue;
    }
    expected.push({ kind: 'topic', id: topic.id, communityId,
      eventId: topic.explore_event_id, archived: topic.archived });
  }
  const normalize = sources => sources.map(source => object(source) ? {
    kind: source.kind, id: source.id, communityId: source.communityId,
    eventId: source.eventId, archived: source.archived,
  } : {}).sort((a, b) => sourceKey(a).localeCompare(sourceKey(b)));
  if (digest(normalize(expected)) !== digest(normalize(manifest.sources))) errors.push('manifest-snapshot-mismatch');
  return { ok: errors.length === 0, errors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error('input');
    const result = rehearseCommunityRooms(JSON.parse(readFileSync(process.argv[2], 'utf8')));
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exitCode = result.ok ? 0 : 1;
  } catch {
    // Do not echo parser excerpts or file paths: input can contain private rows.
    process.stderr.write('Could not read the rehearsal input. Provide one complete local JSON snapshot.\n');
    process.exitCode = 2;
  }
}
