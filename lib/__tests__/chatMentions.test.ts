import { findMentionMembers, splitChatMentions } from '../chatMentions';
import { insertMentionAt, mentionQueryAt } from '../communityChatUi';

const members = [
  {id:'self',first_name:'Liz'}, {id:'1',first_name:'Anne-Marie'},
  {id:'2',first_name:'Mary Jane'}, {id:'3',first_name:'Élodie'},
  {id:'4',first_name:'D’Arcy'}, {id:'5',first_name:null},
];

it('searches only supplied members, including compound names and accent-insensitive queries',()=>{
  expect(findMentionMembers(members,null,'self')).toEqual([]);
  expect(findMentionMembers(members,'','self').map(m=>m.id)).toEqual(['1','2','3','4']);
  for(const [query,id] of [['anne-m','1'],['jane','2'],['elo','3'],['d’a','4']]){
    expect(findMentionMembers(members,query,'self').map(m=>m.id)).toEqual([id]);
  }
  expect(findMentionMembers(members,'someone outside','self')).toEqual([]);
});

it.each(['Anne-M','D’Ar','O\'Ne','E\u0301lo'])('detects the complete partial name %s at the caret',name=>{
  expect(mentionQueryAt(`Hello @${name}`,7+name.length)).toBe(name);
});

it('inserts a compound name at the caret without eating the rest of the draft',()=>{
  const text='Hi @Anne-M see you there';
  const result=insertMentionAt(text,10,'Anne-Marie');
  expect(result).toEqual({text:'Hi @Anne-Marie see you there',caret:15});
  expect(insertMentionAt('@Mary',5,'Mary Jane')).toEqual({text:'@Mary Jane ',caret:11});
});

it('replaces the entire partial token when the caret is in its middle',()=>{
  expect(insertMentionAt('Hi @Anne tomorrow',6,'Anne-Marie')).toEqual({text:'Hi @Anne-Marie tomorrow',caret:15});
  expect(insertMentionAt('mail@Anne.test',7,'Anne-Marie')).toEqual({text:'mail@Anne.test',caret:7});
  expect(mentionQueryAt('(@Ann',5)).toBe('Ann');
});

it('highlights complete names and preserves punctuation, emails and unknown names',()=>{
  const names=new Set(['Anne','Anne-Marie','Mary Jane','D’Arcy','Élodie']);
  const text='@Anne-Marie, meet @Mary Jane and (@D’Arcy). @Élodie! @Anne-MarieX email@Anne.com @Nobody';
  const parts=splitChatMentions(text,names);
  expect(parts.map(p=>p.text).join('')).toBe(text);
  expect(parts.filter(p=>p.mention).map(p=>p.text)).toEqual(['@Anne-Marie','@Mary Jane','@D’Arcy','@Élodie']);
  expect(splitChatMentions(text,names)).toEqual(parts);
});

it('treats regex metacharacters in a member name literally',()=>{
  const parts=splitChatMentions('@A+B and @AAAB',new Set(['A+B']));
  expect(parts.filter(p=>p.mention).map(p=>p.text)).toEqual(['@A+B']);
});

it('does not truncate a large membership list or collapse duplicate first names',()=>{
  const many=Array.from({length:75},(_,i)=>({id:String(i),first_name:i<2?'Alex':`Member${i}`}));
  expect(findMentionMembers(many,'',null)).toHaveLength(75);
  expect(findMentionMembers(many,'Alex',null).map(m=>m.id)).toEqual(['0','1']);
});
