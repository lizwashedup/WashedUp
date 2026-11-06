import { createMemberChatReadQueue } from '../memberChatReadQueue';

const stamp = (n: number) => '2026-11-06T12:00:00.' + n.toString().padStart(6, '0') + 'Z';
const row = (n: number, visible = true) => ({
  id: 'message-' + n, at: stamp(n), current: jest.fn(() => true), visible: jest.fn(() => visible),
  write: jest.fn<Promise<boolean>, []>().mockResolvedValue(true),
});
beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });
const advance = () => jest.advanceTimersByTimeAsync(205);

it('a burst of duplicate and out-of-order arrivals writes once through the newest actually visible timestamp', async () => {
  const queue = createMemberChatReadQueue();
  const older = row(1), next = row(2), offscreen = row(3,false);
  queue.offerLive(next); queue.offerLive(older); queue.offerLive(offscreen); queue.offerLive(next);
  await advance();
  expect(next.write).toHaveBeenCalledTimes(1); expect(older.write).not.toHaveBeenCalled(); expect(offscreen.write).not.toHaveBeenCalled();
  queue.offerLive(older); queue.offerLive(next); queue.check(); await advance();
  expect(next.write).toHaveBeenCalledTimes(1); expect(older.write).not.toHaveBeenCalled();
  offscreen.visible.mockReturnValue(true); queue.check(); await advance();
  expect(offscreen.write).toHaveBeenCalledTimes(1);
});

it('a delayed page overlapping the same live receipt is not another write, but a later explicit refresh can clear late notices', async () => {
  const queue = createMemberChatReadQueue(), live = row(2), page = row(2);
  const start = queue.beginPage(); queue.offerLive(live); await advance(); queue.offerPage(page,start);
  const older = row(1); queue.offerPage(older, queue.beginPage()); await advance();
  expect(page.write).not.toHaveBeenCalled(); expect(older.write).not.toHaveBeenCalled();
  queue.offerPage(page,queue.beginPage()); await advance();
  expect(page.write).toHaveBeenCalledTimes(1); expect(live.write).toHaveBeenCalledTimes(1);
});

it('keeps a later burst serial while a previous write is in flight and does not retry a duplicate if its receipt fails', async () => {
  let resolve!: (ok: boolean) => void;
  const queue = createMemberChatReadQueue(), first = row(1), second = row(2);
  first.write.mockReturnValue(new Promise(done => {resolve=done;}));
  queue.offerLive(first); await advance(); queue.offerLive(first); queue.offerLive(second); await advance();
  expect(second.write).not.toHaveBeenCalled();
  resolve(false); await advance(); expect(first.write).toHaveBeenCalledTimes(1); expect(second.write).toHaveBeenCalledTimes(1);
});

it('a hidden, blocked, deleted or retired bubble cannot dispatch from a scheduled visibility check', async () => {
  const queue = createMemberChatReadQueue(), hidden = row(1), retired = row(2), deleted = row(3);
  queue.offerLive(hidden); hidden.visible.mockReturnValue(false);
  queue.offerLive(retired); retired.current.mockReturnValue(false); queue.offerLive(deleted); queue.forget(deleted.id); await advance();
  expect(hidden.write).not.toHaveBeenCalled(); expect(retired.write).not.toHaveBeenCalled(); expect(deleted.write).not.toHaveBeenCalled();
  queue.clear(); hidden.visible.mockReturnValue(true); queue.check(); await advance(); expect(hidden.write).not.toHaveBeenCalled();
});
