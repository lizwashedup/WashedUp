// Network-isolated PostgreSQL. Fictional rows, current exported RLS and helpers.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const context = process.argv[2];
if (context && !/^[a-zA-Z0-9_-]+$/.test(context)) throw Error('Invalid Docker context');
const prefix = context ? ['--context', context] : [];
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const run = (args, options = {}) => execFileSync('docker', [...prefix, ...args], { encoding: 'utf8', timeout: 60000, ...options });
const quote = s => "'" + s.replaceAll("'", "''") + "'";
let container;
let checks = 0;
function assert(ok, message) {
  if (!ok) throw Error(message);
  checks++;
  console.log('PASS: ' + message);
}
try {
  container = run(['run', '--detach', '--rm', '--pull', 'never', '--network', 'none', '--env', 'POSTGRES_PASSWORD=contract-only', 'postgres:17-alpine']).trim();
  if (!/^[0-9a-f]{64}$/.test(container)) throw Error('Unexpected container');
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (spawnSync('docker', [...prefix, 'exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], { stdio: 'ignore' }).status === 0) { ready = true; break; }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  if (!ready) throw Error('Postgres not ready');
  const sql = s => run(['exec', '-i', container, 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: s, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const expectFailure = (s, message, label) => {
    let refused = false;
    try { sql(s); } catch (error) { if (!String(error.stderr).includes(message)) throw error; refused = true; }
    assert(refused, label);
  };
  sql(read('supabase/tests/contracts/20261103_community_joining_fixture.sql'));
  sql(`CREATE TYPE public.community_status AS ENUM('draft','active','archived');
    ALTER TABLE communities ALTER COLUMN status DROP DEFAULT;
    ALTER TABLE communities ALTER COLUMN status TYPE community_status USING status::community_status;
    ALTER TABLE communities ALTER COLUMN status SET DEFAULT 'draft';
    ALTER TABLE communities ADD COLUMN discoverable boolean NOT NULL DEFAULT true;
    ALTER TABLE communities ADD COLUMN updated_at timestamptz DEFAULT now();
    GRANT USAGE ON SCHEMA auth TO authenticated,anon;
    GRANT SELECT ON communities TO authenticated,anon;
    GRANT UPDATE(name),UPDATE(status) ON communities TO authenticated,anon;`);
  const contract = JSON.parse(read('supabase/tests/contracts/20261104_community_identity_live_contract.json'));
  // Same deployed visibility/authority code. Audience matching remains the fixture's
  // explicit gender model, not a claim that all production Ghost rules are replayed.
  for (const name of ['creator_page_is_visible', 'creator_community_is_visible', 'is_community_member', 'is_community_leader']) {
    const r = contract.find(r => r.kind === 'helper' && r.value.name === name || r.kind === 'authority' && name === 'is_community_leader').value;
    if (crypto.createHash('md5').update(r.definition).digest('hex') !== r.md5) throw Error('Export drift');
    sql(r.definition);
  }
  for (const r of contract.filter(r => r.kind === 'policy')) {
    const p = r.value;
    sql(`CREATE POLICY ${p.policyname} ON public.communities AS ${p.permissive} FOR ${p.cmd} TO ${p.roles.join(',')}
      ${p.qual ? 'USING (' + p.qual + ')' : ''} ${p.with_check ? 'WITH CHECK (' + p.with_check + ')' : ''};`);
  }
  for (const r of contract.filter(r => r.kind === 'constraint' && ['communities_name_check', 'communities_purpose_check'].includes(r.value.name))) {
    sql(`ALTER TABLE communities ADD CONSTRAINT ${r.value.name} ${r.value.definition};`);
  }
  const updated = contract.find(r => r.kind === 'trigger' && r.value.routine === 'update_updated_at_column()').value;
  sql(updated.function_definition + ';' + updated.definition + ';ALTER TABLE communities ENABLE ROW LEVEL SECURITY;');
  const policiesDigest = () => sql("SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY policyname)::text) FROM pg_policies p WHERE schemaname='public' AND tablename='communities';");
  assert(policiesDigest() === contract.find(r => r.kind === 'policies_digest').value.md5, 'all current community RLS policies replay exactly');
  const digest = () => sql("SELECT md5(string_agg(to_jsonb(c)::text,',' ORDER BY id)) FROM communities c;");
  const beforeRows = digest();
  const grantSnapshot = () => JSON.parse(sql("SELECT jsonb_agg(jsonb_build_object('name',attname,'acl',attacl) ORDER BY attnum) FROM pg_attribute WHERE attrelid='communities'::regclass AND attnum>0 AND NOT attisdropped;"));
  const beforeGrants = grantSnapshot();
  const user = n => '00000000-0000-0000-0000-' + String(n).padStart(12, '0');
  const community = n => '10000000-0000-0000-0000-' + String(n).padStart(12, '0');
  const as = (n, statement, role = 'authenticated') => `SET request.jwt.claim.sub=${quote(n ? user(n) : '')}; SET request.jwt.claim.role=${quote(role)}; SET ROLE ${role}; ${statement}`;
  const update = (n, id, name = 'Renamed community', purpose = 'A clear short community description') => sql(as(n,
    `WITH saved AS (UPDATE communities SET name=${quote(name)},purpose=${quote(purpose)} WHERE id=${quote(community(id))} RETURNING id,name,purpose)
     SELECT coalesce(jsonb_agg(to_jsonb(saved)),'[]') FROM saved;`));
  expectFailure(as(1, `UPDATE communities SET name='Renamed community',purpose='A clear short community description' WHERE id=${quote(community(1))};`), 'permission denied', 'native combined-save permission failure reproduced before repair');
  const migration = read('docs/database/review-only/20261104_community_identity_permission.sql');
  const rollback = read('docs/database/review-only/20261104_community_identity_permission.rollback.sql');
  sql(migration);
  assert(beforeRows === digest(), 'deployment changes no community rows');
  const afterGrants = grantSnapshot();
  assert(JSON.stringify(beforeGrants.filter(r => r.name !== 'purpose')) === JSON.stringify(afterGrants.filter(r => r.name !== 'purpose')) && afterGrants.find(r => r.name === 'purpose').acl.join(',') === 'authenticated=w/postgres', 'only authenticated purpose UPDATE is added');
  assert(JSON.parse(update(1, 1))[0]?.purpose === 'A clear short community description', 'active leader saves and receives exact name and description');
  sql(`INSERT INTO community_members(community_id,user_id,role,status) VALUES(${quote(community(1))},${quote(user(2))},'co_leader','active');`);
  assert(JSON.parse(update(2, 1, 'Co leader edit')).length === 1, 'active co-leader can edit its community');
  for (const role of ['admin', 'events', 'member_care', 'finance', 'member']) {
    sql(`UPDATE community_members SET role=${quote(role)} WHERE community_id=${quote(community(1))} AND user_id=${quote(user(2))};`);
    assert(update(2, 1) === '[]', `community ${role} cannot edit identity`);
  }
  assert(update(3, 1) === '[]', 'outsider cannot edit identity');
  assert(update(null, 1) === '[]', 'authenticated role without a user cannot edit');
  sql(`UPDATE community_members SET role='co_leader',status='left' WHERE community_id=${quote(community(1))} AND user_id=${quote(user(2))};`);
  assert(update(2, 1) === '[]', 'revoked co-leader cannot edit');
  expectFailure(as(null, `UPDATE communities SET purpose='Anonymous attempted change';`, 'anon'), 'permission denied', 'anonymous purpose write remains denied');
  expectFailure(as(1, `UPDATE communities SET discoverable=false WHERE id=${quote(community(1))};`), 'permission denied', 'direct discovery update remains denied');
  expectFailure(as(1, `UPDATE communities SET name='x',purpose='A valid description here' WHERE id=${quote(community(1))};`), 'communities_name_check', 'existing name validation remains enforced');
  expectFailure(as(1, `UPDATE communities SET purpose='short' WHERE id=${quote(community(1))};`), 'communities_purpose_check', 'existing description validation remains enforced');
  assert(JSON.parse(update(1, 3, 'Archived community edit')).length === 1, 'existing leader access to archived legacy community stays intact');
  assert(JSON.parse(update(1, 2, 'Eligible community edit')).length === 1, 'eligible leader can edit an audience-restricted publication');
  sql(`INSERT INTO community_members(community_id,user_id,role,status) VALUES(${quote(community(2))},${quote(user(3))},'leader','active');`);
  assert(update(3, 2) === '[]', 'ineligible audience cannot edit even with an active leader row');
  sql(`INSERT INTO creator_page_drafts(id) VALUES(${quote(community(1))});`);
  assert(update(1, 1) === '[]', 'unpublished governed page remains inaccessible through legacy editing');
  expectFailure(migration, 'Community identity grants changed', 'duplicate deployment refuses an existing permission');
  sql('GRANT UPDATE(purpose) ON communities TO anon;');
  expectFailure(rollback, 'Community description grants changed', 'rollback refuses changed grants');
  sql('REVOKE UPDATE(purpose) ON communities FROM anon;');
  const savedRows = digest();
  sql(rollback);
  assert(savedRows === digest(), 'rollback preserves all saved rows');
  expectFailure(as(1, "UPDATE communities SET purpose='After rollback attempted change';"), 'permission denied', 'rollback removes the added permission');
  assert(sql("SELECT has_column_privilege('authenticated','communities','name','UPDATE')") === 't', 'rollback preserves existing name permission');
  sql("ALTER POLICY communities_update ON communities USING(true);");
  expectFailure(migration, 'Community authority changed', 'deployment refuses a changed authority policy');
  console.log(`PASS: ${checks} isolated database checks`);
} catch (error) {
  if (error.stderr) process.stderr.write(error.stderr);
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (container && /^[0-9a-f]{64}$/.test(container)) run(['rm', '-f', container]);
}
