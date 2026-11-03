// Isolated PostgreSQL proof for the opt-out used by next-time plan copies.
// Feed SQL over stdin so this also works with Docker VMs without repo mounts.
const {execFileSync, spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const run = (args, options = {}) => execFileSync('docker', args, {encoding:'utf8', timeout:60000, ...options});
let container;
try {
  container = run(['run','--detach','--rm','--pull','never','--network','none','--env','POSTGRES_PASSWORD=contract-only','postgres:17-alpine']).trim();
  if (!/^[0-9a-f]{64}$/.test(container)) throw new Error('Unexpected container identity');
  let ready = false;
  for (let attempt=0;attempt<60;attempt++) {
    // The image briefly starts a Unix-socket-only init server, then restarts.
    // TCP readiness avoids racing that temporary server's shutdown.
    if (spawnSync('docker',['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres'],{stdio:'ignore',timeout:5000}).status===0) {ready=true;break;}
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250);
  }
  if (!ready) throw new Error('Disposable PostgreSQL did not start');
  const read = relative => fs.readFileSync(path.join(root, relative),'utf8');
  const migration = read('supabase/migrations/20261103010000_explicit_similar_plan_event_unlink.sql');
  const sql = [read('supabase/tests/contracts/200_similar_plan_fixture.sql'), migration, migration, read('supabase/tests/contracts/201_similar_plan_contract.sql')].join('\n');
  process.stdout.write(run(['exec','-i',container,'psql','-U','postgres','-v','ON_ERROR_STOP=1'],{input:sql}));
  const usability = read('supabase/tests/contracts/202_interested_survey_fixture.sql') + '\n' + read('supabase/tests/contracts/203_interested_survey_contract.sql');
  process.stdout.write(run(['exec','-i',container,'psql','-U','postgres','-v','ON_ERROR_STOP=1'],{input:usability}));
  // New database connection: confirms removal survives refresh/reconnection.
  const remaining = run(['exec','-i',container,'psql','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'],{input:"SET ROLE authenticated; SET request.jwt.claim.sub='11111111-1111-4111-8111-111111111111'; SELECT signal_id FROM public.get_user_interest_signals();"}).trim();
  if (remaining !== 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee') throw new Error('Removal did not survive a new connection');
  console.log('PASS: independent similar plans, ordinary/explicit associations, migration idempotency, and unchanged ownership boundaries');
  console.log('PASS: completed-plan interest persists; explicit removal survives reconnection; report permissions and deduplication remain intact');
} finally {
  if (container && /^[0-9a-f]{64}$/.test(container)) run(['rm','-f',container]);
}
