const mockStorage=new Map<string,string>(),mockGet=jest.fn(),mockSet=jest.fn(),mockRemove=jest.fn(),mockOwn=jest.fn();
const mockListeners=new Set<(s:string)=>void>();let mockAppState='active';
jest.mock('@react-native-async-storage/async-storage',()=>({__esModule:true,default:{getItem:(...a:unknown[])=>mockGet(...a),setItem:(...a:unknown[])=>mockSet(...a),removeItem:(...a:unknown[])=>mockRemove(...a)}}));
jest.mock('expo-crypto',()=>({randomUUID:()=> '0fd00000-0000-4000-8000-000000000002'}));
jest.mock('react-native',()=>({AppState:{get currentState(){return mockAppState;},addEventListener:(_:string,fn:(s:string)=>void)=>{mockListeners.add(fn);return{remove:()=>mockListeners.delete(fn)};}}}));
jest.mock('../supabase',()=>({supabase:{auth:{getUser:async()=>({data:{user:{id:'0e6e1827-0f87-4e03-b42b-7ade8219725b'}},error:null})},from:()=>({select:()=>({eq:()=>({eq:()=>({maybeSingle:()=>mockOwn()})})})})}}));
jest.mock('../creatorPageReview',()=>({CreatorPageScopeExpired:class extends Error{},createCreatorPageEventDraft:jest.fn()}));
jest.mock('../creatorPageWorkspace',()=>({loadCreatorPageWorkspace:jest.fn()}));
jest.mock('../creatorPageTeamWorkspace',()=>({loadCreatorPageTeamWorkspace:jest.fn()}));
jest.mock('../creatorPageEventSave',()=>({getPageEventSaveAttempt:jest.fn(),getPageEventSaveState:jest.fn()}));
jest.mock('../creatorPageEventTemplate',()=>({getPageEventTemplate:jest.fn()}));
jest.mock('../creatorPageEventReuse',()=>({readPageEventReuse:jest.fn(),preparePageEventReuse:jest.fn(),startPageEventReuse:jest.fn(),acknowledgeKeptPageEventReuse:jest.fn()}));
import {preparePageEventReuseEntry,readPageEventReuseEntry,startPageEventReuseEntry,getPageEventReuseWorkspace,acknowledgePageEventReuseEntry} from '../creatorPageEventReuseEntry';
import {getPageEventTemplate} from '../creatorPageEventTemplate';
import {createCreatorPageEventDraft} from '../creatorPageReview';import {loadCreatorPageWorkspace} from '../creatorPageWorkspace';import {loadCreatorPageTeamWorkspace} from '../creatorPageTeamWorkspace';
import {getPageEventSaveAttempt,getPageEventSaveState} from '../creatorPageEventSave';import {readPageEventReuse,preparePageEventReuse,startPageEventReuse,acknowledgeKeptPageEventReuse} from '../creatorPageEventReuse';
const page='f5d7644a-2ff5-4def-b0ab-d04b8250892b',user='0e6e1827-0f87-4e03-b42b-7ade8219725b',sourceEvent='0fd00000-0000-4000-8000-000000000001',event='0fd00000-0000-4000-8000-000000000002',request='0fd00000-0000-4000-8000-000000000003';
const source={kind:'event' as const,pageId:page,eventId:sourceEvent},version='2026-09-15T01:00:00Z';let active=true,events:any[],whole:any,saved:any;
const scope={userId:user,isCurrent:()=>active},read=jest.mocked(getPageEventSaveState),receipt=jest.mocked(getPageEventSaveAttempt),create=jest.mocked(createCreatorPageEventDraft),prepare=jest.mocked(preparePageEventReuse),run=jest.mocked(startPageEventReuse),readWhole=jest.mocked(readPageEventReuse);
beforeEach(()=>{jest.resetAllMocks();jest.mocked(acknowledgeKeptPageEventReuse).mockImplementation(async()=>{whole=null;return true;});mockStorage.clear();active=true;mockAppState='active';mockListeners.clear();events=[];whole=null;saved=null;
 mockGet.mockImplementation(async k=>mockStorage.get(k)??null);mockSet.mockImplementation(async(k,v)=>{mockStorage.set(k,v);});mockRemove.mockImplementation(async k=>{mockStorage.delete(k);});mockOwn.mockResolvedValue({data:{id:page},error:null});
 jest.mocked(loadCreatorPageWorkspace).mockImplementation(async()=>({draft:{page_data:{name:'Page'}},events} as any));
 jest.mocked(loadCreatorPageTeamWorkspace).mockImplementation(async()=>({pageId:page,name:'Page',ownerId:'other',kind:'community',events}));
 read.mockResolvedValue({fields:{title:'Original story',category:'community'},updatedAt:version} as any);receipt.mockImplementation(async()=>saved);
 create.mockImplementation(async a=>{events.push({id:a.eventId,title:a.title});return a.eventId;});readWhole.mockImplementation(async()=>whole);
 prepare.mockImplementation(async()=>{whole={version:1,userId:user,pageId:page,eventId:event,requestId:request,source,sourceUpdatedAt:version};return{attempt:whole,created:true};});
 run.mockImplementation(()=>({cancel:jest.fn(),done:Promise.resolve({state:'saved',saved:{pageId:page,eventId:event,requestId:request,userId:user} as any,cleanupPending:false})}));
});
it('persists the exact selection before any destination creation',async()=>{const p=await preparePageEventReuseEntry(page,source,scope);expect(p.attempt.eventId).toBe(event);expect(p.attempt.sourceUpdatedAt).toBe(version);expect(create).not.toHaveBeenCalled();expect(run).not.toHaveBeenCalled();expect(mockStorage.size).toBe(1);});
it('a different selection cannot replace an unresolved original',async()=>{await preparePageEventReuseEntry(page,source,scope);const next=await preparePageEventReuseEntry(page,{...source,eventId:request},scope);expect(next.created).toBe(false);expect(next.attempt.source).toEqual(source);expect(read).toHaveBeenCalledTimes(1);});
it('lost local persistence acknowledgement preserves the same destination and sends no create',async()=>{mockSet.mockImplementationOnce(async(k,v)=>{mockStorage.set(k,v);throw Error('Lost ack');});await expect(preparePageEventReuseEntry(page,source,scope)).rejects.toThrow('Lost ack');expect(create).not.toHaveBeenCalled();expect((await readPageEventReuseEntry(page,scope))?.eventId).toBe(event);});
it('checking before creation performs no backend write',async()=>{await preparePageEventReuseEntry(page,source,scope);const result=await startPageEventReuseEntry(page,scope,'check').done;expect(result.stage).toBe('not-created');expect(create).not.toHaveBeenCalled();expect(prepare).not.toHaveBeenCalled();expect(run).not.toHaveBeenCalled();});
it('resume creates once then persists the whole-copy identity before transfer',async()=>{await preparePageEventReuseEntry(page,source,scope);run.mockImplementation(()=>{expect(JSON.parse([...mockStorage.values()][0]).requestId).toBe(request);return{cancel:jest.fn(),done:Promise.resolve({state:'saved',saved:{} as any,cleanupPending:false})};});const result=await startPageEventReuseEntry(page,scope,'retry').done;expect(result.stage).toBe('saved');expect(create).toHaveBeenCalledTimes(1);expect(prepare.mock.calls[0][4]).toBe(version);expect(mockStorage.size).toBe(1);});
it('lost committed draft-create response is checked and reused without another creation',async()=>{await preparePageEventReuseEntry(page,source,scope);const original=create.getMockImplementation()!;create.mockImplementationOnce(async(a,s)=>{await original(a,s);throw Error('Lost creation');});await expect(startPageEventReuseEntry(page,scope,'retry').done).rejects.toThrow('Lost creation');expect(prepare).not.toHaveBeenCalled();const check=await startPageEventReuseEntry(page,scope,'check').done;expect(check.stage).toBe('pending');await startPageEventReuseEntry(page,scope,'retry').done;expect(create).toHaveBeenCalledTimes(1);});
it('lost saved-copy identity acknowledgement cannot dispatch transfer; explicit resume adopts only the same whole attempt',async()=>{await preparePageEventReuseEntry(page,source,scope);mockSet.mockImplementationOnce(async(k,v)=>{mockStorage.set(k,v);throw Error('Lost copy identity');});await expect(startPageEventReuseEntry(page,scope,'retry').done).rejects.toThrow('Lost copy identity');expect(run).not.toHaveBeenCalled();await startPageEventReuseEntry(page,scope,'retry').done;expect(create).toHaveBeenCalledTimes(1);expect(prepare).toHaveBeenCalledTimes(1);expect(run).toHaveBeenCalledTimes(1);});
it('confirmed receipt survives restart before opening, even after whole-journal cleanup and source loss',async()=>{await preparePageEventReuseEntry(page,source,scope);const first=await startPageEventReuseEntry(page,scope,'retry').done;expect(first.stage).toBe('saved');whole=null;saved={pageId:page,eventId:event,requestId:request,userId:user};read.mockRejectedValue(Error('Source access lost'));const recovered=await startPageEventReuseEntry(page,scope,'check').done;expect(recovered.stage).toBe('saved');expect(mockStorage.size).toBe(1);expect(create).toHaveBeenCalledTimes(1);expect(run).toHaveBeenCalledTimes(1);expect(await acknowledgePageEventReuseEntry(recovered.attempt,scope)).toBe(true);expect(mockStorage.size).toBe(0);});
it('failed open acknowledgement preserves the confirmed destination pointer',async()=>{await preparePageEventReuseEntry(page,source,scope);const result=await startPageEventReuseEntry(page,scope,'retry').done;whole=null;saved={pageId:page,eventId:event,requestId:request,userId:user};mockRemove.mockRejectedValueOnce(Error('Disk busy'));expect(await acknowledgePageEventReuseEntry(result.attempt,scope)).toBe(false);expect(mockStorage.size).toBe(1);expect((await startPageEventReuseEntry(page,scope,'check').done).stage).toBe('saved');});
it('changed source is preserved for review before creating a new destination',async()=>{await preparePageEventReuseEntry(page,source,scope);read.mockResolvedValue({fields:{title:'Changed',category:'community'},updatedAt:'2026-09-15T02:00:00Z'} as any);await expect(startPageEventReuseEntry(page,scope,'retry').done).resolves.toMatchObject({stage:'conflict',conflict:'source'});expect(create).not.toHaveBeenCalled();expect(mockStorage.size).toBe(1);});
it('cancel while creation is pending prevents later copy dispatch and keeps the original ID',async()=>{await preparePageEventReuseEntry(page,source,scope);let finish!:(value:string)=>void;create.mockImplementation(()=>new Promise(r=>{finish=r;}));const task=startPageEventReuseEntry(page,scope,'retry'),pending=task.done.catch(e=>e);while(!finish)await Promise.resolve();task.cancel();finish(event);await pending;expect(prepare).not.toHaveBeenCalled();expect(run).not.toHaveBeenCalled();expect((await readPageEventReuseEntry(page,scope))?.eventId).toBe(event);});
it('a second active operation cannot overlap original creation or copy',async()=>{await preparePageEventReuseEntry(page,source,scope);let finish!:(value:string)=>void;create.mockImplementation(()=>new Promise(r=>{finish=r;}));const task=startPageEventReuseEntry(page,scope,'retry'),pending=task.done.catch(e=>e);expect(()=>startPageEventReuseEntry(page,scope,'retry')).toThrow('still finishing');while(!finish)await Promise.resolve();task.cancel();finish(event);await pending;});
it('teammate entry reads only its minimal workspace after a confirmed absence of own ownership',async()=>{mockOwn.mockResolvedValue({data:null,error:null});const pageView=await getPageEventReuseWorkspace(page,scope);expect(pageView.entry).toBe('team');expect(loadCreatorPageWorkspace).not.toHaveBeenCalled();expect(loadCreatorPageTeamWorkspace).toHaveBeenCalledWith(page,expect.objectContaining({userId:user,isCurrent:expect.any(Function)}));});
it('unknown ownership does not fall through to a different permission reader',async()=>{mockOwn.mockResolvedValue({data:null,error:Error('Offline')});await expect(getPageEventReuseWorkspace(page,scope)).rejects.toThrow('Offline');expect(loadCreatorPageWorkspace).not.toHaveBeenCalled();expect(loadCreatorPageTeamWorkspace).not.toHaveBeenCalled();});
it('backgrounding retires the operation before a pending create can begin copying',async()=>{await preparePageEventReuseEntry(page,source,scope);let finish!:(value:string)=>void;create.mockImplementation(()=>new Promise(r=>{finish=r;}));const task=startPageEventReuseEntry(page,scope,'retry'),pending=task.done.catch(e=>e);while(!finish)await Promise.resolve();mockAppState='background';mockListeners.forEach(fn=>fn('background'));finish(event);await pending;expect(run).not.toHaveBeenCalled();expect(mockListeners.size).toBe(0);});

