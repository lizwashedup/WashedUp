const mockAuth=jest.fn(),mockFrom=jest.fn();
jest.mock('../supabase',()=>({supabase:{auth:{getUser:(...args:any[])=>mockAuth(...args)},from:(...args:any[])=>mockFrom(...args)}}));
import {fetchMyGrants} from '../operatorApplications';
beforeEach(()=>{jest.clearAllMocks();});
it('rejects an explicit different account before reading application rows',async()=>{
 mockAuth.mockResolvedValue({data:{user:{id:'other'}},error:null});await expect(fetchMyGrants('cedar')).rejects.toThrow('Application account changed');expect(mockFrom).not.toHaveBeenCalled();
});
it('reports auth failure instead of inventing an empty application list',async()=>{
 mockAuth.mockResolvedValue({data:{user:null},error:Error('offline')});await expect(fetchMyGrants('cedar')).rejects.toThrow('offline');expect(mockFrom).not.toHaveBeenCalled();
});
it('reads only the verified current applicant and keeps existing React Query context callers compatible',async()=>{
 mockAuth.mockResolvedValue({data:{user:{id:'cedar'}},error:null});const eq=jest.fn().mockResolvedValue({data:[{id:'grant'}],error:null});mockFrom.mockReturnValue({select:()=>({eq})});await expect(fetchMyGrants('cedar')).resolves.toEqual([{id:'grant'}]);await fetchMyGrants({queryKey:['my-operator-grants']});expect(eq.mock.calls).toEqual([['user_id','cedar'],['user_id','cedar']]);
});
