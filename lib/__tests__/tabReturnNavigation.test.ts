import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { TabRouter, TabActions, CommonActions } from '@react-navigation/routers';

// Read the configured navigator, then exercise the installed router rather
// than mocking router.back (which cannot expose an incorrect destination).
const source = ts.createSourceFile('layout.tsx', fs.readFileSync(
  path.join(__dirname, '../../app/(tabs)/_layout.tsx'), 'utf8',
), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let backBehavior: any;
const names: string[] = [];
function visit(node: ts.Node) {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    const tag = node.tagName.getText(source);
    for (const prop of node.attributes.properties) {
      if (!ts.isJsxAttribute(prop) || !prop.initializer || !ts.isStringLiteral(prop.initializer)) continue;
      if (tag === 'Tabs' && prop.name.getText(source) === 'backBehavior') backBehavior = prop.initializer.text;
      if (tag === 'Tabs.Screen' && prop.name.getText(source) === 'name') names.push(prop.initializer.text);
    }
  }
  ts.forEachChild(node, visit);
}
visit(source);
const options = { routeNames: names, routeParamList: {}, routeGetIdList: {} };
const router = TabRouter({ backBehavior });
const initial = () => router.getInitialState(options);
const go = (state: ReturnType<typeof initial>, name: string, params?: object) =>
  router.getRehydratedState(router.getStateForAction(state, TabActions.jumpTo(name, params), options)!, options);
const back = (state: ReturnType<typeof initial>) => {
  const next = router.getStateForAction(state, CommonActions.goBack(), options);
  return next ? router.getRehydratedState(next, options) : null;
};
const active = (state: ReturnType<typeof initial>) => state.routes[state.index];

describe('Profile return navigation', () => {
  it.each(['plans/index', 'explore/index', 'post/index', 'chats/index', 'friends/index', 'chats/[id]', 'chats/circle/[id]'])(
    'returns to %s after Profile without discarding source parameters', (origin) => {
      expect(names).toContain(origin);
      const params = { id: 'fictional-conversation', marker: 'retained' };
      const previous = go(initial(), origin, params);
      const profile = go(previous, 'profile');
      const returned = back(profile)!;
      expect(active(returned)).toEqual(active(previous));
      expect(active(returned).params).toEqual(params);
    },
  );
  it('does not create a Profile loop after repeated visits', () => {
    let state = go(initial(), 'chats/index');
    state = go(state, 'chats/[id]', { id: 'first' });
    for (let i = 0; i < 3; i++) state = back(go(state, 'profile'))!;
    expect(active(state).name).toBe('chats/[id]');
    expect(active(back(state)!).name).toBe('chats/index');
    expect(active(back(back(state)!)!).name).toBe('plans/index');
  });
  it('returns to the latest conversation parameters after switching chats', () => {
    let state = go(initial(), 'chats/[id]', { id: 'first' });
    state = back(go(state, 'profile'))!;
    state = go(state, 'chats/[id]', { id: 'second' });
    expect(active(back(go(state, 'profile'))!).params).toEqual({ id: 'second' });
  });
  it('leaves Back at the initial route unhandled for the parent navigator', () => {
    expect(back(initial())).toBeNull();
  });
});
