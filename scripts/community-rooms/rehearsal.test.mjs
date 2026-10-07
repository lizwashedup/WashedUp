import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PRESERVED_TABLES, REQUIRED_COLUMNS, validateRoomManifest, compareLegacySnapshots, rehearseCommunityRooms } from './rehearsal.mjs';

const clone = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const before = Object.fromEntries(Object.keys(PRESERVED_TABLES).map(table => [table, []]));
  before.communities = [{ id: 'example-community', name: 'Example Club', status: 'active', main_chat_name: 'Community chat', created_by: 'member-a' }];
  before.community_members = [{ id: 'membership-a', community_id: 'example-community', user_id: 'member-a', status: 'active', role: 'member', broadcasts_muted: true }];
  before.community_member_answers = [{ member_id: 'membership-a', community_id: 'example-community', user_id: 'member-a', answers: { private_reason: 'PRIVATE-FIXTURE-ANSWER', intro_answer: 'My public hello' } }];
  before.community_broadcasts = [
    { id: 'intro-a', community_id: 'example-community', kind: 'intro', body: 'My public hello', sender_id: 'member-a', payload: { first_name: 'Example', answer: 'My public hello' } },
    { id: 'message-a', community_id: 'example-community', kind: 'message', body: 'Existing message', sender_id: 'member-a' },
  ];
  before.community_broadcast_replies = [{ id: 'reply-a', broadcast_id: 'intro-a', sender_id: 'member-a', body: 'Welcome' }];
  before.community_broadcast_reactions = [{ broadcast_id: 'intro-a', user_id: 'member-a', emoji: 'heart' }];
  before.community_broadcast_reads = [{ community_id: 'example-community', user_id: 'member-a', last_read_at: '2026-09-12T12:00:00Z' }];
  before.community_topics = [
    { id: 'after-glow', community_id: 'example-community', name: 'After Glow', archived: false, explore_event_id: null },
    { id: 'event-topic', community_id: 'example-community', name: 'Example volleyball', archived: false, explore_event_id: 'event-a' },
  ];
  before.community_topic_members = [
    { topic_id: 'after-glow', user_id: 'member-a', notifications_on: false },
    { topic_id: 'event-topic', user_id: 'attendee-only', notifications_on: true },
  ];
  before.community_topic_messages = [{ id: 'topic-message-a', topic_id: 'after-glow', body: 'Still here', sender_id: 'member-a', image_url: 'fixture-image-reference', reply_to_message_id: null }];
  before.community_topic_message_reactions = [{ id: 'reaction-a', message_id: 'topic-message-a', user_id: 'member-a', reaction: '🔥' }];
  before.community_topic_reads = [{ topic_id: 'after-glow', user_id: 'member-a', last_read_at: '2026-09-12T12:05:00Z' }];
  // Full synthetic export, including nullable fields. Real snapshots must take
  // their complete column list from the database, not this fixture helper.
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    before[table] = before[table].map(row => Object.fromEntries(columns.map(column => [column,
      column in row ? row[column] : ['created_at', 'updated_at'].includes(column) ? '2026-09-01T12:00:00Z'
        : ['pinned', 'is_default'].includes(column) ? false : column === 'handle' ? 'example-club' : null])));
  }

  const sources = ['broadcast-intros', 'broadcast-main'].map(kind => ({
    kind, id: 'example-community', communityId: 'example-community', archived: false, eventId: null,
  })).concat(before.community_topics.map(topic => ({ kind: 'topic', id: topic.id,
    communityId: topic.community_id, eventId: topic.explore_event_id, archived: topic.archived })));
  const room = (id, role, name, source) => ({ id, role, name, sources: [{ kind: source.kind, id: source.id }] });
  return {
    snapshotComplete: true, snapshotId: 'synthetic-only', communityId: 'example-community',
    schema: { version: 1, columns: clone(REQUIRED_COLUMNS) },
    manifest: { version: 1, inventoryComplete: true, communityId: 'example-community', sources, rooms: [
      room('logical-intros', 'intros', 'Intros', sources[0]),
      room('logical-main', 'main', 'Community chat', sources[1]),
      room('logical-existing-topic', 'optional', 'After Glow', sources[2]),
    ] }, before, after: clone(before),
  };
}

test('rehearses distinct Intros/main views while preserving all legacy rows and the event-only attendee', () => {
  const data = fixture(), original = clone(data);
  const result = rehearseCommunityRooms(data);
  assert.equal(result.ok, true);
  assert.equal(result.scope, 'additive-routing-rehearsal-only');
  assert.equal(result.preservation.counts.community_topic_members.before, 2);
  assert.deepEqual(data, original);
});

test('renaming presentation does not select or change the underlying room role', () => {
  const data = fixture();
  data.manifest.rooms[0].name = 'Say hello';
  data.manifest.rooms[1].name = 'Night owls';
  assert.equal(rehearseCommunityRooms(data).ok, true);
  data.manifest.rooms[0].sources = [{ kind: 'broadcast-main', id: 'example-community' }];
  assert.ok(validateRoomManifest(data.manifest).errors.includes('mixed-history-as-intros'));
});

