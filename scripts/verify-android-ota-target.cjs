const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { verifyPackage } = require('./verify-ota-package.cjs');

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function verifyTarget(root, target, artifact, metadata, sourcePackage) {
  if (target.sourceType !== 'manual-store-bundle' || !/^[a-f0-9]{40}$/.test(target.runtimeVersion || '') ||
      !/^[a-f0-9]{40}$/.test(target.reviewedNativeCommit || '') || !/^[a-f0-9]{64}$/.test(target.artifactSha256 || '')) {
    throw new Error('Incomplete Android store target');
  }
  if (sha(artifact) !== target.artifactSha256) throw new Error('Android archive differs from the verified store bundle');
  if (metadata.runtime !== target.runtimeVersion || metadata.updateId !== target.embeddedUpdateId) {
    throw new Error('Android embedded runtime/update does not match the store target');
  }
  for (const required of ['app.json', 'app.config.js', 'eas.json', 'package-lock.json']) {
    if (!target.reviewedInputHashes?.[required]) throw new Error(`Missing Android input pin: ${required}`);
  }
  for (const [file, expected] of Object.entries(target.reviewedInputHashes)) {
    if (path.isAbsolute(file) || file.split(/[\\/]/).includes('..') || !/^[a-f0-9]{64}$/.test(expected)) {
      throw new Error('Invalid Android native input pin');
    }
    if (sha(fs.readFileSync(path.join(root, file))) !== expected) throw new Error(`Android native input changed: ${file}`);
  }
  verifyPackage(sourcePackage, fs.readFileSync(path.join(root, 'package.json')), target.sourcePackageSha256);
  const expo = JSON.parse(fs.readFileSync(path.join(root, 'app.json'))).expo;
  if (expo.android.package !== target.packageIdentifier || String(expo.android.versionCode) !== target.buildNumber || expo.version !== target.version) {
    throw new Error('Android package/version differs from the verified store target');
  }
}

module.exports = { verifyTarget };
if (require.main === module) {
  try {
    const target = JSON.parse(fs.readFileSync('scripts/ota-guard-state/android-release-candidate.json'));
    const artifact = fs.readFileSync(target.artifactPath);
    // Only read the archive whose complete bytes were independently pinned.
    if (sha(artifact) !== target.artifactSha256) throw new Error('Android archive hash mismatch');
    const metadata = JSON.parse(execFileSync('python3', ['-c',
      "import zipfile,json,sys; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({'runtime':z.read('base/assets/fingerprint').decode().strip(),'updateId':json.loads(z.read('base/assets/app.manifest'))['id']}))",
      target.artifactPath], { encoding: 'utf8' }));
    verifyTarget(process.cwd(), target, artifact, metadata, fs.readFileSync(target.sourcePackagePath));
    console.log(`Verified Android ${target.buildNumber} archive, runtime and native inputs.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
