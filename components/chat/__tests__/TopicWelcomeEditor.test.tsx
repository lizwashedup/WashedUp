import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { TextInput, TouchableOpacity } from 'react-native';
const mockRead = jest.fn(), mockDraft = jest.fn(), mockPrepare = jest.fn(), mockSend = jest.fn(), mockCheck = jest.fn(), mockFinish = jest.fn();
jest.mock('../../../lib/topicWelcome', () => ({ readTopicWelcome: (...a: any[]) => mockRead(...a), saveTopicWelcomeDraft: (...a: any[]) => mockDraft(...a), prepareTopicWelcome: (...a: any[]) => mockPrepare(...a), sendTopicWelcome: (...a: any[]) => mockSend(...a), checkTopicWelcome: (...a: any[]) => mockCheck(...a), finishTopicWelcome: (...a: any[]) => mockFinish(...a) }));
import { TopicWelcomeEditor } from '../TopicWelcomeEditor';
let tree: ReactTestRenderer, live: boolean, state: any, owner: any, canCreate: boolean;
const saved = jest.fn();
const attempt = { id: 'original', topicId: 'room', eventId: 'event', userId: 'creator', text: 'Welcome everyone' };
const button = (name: string) => tree.root.findAllByType(TouchableOpacity).find(n => n.props.accessibilityLabel === name);
const text = () => JSON.stringify(tree.toJSON());
const props = () => ({ topicId: 'room', eventId: 'event', owner, canCreate, onSaved: saved });
async function mount() { await act(async () => { tree = create(<TopicWelcomeEditor {...props()} />); }); }
async function press(name: string) { await act(async () => { button(name)!.props.onPress(); }); }
async function type(value: string) { await act(async () => { tree.root.findByType(TextInput).props.onChangeText(value); }); }
beforeEach(() => {
  jest.resetAllMocks(); live = true; canCreate = true; owner = { userId: 'creator', isCurrent: () => live }; state = { text: '', attempt: null }; saved.mockResolvedValue(undefined);
  mockRead.mockImplementation(async () => ({ ...state })); mockDraft.mockImplementation(async (_t, _e, _o, value) => { state = { ...state, text: value }; });
  mockPrepare.mockImplementation(async () => { state = { ...state, attempt }; return attempt; }); mockSend.mockRejectedValue(Error('No acknowledgement')); mockCheck.mockResolvedValue(null);
  mockFinish.mockImplementation(async () => { state = { text: state.text === attempt.text ? '' : state.text, attempt: null }; return state; });
});
afterEach(() => { act(() => tree?.unmount()); });
it('Close and return keep the draft without dispatching', async () => {
  await mount(); await press('+ Add welcome'); await type(attempt.text); await press('Close'); expect(button('Resume welcome')).toBeDefined();
  await press('Resume welcome'); expect(tree.root.findByType(TextInput).props.value).toBe(attempt.text); act(() => tree.unmount()); await mount(); expect(tree.root.findByType(TextInput).props.value).toBe(attempt.text); expect(mockSend).not.toHaveBeenCalled();
});
it('same-frame repeated Save creates one attempt and preserves uncertain recovery', async () => {
  state.text = attempt.text; await mount(); const tap = button('Save welcome')!.props.onPress; await act(async () => { tap(); tap(); });
  expect(mockPrepare).toHaveBeenCalledTimes(1); expect(mockSend).toHaveBeenCalledTimes(1); expect(button('Check welcome')).toBeDefined(); expect(text()).toContain('Waiting to confirm');
});
it('Check is read-only and preserves newer typing after confirmation', async () => {
  state = { text: 'Newer draft', attempt }; mockCheck.mockResolvedValue({ id: attempt.id }); await mount(); await press('Check welcome');
  expect(mockSend).not.toHaveBeenCalled(); expect(tree.root.findByType(TextInput).props.value).toBe('Newer draft'); expect(saved).toHaveBeenCalledTimes(1);
});
it('Retry submits the saved original, never the newer draft', async () => {
  state = { text: 'Newer draft', attempt }; await mount(); await press('Retry save'); expect(mockPrepare).not.toHaveBeenCalled(); expect(mockSend).toHaveBeenCalledWith(attempt, owner);
});
it('keeps receipt checking available after another message arrives', async () => {
  state = { text: attempt.text, attempt }; canCreate = false; await mount(); expect(button('Check welcome')).toBeDefined(); expect(button('Retry save')).toBeUndefined();
  mockCheck.mockResolvedValue({ id: attempt.id }); await press('Check welcome'); expect(saved).toHaveBeenCalledTimes(1); expect(tree.toJSON()).toBeNull();
});
it('failed storage blocks sending and offers explicit draft recovery', async () => {
  state = { text: attempt.text, attempt: null, unsaved: true }; await mount(); expect(button('Save welcome')!.props.disabled).toBe(true);
  state.unsaved = false; await press('Try draft again'); expect(button('Save welcome')!.props.disabled).toBe(false); expect(mockSend).not.toHaveBeenCalled();
});
it('a retired account cannot activate a captured save and another account never renders its draft', async () => {
  state.text = attempt.text; await mount(); const save = button('Save welcome')!.props.onPress; live = false; await act(async () => save()); expect(mockPrepare).not.toHaveBeenCalled();
  owner = { userId: 'other', isCurrent: () => true }; state = { text: '', attempt: null }; await act(async () => tree.update(<TopicWelcomeEditor {...props()} />)); expect(text()).not.toContain(attempt.text);
});
it('late old-room draft result cannot replace the current room', async () => {
  let finish!: (value: any) => void; mockRead.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await mount();
  await act(async () => tree.update(<TopicWelcomeEditor {...props()} topicId="new-room" />));
  await act(async () => finish({ text: 'Previous private draft', attempt: null })); expect(text()).not.toContain('Previous private draft');
});
it('late local confirmation cleanup cannot erase text typed while it finishes', async () => {
  state = { text: attempt.text, attempt }; mockCheck.mockResolvedValue({ id: attempt.id });
  let finish!: (value: any) => void; mockFinish.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await press('Check welcome'); await type('Typed during cleanup');
  await act(async () => finish({ text: '', attempt: null }));
  expect(tree.root.findByType(TextInput).props.value).toBe('Typed during cleanup');
});
it('late uncertain-save storage read cannot replace more recent typing', async () => {
  state.text = attempt.text; await mount(); let finish!: (value: any) => void;
  mockRead.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await press('Save welcome'); await type('Typed during recovery');
  await act(async () => finish({ text: attempt.text, attempt }));
  expect(tree.root.findByType(TextInput).props.value).toBe('Typed during recovery'); expect(button('Check welcome')).toBeDefined();
});
it('initial conversation effects activate the visit before the welcome draft read', async () => {
  live = false;
  mockRead.mockImplementation(async () => { if (!owner.isCurrent()) throw Error('Visit not active'); return { text: '', attempt: null }; });
  function Conversation() { React.useEffect(() => { live = true; }, []); return <TopicWelcomeEditor {...props()} />; }
  await act(async () => { tree = create(<Conversation />); });
  expect(button('+ Add welcome')).toBeDefined();
  expect(button('Try draft again')).toBeUndefined();
});
it('an ordinary attendee does not see creator recovery when its local draft read fails', async () => {
  canCreate = false; mockRead.mockRejectedValue(Error('Local draft read failed'));
  await act(async () => { tree = create(<TopicWelcomeEditor {...props()} canManage={false} />); });
  expect(tree.toJSON()).toBeNull(); expect(mockSend).not.toHaveBeenCalled();
});
it('an authorized creator can recover a failed draft read after the room becomes nonempty', async () => {
  canCreate = false; mockRead.mockRejectedValue(Error('Local draft read failed'));
  await act(async () => { tree = create(<TopicWelcomeEditor {...props()} canManage />); });
  expect(button('Try draft again')).toBeDefined(); expect(button('Save welcome')).toBeUndefined();
});