test('blocks missing partitions and incomplete exports even when remaining counts match', () => {
  const data = fixture();
  data.manifest.sources.shift();
  assert.ok(validateRoomManifest(data.manifest).errors.includes('missing-broadcast-partition'));
  const partial = fixture();
  partial.snapshotComplete = false;
  assert.equal(rehearseCommunityRooms(partial).ok, false);
  const missingTable = fixture();
  delete missingTable.before.community_member_answers;
  assert.equal(rehearseCommunityRooms(missingTable).ok, false);
});

test('blocks event promotion and a fake persistent classification against the source snapshot', () => {
  const data = fixture();
  data.manifest.rooms[1].sources = [{ kind: 'topic', id: 'event-topic' }];
  assert.ok(validateRoomManifest(data.manifest).errors.includes('event-room-in-persistent-hub'));
  data.manifest.sources.find(source => source.id === 'event-topic').eventId = null;
  assert.ok(rehearseCommunityRooms(data).inventory.errors.includes('manifest-snapshot-mismatch'));
});

test('blocks silently dropping a legacy room or mapping its history twice', () => {
  const data = fixture();
  data.manifest.rooms.pop();
  assert.ok(validateRoomManifest(data.manifest).errors.includes('unmapped-history'));
  const doubled = fixture();
  doubled.manifest.rooms.push({ ...doubled.manifest.rooms[2], id: 'duplicate-view' });
  assert.ok(validateRoomManifest(doubled.manifest).errors.includes('history-mapped-twice'));
});

test('blocks merging old main and After Glow into one renamed conversation', () => {
  const data = fixture();
  data.manifest.rooms[1].sources.push({ kind: 'topic', id: 'after-glow' });
  assert.ok(validateRoomManifest(data.manifest).errors.includes('invalid-room-or-history-merge'));
});

test('blocks unknown or duplicate source identities and cross-community mapping', () => {
  for (const change of [
    data => data.manifest.sources.push(clone(data.manifest.sources[0])),
    data => { data.manifest.sources[2].communityId = 'someone-elses-community'; },
    data => { delete data.manifest.sources[2].eventId; },
    data => { data.manifest.rooms[2].sources[0].kind = 'private-answers'; },
    data => { data.manifest.rooms[2].id = data.manifest.rooms[0].id; },
  ]) {
    const data = fixture(); change(data);
    assert.equal(rehearseCommunityRooms(data).ok, false);
  }
});

test('keeps archived topics in retention and does not reactivate an archived community', () => {
  const data = fixture();
  data.before.community_topics[0].archived = true;
  data.after = clone(data.before);
  data.manifest.sources[2].archived = true;
  assert.ok(validateRoomManifest(data.manifest).errors.includes('archived-room-reopened'));
  data.manifest.rooms[2].role = 'legacy';
  assert.equal(rehearseCommunityRooms(data).ok, true);
  data.before.communities[0].status = 'archived'; data.after = clone(data.before);
  assert.equal(rehearseCommunityRooms(data).ok, false);
});

test('source inventory must include archived and event topics even though they do not become required rooms', () => {
  const data = fixture();
  data.manifest.sources.pop();
  assert.equal(validateRoomManifest(data.manifest).ok, true);
  assert.equal(rehearseCommunityRooms(data).inventory.ok, false);
});

test('requires one Intros and one main role; defaults and names are insufficient', () => {
  const data = fixture();
  data.manifest.rooms[1].role = 'optional';
  assert.ok(validateRoomManifest(data.manifest).errors.includes('required-room-roles'));
});

test('preserves body, author, IDs, replies, images, reactions, read markers and private answer rows', () => {
  for (const [table, change] of [
    ['community_broadcasts', row => { row.body = 'Rewritten'; }],
    ['community_broadcasts', row => { row.sender_id = 'different-author'; }],
    ['community_broadcasts', row => { row.id = 'new-id'; }],
    ['community_broadcast_replies', row => { row.broadcast_id = 'another-intro'; }],
    ['community_topic_messages', row => { row.image_url = null; }],
    ['community_topic_messages', row => { row.reply_to_message_id = 'other-message'; }],
    ['community_broadcast_reactions', row => { row.emoji = '❤️'; }],
    ['community_topic_message_reactions', row => { row.reaction = '❤️'; }],
    ['community_broadcast_reads', row => { row.last_read_at = '2026-09-13T00:00:00Z'; }],
    ['community_member_answers', row => { row.answers.private_reason = 'altered'; }],
  ]) {
    const data = fixture(); change(data.after[table][0]);
    assert.equal(rehearseCommunityRooms(data).ok, false, table);
  }
});

