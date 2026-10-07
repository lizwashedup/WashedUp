import { addChatMentionReference, readChatMentionDocument, rebaseChatMentions, splitIdentityMentions, type ChatMentionDocument } from '../chatMentionIdentity';
const alex1='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', alex2='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const tag=(text:string,id=alex1,label='Alex',start=text.indexOf('@'))=>addChatMentionReference(text,null,id,label,start);

it('keeps two identical labels linked to the two explicitly selected people',()=>{
  const text='@Alex and @Alex';
  const document=addChatMentionReference(text,tag(text),alex2,'Alex',10);
  expect(splitIdentityMentions(text,document)).toEqual([{text:'@Alex',userId:alex1},{text:' and '},{text:'@Alex',userId:alex2}]);
});
it('uses code-point offsets across emoji and leaves the exact visible text intact',()=>{
  const text='🌅 Hi @Mary Jane, see you!';
  const document=tag(text,alex1,'Mary Jane');
  expect(document.references[0]).toMatchObject({start:5,end:15});
  expect(splitIdentityMentions(text,document).map(s=>s.text).join('')).toBe(text);
  expect(()=>addChatMentionReference('🌅@Alex',null,alex1,'Alex',1)).toThrow();
});
it('retains identity and original label without looking up a person’s new name',()=>{
  const document=tag('@Alex hello');
  expect(readChatMentionDocument(document.text,document)?.references[0].userId).toBe(alex1);
});
it.each([
  {version:2}, {text:'Different body'}, {references:[{userId:'not-a-user',label:'Alex',start:0,end:5}]},
  {references:[{userId:alex1,label:'Alex',start:-1,end:5}]},
  {references:[{userId:alex1,label:'Alex',start:0,end:4}]},
  {references:[{userId:alex1,label:'Jamie',start:0,end:5}]},
])('renders malformed or stale metadata as plain text: %p',patch=>{
  const text='@Alex hello', document={...tag(text),...patch};
  expect(readChatMentionDocument(text,document)).toBeNull();
  expect(splitIdentityMentions(text,document)).toEqual([{text}]);
});
it('rejects overlapping ranges, email fragments and URLs',()=>{
  const document=tag('@Alex hello');
  expect(readChatMentionDocument(document.text,{...document,references:[...document.references,...document.references]})).toBeNull();
  for(const text of ['email@Alex.test','https://example.test/(@Alex)','@Alexandra'])expect(()=>tag(text)).toThrow();
});
it('moves untouched ranges when text is inserted before the mention',()=>{
  const before=tag('Hi @Alex');
  const next=rebaseChatMentions(before,'🌅 Hi @Alex');
  expect(next.references).toEqual([{userId:alex1,label:'Alex',start:5,end:10}]);
  expect(rebaseChatMentions(next,'🌅 Hi @Alex!').references).toEqual(next.references);
});
it('drops identity when the tagged text itself is edited or extended',()=>{
  const document=tag('@Alex hello');
  expect(rebaseChatMentions(document,'@Alexandra hello').references).toEqual([]);
  expect(rebaseChatMentions(document,'@Al hello').references).toEqual([]);
  expect(rebaseChatMentions(document,'Hello').references).toEqual([]);
});
it('never guesses which identical-name identity survived an ambiguous deletion',()=>{
  const text='@Alex @Alex';
  const document=addChatMentionReference(text,tag(text),alex2,'Alex',6);
  expect(rebaseChatMentions(document,'@Alex').references).toEqual([]);
});
it('does not mutate stored snapshots while rebasing or changing an explicit selection',()=>{
  const original=tag('@Alex hello');const snapshot=JSON.stringify(original);
  const next=addChatMentionReference(original.text,original,alex2,'Alex',0);
  expect(next.references[0].userId).toBe(alex2);expect(JSON.stringify(original)).toBe(snapshot);
});
