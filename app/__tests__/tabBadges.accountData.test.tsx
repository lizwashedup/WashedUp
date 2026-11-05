import React from 'react';
import { act, create } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TabLayout from '../(tabs)/_layout';
let mockAccount: string | null = 'alice',
  mockEpoch = 1,
  mockLoading = false;
const mockRead = jest.fn(),
  mockRpc = jest.fn(),
  mockSeen = jest.fn();
jest.mock('expo-router', () => {
  const Tabs = ({
    children
  }: any) => children;
  Tabs.Screen = (props: any) => require('react').createElement('TabScreen', props);
  return {
    Tabs,
    router: {
      push: jest.fn(),
      replace: jest.fn(),
      navigate: jest.fn()
    },
    usePathname: () => '/plans'
  };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({
    bottom: 0
  })
}));
jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null
}));
jest.mock('expo-image', () => ({
  Image: () => null
}));
jest.mock('../../components/creator/CreatorActionFill', () => ({
  CreatorActionFill: () => null
}));
jest.mock('../../components/yours/icons/SunriseIcon', () => () => null);
jest.mock('../../components/legal/TermsReacceptance', () => ({
  TermsReacceptance: () => null
}));
jest.mock('../../components/create/CreateMenuSheet', () => () => null);
jest.mock('../../lib/ticketing', () => ({
  getOrder: jest.fn()
}));
jest.mock('../../lib/authGate', () => ({
  fetchNeedsPhoneMigration: async () => false
}));
jest.mock('../../hooks/useProfile', () => ({
  getAuthProfile: async () => null
}));
jest.mock('../../lib/navState', () => ({
  getVerificationDestination: () => null,
  approveVerificationEntry: jest.fn()
}));
jest.mock('../../lib/pendingLink', () => ({
  peekPendingCheckout: async () => null,
  consumePendingDestination: async () => null,
  clearPendingDestination: async () => {}
}));
jest.mock('../../lib/sceneStage', () => ({
  SCENE_STAGE: 1,
  SCENE_BADGE_KEY: ['scene-stage'],
  getSeenSceneStage: async () => 1
}));
jest.mock('../../lib/yours/requestsSeen', () => ({
  REQUESTS_BADGE_KEY: ['yours', 'requests-badge'],
  getRequestsSeenAt: () => mockSeen()
}));
jest.mock('../../constants/FeatureFlags', () => ({
  YOURS_PAGE_ENABLED: true
}));
jest.mock('../../hooks/useObservedUser', () => ({
  useObservedUser: () => {
    const epoch = mockEpoch;
    return {
      viewerId: mockAccount,
      epoch,
      isLoading: mockLoading,
      error: null,
      isCurrent: () => epoch === mockEpoch,
      retry: jest.fn()
    };
  }
}));
jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: async () => ({
        data: {
          user: mockAccount ? {
            id: mockAccount
          } : null
        },
        error: null
      }),
      getSession: async () => ({
        data: {
          session: {
            user: {
              id: mockAccount
            }
          }
        }
      }),
      onAuthStateChange: () => ({
        data: {
          subscription: {
            unsubscribe() {}
          }
        }
      })
    },
    rpc: (...args: any[]) => mockRpc(...args),
    from: (table: string) => {
      let account: string | null = null;
      const q: any = {
        select: () => q,
        eq: (key: string, value: string) => {
          if (['user_id', 'recipient_id'].includes(key)) account = value;
          return q;
        },
        then: (yes: any, no: any) => Promise.resolve(mockRead(table, account)).then(yes, no)
      };
      return q;
    }
  }
}));
let tree: ReturnType<typeof create> | undefined, client: QueryClient;
const render = () => <QueryClientProvider client={client}><TabLayout /></QueryClientProvider>;
async function flush() {
  await act(async () => {
    await new Promise(r => setTimeout(r, 5));
  });
}
async function mount() {
  client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity
      }
    }
  });
  act(() => {
    tree = create(render());
  });
  await flush();
  await flush();
  return {
    update: () => act(() => tree!.update(render())),
    badge: (name: string) => tree!.root.findAllByType('TabScreen' as any).find(x => x.props.name === name)!.props.options.tabBarBadge
  };
}
beforeEach(() => {
  mockAccount = 'alice';
  mockEpoch = 1;
  mockLoading = false;
  jest.clearAllMocks();
  mockSeen.mockResolvedValue(Date.parse('2026-01-01'));
  mockRead.mockImplementation(async (table, account) => {
    const rows = Array.from({
      length: account === 'alice' ? 2 : 4
    }, (_, i) => ({
      event_id: String(i)
    }));
    return {
      data: rows,
      count: 1,
      error: null
    };
  });
  mockRpc.mockImplementation(async (_name, args) => ({
    data: Array.from({
      length: args.p_user_id === 'alice' ? 3 : 5
    }, () => ({
      requested_at: '2026-06-01'
    })),
    error: null
  }));
});
afterEach(() => {
  if (tree) act(() => tree!.unmount());
  tree = undefined;
  client?.clear();
  jest.useRealTimers();
});
it('replaces cached chat and People badges when the account changes', async () => {
  const f = await mount();
  expect(f.badge('chats/index')).toBe(2);
  expect(f.badge('friends')).toBe(3);
  mockAccount = 'bob';
  mockEpoch++;
  f.update();
  expect(f.badge('chats/index')).toBeUndefined();
  expect(f.badge('friends')).toBeUndefined();
  await flush();
  expect(f.badge('chats/index')).toBe(4);
  expect(f.badge('friends')).toBe(5);
});
it.each(['loading', 'signed-out'])('hides account badges when identity is %s', async state => {
  const f = await mount();
  if (state === 'loading') mockLoading = true;else {
    mockAccount = null;
    mockEpoch++;
  }
  f.update();
  expect(f.badge('chats/index')).toBeUndefined();
  expect(f.badge('friends')).toBeUndefined();
});
it('ignores late previous-account results', async () => {
  let finish!: (x: any) => void;
  mockRead.mockImplementation((table, account) => table === 'app_notifications' && account === 'alice' ? new Promise(r => finish = r) : Promise.resolve({
    data: [{
      event_id: 'b'
    }],
    count: 0,
    error: null
  }));
  const f = await mount();
  mockAccount = 'bob';
  mockEpoch++;
  f.update();
  await flush();
  await act(async () => finish({
    data: [{
      event_id: 'old'
    }],
    error: null
  }));
  await flush();
  expect(f.badge('chats/index')).toBe(1);
});
it('retains confirmed counts on failed background reads', async () => {
  const f = await mount();
  mockRead.mockResolvedValue({
    data: null,
    count: null,
    error: Error('offline')
  });
  mockRpc.mockResolvedValue({
    data: null,
    error: Error('offline')
  });
  await act(async () => {
    await client.invalidateQueries();
  });
  await flush();
  expect(f.badge('chats/index')).toBe(2);
  expect(f.badge('friends')).toBe(3);
});
it('counts distinct joined chats and only requests newer than the seen marker', async () => {
  mockRead.mockImplementation(async table => ({
    data: table === 'event_members' ? [{
      event_id: 'joined'
    }] : [{
      event_id: 'joined'
    }, {
      event_id: 'joined'
    }, {
      event_id: 'left'
    }],
    count: 0,
    error: null
  }));
  mockRpc.mockResolvedValue({
    data: [{
      requested_at: '2025-01-01'
    }, {
      requested_at: '2026-01-01'
    }, {
      requested_at: 'bad'
    }, {
      requested_at: '2026-02-01'
    }],
    error: null
  });
  const f = await mount();
  expect(f.badge('chats/index')).toBe(1);
  expect(f.badge('friends')).toBe(1);
});
it('keeps existing prefix invalidation working', async () => {
  const f = await mount();
  mockRead.mockResolvedValue({
    data: [],
    count: 0,
    error: null
  });
  await act(async () => {
    await client.invalidateQueries({
      queryKey: ['unread-chats-count']
    });
  });
  await flush();
  expect(f.badge('chats/index')).toBeUndefined();
  expect(f.badge('friends')).toBe(3);
});
it('bounds stalled reads and permits refresh without losing confirmed counts', async () => {
  const f = await mount();
  jest.useFakeTimers();
  mockRead.mockReturnValue(new Promise(() => {}));
  mockRpc.mockReturnValue(new Promise(() => {}));
  let pending!: Promise<void>;
  act(() => {
    pending = client.invalidateQueries();
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(12001);
    await pending;
  });
  for (const prefix of [['unread-chats-count'], ['pending-invites-badge'], ['yours', 'requests-badge']]) expect(client.getQueryCache().find({
    queryKey: prefix,
    exact: false
  })?.state.fetchStatus).toBe('idle');
  expect(f.badge('chats/index')).toBe(2);
  expect(f.badge('friends')).toBe(3);
  mockRead.mockResolvedValue({
    data: [],
    count: 0,
    error: null
  });
  mockRpc.mockResolvedValue({
    data: [],
    error: null
  });
  await act(async () => {
    await client.invalidateQueries();
    await jest.advanceTimersByTimeAsync(5);
  });
  expect(f.badge('chats/index')).toBeUndefined();
  expect(f.badge('friends')).toBeUndefined();
});
it('bounds a stalled local seen-marker read', async () => {
  const f = await mount();
  jest.useFakeTimers();
  mockSeen.mockReturnValue(new Promise(() => {}));
  let pending!: Promise<void>;
  act(() => {
    pending = client.invalidateQueries({
      queryKey: ['yours', 'requests-badge']
    });
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(12001);
    await pending;
  });
  expect(f.badge('friends')).toBe(3);
  expect(client.getQueryCache().find({
    queryKey: ['yours', 'requests-badge'],
    exact: false
  })?.state.status).toBe('error');
});
it('retains an invitation dot after a failed count refresh', async () => {
  await mount();
  expect(client.getQueryCache().find({
    queryKey: ['pending-invites-badge'],
    exact: false
  })?.state.data).toBe(true);
  mockRead.mockResolvedValue({
    data: null,
    count: null,
    error: Error('offline')
  });
  await act(async () => {
    await client.invalidateQueries({
      queryKey: ['pending-invites-badge']
    });
  });
  expect(client.getQueryCache().find({
    queryKey: ['pending-invites-badge'],
    exact: false
  })?.state.data).toBe(true);
});