it('Check identifies a changed initial source before any destination is created',async()=>{await preparePageEventReuseEntry(page,source,scope);read.mockResolvedValue({fields:{title:'New story',category:'community'},updatedAt:'2026-09-15T01:00:00.000001Z'} as any);await expect(startPageEventReuseEntry(page,scope,'check').done).resolves.toMatchObject({stage:'conflict',conflict:'source'});expect(create).not.toHaveBeenCalled();expect(run).not.toHaveBeenCalled();expect(mockRemove).not.toHaveBeenCalled();});
it.each(['source','destination'])('existing complete coordinator supplies %s conflict to entry',async reason=>{await preparePageEventReuseEntry(page,source,scope);await startPageEventReuseEntry(page,scope,'retry').done;run.mockReturnValueOnce({cancel:jest.fn(),done:Promise.resolve({state:'conflict',reason,attempt:whole} as any)});await expect(startPageEventReuseEntry(page,scope,'check').done).resolves.toMatchObject({stage:'conflict',conflict:reason});expect(create).toHaveBeenCalledTimes(1);expect(mockStorage.size).toBe(1);});
it('whole-copy recovery gets first chance at a committed receipt despite source loss',async()=>{await preparePageEventReuseEntry(page,source,scope);await startPageEventReuseEntry(page,scope,'retry').done;read.mockRejectedValue(Error('Source lost'));await expect(startPageEventReuseEntry(page,scope,'check').done).resolves.toMatchObject({stage:'saved'});expect(run).toHaveBeenCalledTimes(2);});
it('a whole attempt differing by a microsecond cannot be adopted',async()=>{await preparePageEventReuseEntry(page,source,scope);await startPageEventReuseEntry(page,scope,'retry').done;whole.sourceUpdatedAt='2026-09-15T01:00:00.000001Z';await expect(startPageEventReuseEntry(page,scope,'check').done).rejects.toThrow('different');expect(mockRemove).not.toHaveBeenCalled();});

