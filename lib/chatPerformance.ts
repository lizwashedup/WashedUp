export type ChatTimingOutcome = 'ok' | 'error' | 'retired';
export type ChatTimingSample = { surface: string; phase: string; milliseconds: number; outcome: ChatTimingOutcome };
const samples: ChatTimingSample[] = [];
const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
/** Local development diagnostics only. No IDs, text, network upload or storage. */
export function beginChatTiming(surface: string, phase: string): (outcome?: ChatTimingOutcome) => void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return () => {};
  const started = now(); let finished = false;
  return (outcome = 'ok') => {
    if (finished) return;
    finished = true;
    samples.push({ surface, phase, milliseconds: Math.max(0, now() - started), outcome });
    if (samples.length > 200) samples.splice(0, samples.length - 200);
  };
}
export async function measureChatPhase<T>(surface: string, phase: string, work: () => PromiseLike<T>): Promise<T> {
  const finish = beginChatTiming(surface, phase);
  try { const value = await work(); finish(); return value; }
  catch (error) { finish('error'); throw error; }
}
export function readChatTimings(): ChatTimingSample[] { return samples.map(sample => ({ ...sample })); }
export function clearChatTimings(): void { samples.length = 0; }
