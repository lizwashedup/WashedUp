// Exact exported routines, fictional dependencies, offline PostgreSQL only.
const {execFile,execFileSync,spawnSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'),context=process.argv[2];
if(context&&!/^[a-zA-Z0-9_-]+$/.test(context))throw Error('Invalid Docker context');
const prefix=context?['--context',context]:[];
const run=(args,options={})=>execFileSync('docker',[...prefix,...args],{encoding:'utf8',timeout:60000,...options});
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
let container;
(async()=>{try{
 container=run(['run','--detach','--rm','--pull','never','--network','none','--env','POSTGRES_PASSWORD=contract-only','postgres:17-alpine']).trim();
 if(!/^[0-9a-f]{64}$/.test(container))throw Error('Unexpected container');
 let ready=false;for(let i=0;i<60;i++){
  if(spawnSync('docker',[...prefix,'exec',container,'pg_isready','-h','127.0.0.1','-U','postgres'],{stdio:'ignore',timeout:5000}).status===0){ready=true;break;}
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250);
 }
 if(!ready)throw Error('Postgres did not start');
 const sql=source=>run(['exec','-i',container,'psql','-X','-q','-U','postgres','-v','ON_ERROR_STOP=1'],{input:source,stdio:['pipe','pipe','pipe']});
 const routines=JSON.parse(read('supabase/tests/contracts/20261103_community_joining_live_routines.json'));
 for(const r of routines)if(crypto.createHash('md5').update(r.definition).digest('hex')!==r.md5)throw Error('Changed snapshot '+r.name);
 sql(read('supabase/tests/contracts/20261103_community_joining_fixture.sql'));
 for(const name of ['creator_page_is_visible','creator_community_is_visible','is_community_leader','creator_page_join_settings_revision','creator_page_member_eligibility_guard','create_community','finalize_community_join','request_to_join_community','set_community_join_policy'])sql(routines.find(r=>r.name===name).definition+';');
 sql('CREATE TRIGGER creator_page_member_eligibility BEFORE INSERT OR UPDATE ON community_members FOR EACH ROW EXECUTE FUNCTION creator_page_member_eligibility_guard(); CREATE TRIGGER creator_page_join_settings_revision BEFORE UPDATE ON communities FOR EACH ROW EXECUTE FUNCTION creator_page_join_settings_revision();');
 sql("SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; SELECT request_to_join_community('10000000-0000-0000-0000-000000000001',fixture_answers()); SELECT fixture_assert((SELECT status='pending' FROM community_members WHERE user_id=auth.uid()),'deployed legacy Open actually requires approval');");
 console.log('PASS: exported legacy baseline reproduced');
 const candidate=read('docs/database/review-only/20261103_community_explicit_joining.sql');
 sql(candidate);
 sql(candidate);
 sql(read('supabase/tests/contracts/20261103_community_joining_contract.sql'));
 console.log('PASS: explicit choice, pending-request preservation, creation receipts, authorization and published audience checks');

 const concurrent=source=>new Promise((resolve,reject)=>{
   const child=execFile('docker',[...prefix,'exec','-i',container,'psql','-X','-q','-U','postgres','-v','ON_ERROR_STOP=1'],{encoding:'utf8',timeout:15000},(error,stdout,stderr)=>error?reject(Object.assign(error,{stdout,stderr})):resolve(stdout));
   child.stdin.end(source);
 });
 sql("CREATE FUNCTION fixture_slow_create() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN PERFORM pg_sleep(0.15); RETURN NEW; END$$; CREATE TRIGGER fixture_slow_create BEFORE INSERT ON community_blocks FOR EACH ROW EXECUTE FUNCTION fixture_slow_create();");
 const duplicate="SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001'; SELECT create_community_with_joining('20000000-0000-0000-0000-000000000009','concurrent-walks','Concurrent Walks','LA','Testing simultaneous requests','open');";
 await Promise.all([concurrent(duplicate),concurrent(duplicate)]);
 sql("SELECT fixture_assert((SELECT count(*)=1 FROM communities WHERE handle='concurrent-walks'),'concurrent creation returns one community'); SELECT fixture_assert((SELECT count(*)=5 FROM community_blocks WHERE community_id=(SELECT id FROM communities WHERE handle='concurrent-walks')),'concurrent retry seeds blocks only once'); DROP TRIGGER fixture_slow_create ON community_blocks;");
 console.log('PASS: simultaneous create requests produce one community and one set of starter blocks');
 sql(read('docs/database/review-only/20261103_community_explicit_joining.rollback.sql'));
 sql("SELECT fixture_assert(to_regprocedure('public.get_community_joining_options(uuid)') IS NULL,'rollback removes the capability'); SELECT fixture_assert((SELECT count(*)=3 FROM community_creation_attempts),'rollback preserves exact creation receipts'); SELECT fixture_assert((SELECT count(*)=1 FROM community_members WHERE community_id='10000000-0000-0000-0000-000000000001' AND user_id='00000000-0000-0000-0000-000000000003' AND status='active'),'rollback retains admitted members');");
 console.log('PASS: rollback restores admission routines without deleting communities, members or receipts');
 sql(candidate);
 sql("ALTER FUNCTION public.request_to_join_community(uuid,jsonb) SET statement_timeout='5s';");
 let denied=false;try{sql(candidate);}catch(e){if(!String(e.stderr).includes('request_to_join_community changed; inspect current definition'))throw e;denied=true;}
 if(!denied)throw Error('Drift was overwritten');
 console.log('PASS: migration refuses a changed deployed admission function');
}catch(error){if(error.stdout)process.stderr.write(error.stdout);if(error.stderr)process.stderr.write(error.stderr);throw error;}
finally{if(container&&/^[0-9a-f]{64}$/.test(container))run(['rm','-f',container]);}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
