/** Two real local Auth/Realtime sessions stay connected across a mutual block.
 * No app UI, push dispatch, production URL or production credentials allowed. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import WebSocket from 'ws';
const [connectionPath,reportPath]=process.argv.slice(2);
assert(connectionPath&&reportPath,'Pass private local connection and report paths');
const config=JSON.parse(await readFile(connectionPath,'utf8'));
const endpoint=new URL(config.API_URL);
assert(endpoint.protocol==='http:'&&endpoint.hostname==='127.0.0.1'&&endpoint.port,'Loopback endpoint required');
const nativeFetch=globalThis.fetch;
const localFetch=(url,options={})=>{
 assert.equal(new URL(typeof url==='string'?url:url.url??url).origin,endpoint.origin);
 return nativeFetch(url,{...options,redirect:'error',signal:options.signal??AbortSignal.timeout(12000)});
};
class LocalSocket extends WebSocket {
 constructor(url,protocols){const u=new URL(url);assert(u.protocol==='ws:'&&u.hostname==='127.0.0.1'&&u.port===endpoint.port);super(url,protocols);}
}
const clients=[],checks=[];
const makeClient=key=>{const api=createClient(endpoint.href,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:localFetch},realtime:{transport:LocalSocket}});clients.push(api);return api;};
const admin=makeClient(config.SERVICE_ROLE_KEY),run=randomUUID(),dm=randomUUID(),group=randomUUID();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const ok=result=>{if(result.error)throw Error(`Local operation failed: ${result.error.code}: ${result.error.message}`);return result.data;};
async function until(predicate,label){const end=Date.now()+12000;while(!predicate()){assert(Date.now()<end,`Timed out: ${label}`);await pause(20);}}
async function check(name,work){await work();checks.push({name,passed:true});console.log(`PASS ${name}`);}
async function actor(label){const email=`${label}-${run}@chat-lab.invalid`,password=randomUUID();const user=ok(await admin.auth.admin.createUser({email,password,email_confirm:true})).user;const api=makeClient(config.ANON_KEY);const session=ok(await api.auth.signInWithPassword({email,password})).session;assert.equal(session.user.id,user.id);await api.realtime.setAuth(session.access_token);return {id:user.id,api,messages:[],reactions:[],channel:null};}
async function listen(person){let ready=false;person.channel=person.api.channel(`private-block:${run}:${randomUUID()}`)
 .on('postgres_changes',{event:'INSERT',schema:'public',table:'messages'},e=>person.messages.push(e.new.id))
 .on('postgres_changes',{event:'INSERT',schema:'public',table:'message_reactions'},e=>person.reactions.push(e.new.id))
 .on('system',{},event=>{if(event.extension==='postgres_changes'&&event.status==='ok')ready=true;})
 .subscribe();await until(()=>ready,'Realtime database subscription');}
async function insert(api,user,circle,text){const id=randomUUID();ok(await api.from('messages').insert({id,user_id:user.id,circle_id:circle,content:text}));return id;}
let failure;
try{
 assert.equal(ok(await admin.from('private_chat_lab_marker').select('id').single()).id,'washedup-private-chat-lab-v1');
 const [a,b,outsider]=await Promise.all(['a','b','outsider'].map(actor));
 ok(await admin.from('profiles').insert([a,b,outsider].map(p=>({id:p.id,first_name_display:'Synthetic',blocked_users:[]}))));
 ok(await admin.from('circles').insert([{id:dm,name:''},{id:group,name:'Synthetic group'}]));
 ok(await admin.from('circle_members').insert([dm,group].flatMap(circle=>[a,b].map(p=>({circle_id:circle,user_id:p.id,status:'joined'})))));
 await Promise.all([a,b,outsider].map(listen));
 let retained;
 await check('Both authenticated sessions receive DM messages before a block',async()=>{retained=await insert(a.api,a,dm,'Before block');await until(()=>a.messages.includes(retained)&&b.messages.includes(retained),'initial DM');});
 for(const store of ['array','table'])for(const [blocker,blocked] of [[a,b],[b,a]]){
  const label=`${store}, ${blocker===a?'A blocks B':'B blocks A'}`;
  if(store==='array')ok(await admin.from('profiles').update({blocked_users:[blocked.id]}).eq('id',blocker.id));
  else ok(await admin.from('user_blocks').insert({blocker_id:blocker.id,blocked_id:blocked.id}));
  await check(`${label}: both sessions lose history and send/reaction permission`,async()=>{
   for(const person of [a,b]){
    assert.equal(ok(await person.api.from('messages').select('id').eq('circle_id',dm)).length,0);
    const send=await person.api.from('messages').insert({id:randomUUID(),circle_id:dm,user_id:person.id,content:'Denied'});assert.equal(send.error?.code,'42501');
    const reaction=await person.api.from('message_reactions').insert({id:randomUUID(),message_id:retained,user_id:person.id,emoji:'Denied'});assert.equal(reaction.error?.code,'42501');
   }
  });
  await check(`${label}: existing streams suppress DM rows and reactions while group delivery continues`,async()=>{
   // Service insertion emulates a queued privileged write. Member writes above
   // were already denied. RLS must still filter its fan-out on existing sockets.
   const hidden=await insert(admin,a,dm,'Private service fixture'),reaction=randomUUID();
   ok(await admin.from('message_reactions').insert({id:reaction,message_id:hidden,user_id:a.id,emoji:'Synthetic'}));
   const control=await insert(a.api,a,group,'Allowed group control');
   await until(()=>a.messages.includes(control)&&b.messages.includes(control),'post-block group sentinel');
   await pause(800);
   for(const person of [a,b,outsider]){assert(!person.messages.includes(hidden));assert(!person.reactions.includes(reaction));}
   assert(!outsider.messages.includes(control));
  });
  if(store==='array')ok(await admin.from('profiles').update({blocked_users:[]}).eq('id',blocker.id));
  else ok(await admin.from('user_blocks').delete().eq('blocker_id',blocker.id).eq('blocked_id',blocked.id));
  await check(`${label}: unblocking restores subsequent delivery on the same sockets`,async()=>{const next=await insert(b.api,b,dm,'After unblock');await until(()=>a.messages.includes(next)&&b.messages.includes(next),'unblocked DM');assert(!outsider.messages.includes(next));});
 }
 await check('An unrelated authenticated session cannot read or write the DM',async()=>{assert.equal(ok(await outsider.api.from('messages').select('id').eq('circle_id',dm)).length,0);const result=await outsider.api.from('messages').insert({id:randomUUID(),circle_id:dm,user_id:outsider.id,content:'Denied'});assert.equal(result.error?.code,'42501');});
}catch(error){failure=error;console.error(error.message);}
finally{
 for(const api of clients){await api.removeAllChannels();api.realtime.disconnect();}
 await writeFile(reportPath,JSON.stringify({passed:!failure,checks,production_contacted:false,external_notifications_sent:false,negative_event_observation_ms:800,scope:'Synthetic local PostgreSQL/PostgREST/Auth/Realtime; not native UI or production parity',error:failure?.message},null,2)+'\n');
}
if(failure)process.exitCode=1;
