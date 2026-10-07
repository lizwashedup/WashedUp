import Colors from '../../../constants/Colors.ts';
import { FontSizes } from '../../../constants/Typography.ts';
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
type Delivery = {decision:'deliver';email:string;invitationId:string;pageId:string;userId:string;idempotencyKey:string};
type Decision = Delivery | {decision:'pause';reason:string} | {decision:'cancel';reason:string};
export function parsePageInvitationDispatch(raw:unknown, invitationId:string, userId:string): Decision | null {
 if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
 const v=raw as Record<string,unknown>;
 if ((v.decision==='pause'||v.decision==='cancel')&&typeof v.reason==='string') return {decision:v.decision,reason:v.reason.slice(0,100)};
 if(v.decision!=='deliver'||!uuid.test(invitationId)||!uuid.test(userId)||v.invitationId!==invitationId||v.userId!==userId
 ||typeof v.pageId!=='string'||!uuid.test(v.pageId)||typeof v.email!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)
 ||v.idempotencyKey!==`page-invitation/${invitationId}/${userId}`) return null;
 return v as Delivery;
}
export function renderPageInvitationEmail(value:Delivery) {
 // The existing private invitation review requires sign-in as the intended recipient.
 // Existing authenticated web review; no token, private message or page metadata in the email.
 const url=`https://washedup.app/app/pages/${value.pageId}/team?invitationId=${value.invitationId}`;
 const text='Someone invited you to help with their page. Open WashedUp to review the invitation and decide whether to accept. Invitations expire after 72 hours.';
 return {subject:'You have a page invitation on WashedUp',text:`${text}\n\nReview invitation: ${url}\n\nYou can also find it in Creator space → Page invitations.`,
 html:`<!doctype html><html><body style="background:${Colors.parchment};color:${Colors.asphalt};font-family:sans-serif;font-size:${FontSizes.bodyLG}px;padding:24px"><p style="color:${Colors.terracotta}">washedup</p><h1>You’re invited</h1><p>${text}</p><p><a href="${url.replaceAll('&','&amp;')}" style="color:${Colors.terracotta}">Review invitation</a></p><p>You can also find it in Creator space → Page invitations.</p></body></html>`};
}
