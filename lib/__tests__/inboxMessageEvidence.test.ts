import { classifyInboxInsert, messageEvidence, withInboxDelivery } from '../inboxMessageEvidence';

const stamp=(n:number)=>new Date(Date.UTC(2026,10,6,12,n)).toISOString();
it('distinguishes already included IDs, a confirmed read position and a truncated window',()=>{
  const snapshot=messageEvidence([{id:'first',created_at:stamp(6)},{id:'second',created_at:stamp(5)}],{id:'mine',created_at:stamp(7)},stamp(1),2);
  expect(classifyInboxInsert(snapshot,'second',stamp(5))).toBe('known');
  expect(classifyInboxInsert(snapshot,'third',stamp(5))).toBe('check');
  expect(classifyInboxInsert(snapshot,'earlier',stamp(1))).toBe('read');
  expect(classifyInboxInsert(snapshot,'new-at-same-latest-time',stamp(7))).toBe('new');
});
it('bounds remembered identities without guessing when an evicted message is redelivered',()=>{
  let e=messageEvidence([],undefined,undefined,20);
  for(let i=0;i<80;i++) e=withInboxDelivery(e,'live-'+i,stamp(i),stamp(i-1))!;
  expect(e.ids).toHaveLength(64);
  expect(classifyInboxInsert(e,'live-0',stamp(0))).toBe('check');
  expect(classifyInboxInsert(e,'live-79',stamp(79))).toBe('known');
  expect(classifyInboxInsert(e,'later',stamp(80))).toBe('new');
});
