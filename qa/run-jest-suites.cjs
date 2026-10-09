const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const activeChildren = new Set();

// Native React/Jest suites must not share a process after a timed-out act().
// Discover through Jest itself: never maintain a hand-picked release allowlist.
function runProcess(command, args, { cwd, log, timeoutMs }) {
  return new Promise((resolve) => {
    const output = fs.openSync(log, 'w');
    const child = spawn(command, args, { cwd, stdio: ['ignore', output, output], detached: process.platform !== 'win32' });
    fs.closeSync(output);
    let timedOut = false, killTimer, spawnError;
    function kill(signal) {
      if (!child.pid) return;
      try {
        if (process.platform !== 'win32') process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch (error) { if (error.code !== 'ESRCH') spawnError = error.message; }
    }
    activeChildren.add(kill);
    const timer = setTimeout(() => {
      timedOut = true;
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), 1000);
    }, timeoutMs);
    child.on('error', error => { spawnError = error.message; });
    child.on('close', (code, signal) => {
      if (timedOut) kill('SIGKILL'); // Also retire descendants if the group leader already exited.
      activeChildren.delete(kill);
      clearTimeout(timer); clearTimeout(killTimer);
      resolve({ code, signal, timedOut, spawnError });
    });
  });
}

function passed(result, report) {
  return result.code === 0 && !result.signal && !result.timedOut && !result.spawnError &&
    report?.success === true && report.numFailedTests === 0 && report.numFailedTestSuites === 0 &&
    report.numRuntimeErrorTestSuites === 0 && report.numTotalTestSuites === 1 && report.numTotalTests > 0;
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const jest = require.resolve('jest/bin/jest');
  const discovered = spawnSync(process.execPath, [jest, '--listTests', '--json', '--runInBand'], { cwd: root, encoding: 'utf8', timeout: 60000 });
  if (discovered.status !== 0) throw new Error(`Jest discovery failed: ${discovered.stderr || discovered.error || discovered.signal}`);
  const suites = JSON.parse(discovered.stdout);
  if (!Array.isArray(suites) || suites.length === 0 || new Set(suites).size !== suites.length || suites.some(s => typeof s !== 'string' || !path.isAbsolute(s))) {
    throw new Error('Jest discovery returned an empty or invalid suite inventory');
  }
  const output = fs.mkdtempSync(path.join(process.env.WASHEDUP_QA_OUTPUT_PARENT || os.tmpdir(), 'washedup-jest-'));
  fs.writeFileSync(path.join(output, 'inventory.json'), JSON.stringify(suites, null, 2));
  console.log(`Running all ${suites.length} discovered suites in separate processes. Evidence: ${output}`);
  const results = [];
  let next = 0;
  async function worker() {
    while (next < suites.length) {
      const index = next++, suite = suites[index];
      const reportPath = path.join(output, `${index}.json`), log = path.join(output, `${index}.log`);
      const outcome = await runProcess(process.execPath, [jest, '--runInBand', '--ci', '--silent', '--json', '--outputFile', reportPath, '--runTestsByPath', suite], { cwd: root, log, timeoutMs: 120000 });
      let report;
      try { report = JSON.parse(fs.readFileSync(reportPath, 'utf8')); } catch { /* Missing/malformed reports fail below. */ }
      const ok = passed(outcome, report);
      results.push({ suite: path.relative(root, suite), ...outcome, passed: ok, testsPassed: report?.numPassedTests || 0, testsFailed: report?.numFailedTests || 0, testsPending: report?.numPendingTests || 0, log, reportPath });
      fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(results, null, 2));
      if (!ok) {
        console.error(`FAIL ${path.relative(root, suite)} ${JSON.stringify(outcome)}\n${fs.readFileSync(log, 'utf8')}`);
      } else if (results.length % 25 === 0 || results.length === suites.length) {
        console.log(`${results.length}/${suites.length} suites completed`);
      }
    }
  }
  await Promise.all([worker(), worker()]);
  const failed = results.filter(r => !r.passed);
  console.log(JSON.stringify({ suites: results.length, passed: results.length - failed.length, failed: failed.length, testsPassed: results.reduce((n, r) => n + r.testsPassed, 0), testsPending: results.reduce((n, r) => n + r.testsPending, 0), output }));
  if (failed.length || results.length !== suites.length) process.exitCode = 1;
}

module.exports = { runProcess, passed };
if (require.main === module) {
  // CI cancellation must not leave detached suites running after the gate exits.
  process.once('exit', () => { for (const kill of activeChildren) kill('SIGKILL'); });
  process.once('SIGINT', () => process.exit(130));
  process.once('SIGTERM', () => process.exit(143));
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
