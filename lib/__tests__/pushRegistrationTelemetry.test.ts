let mockPlatform = 'ios';
const mockRpc = jest.fn();

jest.mock('react-native', () => ({ Platform: { get OS() { return mockPlatform; } } }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { nativeAppVersion: '1.0.6', nativeBuildVersion: '51', expoConfig: { version: '1.0.6' } },
}));
jest.mock('expo-updates', () => ({ updateId: 'update-a', runtimeVersion: 'runtime-a' }));
jest.mock('../supabase', () => ({ supabase: { rpc: (...args: any[]) => mockRpc(...args) } }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  mockPlatform = 'ios';
});

it('serializes an account’s stages and includes the expected authenticated identity', async () => {
  const first = deferred<any>();
  mockRpc.mockReturnValueOnce(first.promise).mockResolvedValue({ data: null, error: null });
  const { recordPushRegistrationState } = require('../pushRegistrationTelemetry');

  recordPushRegistrationState('user-a', 'identity_ready');
  recordPushRegistrationState('user-a', 'registered');
  await flush();

  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(mockRpc).toHaveBeenCalledWith('record_push_registration_state', expect.objectContaining({
    p_user_id: 'user-a',
    p_stage: 'identity_ready',
    p_platform: 'ios',
    p_build_number: '51',
    p_update_id: 'update-a',
  }));

  first.resolve({ data: null, error: null });
  await flush();
  expect(mockRpc).toHaveBeenCalledTimes(2);
  expect(mockRpc.mock.calls[1][1]).toEqual(expect.objectContaining({
    p_user_id: 'user-a',
    p_stage: 'registered',
  }));
});

it.each(['web', 'windows'])('does not write telemetry on %s', async (platform) => {
  mockPlatform = platform;
  const { recordPushRegistrationState } = require('../pushRegistrationTelemetry');
  recordPushRegistrationState('user-a', 'identity_ready');
  await flush();
  expect(mockRpc).not.toHaveBeenCalled();
});
