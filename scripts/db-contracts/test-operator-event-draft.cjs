// Isolated PostgreSQL only. Replays current exported writers, constraints and triggers.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync,spawnSync,execFile}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const context=process.argv[2];if(!context||!/^[\w-]+$/.test(context))throw Error('An explicit isolated Docker context is required');
const prefix=['--context',context],run=(args,options={})=>execFileSync('docker',[...prefix,...args],{encoding:'utf8',timeout:60000,...options});
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),cid=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0'),rid=n=>'20000000-0000-4000-8000-'+String(n).padStart(12,'0');
let container,checks=0;const assert=(ok,label)=>{if(!ok)throw Error(label);checks++;console.log('PASS: '+label);};
async function main(){
 container=run(['run','--detach','--rm','--pull','never','--network','none','--env','POSTGRES_PASSWORD=contract-only','postgres:17-alpine']).trim();
 if(!/^[a-f0-9]{64}$/.test(container))throw Error('Unexpected container');
 for(let i=0;i<60;i++){if(spawnSync('docker',[...prefix,'exec',container,'pg_isready','-h','127.0.0.1','-U','postgres'],{stdio:'ignore'}).status===0)break;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250);}
 const args=['exec','-i',container,'psql','-h','127.0.0.1','-X','-q','-A','-t','-U','postgres','-v','ON_ERROR_STOP=1'];
 const sql=s=>run(args,{input:s,stdio:['pipe','pipe','pipe']}).trim();
 const sqlAsync=s=>new Promise((resolve,reject)=>{const p=execFile('docker',[...prefix,...args],{encoding:'utf8',timeout:60000},(e,out,err)=>e?reject(Object.assign(e,{stderr:err})):resolve(out.trim()));p.stdin.end(s);});
 const fails=(s,text,label)=>{let refused=false;try{sql(s);}catch(e){if(!String(e.stderr).includes(text))throw e;refused=true;}assert(refused,label);};
 const contract=JSON.parse(read('supabase/tests/contracts/20261105_legacy_event_create_live_contract.json'));
 sql(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT current_setting('request.jwt.claim.role',true)$$;
 GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;GRANT EXECUTE ON FUNCTION auth.uid(),auth.role() TO authenticated,anon;`);
 for(const r of contract.filter(r=>r.kind==='enum'))sql(`CREATE TYPE public.${r.value.name} AS ENUM(${r.value.labels.map(quote).join(',')});`);
 sql(`CREATE TABLE profiles(id uuid PRIMARY KEY,gender text);
 CREATE TABLE user_roles(user_id uuid,role app_role);
 CREATE TABLE operator_grants(user_id uuid,track operator_track,status text);
 CREATE TABLE communities(id uuid PRIMARY KEY,status text);
 CREATE TABLE community_members(community_id uuid,user_id uuid,status text,role text);
 CREATE TABLE creator_page_drafts(id uuid PRIMARY KEY,page_data jsonb);
 CREATE TABLE creator_page_publications(page_id uuid,page_kind text,audience text);
 CREATE TABLE creator_page_events(event_id uuid,page_id uuid);
 CREATE TABLE creator_page_event_media(event_id uuid,object_name text,purpose text,ready_at timestamptz,abandoned_at timestamptz);
 CREATE TABLE community_topics(id uuid DEFAULT gen_random_uuid(),community_id uuid,name text,created_by uuid,explore_event_id uuid);
 CREATE TABLE ticket_orders(event_id uuid,status text);
 CREATE TABLE explore_event_rsvps(explore_event_id uuid,status text);
 CREATE TABLE ticket_tiers(event_id uuid,price_cents integer);
 CREATE TABLE event_owner_changes(event_id uuid,changed_by uuid,actor_db_role text,previous_owner_type text,previous_owner_user_id uuid,previous_owner_community_id uuid,new_owner_type text,new_owner_user_id uuid,new_owner_community_id uuid,reason text,had_committed_guests boolean);
 -- Unused team branch is explicitly fictional; this proposal is for legacy creators.
 CREATE FUNCTION creator_page_team_can_manage(uuid,text) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;`);
 const columns=contract.filter(r=>r.kind==='column').map(r=>{const c=r.value;return `"${c.name}" ${c.type}${c.generated==='s'?` GENERATED ALWAYS AS (${c.default}) STORED`:c.default?' DEFAULT '+c.default:''}${c.required?' NOT NULL':''}`;});
 sql(`CREATE TABLE explore_events(${columns.join(',')});`);
 for(const r of contract.filter(r=>r.kind==='constraint'))sql(`ALTER TABLE explore_events ADD CONSTRAINT "${r.value.name}" ${r.value.definition};`);
 const order=['has_role','is_admin','has_operator_grant','creator_page_audience_matches','creator_page_is_visible','creator_community_is_visible','is_community_leader','creator_event_page_id','creator_event_owner_is_eligible','creator_page_team_event_can_manage','validate_event_categories','operator_create_explore_event','operator_create_explore_event_with_categories','operator_set_event_offer_type','operator_set_event_ticket_capacity','operator_set_explore_event_coords'];
 for(const name of order){const c=contract.find(r=>r.kind==='routine'&&r.value.name===name).value;sql(c.definition);assert(sql(`SELECT md5(pg_get_functiondef(${quote(c.identity)}::regprocedure));`)===c.md5,'replayed current '+name);}
 for(const r of contract.filter(r=>r.kind==='trigger'))sql(r.value.function_definition+';'+r.value.definition+';');
 // Existing event visibility policy is outside this draft-only RPC fixture. Enable
 // RLS with no direct client privileges; all existing definer writers stay intact.
 sql('ALTER TABLE explore_events ENABLE ROW LEVEL SECURITY; REVOKE ALL ON explore_events FROM PUBLIC,authenticated,anon;');
 sql(`INSERT INTO auth.users SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(1,7)n;
 INSERT INTO profiles SELECT id,CASE WHEN id=${quote(uid(3))} THEN 'man' ELSE 'woman' END FROM auth.users;
 INSERT INTO communities VALUES(${quote(cid(1))},'active'),(${quote(cid(2))},'active'),(${quote(cid(3))},'archived');
 INSERT INTO operator_grants VALUES(${quote(uid(1))},'community_leader','approved'),(${quote(uid(2))},'event_host','approved'),(${quote(uid(3))},'community_leader','approved'),(${quote(uid(4))},'event_host','revoked');
 INSERT INTO community_members VALUES(${quote(cid(1))},${quote(uid(1))},'active','leader'),(${quote(cid(1))},${quote(uid(3))},'active','co_leader'),(${quote(cid(2))},${quote(uid(3))},'active','leader'),(${quote(cid(3))},${quote(uid(1))},'active','leader');
 INSERT INTO creator_page_drafts VALUES(${quote(cid(2))},'{"audience":"women_only"}');
 INSERT INTO creator_page_publications VALUES(${quote(cid(2))},'community','women_only');`);
 const migration=read('docs/database/review-only/20261105_operator_event_draft_recovery.sql');
 const before=sql('SELECT count(*) FROM explore_events;');
 sql("ALTER FUNCTION operator_set_event_ticket_capacity(uuid,integer) SET statement_timeout='1s';");
 fails(migration,'Event dependency changed','deployment refuses changed dependency definitions');
 sql('ALTER FUNCTION operator_set_event_ticket_capacity(uuid,integer) RESET statement_timeout;');sql(migration);assert(sql('SELECT count(*) FROM explore_events;')===before,'deployment does not create or change events');
 fails(migration,'Draft recovery already exists','duplicate deployment refuses');
 const as=(n,q,role='authenticated')=>`SET request.jwt.claim.sub=${quote(n?uid(n):'')};SET request.jwt.claim.role=${quote(role)};SET ROLE ${role};${q}`;
 const fields={title:'Sunset picnic',description:'A fictional draft',image_url:'',event_date:'',start_time:null,end_time:null,venue:'LA',venue_address:'',category:'music',categories:['music'],external_url:'',ticket_price:'',public_name:'Test',pin_to_chat:true,description_blocks:[],confirmation_message:'Bring water'};
 const create=(request,community=cid(1),f=fields,offer='free_event',cap=24,lat=34,lng=-118)=>`SELECT public.create_operator_event_draft(${quote(rid(request))},${quote(JSON.stringify(f))}::jsonb,${community?quote(community):'NULL'},${quote(offer)},${cap??'NULL'},${lat??'NULL'},${lng??'NULL'});`;
 const cancel=(request,community=cid(1),f=fields)=>`SELECT public.cancel_operator_event_draft_attempt(${quote(rid(request))},${quote(JSON.stringify({fields:f,community_id:community,offer_type:'free_event',ticket_capacity:24,latitude:34,longitude:-118}))}::jsonb);`;
 const get=request=>`SELECT public.get_operator_event_draft_attempt(${quote(rid(request))});`;
 const count=()=>Number(sql('SELECT count(*) FROM explore_events;'));
 const receipt=JSON.parse(sql(as(1,create(1))));
 assert(receipt.status==='Draft'&&receipt.offer_type==='free_event'&&receipt.ticket_capacity===24,'complete free draft receipt includes the chosen settings');
 assert(sql(`SELECT status||':'||offer_type||':'||ticket_capacity||':'||latitude||':'||longitude FROM explore_events WHERE id=${quote(receipt.event_id)};`)==='Draft:free_event:24:34:-118','settings and coordinates persist in one transaction');
 assert(sql('SELECT count(*) FROM community_topics;')==='0','draft creation creates no community chat');
 assert(JSON.parse(sql(as(1,create(1)))).event_id===receipt.event_id&&count()===1,'retry returns the same event without another insert');
 assert(JSON.parse(sql(as(1,get(1)))).event_id===receipt.event_id,'read-only recovery finds the confirmed receipt');
 assert(sql(as(2,get(1)))==='','another account cannot read a receipt with the same request key');
 fails(as(1,create(1,cid(1),{...fields,title:'Changed retry'})),'another draft save','a reused request key cannot overwrite different input');
 sql(`UPDATE explore_events SET title='Later edit' WHERE id=${quote(receipt.event_id)};`);sql(as(1,create(1)));
 assert(sql(`SELECT title FROM explore_events WHERE id=${quote(receipt.event_id)}`)==='Later edit','recovery preserves subsequent event edits');
 const org=JSON.parse(sql(as(2,create(2,null))));assert(org.community_id===null,'approved organization creator can create a private draft');
 fails(as(1,create(3,null)),'access is unavailable','community-only grant cannot create an organization draft');
 fails(as(4,create(4,null)),'access is unavailable','revoked grant is denied');
 fails(as(5,create(5,null)),'access is unavailable','outsider is denied');
 fails(as(null,create(6), 'anon'),'permission denied','anonymous execute remains denied');
 fails(as(null,create(6)),'Sign in','missing authenticated user is denied');
 fails(as(1,'SELECT * FROM operator_event_draft_attempts;'),'permission denied','no direct receipt table read for authenticated');
 fails(as(1,`SELECT operator_event_draft_authorize(${quote(cid(1))});`),'permission denied','internal authority helper is not client callable');
 fails(as(1,create(7,cid(3))),'active community','archived community cannot create a draft');
 fails(as(3,create(8,cid(2))),'access is unavailable','current women-only audience rule denies ineligible creator');
 assert(JSON.parse(sql(as(3,create(9)))).event_id,'eligible co-leader can create for their community');
 for(const role of ['admin','events','member','member_care','finance']){
  sql(`UPDATE community_members SET role=${quote(role)} WHERE community_id=${quote(cid(1))} AND user_id=${quote(uid(3))}`);
  fails(as(3,create(10)),'access is unavailable',role+' does not gain new creation authority');
 }
 sql(`UPDATE community_members SET role='co_leader' WHERE community_id=${quote(cid(1))} AND user_id=${quote(uid(3))}`);
 const beforeInvalid=count();
 for(const [label,f,offer,cap,lat,lng] of [
  ['unrecognized publish input',{...fields,publish:true},'free_event',24,34,-118],
  ['invalid title',{...fields,title:''},'free_event',24,34,-118],
  ['invalid categories',{...fields,categories:['music','music']},'free_event',24,34,-118],
  ['unsupported offer',fields,'subscription',24,34,-118],
  ['zero capacity',fields,'free_event',0,34,-118],
  ['unpaired coordinates',fields,'free_event',24,34,null],
  ['invalid coordinate',fields,'free_event',24,91,-118],
  ['invalid media', {...fields,description_blocks:[{type:'image',path:'other-event/image.jpg'}]},'free_event',24,34,-118],
 ]){let failed=false;try{sql(as(1,create(20,cid(1),f,offer,cap,lat,lng)));}catch(e){failed=true;}assert(failed&&count()===beforeInvalid,'rollback/no event for '+label);}
 // Failure after insertion proves atomic rollback of the event and its receipt.
 sql(`CREATE FUNCTION fixture_capacity_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.ticket_capacity=777 THEN RAISE EXCEPTION 'fixture capacity failure'; END IF;RETURN NEW;END$$;CREATE TRIGGER fixture_capacity_failure BEFORE UPDATE OF ticket_capacity ON explore_events FOR EACH ROW EXECUTE FUNCTION fixture_capacity_failure();`);
 fails(as(1,create(21,cid(1),fields,'free_event',777)),'fixture capacity failure','post-insert settings failure reaches the caller');
 assert(count()===beforeInvalid&&sql(as(1,get(21)))==='','post-insert failure rolls back both event and receipt');
 sql('DROP TRIGGER fixture_capacity_failure ON explore_events;DROP FUNCTION fixture_capacity_failure();');
 const concurrent=await Promise.all([sqlAsync(as(1,create(30))),sqlAsync(as(1,create(30)))]);
 assert(JSON.parse(concurrent[0]).event_id===JSON.parse(concurrent[1]).event_id&&count()===beforeInvalid+1,'concurrent retries create exactly one event');
 const changed=await Promise.allSettled([sqlAsync(as(1,create(31))),sqlAsync(as(1,create(31,cid(1),{...fields,title:'Different race'})))]);
 assert(changed.filter(r=>r.status==='fulfilled').length===1&&changed.filter(r=>r.status==='rejected').length===1&&count()===beforeInvalid+2,'competing different input under one key yields one event and one conflict');
 sql(`UPDATE community_members SET status='left' WHERE community_id=${quote(cid(1))} AND user_id=${quote(uid(1))}`);
 fails(as(1,get(1)),'access is unavailable','revoked community membership cannot recover an old receipt');
 fails(as(1,create(1)),'access is unavailable','replay does not bypass revoked membership');
 sql(`UPDATE community_members SET status='active' WHERE community_id=${quote(cid(1))} AND user_id=${quote(uid(1))}`);
 sql(`DELETE FROM explore_events WHERE id=${quote(receipt.event_id)};`);const afterDelete=count();
 fails(as(1,create(1)),'no longer available','a deleted event cannot be recreated by replaying its request');
 assert(count()===afterDelete&&sql(`SELECT count(*) FROM operator_event_draft_attempts WHERE request_id=${quote(rid(1))} AND event_id IS NULL;`)==='1','deletion retains a private tombstone receipt');
 // A concurrent grant revocation must wait for the authorized transaction.
 const held=sqlAsync(`BEGIN;SET application_name='draft_create_lock_fixture';${as(2,create(50,null))}SELECT pg_sleep(1.5);COMMIT;`);
 let sleeping=false;
 for(let i=0;i<30;i++){if(sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='draft_create_lock_fixture' AND wait_event='PgSleep';")==='1'){sleeping=true;break;}await new Promise(r=>setTimeout(r,20));}
 assert(sleeping,'creation transaction holds authority locks until commit');
 const revoked=sqlAsync(`SET application_name='draft_revoke_lock_fixture';UPDATE operator_grants SET status='revoked' WHERE user_id=${quote(uid(2))};`);
 let waiting=false;
 for(let i=0;i<20;i++){if(sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='draft_revoke_lock_fixture' AND wait_event_type='Lock';")==='1'){waiting=true;break;}await new Promise(r=>setTimeout(r,20));}
 assert(waiting,'concurrent grant revocation waits for the creation transaction');
 await Promise.all([held,revoked]);fails(as(2,create(51,null)),'access is unavailable','no subsequent draft after grant revocation');
 sql(`UPDATE operator_grants SET status='approved' WHERE user_id=${quote(uid(2))}`);
 assert(sql(as(2,'SELECT get_operator_event_draft_capability();'))==='1','authenticated client can detect exact protocol version');
 const beforeCancel=count();
 const stopped=JSON.parse(sql(as(1,cancel(60))));
 assert(stopped.status==='Cancelled'&&stopped.event_id===null&&count()===beforeCancel,'return to editing seals a request without creating or deleting an event');
 assert(JSON.parse(sql(as(1,get(60)))).status==='Cancelled','read-only recovery returns a sealed cancellation after a lost response');
 assert(JSON.parse(sql(as(1,create(60)))).status==='Cancelled'&&count()===beforeCancel,'a delayed create cannot run after the original request was sealed');
 assert(JSON.parse(sql(as(1,cancel(60)))).status==='Cancelled','cancellation is repeatable with the original immutable input');
 fails(as(1,cancel(60,cid(1),{...fields,title:'Changed'})),'another draft save','cancellation refuses changed request input');
 fails(as(5,cancel(62)),'access is unavailable','an outsider cannot create a cancellation receipt');
 fails(as(null,cancel(62),'anon'),'permission denied','anonymous cancellation is denied');
 assert(sql(as(2,get(60)))==='','cancellation receipts remain private to their initiating account');
 const existing=JSON.parse(sql(as(1,create(61))));
 assert(JSON.parse(sql(as(1,cancel(61)))).event_id===existing.event_id&&count()===beforeCancel+1,'return to editing preserves and recovers an already committed draft');
 assert(JSON.parse(sql(as(1,cancel(1)))).status==='Cancelled','a separately deleted draft can release its local recovery marker');
 assert(JSON.parse(sql(as(1,create(1)))).status==='Cancelled','a released deleted draft still cannot be recreated under its old key');
 const race=await Promise.all([sqlAsync(as(1,create(63))),sqlAsync(as(1,cancel(63)))]);
 const outcomes=race.map(JSON.parse);
 assert(outcomes[0].status===outcomes[1].status&&outcomes[0].event_id===outcomes[1].event_id,'create and return-to-editing race resolves to the same single outcome');
 assert(count()===beforeCancel+1+(outcomes[0].status==='Draft'?1:0),'concurrent cancellation cannot delete or duplicate an event');
 const createdFunctions=['operator_event_draft_authorize','get_operator_event_draft_attempt','create_operator_event_draft','get_operator_event_draft_capability','cancel_operator_event_draft_attempt'];
 const fn=JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_object('identity',oid::regprocedure::text,'md5',md5(pg_get_functiondef(oid)),'acl',proacl) ORDER BY proname) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN(${createdFunctions.map(quote).join(',')});`));
 const fingerprintPath=path.join(root,'supabase/tests/contracts/20261105_operator_event_draft_candidate_fingerprints.json');
 if(process.argv.includes('--refresh-reviewed-fingerprints')){
  fs.writeFileSync(fingerprintPath,JSON.stringify(fn,null,2)+'\n');
  const guard=fn.map(f=>` IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure(${quote(f.identity)}) AND md5(pg_get_functiondef(oid))=${quote(f.md5)} AND proacl=ARRAY[${f.acl.map(quote).join(',')}]::aclitem[]) THEN RAISE EXCEPTION 'Draft recovery routine changed'; END IF;`).join('\n');
  const rollbackPath=path.join(root,'docs/database/review-only/20261105_operator_event_draft_recovery.rollback.sql');
  let rollback=fs.readFileSync(rollbackPath,'utf8');
  rollback=rollback.replace(/DO \$guard\$ BEGIN[\s\S]*?(?= IF has_table_privilege)/,'DO $guard$ BEGIN\n'+guard+'\n');
  if(!rollback.includes('DROP FUNCTION public.cancel_operator_event_draft_attempt'))rollback=rollback.replace('DROP FUNCTION public.get_operator_event_draft_capability();','DROP FUNCTION public.cancel_operator_event_draft_attempt(uuid,jsonb);\nDROP FUNCTION public.get_operator_event_draft_capability();');
  fs.writeFileSync(rollbackPath,rollback);
 }else assert(JSON.stringify(fn)===JSON.stringify(JSON.parse(fs.readFileSync(fingerprintPath,'utf8'))),'candidate definitions and grants match reviewed fingerprints');
 // Rehearse the exact rollback-only production QA file using fictional authority.
 const qaCommunity='ed31b9f3-2b78-4690-88b2-c05b74265a11';
 sql(`ALTER TABLE communities ADD COLUMN name text,ADD COLUMN purpose text,ADD COLUMN discoverable boolean;
 INSERT INTO communities(id,status,name,purpose,discoverable) VALUES(${quote(qaCommunity)},'archived','WashedUp Discovery QA','Private isolated QA of discovery controls. No ordinary members or invitations.',false);
 INSERT INTO community_members VALUES(${quote(qaCommunity)},${quote(uid(1))},'active','leader');`);
 const qaBefore=sql("SELECT md5(coalesce(jsonb_agg(to_jsonb(e) ORDER BY id)::text,'')) FROM explore_events e;");
 const qaReceiptBefore=sql('SELECT count(*) FROM operator_event_draft_attempts;');
 const qaSql=read('docs/database/review-only/20261105_operator_event_draft_recovery.qa.sql');
 assert(sql(qaSql).includes('PASS: complete draft'),'prepared production QA succeeds under authenticated database role');
 assert(sql("SELECT md5(coalesce(jsonb_agg(to_jsonb(e) ORDER BY id)::text,'')) FROM explore_events e;")===qaBefore,'prepared production QA rolls back every test event');
 assert(sql('SELECT count(*) FROM operator_event_draft_attempts;')===qaReceiptBefore,'prepared production QA rolls back its receipts');
 assert(sql(`SELECT status||':'||discoverable FROM communities WHERE id=${quote(qaCommunity)};`)==='archived:false','prepared production QA restores the archived hidden community');
 sql(`UPDATE communities SET name='Changed QA' WHERE id=${quote(qaCommunity)};`);
 fails(qaSql,'isolated QA community','prepared production QA refuses a changed fixture');
 const beforeRollback=sql("SELECT md5(coalesce(jsonb_agg(to_jsonb(e) ORDER BY id)::text,'')) FROM explore_events e;");
 const receiptCount=sql('SELECT count(*) FROM operator_event_draft_attempts;');
 sql("ALTER FUNCTION get_operator_event_draft_capability() SET statement_timeout='1s';");
 fails(read('docs/database/review-only/20261105_operator_event_draft_recovery.rollback.sql'),'Draft recovery routine changed','rollback refuses a changed new endpoint');
 sql('ALTER FUNCTION get_operator_event_draft_capability() RESET statement_timeout;');
 sql(read('docs/database/review-only/20261105_operator_event_draft_recovery.rollback.sql'));
 assert(sql("SELECT md5(coalesce(jsonb_agg(to_jsonb(e) ORDER BY id)::text,'')) FROM explore_events e;")===beforeRollback,'rollback retains every event');
 assert(sql('SELECT count(*) FROM operator_event_draft_attempts;')===receiptCount,'rollback retains all private recovery receipts');
 assert(sql("SELECT to_regprocedure('public.create_operator_event_draft(uuid,jsonb,uuid,text,integer,double precision,double precision)') IS NULL;")==='t','rollback removes only the new creation endpoint');
 fails(as(1,'SELECT * FROM operator_event_draft_attempts;'),'permission denied','receipt data stays private after rollback');
 console.log(`PASS: ${checks} isolated database checks`);
}
main().catch(e=>{if(e.stderr)process.stderr.write(e.stderr);console.error(e.stack??e);process.exitCode=1;}).finally(()=>{if(container&&/^[a-f0-9]{64}$/.test(container))run(['rm','-f',container]);});
