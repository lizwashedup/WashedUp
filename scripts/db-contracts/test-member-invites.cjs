// Executes catalog-exported invitation routines against fictional rows only.
// No DB URL, credentials, host network, app hooks, notifications or live writes.
const { execFileSync, spawnSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const context = process.argv[2];
if (context && !/^[a-zA-Z0-9_-]+$/.test(context)) throw new Error('Invalid Docker context');
const prefix = context ? ['--context', context] : [];
const run = (args, options = {}) => execFileSync('docker', [...prefix, ...args], { encoding: 'utf8', timeout: 60000, ...options });
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
let container;
try {
  container = run(['run', '--detach', '--rm', '--pull', 'never', '--network', 'none', '--env', 'POSTGRES_PASSWORD=contract-only', 'postgres:17-alpine']).trim();
  if (!/^[0-9a-f]{64}$/.test(container)) throw new Error('Unexpected container identity');
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (spawnSync('docker', [...prefix, 'exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], { stdio: 'ignore', timeout: 5000 }).status === 0) { ready = true; break; }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  if (!ready) throw new Error('Disposable PostgreSQL did not start');
  const sql = source => run(['exec', '-i', container, 'psql', '-X', '-q', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: source, stdio: ['pipe', 'pipe', 'pipe'] });
  const duringLockedUpdate = (label, statement, action) => {
    const writer = spawn('docker', [...prefix, 'exec', container, 'psql', '-X', '-q', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c',
      `SET application_name='${label}'; BEGIN; ${statement}; SELECT pg_sleep(2); COMMIT;`], { stdio: 'ignore' });
    try {
      let locked = false;
      for (let i = 0; i < 30; i++) {
        if (sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${label}' AND wait_event='PgSleep';`).match(/\n\s*1\s*\n/)) { locked = true; break; }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
      }
      if (!locked) throw new Error(`Concurrent fixture did not acquire its lock: ${label}`);
      action();
    } finally { writer.kill(); }
  };
  const banRace = expectDenial => {
    sql("INSERT INTO community_members VALUES ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','member','inactive','2025-01-01'); SELECT fixture_invite('00000000-0000-0000-0000-000000000002','ban-race');");
    duringLockedUpdate('invite_ban_race', "UPDATE community_members SET status='banned'", () => {
      let rejected = false;
      try { sql("SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; SELECT accept_member_invite('ban-race');"); }
      catch (error) { if (!String(error.stderr).includes('cannot accept: banned from this community')) throw error; rejected = true; }
      if (rejected !== expectDenial) throw new Error(`Unexpected concurrent ban outcome; expected rejection=${expectDenial}`);
      const expected = expectDenial ? 'pending' : 'accepted';
      if (!sql(`SELECT count(*) FROM community_members m JOIN community_member_invites i USING(community_id) WHERE m.status='banned' AND i.status='${expected}';`).match(/\n\s*1\s*\n/)) throw new Error('Concurrent ban state did not match');
    });
    sql('TRUNCATE community_members,community_member_invites;');
    console.log(expectDenial ? 'PASS: concurrent ban rejects acceptance without consuming the invitation' : 'PASS: GAP reproduced: acceptance reports success after a concurrent ban prevents membership');
  };
  const routines = JSON.parse(read('supabase/tests/contracts/20261103_member_invite_live_routines.json'));
  for (const row of routines) {
    if (crypto.createHash('md5').update(row.definition).digest('hex') !== row.md5) throw new Error(`Routine snapshot changed: ${row.name}`);
  }
  sql(read('supabase/tests/contracts/20261103_member_invite_fixture.sql'));
  sql(routines.map(row => row.definition + ';').join('\n'));
  sql('CREATE TRIGGER creator_page_member_eligibility BEFORE INSERT OR UPDATE ON public.community_members FOR EACH ROW EXECUTE FUNCTION public.creator_page_member_eligibility_guard();');
  const cases = read('supabase/tests/contracts/20261103_member_invite_contract.sql');
  process.stdout.write(sql(cases));
  console.log('PASS: deployed routine snapshot reproduced against isolated fixtures');
  banRace(false);
  const candidate = read('docs/database/review-only/20261103_member_invite_acceptance_guards.sql');
  sql(candidate); sql(candidate); // Catalog guard permits the exact candidate to be reapplied.
  process.stdout.write(sql(cases.split('-- Archived-community baseline gap.')[0]));
  process.stdout.write(sql(read('supabase/tests/contracts/20261103_member_invite_archive_contract.sql')));
  console.log('PASS: acceptance candidate is repeatable and retains existing acceptance boundaries');
  banRace(true);
  sql("SELECT fixture_invite('00000000-0000-0000-0000-000000000002','archive-race');");
  duringLockedUpdate('invite_archive_race', "UPDATE communities SET status='archived'", () => {
    let rejected = false;
    try { sql("SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; SELECT accept_member_invite('archive-race');"); }
    catch (error) { if (!String(error.stderr).includes('Community unavailable')) throw error; rejected = true; }
    if (!rejected) throw new Error('Acceptance bypassed the concurrent archive');
    if (!sql('SELECT count(*) FROM community_members;').match(/\n\s*0\s*\n/)) throw new Error('Concurrent archive left membership');
    console.log('PASS: acceptance waits for concurrent archive and rejects after it commits');
  });
  const rollback = read('docs/database/review-only/20261103_member_invite_acceptance_guards_rollback.sql');
  sql(rollback); sql(rollback);
  if (!sql("SELECT md5(pg_get_functiondef('public.accept_member_invite(text,uuid)'::regprocedure));").includes('6cb89d74e00358b966e9a6e7cb50f40b')) throw new Error('Rollback did not restore the exact catalog snapshot');
  console.log('PASS: guarded rollback restores the exact prior definition and is repeatable');
  sql(candidate);
  sql("COMMENT ON FUNCTION accept_member_invite(text,uuid) IS 'Fixture only';");
  sql("ALTER FUNCTION accept_member_invite(text,uuid) SET statement_timeout='5s';");
  let driftRejected = false;
  try { sql(candidate); } catch (error) { if (!String(error.stderr).includes('changed; inspect current definition')) throw error; driftRejected = true; }
  if (!driftRejected) throw new Error('Candidate overwrote a drifted function');
  console.log('PASS: acceptance candidate refuses to overwrite changed deployed code');
} catch (error) {
  if (error.stdout) process.stderr.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  throw error;
} finally {
  if (container && /^[0-9a-f]{64}$/.test(container)) run(['rm', '-f', container]);
}
