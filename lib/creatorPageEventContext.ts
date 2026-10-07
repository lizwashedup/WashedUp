/** Minimal editor context: never an owner application or review record. */
import type {CreatorPageKind} from './creatorPageReview';
import type {CreatorPageWorkspace} from './creatorPageWorkspace';
import type {CreatorPageTeamWorkspace} from './creatorPageTeamWorkspace';
export interface CreatorPageEventContext {
  pageId:string; name:string; ownerId:string; kind:CreatorPageKind;
  isPublished:boolean; entry:'owner'|'team';
}
export function ownerPageEventContext(page:CreatorPageWorkspace):CreatorPageEventContext {
  return {pageId:page.draft.id,name:String(page.draft.page_data.name||'Your page'),ownerId:page.draft.owner_id,
    kind:page.draft.page_kind,isPublished:!!page.publication,entry:'owner'};
}
export function teamPageEventContext(page:CreatorPageTeamWorkspace):CreatorPageEventContext {
  return {pageId:page.pageId,name:page.name,ownerId:page.ownerId,kind:page.kind,isPublished:true,entry:'team'};
}
