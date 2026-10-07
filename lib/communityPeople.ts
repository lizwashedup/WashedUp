import {supabase} from './supabase';
import {checkPublishedPageScope} from './publishedPageIdentity';
import type {PageImageScope} from './publishedPageCover';
export type CommunityPerson={id:string;name:string|null;photo:string|null;role?:'creator'|'co_creator'};
const uuid=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export async function readCommunityPeople(pageId:string,scope:PageImageScope,offset=0) {
 if(!uuid.test(pageId)||!Number.isSafeInteger(offset)||offset<0)throw Error('Members unavailable.');
 await checkPublishedPageScope(scope);
 const members=await supabase.from('community_members').select('user_id').eq('community_id',pageId).eq('status','active').order('user_id').range(offset,offset+29);
 await checkPublishedPageScope(scope);if(members.error)throw members.error;
 const ids=(members.data??[]).map(m=>m.user_id);
 if(!ids.length)return {people:[] as CommunityPerson[],next:undefined as number|undefined};
 const profiles=await supabase.from('profiles_public').select('id,first_name_display,profile_photo_url').in('id',ids);
 await checkPublishedPageScope(scope);if(profiles.error)throw profiles.error;
 const map=new Map((profiles.data??[]).map(p=>[p.id,p]));
 return {people:ids.flatMap(id=>{const p=map.get(id);return p?[{id:p.id,name:p.first_name_display??null,photo:p.profile_photo_url??null}]:[];}),next:ids.length===30?offset+30:undefined};
}
export async function readCommunityCreators(pageId:string,scope:PageImageScope):Promise<CommunityPerson[]> {
 if(!uuid.test(pageId))throw Error('Creators unavailable.');
 await checkPublishedPageScope(scope);
 const {data,error}=await supabase.rpc('get_creator_page_public_team',{p_page_id:pageId});
 await checkPublishedPageScope(scope);if(error)throw error;
 if(!Array.isArray(data)||data.some(p=>!uuid.test(p.id)||!['creator','co_creator'].includes(p.role)||(p.name!==null&&typeof p.name!=='string')||(p.photo!==null&&typeof p.photo!=='string')))throw Error('Creators could not be checked.');
 return data;
}
