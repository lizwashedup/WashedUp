import { supabase } from '../supabase';
import { getEventTopicId } from '../communityChat';
jest.mock('../supabase',()=>({supabase:{from:jest.fn()}}));
const read=jest.fn(),eq=jest.fn();
beforeEach(()=>{jest.clearAllMocks();eq.mockReturnValue({maybeSingle:read});jest.mocked(supabase.from).mockReturnValue({select:()=>({eq})} as any);});
it('distinguishes a failed lookup from a confirmed absent event chat for strict callers',async()=>{
 read.mockResolvedValue({data:null,error:Error('offline')});await expect(getEventTopicId('event',true)).rejects.toThrow('offline');
 read.mockResolvedValue({data:null,error:null});await expect(getEventTopicId('event',true)).resolves.toBeNull();
});
it('preserves the existing event-specific query and legacy failure behavior',async()=>{
 read.mockResolvedValue({data:{id:'room'},error:null});await expect(getEventTopicId('event',true)).resolves.toBe('room');expect(eq).toHaveBeenCalledWith('explore_event_id','event');
 read.mockResolvedValue({data:null,error:Error('offline')});await expect(getEventTopicId('event')).resolves.toBeNull();
});
