const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

function verifyPackage(archived, current, expectedSha) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha) || createHash('sha256').update(archived).digest('hex') !== expectedSha) {
    throw new Error('Archived package.json does not match the pinned signed-build input');
  }
  const reference = JSON.parse(archived), candidate = JSON.parse(current);
  // Commands do not change installed native modules. Every other field remains
  // part of the signed-build contract, including overrides and app metadata.
  delete reference.scripts;
  delete candidate.scripts;
  if (!isDeepStrictEqual(reference, candidate)) throw new Error('package.json changed outside scripts; native compatibility must be reviewed');
}

module.exports = { verifyPackage };
if (require.main === module) {
  try {
    const [commit, expectedSha] = process.argv.slice(2);
    if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid signed-build commit');
    verifyPackage(execFileSync('git', ['show', `${commit}:package.json`]), fs.readFileSync('package.json'), expectedSha);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
