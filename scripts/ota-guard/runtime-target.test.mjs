import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const expectedRuntime = '17b471ae2a908d2805483436b15fd0059dd95572';

function readRuntime(extraEnv = {}) {
  const result = spawnSync(
    process.execPath,
    ['-e', "process.stdout.write(JSON.stringify(require('./app.config.js').expo.runtimeVersion))"],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, WASHEDUP_OTA_RUNTIME_VERSION: '', EAS_BUILD: '', ...extraEnv },
    },
  );
  return result;
}

test('normal app config keeps fingerprint policy', () => {
  const result = readRuntime();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { policy: 'fingerprint' });
});

test('guarded OTA export can target the exact build runtime', () => {
  const result = readRuntime({ WASHEDUP_OTA_RUNTIME_VERSION: expectedRuntime });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), expectedRuntime);
});

test('native builds reject the OTA runtime override', () => {
  const result = readRuntime({
    WASHEDUP_OTA_RUNTIME_VERSION: expectedRuntime,
    EAS_BUILD: 'true',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /guarded OTA exports only/);
});

