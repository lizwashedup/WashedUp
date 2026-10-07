import React from 'react';
import { act, create } from 'react-test-renderer';
import PathsSheet from '../PathsSheet';
import { useObservedUser } from '../../../../hooks/useObservedUser';

const mockListeners = new Set<(event: string, session: any) => void>();
const mockGetUser = jest.fn(), mockEnsure = jest.fn();
let mockPresentations = 0, mockDismissals = 0;
jest.mock('../../../../lib/supabase', () => ({ supabase: { auth: {
  onAuthStateChange: (callback: any) => { mockListeners.add(callback); return { data: { subscription: { unsubscribe: () => mockListeners.delete(callback) } } }; },
  getUser: (...args: unknown[]) => mockGetUser(...args),
} } }));
jest.mock('../../../../hooks/useReferral', () => ({ useReferral: () => ({ ensureReferralCode: mockEnsure }) }));
jest.mock('../../../../lib/yours/invite', () => ({ openInviteComposer: jest.fn() }));
jest.mock('../HandleLookupView', () => ({ __esModule: true, default: () => null }));
jest.mock('../PlanHistoryBacklog', () => ({ __esModule: true, default: () => null }));
jest.mock('../QRShareView', () => ({ __esModule: true, default: () => null }));
jest.mock('../../primitives/BottomSheet', () => ({ __esModule: true, default: function Presentation(p: any) {
  require('react').useLayoutEffect(() => { mockPresentations++; return () => { mockDismissals++; }; }, []);
  return require('react').createElement('Presentation', p, p.children);
} }));
let visible = true;
function Screen() {
  const viewer = useObservedUser();
  // This is the existing screen's confirmed identity used to authorize Add.
  if (!viewer.viewerId) return null;
  return React.createElement(PathsSheet, { visible, userId: viewer.viewerId, viewer,
    backlogCount: 0, onClose: jest.fn(), onPressPerson: jest.fn() } as any);
}
const cleanup: Array<() => void> = [];
async function flush() { await act(async () => { for (let i=0;i<12;i++) await Promise.resolve(); }); }
async function open() {
  let tree!: ReturnType<typeof create>;
  act(() => { tree=create(<Screen/>); }); cleanup.push(() => act(() => tree.unmount()));
  await flush(); return tree;
}
function emit(id: string | null, event='SIGNED_IN') {
  act(() => { for (const listener of [...mockListeners]) listener(event, id ? { user: { id } } : null); });
}
beforeEach(() => { visible=true; mockPresentations=0; mockDismissals=0; mockGetUser.mockReset(); mockEnsure.mockReset();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'alice' } }, error: null }); });
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); mockListeners.clear(); });
it('presents once from the already-confirmed screen identity without replacing a presenting sheet for a second auth read', async () => {
  const tree=await open();
  expect(tree.root.findAllByType('Presentation' as any)).toHaveLength(1);
  expect({ reads: mockGetUser.mock.calls.length, presentations: mockPresentations, dismissals: mockDismissals }).toEqual({ reads: 1, presentations: 1, dismissals: 0 });
  const presentation=tree.root.findByType('Presentation' as any);
  emit('alice','TOKEN_REFRESHED'); await flush();
  expect(tree.root.findByType('Presentation' as any)).toBe(presentation);
  expect(mockPresentations).toBe(1); expect(mockDismissals).toBe(0);
});
it('retires a visible presentation on account change without presenting a replacement until an explicit new opening', async () => {
  const tree=await open();
  const oldInvite=tree.root.findAll(n=>n.props.accessibilityLabel==='Invite someone' && typeof n.props.onPress==='function')[0].props.onPress;
  emit('bob'); await flush();
  expect(tree.root.findAllByType('Presentation' as any)).toHaveLength(0);
  expect(mockPresentations).toBe(1); expect(mockDismissals).toBe(1);
  act(() => oldInvite()); await flush(); expect(mockEnsure).not.toHaveBeenCalled();
  emit('alice'); await flush(); expect(tree.root.findAllByType('Presentation' as any)).toHaveLength(0);
  visible=false; act(()=>tree.update(<Screen/>));
  visible=true; act(()=>tree.update(<Screen/>)); await flush();
  expect(tree.root.findAllByType('Presentation' as any)).toHaveLength(1);
  expect(mockPresentations).toBe(2);
});
