import type {CreatorPageScope} from './creatorPageReview';
import {CreatorPageScopeExpired} from './creatorPageReview';
import {getPageEventSaveState} from './creatorPageEventSave';

/** Optional guard for the existing media routines; authority is checked by the backend. */
export interface EventMediaGuard {
  assertCurrent(): void;
  check(): Promise<void>;
}
export function createPageEventMediaGuard(pageId:string,eventId:string,scope:CreatorPageScope,canWrite:()=>boolean,settleSave?:()=>Promise<unknown>):EventMediaGuard {
  const assertCurrent=()=>{
    if(!scope.isCurrent()) throw new CreatorPageScopeExpired();
    if(!canWrite()) throw new Error('Check the saved event before adding media.');
  };
  return {assertCurrent,async check(){
    if(!scope.isCurrent()) throw new CreatorPageScopeExpired();
    await settleSave?.();
    assertCurrent();
    const saved=await getPageEventSaveState(pageId,eventId,scope);
    assertCurrent();
    if(saved.status!=='Draft'&&saved.status!=='Live') throw new Error('This event is closed.');
  }};
}
