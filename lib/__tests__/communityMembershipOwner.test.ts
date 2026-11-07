import { getMyMembership } from '../communityJoin';
const mockUser = jest.fn(), mockFrom = jest.fn();
jest.mock('../supabase', () => ({supabase:{auth:{getUser:(...args:any[])=>mockUser(...args)},from:(...args:any[])=>mockFrom(...args)}}));
beforeEach(()=>{mockUser.mockReset().mockResolvedValue({data:{user:{id:'alice'}}});mockFrom.mockReset();});
it.each(['bob',null])('does not read another account after auth resolves to %s',async id=>{
 mockUser.mockResolvedValue({data:{user:id?{id}:null}});
 await expect(getMyMembership('room','alice')).rejects.toThrow('account changed');
 expect(mockFrom).not.toHaveBeenCalled();
});
it('preserves the unscoped signed-out null contract',async()=>{
 mockUser.mockResolvedValue({data:{user:null}});await expect(getMyMembership('room')).resolves.toBeNull();expect(mockFrom).not.toHaveBeenCalled();
});
it.each([{id:'membership',status:'removed',role:'member'},null])('returns the exact own read without treating absence as removal',async data=>{
 const chain:any={select:jest.fn(()=>chain),eq:jest.fn(()=>chain),maybeSingle:jest.fn().mockResolvedValue({data,error:null})};mockFrom.mockReturnValue(chain);
 await expect(getMyMembership('room','alice')).resolves.toEqual(data);
 expect(chain.eq.mock.calls).toEqual([['community_id','room'],['user_id','alice']]);
});
it('preserves a failed read as an error',async()=>{
 const error=new Error('offline');const chain:any={select:()=>chain,eq:()=>chain,maybeSingle:async()=>({data:null,error})};mockFrom.mockReturnValue(chain);
 await expect(getMyMembership('room','alice')).rejects.toBe(error);
});
