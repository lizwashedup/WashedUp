import { attributeCircleCardUnreads } from '../memberInboxActivity';
import { restrictGroupPreview, type ChatPreview } from '../chatPreview';
import { supabase } from '../supabase';

jest.mock('../supabase', () => ({ supabase: { from: jest.fn() } }));
const blocked = new Set(['blocked']);
const read = <T,>(q: PromiseLike<T>) => Promise.resolve(q);
function card(id: string, isDm = false): ChatPreview {
  return {kind:'circle', conversationId:id, title:id, category:null, image_url:null, ticket_url:null, member_count:4, start_time:'', is_past:false,
    last_message:'Allowed preview', last_message_at:'2026-11-06', last_message_user_id:'allowed', unread_count:4, member_avatars:[],is_dm:isDm};
}
it('checks each group’s own read position and keeps its permitted badge without changing an authorized DM', async()=>{
  const messages = [
    {circle_id:'group-a',user_id:'allowed',created_at:'01'}, {circle_id:'group-a',user_id:'allowed',created_at:'03'},
    {circle_id:'group-a',user_id:'blocked',created_at:'04'}, {circle_id:'group-a',user_id:'viewer',created_at:'05'},
    {circle_id:'group-b',user_id:'allowed',created_at:'01'}, {circle_id:'group-b',user_id:'other',created_at:'02'},
  ];
  const markers = [{circle_id:'group-a',user_id:'viewer',last_read_at:'02'}];
  jest.mocked(supabase.from).mockImplementation((table:string)=>{
    const filters: ((r:Record<string,string>)=>boolean)[] = [];
    const q:any={select:()=>q,eq:(k:string,v:string)=>{filters.push(r=>r[k]===v);return q;},
      neq:(k:string,v:string)=>{filters.push(r=>r[k]!==v);return q;},gt:(k:string,v:string)=>{filters.push(r=>r[k]>v);return q;},
      in:(k:string,vs:string[])=>{filters.push(r=>vs.includes(r[k]));return q;},
      not:(k:string,op:string,list:string)=>{expect(op).toBe('in');const ids=JSON.parse('['+list.slice(1,-1)+']');filters.push(r=>!ids.includes(r[k]));return q;},
      order:()=>q,limit:(n:number)=>{expect(n).toBe(10);return q;},
      then:(ok:Function)=>ok({data:(table==='messages'?messages:markers).filter(row=>filters.every(f=>f(row))),error:null})};
    return q;
  });
  const dm=card('private',true);
  const rows=await attributeCircleCardUnreads([card('group-a'),card('group-b'),dm],'viewer',blocked,read);
  expect(rows.map(row=>restrictGroupPreview(row,blocked).unread_count)).toEqual([1,2,4]);
  expect(rows[2]).toBe(dm);
});
