import {requestWithDeadline} from '../requestWithDeadline';
const nativeAbort = require('abort-controller/dist/abort-controller');
const originalController = global.AbortController;
const originalSignal = global.AbortSignal;
beforeEach(()=>{
  jest.useFakeTimers();
  global.AbortController=nativeAbort.AbortController;
  global.AbortSignal=nativeAbort.AbortSignal;
});
afterEach(()=>{
  jest.useRealTimers();
  global.AbortController=originalController;
  global.AbortSignal=originalSignal;
});
it('uses the installed native controller without depending on AbortSignal.timeout',async()=>{
  expect(typeof (global.AbortSignal as any).timeout).toBe('undefined');
  let signal:AbortSignal|undefined;
  const request=Object.assign(Promise.resolve({data:['ticket'],error:null}),{abortSignal:(value:AbortSignal)=>{signal=value;return Promise.resolve({data:['ticket'],error:null});}});
  await expect(requestWithDeadline(request,12000)).resolves.toEqual({data:['ticket'],error:null});
  expect(signal?.aborted).toBe(false);
  expect(jest.getTimerCount()).toBe(0);
});
it('aborts a stalled request and rejects rather than reporting no tickets',async()=>{
  let signal:AbortSignal|undefined;
  const request=Object.assign(new Promise<never>(()=>{}),{abortSignal:(value:AbortSignal)=>{signal=value;return new Promise<never>(()=>{});}});
  const pending=requestWithDeadline(request,12000);
  const check=expect(pending).rejects.toThrow('took too long');
  jest.advanceTimersByTime(12000);
  await check;
  expect(signal?.aborted).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});
it('clears the deadline on failure and preserves the original error',async()=>{
  const failure=Error('connection lost');
  await expect(requestWithDeadline(Promise.reject(failure),12000)).rejects.toBe(failure);
  expect(jest.getTimerCount()).toBe(0);
});
it('does not turn a late successful reply into a successful timed-out operation',async()=>{
  let finish!:(value:string)=>void;
  const request=new Promise<string>(resolve=>{finish=resolve;});
  const pending=requestWithDeadline(request,12000);
  const check=expect(pending).rejects.toThrow('took too long');
  jest.advanceTimersByTime(12000);await check;finish('late reply');
  await expect(pending).rejects.toThrow('took too long');
});
