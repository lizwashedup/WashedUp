import { communityJoinPushRoute } from '../../lib/communityJoinNotification';
import { memberReactionPushRoute } from '../../lib/memberReactionPushRoute';
import { communityChatPushRoute } from '../../lib/communityChatPushRoute';
import { pageInvitationPushRoute } from '../../lib/pageInvitationNotification';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
jest.mock('../../lib/supabase',()=>({supabase:{}}));
import {attendeeMessagePushRoute} from '../../lib/attendeeMessageNotification';
import {organizationPageUpdatePushRoute} from '../../lib/organizationPageUpdate';
// Execute the actual root click-handler body with navigation captured. This
// proves branch continuity, not SDK registration or cold-start/auth lifecycle.
const source=fs.readFileSync(path.join(__dirname,'../_layout.tsx'),'utf8');
const start=source.indexOf('    const onClick = (event: any) => {');
const end=source.indexOf('\n    let cancelled = false;',start);
if(start<0||end<0)throw Error('Root click handler boundary changed');
const code=ts.transpileModule(source.slice(start,end)+'\nglobalThis.handler=onClick;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function click(data:any,enabled=true){const push=jest.fn();const context:any={safePush:push,communityJoinPushRoute,attendeeMessagePushRoute,organizationPageUpdatePushRoute,communityChatPushRoute,pageInvitationPushRoute,memberReactionPushRoute,CREATOR_PAGES_ENABLED:enabled,COMMUNITIES_ENABLED:true,YOURS_PAGE_ENABLED:true,COMMUNITY_CHAT_GROUPING_ENABLED:false};vm.runInNewContext(code,context);context.handler({notification:{additionalData:data}});return push;}
const page='22222222-2222-4222-8222-222222222222',update='33333333-3333-4333-8333-333333333333';
it('root click opens exact organization/update before an unrelated chat fallback',()=>{const push=click({type:'creator_page_update',creatorPageId:page,creatorPageBroadcastId:update,eventId:'wrong-chat'});expect(push).toHaveBeenCalledWith(`/organization/${page}?identity=page&update=${update}`);expect(push).toHaveBeenCalledTimes(1);});
it('unknown or gated page targets recover to Scene',()=>{expect(click({type:'creator_page_update',eventId:'wrong-chat'})).toHaveBeenCalledWith('/(tabs)/explore');expect(click({type:'creator_page_update',creatorPageId:page,creatorPageBroadcastId:update},false)).toHaveBeenCalledWith('/(tabs)/explore');});
it.each([
 [{type:'new_message',eventId:'plan'},'/(tabs)/chats/plan'],
 [{type:'new_message',circleId:'circle'},'/(tabs)/chats/circle/circle'],
 [{type:'new_message',topicId:'22222222-2222-4222-8222-222222222222'},'/community-topic/22222222-2222-4222-8222-222222222222'],
 [{type:'plan_invite',eventId:'plan'},'/plan/plan'],
 [{type:'broadcast'},'/(tabs)/chats'],
])('preserves the existing notification destination for %p',(data,route)=>{expect(click(data)).toHaveBeenCalledWith(route);});

it('Scene attendee updates open their own event and cannot use a supplied Plan fallback',()=>{expect(click({type:'attendee_message',exploreEventId:page,eventId:'wrong-plan'})).toHaveBeenCalledWith(`/event/${page}`);expect(click({type:'attendee_message',exploreEventId:'../../chat',eventId:'wrong-plan'})).toHaveBeenCalledWith('/(tabs)/explore');});

it('the actual push handler preserves the notice needed to read full update text',()=>{expect(click({type:'attendee_message',exploreEventId:page,notificationId:update})).toHaveBeenCalledWith(`/event/${page}?notificationId=${update}`);});

const notice='44444444-4444-4444-8444-444444444444',member='55555555-5555-4555-8555-555555555555';
it.each([page,update])('opens the exact page requests from a mapped joining push for %s',id=>{
 expect(click({type:'community_join_request',notificationId:notice,creatorPageId:id,communityMemberId:member})).toHaveBeenCalledWith(`/creator/page-requests?id=${id}`);
});
it.each(['community_join_approved','community_join_declined'])('opens the exact community for %s',type=>{
 expect(click({type,notificationId:notice,creatorPageId:page,communityMemberId:member,eventId:'wrong-plan'})).toHaveBeenCalledWith(`/community/${page}`);
});
it.each([{creatorPageId:'../../wrong',communityMemberId:member},{creatorPageId:page},{communityMemberId:member},{creatorPageId:page,communityMemberId:member,notificationId:'bad'}])('keeps malformed mapped request sources out of the legacy/current-community route: %p',fields=>{
 expect(click({type:'community_join_request',notificationId:notice,...fields})).toHaveBeenCalledWith('/(tabs)/friends');
});
it('preserves unmapped legacy behavior and feature-gated safety',()=>{
 expect(click({type:'community_join_request'})).toHaveBeenCalledWith('/(creator)/members');
 expect(click({type:'community_join_approved'})).toHaveBeenCalledWith('/(tabs)/chats');
 expect(click({type:'community_join_request',notificationId:notice,creatorPageId:page,communityMemberId:member},false)).toHaveBeenCalledWith('/(tabs)/friends');
});
it.each(['people_request_accepted','referral_joined'])('chooses People explicitly for %s regardless of the retained Yours tab',type=>{
 expect(click({type})).toHaveBeenCalledWith('/(tabs)/friends?tab=people');
});