it('Keep before confirmed creation recovers one original empty draft and never starts copying',async()=>{await preparePageEventReuseEntry(page,source,scope);const kept=await startPageEventReuseEntry(page,scope,'keep').done;expect(kept.stage).toBe('kept');expect(kept.attempt.kept).toBe(true);expect(create).toHaveBeenCalledTimes(1);expect(prepare).not.toHaveBeenCalled();expect(run).not.toHaveBeenCalled();expect((await startPageEventReuseEntry(page,scope,'retry').done).stage).toBe('kept');expect(create).toHaveBeenCalledTimes(1);expect(await acknowledgePageEventReuseEntry(kept.attempt,scope)).toBe(true);expect(mockStorage.size).toBe(0);});
it('lost keep creation response retains the original ID and Check recovers without another create',async()=>{await preparePageEventReuseEntry(page,source,scope);const original=create.getMockImplementation()!;create.mockImplementationOnce(async(...a)=>{await original(...a);throw Error('Lost create');});await expect(startPageEventReuseEntry(page,scope,'keep').done).rejects.toThrow('Lost');expect((await startPageEventReuseEntry(page,scope,'check').done).stage).toBe('kept');expect(create).toHaveBeenCalledTimes(1);expect(run).not.toHaveBeenCalled();});
it('a stopped initial creation that has not committed stays pending on Check and retry',async()=>{await preparePageEventReuseEntry(page,source,scope);create.mockRejectedValueOnce(Error('Offline'));await expect(startPageEventReuseEntry(page,scope,'keep').done).rejects.toThrow();expect((await startPageEventReuseEntry(page,scope,'check').done).stage).toBe('stopping');expect((await startPageEventReuseEntry(page,scope,'retry').done).stage).toBe('stopping');expect(create).toHaveBeenCalledTimes(1);});
it('kept complete copy records terminal entry before releasing the whole pointer',async()=>{await preparePageEventReuseEntry(page,source,scope);await startPageEventReuseEntry(page,scope,'retry').done;run.mockReturnValueOnce({cancel:jest.fn(),done:Promise.resolve({state:'kept',event:{fields:{title:'Kept draft'}} as any,cleanupPending:false})});jest.mocked(acknowledgeKeptPageEventReuse).mockImplementationOnce(async()=>{expect(JSON.parse([...mockStorage.values()][0]).kept).toBe(true);whole=null;return true;});const kept=await startPageEventReuseEntry(page,scope,'keep').done;expect(kept.stage).toBe('kept');expect(acknowledgeKeptPageEventReuse).toHaveBeenCalled();expect(mockStorage.size).toBe(1);expect(await acknowledgePageEventReuseEntry(kept.attempt,scope)).toBe(true);});
it('a kept copy with unfinished media cleanup retains its whole and entry pointers',async()=>{await preparePageEventReuseEntry(page,source,scope);await startPageEventReuseEntry(page,scope,'retry').done;run.mockReturnValueOnce({cancel:jest.fn(),done:Promise.resolve({state:'kept',event:{fields:{title:'Kept'}} as any,cleanupPending:true})});const kept=await startPageEventReuseEntry(page,scope,'keep').done;expect(kept.cleanupPending).toBe(true);expect(acknowledgeKeptPageEventReuse).not.toHaveBeenCalled();expect(await acknowledgePageEventReuseEntry(kept.attempt,scope)).toBe(false);expect(mockStorage.size).toBe(1);});


