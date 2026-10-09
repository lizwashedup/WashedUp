const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { verifyPackage } = require('../scripts/verify-ota-package.cjs');
const reference = { name: 'app', version: '1.0.7', dependencies: { native: '1.0.0' }, devDependencies: { test: '2' }, overrides: { native: '1.0.0' }, scripts: { test: 'jest' } };
const archived = JSON.stringify(reference);
const sha = createHash('sha256').update(archived).digest('hex');
test('permits unchanged metadata or scripts alone against the authentic pinned input', () => {
  verifyPackage(archived, archived, sha);
  verifyPackage(archived, JSON.stringify({ ...reference, scripts: { test: 'node runner' } }), sha);
});
for (const [field, value] of Object.entries({ name: 'other', version: '2', dependencies: { native: '2' }, devDependencies: {}, overrides: {}, main: 'other.js' })) {
  test(`rejects changes to ${field}`, () => assert.throws(() => verifyPackage(archived, JSON.stringify({ ...reference, [field]: value }), sha), /outside scripts/));
}
test('rejects a replaced reference, wrong pin, and malformed metadata', () => {
  assert.throws(() => verifyPackage(archived + ' ', archived, sha), /pinned/);
  assert.throws(() => verifyPackage(archived, archived, '0'.repeat(64)), /pinned/);
  assert.throws(() => verifyPackage(archived, '{', sha));
});
