/** Persist categories as a list; the original primary category remains compatible with older clients. */
export const EVENT_CATEGORIES = ['music','comedy','nightlife','food and drink','art','fitness','outdoors','community','film','markets','gaming','business & networking','just for fun','other'];
export function eventCategories(value: { category?: string | null; categories?: string[] | null; community_id?: string | null }, community = !!value.community_id): string[] {
 const raw=value.categories?.length?value.categories:value.category?[value.category]:[];
 const values=Array.from(new Set(raw.map(v=>v.toLowerCase().trim()).filter(Boolean)));
 return community ? ['community',...values.filter(v=>v!=='community')].slice(0,2) : values;
}
export function toggleEventCategory(values: string[], value: string, community: boolean): string[] {
 const selected=eventCategories({categories:values},community);
 if(community&&value==='community')return selected;
 if(selected.includes(value))return selected.filter(v=>v!==value);
 return selected.length<2?[...selected,value]:selected;
}
export function eventMatchesCategory(event: { category?: string | null; categories?: string[] | null; community_id?: string | null }, filter: string): boolean {
 return eventCategories(event).some(c=>c===filter||c==='fitness and outdoors'&&(filter==='fitness'||filter==='outdoors'));
}
export function validEventCategories(values: unknown): values is string[] {
 return Array.isArray(values)&&values.length>=1&&values.length<=2&&new Set(values).size===values.length&&values.every(v=>typeof v==='string'&&v.trim().length>0&&v.length<=80);
}