describe('saved category snapshots', () => {
 const storageKey = `creator-page-event-reuse-entry:v1:${user}:${page}`;
 const originalAttempt = (categories?: string[]) => ({version: 1, userId: user, pageId: page, eventId: event, source,
  sourceUpdatedAt: version, title: 'Original story', category: 'community', ...(categories === undefined ? {} : {categories})});
 it.each([
  ['event', ['community']], ['event', ['community', 'outdoors']],
  ['template', ['community']], ['template', ['community', 'just for fun']],
 ] as const)('preserves the complete %s selection %j through initial creation', async (kind, values) => {
  const categories = [...values];
  const selected = kind === 'event' ? source : {...source, kind: 'template' as const, templateId: request};
  const fields = {title: 'Original story', category: 'community', categories};
  read.mockResolvedValue({fields, updatedAt: version} as any);
  jest.mocked(getPageEventTemplate).mockResolvedValue({fields, sourceUpdatedAt: version, communityId: page} as any);
  prepare.mockImplementation(async () => {
   whole = {version: 1, userId: user, pageId: page, eventId: event, requestId: request, source: selected, sourceUpdatedAt: version};
   return {attempt: whole, created: true};
  });
  const pending = await preparePageEventReuseEntry(page, selected, scope);
  expect(pending.attempt.categories).toEqual(values);
  expect(pending.attempt.categories).not.toBe(categories);
  expect(JSON.parse(mockStorage.get(storageKey)!).categories).toEqual(values);
  expect(create).not.toHaveBeenCalled();
  await startPageEventReuseEntry(page, scope, 'retry').done;
  expect(create).toHaveBeenCalledTimes(1);
  expect(create.mock.calls[0][0]).toEqual({pageId: page, eventId: event, title: 'Original story', category: 'community', categories: values});
 });
 it('recovers a cold pending selection with its original categories after an unknown create result', async () => {
  const attempt = originalAttempt(['community', 'fitness']);
  mockStorage.set(storageKey, JSON.stringify(attempt));
  // A fresh source read must never rewrite the original persisted create payload.
  read.mockResolvedValue({fields: {title: 'Original story', category: 'community', categories: ['community', 'outdoors']}, updatedAt: version} as any);
  create.mockRejectedValueOnce(Error('Response lost'));
  await expect(startPageEventReuseEntry(page, scope, 'retry').done).rejects.toThrow('Response lost');
  expect(await readPageEventReuseEntry(page, scope)).toEqual(attempt);
  await startPageEventReuseEntry(page, scope, 'retry').done;
  expect(create.mock.calls.map(call => call[0])).toEqual([1, 2].map(() => ({pageId: page, eventId: event, title: attempt.title, category: attempt.category, categories: attempt.categories})));
  expect(prepare).toHaveBeenCalledTimes(1);
 });
 it('keeps original categories when stopping before initial creation', async () => {
  mockStorage.set(storageKey, JSON.stringify(originalAttempt(['community', 'other'])));
  expect((await startPageEventReuseEntry(page, scope, 'keep').done).stage).toBe('kept');
  expect(create.mock.calls[0][0].categories).toEqual(['community', 'other']);
  expect(run).not.toHaveBeenCalled();
 });
 it('keeps a legacy pending create on its original single-category request despite newer source fields', async () => {
  const attempt = originalAttempt();
  mockStorage.set(storageKey, JSON.stringify(attempt));
  read.mockResolvedValue({fields: {title: 'Original story', category: 'community', categories: ['community', 'outdoors']}, updatedAt: version} as any);
  expect(await readPageEventReuseEntry(page, scope)).toEqual(attempt);
  await startPageEventReuseEntry(page, scope, 'retry').done;
  expect(create.mock.calls[0][0]).toEqual({pageId: page, eventId: event, title: attempt.title, category: attempt.category});
  expect(create.mock.calls[0][0]).not.toHaveProperty('categories');
 });
 it('never replaces an unresolved category attempt when a different source is selected', async () => {
  const attempt = originalAttempt(['community', 'music']);
  mockStorage.set(storageKey, JSON.stringify(attempt));
  expect(await preparePageEventReuseEntry(page, {...source, eventId: request}, scope)).toEqual({attempt, created: false});
  expect(read).not.toHaveBeenCalled();
  expect(mockSet).not.toHaveBeenCalled();
 });
 it.each([null, [], ['music', 'music'], ['music', 'art', 'film'], [''], [4], 'music', ['x'.repeat(81)]].map(categories => ({categories})))('rejects malformed persisted categories $categories without erasing or creating', async ({categories}) => {
  const raw = JSON.stringify({...originalAttempt(), categories});
  mockStorage.set(storageKey, raw);
  await expect(startPageEventReuseEntry(page, scope, 'retry').done).rejects.toThrow('original event copy');
  expect(mockStorage.get(storageKey)).toBe(raw);
  expect(create).not.toHaveBeenCalled();
  expect(prepare).not.toHaveBeenCalled();
 });
 it.each(['event', 'template'] as const)('rejects a malformed %s category snapshot before saving an entry', async kind => {
  const fields = {title: 'Story', category: 'community', categories: ['community', 'music', 'film']};
  read.mockResolvedValue({fields, updatedAt: version} as any);
  jest.mocked(getPageEventTemplate).mockResolvedValue({fields, sourceUpdatedAt: version} as any);
  const selected = kind === 'event' ? source : {...source, kind: 'template' as const, templateId: request};
  await expect(preparePageEventReuseEntry(page, selected, scope)).rejects.toThrow('original event categories');
  expect(mockSet).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
 });
});


