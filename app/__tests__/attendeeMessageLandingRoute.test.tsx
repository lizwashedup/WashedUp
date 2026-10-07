import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
// Execute the real route boundary, without mounting the unchanged event renderer.
const source = fs.readFileSync(path.join(__dirname, '../event/[id].tsx'), 'utf8');
const start = source.indexOf('export default function EventDetailRoute()');
const end = source.indexOf('\nfunction EventDetailScreen(', start);
if (start < 0 || end < 0) throw Error('Event route boundary changed');
const code = ts.transpileModule(source.slice(start, end).replace('export default ', '') + '\nglobalThis.route=EventDetailRoute;', {
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
function route(params: unknown, enabled = true) {
  const context: any = { React, COMMUNITIES_ENABLED: enabled, CREATOR_PAGES_ENABLED: true,
    useLocalSearchParams: () => params, AttendeeMessageLanding: 'UpdateReader', EventDetailScreen: 'OriginalEvent', CreatorPageEventGate: 'OriginalGate' };
  vm.runInNewContext(code, context);
  return context.route();
}
it('lands the original notification inside its event route before event loading', () => {
  const result = route({ id: 'event', notificationId: 'notice' });
  expect(result.type).toBe('UpdateReader');
  expect(result.props).toEqual({ eventId: 'event', notificationId: 'notice' });
});
it('preserves ordinary event entry and gated builds', () => {
  expect(route({ id: 'event' }).type).toBe('OriginalEvent');
  expect(route({ id: 'event', notificationId: 'notice' }, false).type).toBe('OriginalEvent');
});
it('preserves the exact-page private preview gate even with an update hint', () => {
  const result = route({ id: 'event', preview: 'guest', pageId: 'page', team: '1', notificationId: 'notice' });
  expect(result.type).toBe('OriginalGate');
  expect(result.props).toMatchObject({ pageId: 'page', eventId: 'event', team: true });
});
