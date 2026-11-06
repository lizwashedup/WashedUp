const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const patchDirectory = path.resolve(__dirname, '../../patches');
const manifest = require('../../patches/screen-stack-retirement.json');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function within(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..' + path.sep)
    && relative !== '..' && !path.isAbsolute(relative);
}

function applyScreenStackRetirement(projectRoot, { checkOnly = false } = {}) {
  const root = fs.realpathSync(projectRoot);
  const dependencies = fs.realpathSync(path.join(root, 'node_modules'));
  const dependency = fs.realpathSync(path.join(dependencies, manifest.package));
  const target = fs.realpathSync(path.join(dependency, manifest.file));
  // Several WashedUp worktrees share dependencies. A native build must use its
  // own copy; never silently patch another checkout's installed library.
  if (!within(root, dependencies) || !within(dependencies, dependency) || !within(dependency, target)) {
    throw new Error('Native retirement patch requires private, in-project dependencies.');
  }
  const version = JSON.parse(fs.readFileSync(path.join(dependency, 'package.json'), 'utf8')).version;
  if (version !== manifest.version) throw new Error('Review the native retirement patch for this dependency version.');
  const patch = fs.readFileSync(path.join(patchDirectory, manifest.patch));
  if (digest(patch) !== manifest.patchSha256) throw new Error('Native retirement patch payload has drifted.');
  const original = fs.readFileSync(target);
  const inputHash = digest(original);
  if (inputHash === manifest.patchedSha256) return { status: 'already-applied', sha256: inputHash };
  if (inputHash !== manifest.baselineSha256) throw new Error('Native screen-stack source has drifted; refusing to modify it.');
  if (checkOnly) throw new Error('Native screen-stack retirement patch has not been applied.');

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'washedup-native-patch-'));
  let replacement;
  try {
    const output = path.join(temporary, 'RNSScreenStack.mm');
    const result = spawnSync('patch', ['--batch', '--fuzz=0', '-o', output, target], {
      input: patch, encoding: 'utf8', timeout: 30000,
    });
    if (result.error || result.status !== 0) throw new Error('Native retirement patch could not be applied cleanly.');
    const patched = fs.readFileSync(output);
    if (digest(patched) !== manifest.patchedSha256) throw new Error('Native retirement patch output did not match the reviewed source.');
    // Write beside the original and replace atomically only after verification.
    replacement = path.join(path.dirname(target), '.washedup-retirement-' + crypto.randomUUID());
    fs.writeFileSync(replacement, patched, { flag: 'wx', mode: fs.statSync(target).mode & 0o777 });
    if (digest(fs.readFileSync(target)) !== inputHash) throw new Error('Native source changed while preparing the patch.');
    fs.renameSync(replacement, target);
    replacement = undefined;
    return { status: 'applied', sha256: manifest.patchedSha256 };
  } finally {
    if (replacement) fs.rmSync(replacement, { force: true });
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

module.exports = { applyScreenStackRetirement };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--check')) throw new Error('Usage: node scripts/native/screen-stack-retirement.cjs [--check]');
  console.log(JSON.stringify(applyScreenStackRetirement(process.cwd(), { checkOnly: args.includes('--check') })));
}
