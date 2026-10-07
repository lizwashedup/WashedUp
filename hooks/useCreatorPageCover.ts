import type {CreatorPageScope} from '../lib/creatorPageReview';
import type {EventMediaGuard} from '../lib/eventMediaGuard';
import {useCreatorPageMediaUpload} from './useCreatorPageMediaUpload';
/** Keep the existing cover interface on the shared original-upload recovery. */
export function useCreatorPageCover(pageId:string|undefined,eventId:string|undefined,scope:CreatorPageScope|undefined,guard:EventMediaGuard|undefined,
 onReady:(reference:string)=>void,onDiscard:(reference:string)=>void,savedReference:string|undefined){
 return useCreatorPageMediaUpload(pageId,eventId,scope,guard,onReady,onDiscard,savedReference?[savedReference]:[],'cover');
}
