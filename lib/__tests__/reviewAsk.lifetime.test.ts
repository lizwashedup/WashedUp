import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { maybeRequestReviewAfterTopRating } from '../reviewAsk';
const mockEligibility = jest.fn(), mockAvailable = jest.fn(), mockRequest = jest.fn(), mockLog = jest.fn();
jest.mock('../supabase', () => ({ supabase: { rpc: (...args: unknown[]) => mockEligibility(...args) } }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: 'test-version' } } }));
// Substitute only the native loading boundary; the real review eligibility,
// cooldown, storage and lifetime checks remain exercised below.
jest.mock('../loadStoreReview', () => ({ loadStoreReview: async () => ({ isAvailableAsync: () => mockAvailable(), requestReview: () => mockRequest() }) }));
jest.mock('../logger', () => ({ logError: (...args:unknown[]) => mockLog(...args) }));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const originalPlatform = Platform.OS;
let active: boolean;
const run = () => (maybeRequestReviewAfterTopRating as any)(() => active);
async function flush() { for (let i=0;i<30;i++) await Promise.resolve(); }
beforeEach(async () => {
  jest.useFakeTimers(); await AsyncStorage.clear(); jest.clearAllMocks(); active=true;
  Object.defineProperty(Platform,'OS',{configurable:true,value:'ios'});
  mockEligibility.mockReset().mockResolvedValue({data:true,error:null});mockAvailable.mockReset().mockResolvedValue(true);mockRequest.mockReset().mockResolvedValue(undefined);
});
afterEach(()=>{jest.restoreAllMocks();jest.clearAllTimers();jest.useRealTimers();Object.defineProperty(Platform,'OS',{configurable:true,value:originalPlatform});});
it('preserves eligible presentation and records the existing cooldown before requesting',async()=>{
  mockRequest.mockImplementation(async()=>{expect(await AsyncStorage.getItem('reviewAsk.lastAtV2')).not.toBeNull();expect(await AsyncStorage.getItem('reviewAsk.lastVersionV2')).toBe('test-version');});
  await run();expect(mockLog).not.toHaveBeenCalled();expect(mockEligibility).toHaveBeenCalledWith('get_review_ask_eligibility');expect(mockRequest).toHaveBeenCalledTimes(1);
});
it.each(['reviewAskCompleted','hasRequestedReview'])('honors the existing permanent stop %s',async key=>{
  await AsyncStorage.setItem(key,'true');await run();expect(mockEligibility).not.toHaveBeenCalled();expect(mockRequest).not.toHaveBeenCalled();
});
it('honors the existing cooldown and version-bump exception',async()=>{
  await AsyncStorage.setItem('reviewAsk.lastAtV2',String(Date.now()));await AsyncStorage.setItem('reviewAsk.lastVersionV2','test-version');
  await run();expect(mockRequest).not.toHaveBeenCalled();await AsyncStorage.setItem('reviewAsk.lastVersionV2','older-version');await run();expect(mockRequest).toHaveBeenCalledTimes(1);
});
it('does not start work for a retired request',async()=>{active=false;await run();expect(mockEligibility).not.toHaveBeenCalled();expect(mockRequest).not.toHaveBeenCalled();});
it.each(['storage','eligibility','availability'])('does not present after retirement during %s',async stage=>{
  const pending=deferred<any>();
  if(stage==='storage')jest.spyOn(AsyncStorage,'getItem').mockReturnValueOnce(pending.promise);
  else if(stage==='eligibility')mockEligibility.mockReturnValueOnce(pending.promise);
  else mockAvailable.mockReturnValueOnce(pending.promise);
  const attempt=run();await flush();active=false;pending.resolve(stage==='storage'?null:stage==='eligibility'?{data:true,error:null}:true);await attempt;
  expect(mockRequest).not.toHaveBeenCalled();expect(await AsyncStorage.getItem('reviewAsk.lastAtV2')).toBeNull();
});
it.each(['storage','eligibility','availability'])('bounds stalled %s without accepting the late result',async stage=>{
  const pending=deferred<any>();
  if(stage==='storage')jest.spyOn(AsyncStorage,'getItem').mockReturnValueOnce(pending.promise);
  else if(stage==='eligibility')mockEligibility.mockReturnValueOnce(pending.promise);
  else mockAvailable.mockReturnValueOnce(pending.promise);
  let settled=false;const attempt=run().then(()=>{settled=true;});await flush();await jest.advanceTimersByTimeAsync(12_001);await flush();
  expect(settled).toBe(true);pending.resolve(stage==='storage'?null:stage==='eligibility'?{data:true,error:null}:true);await attempt;
  expect(mockRequest).not.toHaveBeenCalled();
});
it.each([false,null])('does not infer eligibility from %s',async eligible=>{mockEligibility.mockResolvedValueOnce({data:eligible,error:null});await run();expect(mockRequest).not.toHaveBeenCalled();});
