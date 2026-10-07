let mockPlatform = 'android', mockLocal = false;
const mockAdd = jest.fn(), mockLast = jest.fn(), mockClear = jest.fn();
jest.mock('react-native', () => ({ Platform: { get OS() { return mockPlatform; } } }));
jest.mock('../../constants/LocalDevelopment', () => ({ get LOCAL_DEVELOPMENT_ONLY() { return mockLocal; } }));
jest.mock('expo-notifications', () => ({ DEFAULT_ACTION_IDENTIFIER: 'default',
  addNotificationResponseReceivedListener: (...args: any[]) => mockAdd(...args),
  getLastNotificationResponse: (...args: any[]) => mockLast(...args),
  clearLastNotificationResponse: (...args: any[]) => mockClear(...args),
}));
const response = (id = 'tap-a', data: any = { type: 'new_message', topicId: 'room', reactionMessageId: 'message', reactionMessageSource: 'topic' }, actionIdentifier = 'default') => ({ actionIdentifier, notification: { request: { identifier: id, content: { data } } } });
let subscribe: typeof import('../expoNotificationResponses').subscribeExpoNotificationResponses;
let listener: (response: any) => void, remove: jest.Mock;
beforeEach(() => {
  jest.resetModules(); jest.clearAllMocks(); mockPlatform = 'android'; mockLocal = false; remove = jest.fn();
  mockAdd.mockImplementation(callback => { listener = callback; return { remove }; });
  mockLast.mockReturnValue(null); mockClear.mockImplementation(() => {});
  subscribe = require('../expoNotificationResponses').subscribeExpoNotificationResponses;
});
it.each(['android', 'ios'])('handles warm %s taps without dropping reaction metadata', platform => {
  mockPlatform = platform; const route = jest.fn(); subscribe(route); const tap = response(); mockLast.mockReturnValue(tap); listener(tap);
  expect(route).toHaveBeenCalledWith(tap.notification.request.content.data); expect(mockClear).toHaveBeenCalledTimes(1);
});
it.each(['android', 'ios'])('consumes the buffered cold %s response once', platform => {
  mockPlatform = platform; const route = jest.fn(), tap = response(); mockLast.mockReturnValue(tap); const stop = subscribe(route);
  listener(tap); stop(); subscribe(route); expect(route).toHaveBeenCalledTimes(1);
});
it('reads the cold response after attaching the live listener', () => {
  const route = jest.fn(), tap = response(); mockLast.mockReturnValue(tap); mockAdd.mockImplementation(callback => { listener = callback; callback(tap); return { remove }; });
  subscribe(route); expect(route).toHaveBeenCalledTimes(1);
  expect(mockAdd.mock.invocationCallOrder[0]).toBeLessThan(mockLast.mock.invocationCallOrder[0]);
});
it('leaves a newer native response alone when an older callback is received', () => {
  const route = jest.fn(); subscribe(route); mockLast.mockReturnValue(response('newer')); listener(response('older'));
  expect(mockClear).not.toHaveBeenCalled(); listener(response('newer')); expect(route).toHaveBeenCalledTimes(2); expect(mockClear).toHaveBeenCalledTimes(1);
});
it.each([null, undefined, {}, { actionIdentifier: 'default' }, response('', {}), response('a', null), response('a', []), response('a', {}), response('a', { custom: { type: 'new_message' } }), response('a', { type: '' }), response('a', { type: 3 }), response('a', { type: 'new_message' }, 'reply')])('ignores unrelated or unsupported response %p', value => {
  const route = jest.fn(); subscribe(route); listener(value); expect(route).not.toHaveBeenCalled(); expect(mockClear).not.toHaveBeenCalled();
});
it('ignores queued callbacks after disposal and removes the subscription', () => {
  const route = jest.fn(); const stop = subscribe(route); stop(); listener(response()); expect(route).not.toHaveBeenCalled(); expect(remove).toHaveBeenCalledTimes(1);
});
it('still handles warm taps after initial native read failure', () => {
  mockLast.mockImplementationOnce(() => { throw Error('bridge unavailable'); }); const route = jest.fn(); subscribe(route); listener(response()); expect(route).toHaveBeenCalledTimes(1);
});
it('still reads a buffered cold tap if listener registration throws', () => {
  mockAdd.mockImplementationOnce(() => { throw Error('bridge unavailable'); }); mockLast.mockReturnValue(response()); const route = jest.fn(); const stop = subscribe(route); expect(route).toHaveBeenCalledTimes(1); expect(stop).not.toThrow();
});
it('does not replay an accepted response if native clear throws', () => {
  mockClear.mockImplementation(() => { throw Error('bridge unavailable'); }); mockLast.mockReturnValue(response()); const route = jest.fn(); const stop = subscribe(route); stop(); subscribe(route); listener(response()); expect(route).toHaveBeenCalledTimes(1);
});
it('does not clear or consume a tap when routing throws', () => {
  mockLast.mockReturnValue(response()); const route = jest.fn().mockImplementationOnce(() => { throw Error('router unavailable'); }); subscribe(route); expect(mockClear).not.toHaveBeenCalled(); listener(response()); expect(route).toHaveBeenCalledTimes(2); expect(mockClear).toHaveBeenCalledTimes(1);
});
it('tolerates an already-detached bridge on cleanup', () => {
  remove.mockImplementation(() => { throw Error('detached'); }); expect(subscribe(jest.fn())).not.toThrow();
});
it.each(['web', 'windows', 'local'])('performs no bridge calls in %s mode', mode => {
  mockLocal = mode === 'local'; mockPlatform = mode === 'local' ? 'android' : mode; const route = jest.fn(); subscribe(route)();
  expect(mockAdd).not.toHaveBeenCalled(); expect(mockLast).not.toHaveBeenCalled(); expect(mockClear).not.toHaveBeenCalled(); expect(route).not.toHaveBeenCalled();
});
