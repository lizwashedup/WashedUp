type NativeFlags = {
  YOURS_PAGE_ENABLED: boolean;
  GROUPS_ENABLED: boolean;
  COMMUNITIES_ENABLED: boolean;
  SCENE_DISCOVERY_ENABLED: boolean;
  JOIN_GATE_ENABLED: boolean;
  CHAT_DELETE_ENABLED: boolean;
  MEMBER_STATE_ENABLED: boolean;
  CHAT_ENGINE_ENABLED: boolean;
};

const envKeys = [
  'EXPO_PUBLIC_YOURS_PAGE_ENABLED',
  'EXPO_PUBLIC_GROUPS_ENABLED',
  'EXPO_PUBLIC_COMMUNITIES_ENABLED',
  'EXPO_PUBLIC_SCENE_DISCOVERY_ENABLED',
  'EXPO_PUBLIC_JOIN_GATE_ENABLED',
  'EXPO_PUBLIC_CHAT_DELETE_ENABLED',
  'EXPO_PUBLIC_MEMBER_STATE_ENABLED',
  'EXPO_PUBLIC_CHAT_ENGINE_ENABLED',
] as const;

const originalEnv = new Map(envKeys.map((key) => [key, process.env[key]]));

function setFlagEnv(
  overrides: Partial<Record<(typeof envKeys)[number], string | undefined>> = {},
) {
  for (const key of envKeys) {
    const value = overrides[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function loadFlags(): NativeFlags {
  jest.resetModules();
  return require('../FeatureFlags') as NativeFlags;
}

afterEach(() => {
  for (const key of envKeys) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('native feature flag contract', () => {
  it('keeps the current behavior when every scoped flag is unset', () => {
    setFlagEnv();

    expect(loadFlags()).toMatchObject({
      YOURS_PAGE_ENABLED: true,
      GROUPS_ENABLED: true,
      COMMUNITIES_ENABLED: false,
      SCENE_DISCOVERY_ENABLED: true,
      JOIN_GATE_ENABLED: false,
      CHAT_DELETE_ENABLED: false,
      MEMBER_STATE_ENABLED: false,
      CHAT_ENGINE_ENABLED: false,
    });
  });

  describe.each([
    ['Yours', 'EXPO_PUBLIC_YOURS_PAGE_ENABLED', 'YOURS_PAGE_ENABLED'],
    ['Groups', 'EXPO_PUBLIC_GROUPS_ENABLED', 'GROUPS_ENABLED'],
    ['Scene discovery', 'EXPO_PUBLIC_SCENE_DISCOVERY_ENABLED', 'SCENE_DISCOVERY_ENABLED'],
  ] as const)('%s rollback flag', (_name, envKey, flagKey) => {
    it.each([
      ['true', true],
      ['false', false],
      ['FALSE', true],
      ['1', true],
    ])('is disabled only by exact lowercase false (%s)', (value, expected) => {
      setFlagEnv({ [envKey]: value });
      expect(loadFlags()[flagKey]).toBe(expected);
    });
  });

  describe.each([
    ['Communities', 'EXPO_PUBLIC_COMMUNITIES_ENABLED', 'COMMUNITIES_ENABLED'],
    ['join gate', 'EXPO_PUBLIC_JOIN_GATE_ENABLED', 'JOIN_GATE_ENABLED'],
    ['chat deletion', 'EXPO_PUBLIC_CHAT_DELETE_ENABLED', 'CHAT_DELETE_ENABLED'],
    ['member state', 'EXPO_PUBLIC_MEMBER_STATE_ENABLED', 'MEMBER_STATE_ENABLED'],
    ['chat engine', 'EXPO_PUBLIC_CHAT_ENGINE_ENABLED', 'CHAT_ENGINE_ENABLED'],
  ] as const)('%s opt-in flag', (_name, envKey, flagKey) => {
    it.each([
      ['true', true],
      ['false', false],
      ['TRUE', false],
      ['1', false],
    ])('accepts only exact lowercase true (%s)', (value, expected) => {
      setFlagEnv({ [envKey]: value });
      expect(loadFlags()[flagKey]).toBe(expected);
    });
  });
});
