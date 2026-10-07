import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveCommunityChatPushTargets,communityChatPushData} from '../_shared/communityChatPushTargets.ts';
import {communityChatPushRoute} from '../../../lib/communityChatPushRoute.ts';
const id=n=>`11111111-1111-4111-8111-${String(n).padStart(12,'0')}`;
const notice={id:id(1),user_id:id(2),type:'community_broadcast',topic_id:null};
const target={notification_id:id(1),user_id:id(2),source_kind:'broadcast',community_id:id(3),topic_id:null,broadcast_id:id(4),eligible:true,message_id:id(4),message_source:'broadcast',destination_topic_id:null};
for(const kind of ['main','legacy-intro','topic'])test(`author reaction resolves through the existing ${kind} route`,async()=>{
 const n=kind==='topic'?{...notice,type:'new_message',topic_id:id(5)}:notice;
 const row=kind==='topic'?{...target,source_kind:'topic',topic_id:id(5),broadcast_id:null,message_id:id(6),message_source:'topic',destination_topic_id:id(5)}:{...target,destination_topic_id:kind==='legacy-intro'?id(5):null};
 const db={rpc:async(name,args)=>{assert.equal(name,'get_community_chat_push_targets_v2');assert.deepEqual(args,{p_notification_ids:[n.id]});return{data:[row],error:null};}};
 const found=(await resolveCommunityChatPushTargets(db,[n])).get(n.id);const data=communityChatPushData(found);
 const expected=kind==='main'?`/community-thread/${id(3)}`:`/community-topic/${id(5)}`;
 assert.equal(communityChatPushRoute(data,true),expected+`?reactionMessageId=${row.message_id}&reactionMessageSource=${row.message_source}`);
 assert.equal(data.notificationId,n.id);assert.equal(communityChatPushRoute(data,false),kind==='main'?'/(tabs)/chats':expected+`?reactionMessageId=${row.message_id}&reactionMessageSource=${row.message_source}`);
});
for(const [label,change] of Object.entries({foreignMessage:{message_id:id(9)},wrongSource:{message_source:'topic'},badRoom:{destination_topic_id:'../other'},missingSource:{message_source:null},missingMessage:{message_id:null}}))test(`invalid ${label} cannot become a provider target`,async()=>{
 await assert.rejects(resolveCommunityChatPushTargets({rpc:async()=>({data:[{...target,...change}]})},[notice]),/source did not match/);
});
test('topic reactions cannot name a different destination room',async()=>{
 const n={...notice,type:'new_message',topic_id:id(5)};
 await assert.rejects(resolveCommunityChatPushTargets({rpc:async()=>({data:[{...target,source_kind:'topic',topic_id:id(5),broadcast_id:null,message_source:'topic',destination_topic_id:id(9)}]})},[n]),/source did not match/);
});
test('ordinary and legacy notifications preserve their route semantics',()=>{
 assert.equal(communityChatPushRoute({type:'community_broadcast',communityId:id(3),communityBroadcastId:id(4)},true),`/community-thread/${id(3)}`);
 assert.equal(communityChatPushRoute({type:'new_message',topicId:id(5)},true),`/community-topic/${id(5)}`);
 assert.equal(communityChatPushRoute({type:'new_message',topicId:id(5)},false),`/community-topic/${id(5)}`);
 assert.equal(communityChatPushRoute({type:'community_broadcast'},true),'/(tabs)/chats');
 assert.equal(communityChatPushRoute({type:'new_message',circleId:id(7)},true),null);
 assert.equal(communityChatPushRoute({type:'broadcast',eventId:id(7)},true),null);
});
test('invalid external notification addresses recover without another room fallback',()=>{
 for(const data of [{type:'community_broadcast',communityId:'../x',communityBroadcastId:id(4)},{type:'new_message',topicId:'../x'},{type:'new_message',topicId:id(5),reactionMessageId:id(6),reactionMessageSource:'broadcast'},{type:'community_broadcast',communityId:id(3),communityBroadcastId:id(4),notificationId:'../other'}])assert.equal(communityChatPushRoute(data,true),'/(tabs)/chats');
});
