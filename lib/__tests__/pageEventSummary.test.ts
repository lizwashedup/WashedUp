import {getPageEventSummaryAccess} from '../pageEventSummary';
const mockWorkspace=jest.fn(),mockTickets=jest.fn();
jest.mock('../creatorPageEventReuseEntry',()=>({getPageEventReuseWorkspace:(...a:unknown[])=>mockWorkspace(...a)}));
jest.mock('../creatorTicketRead',()=>({canReadCreatorTickets:(...a:unknown[])=>mockTickets(...a)}));
let current=true;const scope={userId:'viewer',isCurrent:()=>current};
beforeEach(()=>{jest.clearAllMocks();current=true;mockWorkspace.mockReset().mockResolvedValue({entry:'owner',events:[{id:'event'}]});mockTickets.mockReset().mockResolvedValue(true);});
it('uses the exact page workspace and event-specific financial authority',async()=>{
 expect(await getPageEventSummaryAccess('page','event',scope)).toEqual({pageId:'page',entry:'owner',events:true,audience:true,finance:true});
 expect(mockWorkspace).toHaveBeenCalledWith('page',scope);expect(mockTickets).toHaveBeenCalledWith('event',scope);
});
it('keeps editing but withholds buyer tools from a content-only teammate',async()=>{
 mockWorkspace.mockResolvedValue({entry:'team',events:[{id:'event'}]});mockTickets.mockResolvedValue(false);
 expect(await getPageEventSummaryAccess('page','event',scope)).toEqual({pageId:'page',entry:'team',events:true,audience:false,finance:false});
});
it('refuses an event from another page without attempting financial reads',async()=>{
 await expect(getPageEventSummaryAccess('page','other',scope)).rejects.toThrow();expect(mockTickets).not.toHaveBeenCalled();
});
it('keeps denied or unavailable page access explicit',async()=>{
 mockWorkspace.mockRejectedValue(new Error('revoked'));await expect(getPageEventSummaryAccess('page','event',scope)).rejects.toThrow('revoked');expect(mockTickets).not.toHaveBeenCalled();
});
it('does not call an unknown financial result a confirmed refusal',async()=>{
 mockTickets.mockRejectedValue(new Error('offline'));await expect(getPageEventSummaryAccess('page','event',scope)).rejects.toThrow('offline');
});
it('rejects late results after the initiating visit ends',async()=>{
 mockTickets.mockImplementation(async()=>{current=false;return true;});await expect(getPageEventSummaryAccess('page','event',scope)).rejects.toThrow();
});