test('rejects changes to membership, ownership, per-room mute and unexpected auto-subscription', () => {
  for (const change of [
    data => { data.after.community_members[0].status = 'left'; },
    data => { data.after.communities[0].created_by = 'someone-else'; },
    data => { data.after.community_topic_members[0].notifications_on = true; },
    data => { data.after.community_members[0].broadcasts_muted = false; },
    data => data.after.community_members.push({ id: 'membership-guest', user_id: 'attendee-only', community_id: 'example-community', status: 'active' }),
    data => data.after.community_topic_members.push({ topic_id: 'after-glow', user_id: 'attendee-only', notifications_on: true }),
  ]) {
    const data = fixture(); change(data);
    assert.equal(rehearseCommunityRooms(data).ok, false);
  }
});

test('does not mistake equal row counts, duplicates or incomplete identities for preserved history', () => {
  const data = fixture();
  data.after.community_broadcasts[1] = clone(data.after.community_broadcasts[0]);
  const result = compareLegacySnapshots(data.before, data.after);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.code === 'duplicate-row-identity'));
  data.after.community_broadcasts[1] = { body: 'Missing identity' };
  assert.equal(compareLegacySnapshots(data.before, data.after).ok, false);
});

test('ignores JSON key and row order but not array content or missing fields', () => {
  const data = fixture();
  data.after.community_broadcasts.reverse();
  data.after.community_member_answers[0].answers = { intro_answer: 'My public hello', private_reason: 'PRIVATE-FIXTURE-ANSWER' };
  assert.equal(rehearseCommunityRooms(data).ok, true);
  delete data.after.community_broadcasts[0].body;
  assert.equal(rehearseCommunityRooms(data).ok, false);
});

test('diagnostics do not contain message content, private answers or user identifiers', () => {
  const data = fixture();
  data.after.community_member_answers[0].answers.private_reason = 'changed-secret';
  const result = JSON.stringify(rehearseCommunityRooms(data));
  for (const secret of ['PRIVATE-FIXTURE-ANSWER', 'changed-secret', 'member-a', 'My public hello']) {
    assert.equal(result.includes(secret), false);
  }
});

test('rejects identity-only exports, omitted declared columns and malformed schema contracts', () => {
  for (const change of [
    data => { data.before.community_broadcasts = data.before.community_broadcasts.map(row => ({ id: row.id })); data.after = clone(data.before); },
    data => { data.before.community_member_answers = [{ member_id: 'membership-a' }]; data.after = clone(data.before); },
    data => { data.schema.columns.community_broadcasts = ['id']; },
    data => { data.schema.columns.community_broadcasts.push('new_server_column'); },
    data => { delete data.schema; },
  ]) {
    const data = fixture(); change(data);
    assert.equal(rehearseCommunityRooms(data).ok, false);
  }
});

test('checks actual topic reaction primary keys and the independent message/user unique constraint', () => {
  for (const duplicate of [
    { id: 'reaction-a', user_id: 'other-user' },
    { id: 'reaction-b', user_id: 'member-a' },
  ]) {
    const data = fixture();
    data.before.community_topic_message_reactions.push({ ...data.before.community_topic_message_reactions[0], ...duplicate });
    data.after = clone(data.before);
    assert.equal(rehearseCommunityRooms(data).ok, false);
  }
});

test('rejects orphan and cross-community history without requiring event attendees to join the community', () => {
  for (const [table, change] of [
    ['community_broadcasts', row => { row.community_id = 'other-community'; }],
    ['community_broadcasts', row => { row.kind = 'unknown-kind'; }],
    ['community_broadcast_replies', row => { row.broadcast_id = 'missing-message'; }],
    ['community_broadcast_reactions', row => { row.broadcast_id = 'missing-message'; }],
    ['community_member_answers', row => { row.user_id = 'someone-else'; }],
    ['community_topic_messages', row => { row.topic_id = 'orphan-topic'; }],
    ['community_topic_messages', row => { row.reply_to_message_id = 'missing-parent'; }],
    ['community_topic_message_reactions', row => { row.message_id = 'missing-message'; }],
    ['community_topic_members', row => { row.topic_id = 'orphan-topic'; }],
    ['community_topic_reads', row => { row.topic_id = 'orphan-topic'; }],
  ]) {
    const data = fixture(); change(data.before[table][0]); data.after = clone(data.before);
    assert.equal(rehearseCommunityRooms(data).ok, false, table);
  }
  assert.equal(rehearseCommunityRooms(fixture()).ok, true);
});

test('local CLI returns pass/fail codes and hides parser excerpts for malformed private inputs', () => {
  const folder = mkdtempSync(join(tmpdir(), 'community-rehearsal-'));
  const file = join(folder, 'fixture.json');
  const run = () => spawnSync(process.execPath, [fileURLToPath(new URL('./rehearsal.mjs', import.meta.url)), file], { encoding: 'utf8' });
  try {
    writeFileSync(file, JSON.stringify(fixture()));
    assert.equal(run().status, 0);
    const data = fixture(); data.after.community_broadcasts.pop();
    writeFileSync(file, JSON.stringify(data));
    assert.equal(run().status, 1);
    writeFileSync(file, '{"private":SECRET-FIXTURE');
    const result = run();
    assert.equal(result.status, 2);
    assert.equal((result.stdout + result.stderr).includes('SECRET-FIXTURE'), false);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