describe('bounded entry recovery',()=>{
 beforeEach(()=>jest.useFakeTimers());afterEach(()=>jest.useRealTimers());
 it('releases the journal after a stalled workspace read without creating an event from its late result',async()=>{
  let finish!:(value:any)=>void;mockOwn.mockReturnValueOnce(new Promise(r=>{finish=r;}));
  let failure:any;const pending=preparePageEventReuseEntry(page,source,scope).catch(e=>{failure=e;});
  await jest.advanceTimersByTimeAsync(12_001);expect(failure).toBeInstanceOf(Error);
  await expect(preparePageEventReuseEntry(page,source,scope)).resolves.toMatchObject({created:true});
  finish({data:{id:page},error:null});await pending;expect(create).not.toHaveBeenCalled();expect(mockStorage.size).toBe(1);
 });
 it('a never-answering creation releases the original entry for read-only recovery',async()=>{
  await preparePageEventReuseEntry(page,source,scope);create.mockImplementationOnce(async a=>{events.push({id:a.eventId});return new Promise(()=>{});});
  let failure:any;const pending=startPageEventReuseEntry(page,scope,'retry').done.catch(e=>{failure=e;});
  await jest.advanceTimersByTimeAsync(25_001);expect(failure).toBeInstanceOf(Error);await pending;
  await expect(startPageEventReuseEntry(page,scope,'check').done).resolves.toMatchObject({stage:'pending',attempt:{eventId:event}});
  expect(create).toHaveBeenCalledTimes(1);expect(run).not.toHaveBeenCalled();
 });
});

it('Pause releases a never-answering creation for Check while preserving its original event ID',async()=>{
 await preparePageEventReuseEntry(page,source,scope);let sent=false;create.mockImplementationOnce(async()=>{sent=true;return new Promise(()=>{});});
 const task=startPageEventReuseEntry(page,scope,'retry'),pending=task.done.catch(e=>e);while(!sent)await Promise.resolve();
 task.cancel();await expect(pending).resolves.toBeInstanceOf(Error);
 await expect(startPageEventReuseEntry(page,scope,'check').done).resolves.toMatchObject({stage:'not-created',attempt:{eventId:event}});
 expect(create).toHaveBeenCalledTimes(1);expect(run).not.toHaveBeenCalled();
});
