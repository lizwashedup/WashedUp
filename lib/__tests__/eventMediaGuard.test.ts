import {createPageEventMediaGuard} from '../eventMediaGuard';
const mockRead=jest.fn();
jest.mock('../creatorPageEventSave',()=>({getPageEventSaveState:(...a:unknown[])=>mockRead(...a)}));
jest.mock('../creatorPageReview',()=>({CreatorPageScopeExpired:class extends Error{}}));
let current=true,writable=true;const scope={userId:'member',isCurrent:()=>current};
beforeEach(()=>{current=true;writable=true;mockRead.mockReset().mockResolvedValue({status:'Draft'});});
it('uses exact page/event backend access without requiring ticket authority',async()=>{const guard=createPageEventMediaGuard('page','event',scope,()=>writable);await guard.check();expect(mockRead).toHaveBeenCalledWith('page','event',scope);});
it('does not read or proceed from a retired visit',async()=>{current=false;await expect(createPageEventMediaGuard('page','event',scope,()=>writable).check()).rejects.toThrow();expect(mockRead).not.toHaveBeenCalled();});
it('rejects permission loss reported by the backend',async()=>{mockRead.mockRejectedValue(Error('Revoked'));await expect(createPageEventMediaGuard('page','event',scope,()=>writable).check()).rejects.toThrow('Revoked');});
it('checks current visit again when permission read completes',async()=>{mockRead.mockImplementation(async()=>{current=false;return{status:'Draft'};});await expect(createPageEventMediaGuard('page','event',scope,()=>writable).check()).rejects.toThrow();});
it('blocks media during unresolved save or status work',async()=>{writable=false;await expect(createPageEventMediaGuard('page','event',scope,()=>writable).check()).rejects.toThrow('Check');expect(mockRead).not.toHaveBeenCalled();});
it('does not add media to a closed event',async()=>{mockRead.mockResolvedValue({status:'Cancelled'});await expect(createPageEventMediaGuard('page','event',scope,()=>writable).check()).rejects.toThrow('closed');});

it('waits for an ordinary in-flight autosave before checking media authority',async()=>{writable=false;const settle=jest.fn(async()=>{writable=true;});await createPageEventMediaGuard('page','event',scope,()=>writable,settle).check();expect(settle).toHaveBeenCalledTimes(1);expect(mockRead).toHaveBeenCalledTimes(1);});
it('does not resume after an unresolved autosave',async()=>{writable=false;await expect(createPageEventMediaGuard('page','event',scope,()=>writable,async()=>{}).check()).rejects.toThrow('Check');expect(mockRead).not.toHaveBeenCalled();});
