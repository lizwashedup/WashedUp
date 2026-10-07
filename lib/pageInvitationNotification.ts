import { supabase } from './supabase';
import { requestWithDeadline } from './requestWithDeadline';
import type { PageImageScope } from './publishedPageCover';
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const isId=(v:unknown):v is string=>typeof v==='string'&&uuid.test(v);
export class PageInvitationIdentityError extends Error {
 constructor(message:string) {super(message);this.name='PageInvitationIdentityError';}
}
const current=(scope:PageImageScope)=>{
 if(!scope.isCurrent()) throw new PageInvitationIdentityError('This invitation is no longer open.');
};
async function authorization(scope:PageImageScope) {
 current(scope);
 let result;
 try {result=await requestWithDeadline(supabase.auth.getSession(),12_000);}
 catch {throw new PageInvitationIdentityError('Couldn’t check your account. Try again.');}
 current(scope);
 const session=result.data.session;
 if(result.error||!scope.userId||session?.user.id!==scope.userId||!session.access_token)
  throw new PageInvitationIdentityError('Sign in to review this invitation.');
 return `Bearer ${session.access_token}`;
}
export function pageInvitationRoute(target:{pageId:string;invitationId:string}) {
 if(!isId(target.pageId)||!isId(target.invitationId)) throw Error('This invitation address is invalid.');
 return `/creator/page-team?id=${target.pageId}&invitationId=${target.invitationId}`;
}
export function pageInvitationPushRoute(data:Record<string,unknown>, enabled:boolean):string|null {
 if(data.type!=='page_team_invitation') return null;
 if(!enabled||!isId(data.creatorPageId)||!isId(data.pageInvitationId)) return '/(tabs)/friends';
 return pageInvitationRoute({pageId:data.creatorPageId,invitationId:data.pageInvitationId});
}
export async function loadPageInvitationTarget(id:string,scope:PageImageScope) {
 if(!isId(id)||!scope.userId) throw Error('Sign in to review this invitation.');
 const token=await authorization(scope);
 const {data,error}=await requestWithDeadline(supabase.from('page_team_invitation_notifications')
  .select('notification_id,page_id,invitation_id,user_id').eq('notification_id',id).eq('user_id',scope.userId)
  .setHeader('Authorization',token).maybeSingle(),12_000);
 await authorization(scope);
 if(error) throw Error('Couldn’t check this invitation. Try again.');
 if(!data) return null;
 if(data.notification_id!==id||data.user_id!==scope.userId||!isId(data.page_id)||!isId(data.invitation_id)) throw Error('This invitation could not be confirmed.');
 return {pageId:data.page_id,invitationId:data.invitation_id};
}
/** Read status is optional, but account/visit ownership is never optional. */
export async function markPageInvitationRead(id:string,scope:PageImageScope) {
 if(!isId(id)||!scope.userId) throw new PageInvitationIdentityError('Sign in to review this invitation.');
 const token=await authorization(scope);
 const result=await requestWithDeadline(supabase.from('app_notifications').update({status:'read'})
  .eq('id',id).eq('user_id',scope.userId).select('id').setHeader('Authorization',token).maybeSingle(),12_000).catch(()=>null);
 await authorization(scope);
 if(!result||result.error||result.data?.id!==id) throw Error('Couldn’t mark this invitation as read.');
}
