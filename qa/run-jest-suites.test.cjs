const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runProcess, passed } = require('./run-jest-suites.cjs');
const good = { success: true, numFailedTests: 0, numFailedTestSuites: 0, numRuntimeErrorTestSuites: 0, numTotalTestSuites: 1, numTotalTests: 1 };

test('requires a successful process and a complete single-suite Jest report', () => {
  assert.equal(passed({ code: 0 }, good), true);
  for (const outcome of [{ code: 1 }, { code: null }, { code: 0, signal: 'SIGTERM' }, { code: 0, timedOut: true }, { code: 0, spawnError: 'missing executable' }]) assert.equal(passed(outcome, good), false);
  for (const report of [undefined, {}, { ...good, success: false }, { ...good, numFailedTests: 1 }, { ...good, numFailedTestSuites: 1 }, { ...good, numRuntimeErrorTestSuites: 1 }, { ...good, numTotalTestSuites: 0 }, { ...good, numTotalTests: 0 }]) assert.equal(passed({ code: 0 }, report), false);
});

test('a stalled child is terminated and cannot become a passing suite', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wu-runner-contract-'));
  try {
    const result = await runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: dir, log: path.join(dir, 'log'), timeoutMs: 100 });
    assert.equal(result.timedOut, true);
    assert.equal(passed(result, good), false);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('retains failing output and the real exit code', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wu-runner-contract-'));
  try {
    const log = path.join(dir, 'log');
    const result = await runProcess(process.execPath, ['-e', 'console.error("fixture failure"); process.exitCode = 3'], { cwd: dir, log, timeoutMs: 5000 });
    assert.equal(result.code, 3);
    assert.match(fs.readFileSync(log, 'utf8'), /fixture failure/);
  } finally { fs.rmSync(dir, { recursive: true }); }
});
