import { DraftUnavailable, saveExistingPlanDraft } from '../memberPlanDraft';

const mockFrom = jest.fn();
jest.mock('../supabase', () => ({supabase:{from:() => mockFrom()}}));
const fields = {title:'Beach walk',status:'draft',start_time:'2040-09-15T03:00:00.123456Z',end_time:null,max_invites:5};
const row = {id:'draft-a',creator_user_id:'alice',...fields};
let write: any, read: any;
function request() {
  return {update:jest.fn().mockReturnThis(),select:jest.fn().mockReturnThis(),eq:jest.fn().mockReturnThis(),maybeSingle:jest.fn()};
}
const save = (current = () => true) => saveExistingPlanDraft('draft-a','alice',fields,current);
beforeEach(() => {
  mockFrom.mockReset(); write=request();read=request();
  mockFrom.mockReturnValueOnce(write).mockReturnValueOnce(read);
  write.maybeSingle.mockRejectedValue(Error('connection closed'));
  read.maybeSingle.mockResolvedValue({data:row,error:null});
});
it('confirms matching fields on the same owned draft after a lost response, with one write', async()=>{
  read.maybeSingle.mockResolvedValue({data:{...row,start_time:'2040-09-14T20:00:00.123456-07:00'},error:null});
  await save();
  expect(write.update).toHaveBeenCalledTimes(1);expect(read.update).not.toHaveBeenCalled();
  expect(read.eq.mock.calls).toEqual([['id','draft-a'],['creator_user_id','alice'],['status','draft']]);
});
it.each([{title:'Later edit'},{creator_user_id:'bob'},{id:'draft-b'},{status:'forming'},
  {start_time:'2040-09-15T03:00:00.123457Z'},{end_time:undefined}])('keeps the edits when the receipt differs: %p',async patch=>{
  read.maybeSingle.mockResolvedValue({data:{...row,...patch},error:null});
  await expect(save()).rejects.toThrow('connection closed');expect(read.update).not.toHaveBeenCalled();
});
it('keeps an unreadable save uncertain',async()=>{
  read.maybeSingle.mockResolvedValue({data:null,error:{message:'offline'}});
  await expect(save()).rejects.toThrow('connection closed');
});
it('keeps a late recovery read with the original account',async()=>{
  let current=true;read.maybeSingle.mockImplementation(async()=>{current=false;return {data:row,error:null};});
  await expect(save(()=>current)).rejects.toThrow('connection closed');
});
it('preserves an authoritative missing or departed draft',async()=>{
  write.maybeSingle.mockResolvedValue({data:null,error:null});await expect(save()).rejects.toBeInstanceOf(DraftUnavailable);
  expect(read.select).not.toHaveBeenCalled();
});
it('does not turn a server refusal into a matching save',async()=>{
  write.maybeSingle.mockResolvedValue({data:null,error:{code:'42501'}});await expect(save()).rejects.toMatchObject({code:'42501'});
  expect(read.select).not.toHaveBeenCalled();
});
