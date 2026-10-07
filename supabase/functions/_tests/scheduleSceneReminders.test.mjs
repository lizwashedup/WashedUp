import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import { isAuthorizedRunToken } from '../_shared/runTokenAuth.ts';

const source = stripTypeScriptTypes(readFileSync(new URL('../schedule-scene-reminders/index.ts', import.meta.url), 'utf8').replace(/^import .*\r?\n/gm, ''));
function fixture({ data = 0, error = null, throws = false, secret = 'synthetic-scheduler' } = {}) {
  let handler; const calls = [];
  vm.runInNewContext(source, {
    Response, Number, console: { error() {} }, isAuthorizedRunToken,
    Deno: { serve(value) { handler = value; }, env: { get: key => ({ SCENE_REMINDER_RUN_TOKEN: secret, SUPABASE_URL: 'https://isolated.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-key' })[key] } },
    createClient(url, key) {
      calls.push({ url, key });
      return { async rpc(name, args) { calls.push({ name, args: JSON.parse(JSON.stringify(args)) }); if (throws) throw Error('Unknown transport'); return { data, error }; } };
    },
  });
  return { calls, run: async (method = 'POST', token = 'synthetic-scheduler') => {
    const response = await handler(new Request('https://handler.invalid', { method, headers: { 'x-run-token': token } }));
    return { response, body: await response.json() };
  } };
}
test('rejects non-POST and unauthorized requests before creating a database client', async () => {
  for (const [method, token, status] of [['GET', 'synthetic-scheduler', 405], ['POST', '', 403], ['POST', 'wrong', 403]]) {
    const f = fixture(); const r = await f.run(method, token); assert.equal(r.response.status, status); assert.equal(f.calls.length, 0);
  }
  const f = fixture({ secret: '' }); assert.equal((await f.run()).response.status, 403); assert.equal(f.calls.length, 0);
});
for (const count of [0, 1, 500]) test(`confirmed queue of ${count} never claims provider delivery`, async () => {
  const f = fixture({ data: count }), r = await f.run();
  assert.equal(r.response.status, 200); assert.equal(r.response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(r.body, { queued: count, providerDeliveryConfirmed: false });
  assert.deepEqual(f.calls[1], { name: 'queue_scene_event_reminders', args: { p_limit: 500 } });
});
for (const options of [{ error: { message: 'private database detail' } }, { throws: true }, { data: null }, { data: '1' }, { data: -1 }, { data: 501 }, { data: 1.5 }]) test(`unknown or malformed queue receipt fails explicitly: ${JSON.stringify(options)}`, async () => {
  const f = fixture(options), r = await f.run(); assert.equal(r.response.status, 503);
  assert.deepEqual(r.body, { error: 'Reminder scheduling could not be confirmed' });
  assert.equal(f.calls.length, 2);
});
