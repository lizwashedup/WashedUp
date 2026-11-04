const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { applyScreenStackRetirement } = require('./screen-stack-retirement.cjs');
const manifest = require('../../patches/screen-stack-retirement.json');
const original = fs.readFileSync(require.resolve('react-native-screens/ios/RNSScreenStack.mm'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function fixture(t) {
  assert.equal(hash(original), manifest.baselineSha256, 'Tests require the original pinned dependency; use a clean install.');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'washedup-native-patch-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dependency = path.join(root, 'node_modules/react-native-screens');
  const target = path.join(dependency, manifest.file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(path.join(dependency, 'package.json'), JSON.stringify({ version: manifest.version }));
  fs.writeFileSync(target, original);
  return { root, dependency, target };
}

test('applies the exact reviewed native source and verifies an idempotent re-run', t => {
  const { root, target } = fixture(t);
  assert.equal(applyScreenStackRetirement(root).status, 'applied');
  assert.equal(hash(fs.readFileSync(target)), manifest.patchedSha256);
  assert.equal(applyScreenStackRetirement(root).status, 'already-applied');
  assert.equal(applyScreenStackRetirement(root, { checkOnly: true }).status, 'already-applied');
});

test('check mode refuses unpatched input without changing it', t => {
  const { root, target } = fixture(t);
  assert.throws(() => applyScreenStackRetirement(root, { checkOnly: true }), /not been applied/);
  assert.deepEqual(fs.readFileSync(target), original);
});

test('unknown native source is preserved and rejected', t => {
  const { root, target } = fixture(t);
  const changed = Buffer.concat([original, Buffer.from('\n// Unreviewed change\n')]);
  fs.writeFileSync(target, changed);
  assert.throws(() => applyScreenStackRetirement(root), /source has drifted/);
  assert.deepEqual(fs.readFileSync(target), changed);
});

test('a dependency upgrade requires explicit patch review', t => {
  const { root, dependency, target } = fixture(t);
  fs.writeFileSync(path.join(dependency, 'package.json'), JSON.stringify({ version: '4.17.0' }));
  assert.throws(() => applyScreenStackRetirement(root), /dependency version/);
  assert.deepEqual(fs.readFileSync(target), original);
});

test('shared dependencies cannot be mutated through a worktree symlink', t => {
  const source = fixture(t);
  const consumer = fs.mkdtempSync(path.join(os.tmpdir(), 'washedup-native-consumer-'));
  t.after(() => fs.rmSync(consumer, { recursive: true, force: true }));
  fs.symlinkSync(path.join(source.root, 'node_modules'), path.join(consumer, 'node_modules'), 'dir');
  assert.throws(() => applyScreenStackRetirement(consumer), /private, in-project/);
  assert.deepEqual(fs.readFileSync(source.target), original);
});

test('a native source symlink cannot escape the private dependency', t => {
  const source = fixture(t);
  const consumer = fixture(t);
  fs.unlinkSync(consumer.target);
  fs.symlinkSync(source.target, consumer.target);
  assert.throws(() => applyScreenStackRetirement(consumer.root), /private, in-project/);
  assert.deepEqual(fs.readFileSync(source.target), original);
});

test('loading the prebuild plugin never mutates shared native dependencies', () => {
  const before = fs.readFileSync(require.resolve('react-native-screens/ios/RNSScreenStack.mm'));
  assert.equal(typeof require('../../plugins/withScreenStackRetirement'), 'function');
  assert.deepEqual(fs.readFileSync(require.resolve('react-native-screens/ios/RNSScreenStack.mm')), before);
});
