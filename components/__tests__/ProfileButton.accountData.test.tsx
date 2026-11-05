import React from 'react';
import { act, create } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Text } from 'react-native';
import ProfileButton from '../ProfileButton';
let mockAccount: string | null = 'alice',
  mockEpoch = 1,
  mockLoading = false,
  mockIdentityError: Error | null = null;
const mockRead = jest.fn(),
  mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    push: (...args: any[]) => mockPush(...args)
  }
}));
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true
}));
jest.mock('expo-image', () => ({
  Image: (props: any) => require('react').createElement('Photo', props)
}));
jest.mock('../InboxModal', () => () => null);
jest.mock('../creator/CreatorActionFill', () => ({
  CreatorActionFill: () => null
}));
jest.mock('../../hooks/useAfterglowFonts', () => ({
  useAfterglowFonts: () => ({
    fonts: jest.requireActual('../../constants/Typography').AfterglowFallbackFonts
  })
}));
jest.mock('../../hooks/useObservedUser', () => ({
  useObservedUser: () => {
    const epoch = mockEpoch;
    return {
      viewerId: mockAccount,
      epoch,
      isLoading: mockLoading,
      error: mockIdentityError,
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
      })
    },
    from: (table: string) => {
      let account: string | null = null;
      const result = () => mockRead(table, account);
      const q: any = {
        select: () => q,
        eq: (key: string, value: string) => {
          if (['id', 'recipient_id', 'user_id'].includes(key)) account = value;
          return q;
        },
        in: () => q,
        neq: () => q,
        or: () => q,
        single: () => result(),
        then: (yes: any, no: any) => Promise.resolve(result()).then(yes, no)
      };
      return q;
    }
  }
}));
let tree: ReturnType<typeof create> | undefined, client: QueryClient;
async function flush() {
  await act(async () => {
    await new Promise(r => setTimeout(r, 5));
  });
}
function render() {
  return <QueryClientProvider client={client}><ProfileButton /></QueryClientProvider>;
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
  return {
    update: () => act(() => tree!.update(render())),
    photos: () => tree!.root.findAllByType('Photo' as any).map(n => n.props.source.uri),
    text: () => tree!.root.findAllByType(Text).flatMap(n => n.props.children).join(' ')
  };
}
beforeEach(() => {
  mockAccount = 'alice';
  mockEpoch = 1;
  mockLoading = false;
  mockIdentityError = null;
  jest.clearAllMocks();
  mockRead.mockImplementation(async (table, account) => table === 'profiles' ? {
    data: {
      profile_photo_url: `https://example.test/${account}.png`
    },
    error: null
  } : table === 'plan_invites' ? {
    data: [],
    error: null
  } : {
    count: account === 'alice' ? 2 : 4,
    error: null
  });
});
afterEach(() => {
  if (tree) act(() => tree!.unmount());
  tree = undefined;
  client?.clear();
  jest.useRealTimers();
});
it('never shows the previous account photo or badge after an account switch', async () => {
  const f = await mount();
  expect(f.photos()).toEqual(['https://example.test/alice.png']);
  expect(f.text()).toContain('2');
  mockAccount = 'bob';
  mockEpoch++;
  f.update();
  expect(f.photos()).toEqual([]);
  expect(f.text()).not.toContain('2');
  await flush();
  expect(f.photos()).toEqual(['https://example.test/bob.png']);
  expect(f.text()).toContain('4');
});
it.each(['loading', 'error', 'signed-out'])('hides cached personal data while identity is %s', async state => {
  const f = await mount();
  if (state === 'loading') mockLoading = true;
  if (state === 'error') mockIdentityError = Error('offline');
  if (state === 'signed-out') {
    mockAccount = null;
    mockEpoch++;
  }
  f.update();
  expect(f.photos()).toEqual([]);
  expect(f.text()).not.toContain('2');
});
it('ignores a late photo from the previous account', async () => {
  let finish!: (x: any) => void;
  mockRead.mockImplementation((table, account) => table === 'profiles' && account === 'alice' ? new Promise(r => {
    finish = r;
  }) : Promise.resolve(table === 'profiles' ? {
    data: {
      profile_photo_url: 'https://example.test/bob.png'
    },
    error: null
  } : {
    data: [],
    count: 0,
    error: null
  }));
  const f = await mount();
  mockAccount = 'bob';
  mockEpoch++;
  f.update();
  await flush();
  await act(async () => finish({
    data: {
      profile_photo_url: 'https://example.test/alice.png'
    },
    error: null
  }));
  await flush();
  expect(f.photos()).toEqual(['https://example.test/bob.png']);
});
it('preserves existing prefix invalidation after a confirmed photo change', async () => {
  const f = await mount();
  mockRead.mockImplementation(async table => table === 'profiles' ? {
    data: {
      profile_photo_url: 'https://example.test/new.png'
    },
    error: null
  } : {
    data: [],
    count: 0,
    error: null
  });
  await act(async () => {
    await client.invalidateQueries({
      queryKey: ['profile-photo']
    });
  });
  await flush();
  expect(f.photos()).toEqual(['https://example.test/new.png']);
});
it('keeps the current badge during a failed refresh instead of confirming a false zero', async () => {
  const f = await mount();
  expect(f.text()).toContain('2');
  mockRead.mockImplementation(async table => table === 'plan_invites' ? {
    data: null,
    error: Error('offline')
  } : {
    count: null,
    error: null
  });
  await act(async () => {
    await client.invalidateQueries({
      queryKey: ['inbox-count']
    });
  });
  await flush();
  expect(f.text()).toContain('2');
  expect(client.getQueryCache().find({
    queryKey: ['inbox-count'],
    exact: false
  })?.state.status).toBe('error');
});
it('finishes a stalled photo refresh and permits a later explicit refresh', async () => {
  const f = await mount();
  jest.useFakeTimers();
  mockRead.mockReturnValue(new Promise(() => {}));
  let refresh!: Promise<void>;
  act(() => {
    refresh = client.invalidateQueries({
      queryKey: ['profile-photo']
    });
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(12001);
    await refresh;
  });
  expect(client.getQueryCache().find({
    queryKey: ['profile-photo'],
    exact: false
  })?.state.fetchStatus).toBe('idle');
  expect(f.photos()).toEqual(['https://example.test/alice.png']);
  mockRead.mockResolvedValue({
    data: {
      profile_photo_url: 'https://example.test/recovered.png'
    },
    error: null
  });
  await act(async () => {
    await client.invalidateQueries({
      queryKey: ['profile-photo']
    });
    await jest.advanceTimersByTimeAsync(5);
  });
  expect(f.photos()).toEqual(['https://example.test/recovered.png']);
});
