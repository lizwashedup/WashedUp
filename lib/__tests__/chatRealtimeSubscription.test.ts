import {nextChatDataChannelName, subscribeChatWhenReady} from '../chatRealtimeSubscription';

beforeEach(() => jest.useFakeTimers());
afterEach(() => {jest.clearAllTimers();jest.useRealTimers();});
it('joins immediately on an available socket', () => {
 const join=jest.fn();const stop=subscribeChatWhenReady(()=>false,join,()=>true);
 expect(join).toHaveBeenCalledTimes(1);stop();expect(jest.getTimerCount()).toBe(0);
});
it('waits through socket teardown and joins only once when available', () => {
 let closing=true;const join=jest.fn();const stop=subscribeChatWhenReady(()=>closing,join,()=>true);
 jest.advanceTimersByTime(150);expect(join).not.toHaveBeenCalled();
 closing=false;jest.advanceTimersByTime(50);expect(join).toHaveBeenCalledTimes(1);
 jest.advanceTimersByTime(100);expect(join).toHaveBeenCalledTimes(1);stop();
});
it('cancels a delayed join even when its room predicate still reports current', () => {
 let closing=true;const join=jest.fn();const stop=subscribeChatWhenReady(()=>closing,join,()=>true);
 stop();closing=false;jest.advanceTimersByTime(100);expect(join).not.toHaveBeenCalled();expect(jest.getTimerCount()).toBe(0);
});
it('does not join after the room or account is retired', () => {
 let current=true;const join=jest.fn();subscribeChatWhenReady(()=>true,join,()=>current);
 current=false;jest.advanceTimersByTime(100);expect(join).not.toHaveBeenCalled();expect(jest.getTimerCount()).toBe(0);
});
it('gives repeated PostgreSQL room visits different subscription names', () => {
 const first=nextChatDataChannelName('chat:room'),second=nextChatDataChannelName('chat:room');
 expect(first).not.toBe(second);expect(first).toContain('chat:room:visit:');
});
