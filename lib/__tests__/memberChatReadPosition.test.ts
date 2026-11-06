import { acknowledgeMemberChatPage } from '../memberChatReadPosition';
import { supabase } from '../supabase';

jest.mock('../supabase', () => ({supabase:{from:jest.fn()}}));
const old = '2026-11-06T09:00:00.000001Z', next = '2026-11-06T09:00:00.000002Z';
const room = { kind:'event', id:'plan' } as const;
function fixture() {
  const tables: Record<string, Record<string,string>[]> = {chat_reads:[], app_notifications:[], messages:[]};
  const state = {active:true, after: (_table:string, _mode:string) => {}};
  const notice = (id:string, at = next, props = {}) => tables.app_notifications.push(
    {id,event_id:'plan',user_id:'me',created_at:at,type:'new_message',status:'unread',...props});
  const from = (table:string) => {
    let mode='read', values:Record<string,string>={}, max=Infinity;const predicates:((r:Record<string,string>)=>boolean)[]=[];
    const q:any = {
      eq:(k:string,v:string)=>{predicates.push(r=>r[k]===v);return q;}, lt:(k:string,v:string)=>{predicates.push(r=>r[k]<v);return q;},
      gt:(k:string,v:string)=>{predicates.push(r=>r[k]>v);return q;}, lte:(k:string,v:string)=>{predicates.push(r=>r[k]<=v);return q;},
      in:(k:string,vs:string[])=>{predicates.push(r=>vs.includes(r[k]));return q;},
      select:()=>q, limit:(n:number)=>{max=n;return q;},
      upsert:(row:Record<string,string>,opts:any)=>{expect(opts.ignoreDuplicates).toBe(true);mode='insert';values=row;return q;},
      update:(patch:Record<string,string>)=>{mode='update';values=patch;return q;},
      then:(done:Function)=>{let rows=tables[table].filter(r=>predicates.every(f=>f(r))).slice(0,max);
        if(mode==='insert'){const parent=values.event_id?'event_id':'circle_id';rows=rows.some(r=>r.user_id===values.user_id&&r[parent]===values[parent])?[]:[values];tables[table].push(...rows);}
        if(mode==='update')rows.forEach(r=>Object.assign(r,values));
        const data=rows.map(r=>({...r}));state.after(table,mode);done({data,error:null});},
    };return q;
  };
  jest.mocked(supabase.from).mockImplementation(from as any);
  return {tables,state,notice,ack:(at:string, circle=false)=>acknowledgeMemberChatPage(circle?{kind:'circle',id:'circle'}:room,at,{userId:'me',isCurrent:()=>state.active},()=>state.active)};
}
it('preserves an unseen arrival and an unrelated notice; a later actual page clears the right one',async()=>{
  const f=fixture();f.notice('old',old);f.notice('new');f.notice('other',old,{user_id:'other'});f.notice('elsewhere',old,{event_id:'elsewhere'});f.notice('invite',old,{type:'plan_invite'});
  f.tables.messages.push({id:'new',event_id:'plan',created_at:next});
  await f.ack(old);expect(f.tables.app_notifications.map(r=>r.status)).toEqual(['read','unread','unread','unread','unread']);
  await f.ack(next);await f.ack(old);
  expect(f.tables.chat_reads).toEqual([{event_id:'plan',user_id:'me',last_read_at:next}]);expect(f.tables.app_notifications[1].status).toBe('read');
});
it('clears a delayed notice only when still caught up; a notice arriving after that check stays unread',async()=>{
  const f=fixture();f.notice('reaction');f.state.after=(table,mode)=>{if(table==='messages'&&mode==='read')f.notice('another');};
  await f.ack(old);expect(f.tables.app_notifications.map(r=>r.status)).toEqual(['read','unread']);
});
it('leaving during the newer-history check prevents the delayed notice write',async()=>{
  const f=fixture();f.notice('reaction');f.state.after=(table)=>{if(table==='messages')f.state.active=false;};
  await f.ack(old);expect(f.tables.app_notifications[0].status).toBe('unread');
});
it('advances Circle independently and never clears a plan notification',async()=>{
  const f=fixture();f.notice('plan',old);await f.ack(next,true);await f.ack(old,true);
  expect(f.tables.chat_reads).toEqual([{circle_id:'circle',user_id:'me',last_read_at:next}]);expect(f.tables.app_notifications[0].status).toBe('unread');
});
