#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// This command intentionally accepts only a local JSON fixture or stdin. It has
// no database client and never attempts a remote connection.
const args = process.argv.slice(2);
const fixtureIndex = args.indexOf('--fixture');
const fixturePath = fixtureIndex >= 0 ? args[fixtureIndex + 1] : null;
if (fixtureIndex >= 0 && (!fixturePath || fixturePath.startsWith('--'))) {
  console.error('usage: drift-classifier.mjs [--fixture path]');
  process.exit(2);
}

const raw = fixturePath
  ? (existsSync(resolve(fixturePath)) ? readFileSync(resolve(fixturePath), 'utf8') : null)
  : readFileSync(0, 'utf8');
if (raw === null) {
  console.error(`fixture is missing: ${resolve(fixturePath)}`);
  process.exit(2);
}

let input;
try {
  input = JSON.parse(raw);
} catch (cause) {
  console.error(`fixture is not valid JSON: ${cause.message}`);
  process.exit(2);
}

const asNames = (value, label) => {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    console.error(`${label} must be an array of strings`);
    process.exit(2);
  }
  return [...new Set(value)].sort();
};

const local = asNames(input.local_migrations, 'local_migrations');
const remote = asNames(input.remote_migrations, 'remote_migrations');
const held = asNames(input.held_migrations ?? [], 'held_migrations');
const versionedMigration = /^\d{14}_.+\.sql$/;
const localSet = new Set(local);
const remoteSet = new Set(remote);
const heldSet = new Set(held);
const result = {
  tracked: [],
  remote_only: [],
  local_only: [],
  held: [],
  unknown: [],
};

for (const name of local) {
  if (!versionedMigration.test(name)) result.unknown.push(`local:${name}`);
  else if (heldSet.has(name)) result.held.push(name);
  else if (remoteSet.has(name)) result.tracked.push(name);
  else result.local_only.push(name);
}
for (const name of remote) {
  if (!versionedMigration.test(name)) result.unknown.push(`remote:${name}`);
  else if (!localSet.has(name)) result.remote_only.push(name);
}
for (const name of held) {
  if (!localSet.has(name)) result.unknown.push(`held-not-local:${name}`);
}
for (const key of Object.keys(result)) result[key] = [...new Set(result[key])].sort();

console.log(JSON.stringify({
  source: fixturePath ? resolve(fixturePath) : 'stdin',
  read_only: true,
  production_contacted: false,
  counts: Object.fromEntries(Object.entries(result).map(([key, values]) => [key, values.length])),
  ...result,
}, null, 2));
