const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { verifyTarget } = require('../scripts/verify-android-ota-target.cjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'android-target-'));
  try {
    const pkg = JSON.stringify({ dependencies: { expo: '54.0.0' }, scripts: { test: 'old' } });
    const files = { 'app.json': JSON.stringify({ expo: { version: '1.0.7', android: { package: 'com.example.app', versionCode: 18 } } }),
      'app.config.js': 'original config', 'eas.json': '{}', 'package-lock.json': 'original lock', 'package.json': pkg };
    for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(root, name), bytes);
    const artifact = Buffer.from('reviewed archive');
    const metadata = { runtime: 'a'.repeat(40), updateId: 'embedded-id' };
    const target = { sourceType: 'manual-store-bundle', version: '1.0.7', buildNumber: '18', packageIdentifier: 'com.example.app',
      runtimeVersion: metadata.runtime, embeddedUpdateId: metadata.updateId, reviewedNativeCommit: 'b'.repeat(40), artifactSha256: sha(artifact),
      sourcePackageSha256: sha(pkg), reviewedInputHashes: Object.fromEntries(Object.entries(files).filter(([f]) => f !== 'package.json').map(([f, bytes]) => [f, sha(bytes)])) };
    run({ root, target, artifact, metadata, pkg, verify: () => verifyTarget(root, target, artifact, metadata, pkg) });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
test('accepts verified native contract while allowing command-only package changes', () => fixture(f => {
  fs.writeFileSync(path.join(f.root, 'package.json'), JSON.stringify({ dependencies: { expo: '54.0.0' }, scripts: { test: 'new' } }));
  assert.doesNotThrow(f.verify);
}));
test('rejects a different archive', () => fixture(f => { f.target.artifactSha256 = '0'.repeat(64); assert.throws(f.verify, /archive/); }));
test('rejects a wrong runtime or embedded update', () => fixture(f => {
  f.metadata.runtime = 'c'.repeat(40); assert.throws(f.verify, /runtime/);
  f.metadata.runtime = f.target.runtimeVersion; f.metadata.updateId = 'other'; assert.throws(f.verify, /runtime/);
}));
test('rejects changed native configuration and incomplete pins', () => fixture(f => {
  fs.writeFileSync(path.join(f.root, 'app.config.js'), 'changed'); assert.throws(f.verify, /native input changed/);
  delete f.target.reviewedInputHashes['app.config.js']; assert.throws(f.verify, /Missing/);
}));
test('rejects changed native dependencies', () => fixture(f => {
  fs.writeFileSync(path.join(f.root, 'package.json'), JSON.stringify({ dependencies: { expo: '55.0.0' } })); assert.throws(f.verify, /outside scripts/);
}));
test('rejects wrong package identity and malformed target', () => fixture(f => {
  f.target.buildNumber = '19'; assert.throws(f.verify, /package\/version/);
  f.target.runtimeVersion = ''; assert.throws(f.verify, /Incomplete/);
}));
