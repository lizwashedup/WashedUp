// Fictional, network-isolated PostgreSQL; no production writes or credentials.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync,spawn,spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),context=process.argv[2];
if(context&&!/^[a-zA-Z0-9_-]+$/.test(context))throw Error('Invalid Docker context');
const prefix=context?['--context',context]:[],read=p=>fs.readFileSync(path.join(root,p),'utf8');
const run=(a,o={})=>execFileSync('docker',[...prefix,...a],{encoding:'utf8',timeout:60000,...o});
let container;
(async()=>{try{
 container=run(['run','--detach','--rm','--pull','never','--network','none','--env','POSTGRES_PASSWORD=contract-only','postgres:17-alpine']).trim();
 if(!/^[0-9a-f]{64}$/.test(container))throw Error('Unexpected container');
 let ready=false;for(let i=0;i<60;i++){if(spawnSync('docker',[...prefix,'exec',container,'pg_isready','-h','127.0.0.1','-U','postgres'],{stdio:'ignore'}).status===0){ready=true;break;}Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250);}if(!ready)throw Error('Postgres not ready');
 const sql=s=>run(['exec','-i',container,'psql','-X','-q','-A','-t','-U','postgres','-v','ON_ERROR_STOP=1'],{input:s,stdio:['pipe','pipe','pipe']});
 sql(read('supabase/tests/contracts/20261103_community_joining_fixture.sql'));
 const routines=JSON.parse(read('supabase/tests/contracts/20261103_community_joining_live_routines.json'));
 for(const name of ['creator_page_is_visible','creator_community_is_visible','is_community_leader']){const routine=routines.find(r=>r.name===name);if(crypto.createHash('md5').update(routine.definition).digest('hex')!==routine.md5)throw Error('Export drift');sql(routine.definition+';');}
 sql('ALTER TABLE communities ADD COLUMN discoverable boolean NOT NULL DEFAULT true;');
 const migration=read('docs/database/review-only/20261104_community_discovery_control.sql');sql(migration);
 sql(read('supabase/tests/contracts/20261104_community_discovery_contract.sql'));
 console.log('PASS: creator authority, exact receipts, stale state, null inputs, archived community, grants and unchanged admission');
 // Signal after the lock is held; the racing setter must wait for the committed result.
 const concurrent=s=>{let readyResolve;const ready=new Promise(r=>{readyResolve=r});let stdout='',stderr='';const child=spawn('docker',[...prefix,'exec','-i',container,'psql','-X','-q','-U','postgres','-v','ON_ERROR_STOP=1']);child.stdout.on('data',v=>{stdout+=v;if(stdout.includes('LOCK_HELD'))readyResolve();});child.stderr.on('data',v=>{stderr+=v});const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code?reject(Error(stderr)):resolve(stdout));});child.stdin.end(s);return{ready,done};};
 let race=concurrent("BEGIN; UPDATE communities SET status='archived' WHERE handle='legacy';\n\\echo LOCK_HELD\nSELECT pg_sleep(0.3); COMMIT;");await race.ready;
 sql("SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001'; DO $$ BEGIN BEGIN PERFORM set_community_discoverable('10000000-0000-0000-0000-000000000001','active',true,false); RAISE EXCEPTION 'concurrent archive overwritten'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END; END $$;");await race.done;
 sql("UPDATE communities SET status='active' WHERE handle='legacy';");
 race=concurrent("BEGIN; UPDATE community_members SET status='left' WHERE community_id='10000000-0000-0000-0000-000000000001' AND role='leader';\n\\echo LOCK_HELD\nSELECT pg_sleep(0.3); COMMIT;");await race.ready;
 sql("SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001'; DO $$ BEGIN BEGIN PERFORM set_community_discoverable('10000000-0000-0000-0000-000000000001','active',true,false); RAISE EXCEPTION 'revoked role used'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;");await race.done;
 console.log('PASS: concurrent archive and creator-role revocation are respected');
 const hashes=sql("SELECT proname||' '||md5(pg_get_functiondef(oid)) FROM pg_proc WHERE proname IN ('get_community_visibility_options','set_community_discoverable') ORDER BY proname;").trim();console.log(hashes);
 let refused=false;try{sql(migration)}catch(e){if(!String(e.stderr).includes('Discovery control already exists'))throw e;refused=true;}if(!refused)throw Error('Existing functions overwritten');
 console.log('PASS: existing-function collision refuses deployment');
 if(fs.existsSync(path.join(root,'docs/database/review-only/20261104_community_discovery_control.rollback.sql'))){const rollback=read('docs/database/review-only/20261104_community_discovery_control.rollback.sql');sql("ALTER FUNCTION public.get_community_visibility_options(uuid) SET statement_timeout='5s';");let drift=false;try{sql(rollback)}catch(e){if(!String(e.stderr).includes('Discovery functions changed'))throw e;drift=true;}if(!drift)throw Error('Rollback overwrote drift');sql('ALTER FUNCTION public.get_community_visibility_options(uuid) RESET statement_timeout;');sql(rollback);sql("SELECT fixture_assert(to_regprocedure('public.set_community_discoverable(uuid,text,boolean,boolean)') IS NULL,'rollback removes only the new setter'); SELECT fixture_assert((SELECT count(*)=3 FROM communities),'rollback retains communities');");console.log('PASS: guarded rollback refuses drift and preserves community records');sql("ALTER FUNCTION public.is_community_leader(uuid,uuid) SET statement_timeout='5s';");let authority=false;try{sql(migration)}catch(e){if(!String(e.stderr).includes('Community creator authority changed'))throw e;authority=true;}if(!authority)throw Error('Authority drift accepted');console.log('PASS: changed creator authority refuses deployment');}
}catch(e){if(e.stderr)process.stderr.write(e.stderr);throw e;}finally{if(container&&/^[0-9a-f]{64}$/.test(container))run(['rm','-f',container]);}})().catch(e=>{console.error(e.message);process.exitCode=1;});
