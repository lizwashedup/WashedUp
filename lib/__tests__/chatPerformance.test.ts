import { beginChatTiming, clearChatTimings, readChatTimings, measureChatPhase } from '../chatPerformance';
beforeEach(() => { clearChatTimings(); });
it('keeps bounded local durations without message or account data, and finishes once', () => {
  const finish = beginChatTiming('community-main','send'); finish(); finish('error');
  expect(readChatTimings()).toHaveLength(1);
  expect(Object.keys(readChatTimings()[0]).sort()).toEqual(['milliseconds','outcome','phase','surface']);
  for(let i=0;i<220;i++)beginChatTiming('event','history')();
  expect(readChatTimings()).toHaveLength(200);
  const copied=readChatTimings();copied[0].milliseconds=-1;expect(readChatTimings()[0].milliseconds).toBeGreaterThanOrEqual(0);
});
it('preserves the original rejection and labels failed measurements', async () => {
  const error=Error('local fixture error');
  await expect(measureChatPhase('event','history',()=>Promise.reject(error))).rejects.toBe(error);
  expect(readChatTimings()[0].outcome).toBe('error');
});
it('does not collect production timings',()=>{
  const old=(global as any).__DEV__;(global as any).__DEV__=false;
  try{beginChatTiming('event','send')();expect(readChatTimings()).toEqual([]);}finally{(global as any).__DEV__=old;}
});
