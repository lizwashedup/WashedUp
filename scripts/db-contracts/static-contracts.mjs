#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = process.env.DB_CONTRACTS_ROOT
  ? resolve(process.env.DB_CONTRACTS_ROOT)
  : resolve(scriptDir, '../..');
const migrationsDir = process.env.DB_CONTRACTS_MIGRATIONS_DIR
  ? resolve(process.env.DB_CONTRACTS_MIGRATIONS_DIR)
  : join(repoRoot, 'supabase/migrations');
const contractsPath = process.env.DB_CONTRACTS_MANIFEST
  ? resolve(process.env.DB_CONTRACTS_MANIFEST)
  : join(repoRoot, 'scripts/db-contracts/migration-contracts.json');
const provenancePath = process.env.DB_CONTRACTS_PROVENANCE
  ? resolve(process.env.DB_CONTRACTS_PROVENANCE)
  : join(repoRoot, 'docs/database/migration-provenance.json');
const allowedKinds = new Set([
  'top_level_dml',
  'do_fixture_dml',
  'scheduler',
  'irreversible_ddl',
  'stateful_replacement',
  'default_privileges',
]);
const diagnostics = [];
const error = (message) => diagnostics.push(message);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function readJson(path, label) {
  if (!existsSync(path)) {
    error(`${label} is missing: ${path}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    error(`${label} is not valid JSON: ${cause.message}`);
    return null;
  }
}

function sqlFiles() {
  if (!existsSync(migrationsDir)) {
    error(`migration directory is missing: ${migrationsDir}`);
    return [];
  }
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

function versionOf(file) {
  const match = /^(\d{14})_.+\.sql$/.exec(file);
  if (!match) error(`migration filename must start with a 14-digit version: ${file}`);
  return match?.[1] ?? null;
}

function inventoryDigest(files) {
  const digest = createHash('sha256');
  for (const file of files) {
    digest.update(file);
    digest.update('\0');
    digest.update(sha256(readFileSync(join(migrationsDir, file))));
    digest.update('\n');
  }
  return digest.digest('hex');
}

function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

function stringEntropy(value) {
  const counts = new Map();
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1);
  return [...counts.values()].reduce((total, count) => {
    const probability = count / value.length;
    return total - probability * Math.log2(probability);
  }, 0);
}

function secretLiterals(sql) {
  const values = new Set();
  const uncommented = stripSqlComments(sql);
  const candidates = [];
  for (const match of uncommented.matchAll(/'(?:''|[^'])*'/g)) {
    candidates.push(match[0].slice(1, -1).replace(/''/g, "'"));
  }
  for (const match of uncommented.matchAll(
    /'(?:''|[^'])*'(?:\s*\|\|\s*'(?:''|[^'])*')+/g,
  )) {
    candidates.push(
      [...match[0].matchAll(/'(?:''|[^'])*'/g)]
        .map((part) => part[0].slice(1, -1).replace(/''/g, "'"))
        .join(''),
    );
  }
  for (const match of uncommented.matchAll(
    /(?:whsec_[A-Za-z0-9_-]{16,}|(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|\b[a-f0-9]{48,}\b)/gi,
  )) {
    candidates.push(match[0]);
  }
  for (const value of candidates) {
    const isJwt = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
    const isApiKey = /^(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9_-]{16,}$/i.test(value);
    const isWebhookSecret = /^whsec_[A-Za-z0-9_-]{16,}$/i.test(value);
    const isHexToken = /^[a-f0-9]{48,}$/i.test(value);
    const isHighEntropyToken =
      /^[A-Za-z0-9_=-]{32,}$/.test(value) &&
      /[a-z]/.test(value) &&
      /[A-Z]/.test(value) &&
      /\d/.test(value) &&
      stringEntropy(value) >= 4.3;
    if (isJwt || isApiKey || isWebhookSecret || isHexToken || isHighEntropyToken) {
      values.add(value);
    }
  }
  return [...values];
}

function functionBodies(sql) {
  const bodies = [];
  const expression = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\([^)]*\)[\s\S]*?\bAS\s+\$([A-Za-z0-9_]*)\$([\s\S]*?)\$\2\$/gi;
  for (const match of sql.matchAll(expression)) {
    bodies.push({ name: match[1].toLowerCase(), body: match[3] });
  }
  return bodies;
}

function checkNotificationHandlers(files) {
  const latest = new Map();
  for (const file of files) {
    const version = versionOf(file);
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    for (const fn of functionBodies(sql)) {
      if (fn.name !== 'notify_report_alert' && fn.name !== 'notify_plan_posted') continue;
      const prior = latest.get(fn.name);
      if (!prior || version > prior.version || (version === prior.version && file > prior.file)) {
        latest.set(fn.name, { ...fn, file, version });
      }
    }
  }

  for (const name of ['notify_report_alert', 'notify_plan_posted']) {
    const current = latest.get(name);
    if (!current) {
      error(`notification handler is absent: ${name}`);
      continue;
    }
    if (!/vault\.decrypted_secrets/i.test(current.body)) {
      error(`${current.file}: latest ${name} does not read its token from Vault`);
    }
    const guard = /IF\s+coalesce\s*\(\s*run_token\s*,\s*''\s*\)\s*=\s*''\s+THEN\s+RETURN\s+NEW\s*;/i.exec(
      current.body,
    );
    const postAt = current.body.search(/net\.http_post/i);
    if (!guard || postAt < 0 || guard.index > postAt) {
      error(
        `${current.file}: latest ${name} must return before net.http_post when its Vault token is empty`,
      );
    }
  }
}

function checkVaultFunctionLiterals(files) {
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    for (const fn of functionBodies(sql)) {
      if (
        /vault\.decrypted_secrets/i.test(fn.body) &&
        /'[^'\n]*[a-f0-9]{48,}[^'\n]*'/i.test(fn.body)
      ) {
        error(`${file}: Vault-reading function ${fn.name} contains a long hexadecimal literal`);
      }
    }
  }
}

function checkPgcryptoQualification(files) {
  const safeSearchPathAfter = new Map();
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    for (const match of sql.matchAll(
      /ALTER\s+FUNCTION\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\([^;]*?\)\s+SET\s+search_path\s+(?:TO|=)\s+public\s*,\s*extensions\s*;/gi,
    )) {
      safeSearchPathAfter.set(match[1].toLowerCase(), file);
    }
  }
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    for (const fn of functionBodies(sql)) {
      const repairFile = safeSearchPathAfter.get(fn.name);
      const repairedLater = repairFile && repairFile > file;
      if (/(^|[^.a-z0-9_])digest\s*\(/i.test(fn.body) && !repairedLater) {
        error(`${file}: function ${fn.name} uses unqualified digest(); use extensions.digest()`);
      }
    }
  }
}

function checkProvenance(provenance, duplicateVersions) {
  if (!provenance) return;
  if (provenance.schema_provenance !== 'incomplete') {
    error('provenance must explicitly mark the local schema provenance as incomplete');
  }
  const records = Array.isArray(provenance.unresolved_versions)
    ? provenance.unresolved_versions
    : [];
  const unresolved = new Map(records.map((record) => [record.version, record]));
  for (const [version, candidates] of duplicateVersions) {
    const record = unresolved.get(version);
    if (!record || record.status !== 'unresolved') {
      error(`duplicate version ${version} has no unresolved provenance record`);
      continue;
    }
    const actual = Array.isArray(record.local_candidates)
      ? [...record.local_candidates].sort()
      : [];
    if ([...candidates].sort().join('\n') !== actual.join('\n')) {
      error(`duplicate version ${version} provenance candidates do not match local files`);
    }
  }
  for (const record of records) {
    if (record.status === 'unresolved') {
      error(`known unresolved migration provenance: ${record.version}`);
    }
  }

  const directApplied = Array.isArray(provenance.direct_applied)
    ? provenance.direct_applied
    : [];
  const requiredDirectFields = [
    'file',
    'production_evidence',
    'apply_date',
    'approval_class',
  ];
  const directFiles = new Set();
  for (const record of directApplied) {
    for (const field of requiredDirectFields) {
      if (typeof record?.[field] !== 'string' || record[field].trim() === '') {
        error(`direct-applied provenance for ${record?.file ?? '<unknown>'} needs ${field}`);
      }
    }
    if (record?.file) {
      if (directFiles.has(record.file)) error(`duplicate direct-applied provenance record: ${record.file}`);
      directFiles.add(record.file);
      if (!files.includes(record.file)) {
        error(`direct-applied provenance references a missing active migration: ${record.file}`);
      }
    }
    if (record?.production_evidence) {
      const evidencePath = record.production_evidence.split(':', 1)[0];
      const candidates = [
        resolve(repoRoot, evidencePath),
        resolve(dirname(provenancePath), evidencePath),
      ];
      if (!candidates.some((candidate) => existsSync(candidate))) {
        error(`direct-applied provenance evidence is missing for ${record.file}: ${evidencePath}`);
      }
    }
    if (record?.apply_date && !/^\d{4}-\d{2}-\d{2}$/.test(record.apply_date)) {
      error(`direct-applied provenance for ${record.file} has invalid apply_date: ${record.apply_date}`);
    }
    if (record?.approval_class && !/^(?:explicit|repair|verified_direct_apply)$/.test(record.approval_class)) {
      error(`direct-applied provenance for ${record.file} has unsupported approval_class: ${record.approval_class}`);
    }
  }

  const held = Array.isArray(provenance.held_migrations) ? provenance.held_migrations : [];
  const heldFiles = new Set();
  for (const record of held) {
    if (typeof record?.file !== 'string' || typeof record?.reason !== 'string' || typeof record?.source !== 'string') {
      error(`held migration records need file, reason, and source: ${record?.file ?? '<unknown>'}`);
      continue;
    }
    if (heldFiles.has(record.file)) error(`duplicate held migration record: ${record.file}`);
    heldFiles.add(record.file);
    if (files.includes(record.file)) error(`held migration remains in active inventory: ${record.file}`);
  }
}

function gitTrackedMigrationFiles() {
  try {
    return execFileSync('git', ['-C', repoRoot, 'ls-files', '--', 'supabase/migrations/*.sql'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).split('\n').filter(Boolean).map((file) => file.replace(/^supabase\/migrations\//, '')).sort();
  } catch {
    return [];
  }
}

function gitUntrackedMigrationFiles() {
  const override = process.env.DB_CONTRACTS_UNTRACKED_OVERRIDE;
  if (override !== undefined) return override.split(',').map((file) => file.trim()).filter(Boolean).sort();
  try {
    return execFileSync('git', ['-C', repoRoot, 'ls-files', '--others', '--exclude-standard', '--', 'supabase/migrations/*.sql'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).split('\n').filter(Boolean).map((file) => file.replace(/^supabase\/migrations\//, '')).sort();
  } catch {
    return [];
  }
}

function checkReleaseInventory(files, inventoryMatches, provenance, contracts) {
  const heldRecords = Array.isArray(provenance?.held_migrations)
    ? provenance.held_migrations
    : [];
  const held = heldRecords
    .map((record) => record?.file)
    .filter((file) => typeof file === 'string');
  const activeHeld = new Set(
    held
      .map((file) => file.split('/').at(-1))
      .filter((file) => files.includes(file)),
  );
  console.log(`HELD: ${held.length ? held.join(', ') : 'none'}`);
  const candidates = files.filter((file) => !activeHeld.has(file));
  console.log(`RELEASE_CANDIDATES: ${candidates.length} active migration(s), held excluded`);
  if (candidates.length !== files.length - activeHeld.size) {
    error('release candidate calculation does not equal active inventory minus explicitly recorded held migrations');
  }
  const allowedUntracked = new Set(contracts?.approved_untracked_migrations ?? []);
  const untracked = gitUntrackedMigrationFiles();
  const unknownUntracked = untracked.filter((file) => !allowedUntracked.has(file));
  if (unknownUntracked.length) {
    error(`unknown active migration file(s): ${unknownUntracked.join(', ')}. Remediation: classify each file as active, held, or archive it, then regenerate migration-contracts.json inventory_count and inventory_sha256.`);
  }
  if (inventoryMatches) return;
  const tracked = gitTrackedMigrationFiles();
  if (!tracked.length) return;
  const local = new Set(files);
  const trackedSet = new Set(tracked);
  const unknown = files.filter((file) => !trackedSet.has(file) && !allowedUntracked.has(file));
  const missing = tracked.filter((file) => !local.has(file));
  if (unknown.length) {
    error(`unknown active migration file(s): ${unknown.join(', ')}. Remediation: classify each file as active, held, or archive it, then regenerate migration-contracts.json inventory_count and inventory_sha256.`);
  }
  if (missing.length) {
    error(`tracked migration file(s) missing from active inventory: ${missing.join(', ')}. Remediation: restore the file or record its archive/superseded disposition before changing the inventory digest: ${missing.join(', ')}`);
  }
  if (!held.length) console.log('HELD: none');
}

function checkPrivateHarness() {
  const runnerPath = join(repoRoot, 'scripts/db-contracts/run-private-sql-contracts.sh');
  if (!existsSync(runnerPath)) {
    error(`private SQL contract runner is missing: ${runnerPath}`);
    return;
  }
  const runner = readFileSync(runnerPath, 'utf8');
  if (!/--network\s+none/.test(runner)) error('private SQL contract runner must use --network none');
  if (!/POSTGRES_PASSWORD=contract-only/.test(runner)) error('private SQL contract runner must use an isolated contract-only password');
  if (/SUPABASE_(?:ACCESS_TOKEN|DB_PASSWORD)|SERVICE_ROLE_KEY/.test(runner)) error('private SQL contract runner must not reference production credentials');
}

function checkClassifications(contracts, files, inventoryMatches) {
  const sideEffects = contracts.side_effect_migrations;
  const expectedCounts = contracts.classification_counts;
  if (!sideEffects || typeof sideEffects !== 'object' || Array.isArray(sideEffects)) {
    error('migration contracts must contain side_effect_migrations');
    return;
  }
  const unknownKinds = Object.keys(sideEffects).filter((kind) => !allowedKinds.has(kind));
  for (const kind of unknownKinds) error(`unknown migration classification: ${kind}`);

  const classifiedFiles = new Set();
  for (const kind of allowedKinds) {
    const classified = sideEffects[kind];
    if (!Array.isArray(classified)) {
      error(`migration classification ${kind} must be an array`);
      continue;
    }
    if (classified.length !== expectedCounts?.[kind]) {
      error(
        `${kind} count mismatch: expected ${expectedCounts?.[kind]}, found ${classified.length}`,
      );
    }
    const categorySeen = new Set();
    for (const file of classified) {
      if (categorySeen.has(file)) error(`${kind} contains duplicate file ${file}`);
      categorySeen.add(file);
      classifiedFiles.add(file);
      if (!files.includes(file)) error(`contract references a missing migration: ${file}`);
    }
    if (typeof contracts.classification_reasons?.[kind] !== 'string') {
      error(`${kind} needs a classification reason`);
    }
  }
  if (classifiedFiles.size !== contracts.side_effect_union_count) {
    error(
      `expected ${contracts.side_effect_union_count} explicit side-effect/state-dependent files, found ${classifiedFiles.size}`,
    );
  }
  if (!inventoryMatches) {
    error(
      'nonlisted migrations cannot be treated as definition_only until the count and inventory digest match',
    );
  }
}

function checkPayoutContracts() {
  const releasePath = join(repoRoot, 'supabase/functions/ticket-payout-release/index.ts');
  const drainPath = join(repoRoot, 'supabase/functions/ticket-inbox-drain/index.ts');
  for (const path of [releasePath, drainPath]) {
    if (!existsSync(path)) error(`payout source is missing: ${path}`);
  }
  if (!existsSync(releasePath) || !existsSync(drainPath)) return;

  const release = readFileSync(releasePath, 'utf8');
  const drain = readFileSync(drainPath, 'utf8');
  if (!/claimPayoutBatch\s*\(\s*\(name, args\)=>service\.rpc\(name, args\),\s*row,\s*events\s*\)/s.test(release)) {
    error('ticket payout release does not pass the complete event array to the batch claim helper');
  }
  if (/service\.rpc\(['"]claim_ticket_payout_batch['"]/.test(release)) {
    error('ticket payout release bypasses the one-call batch claim helper');
  }
  if (/service\.from\(['"]ticket_payouts['"]\)\.insert/.test(release)) {
    error('ticket payout release still claims rows with separate insert requests');
  }
  if (!/applyPayoutReconciliationFilters\s*\(/.test(drain)) {
    error('ticket payout drain does not apply the composite reconciliation filters');
  }
}

const files = sqlFiles();
const contracts = readJson(contractsPath, 'migration contracts');
const provenance = readJson(provenancePath, 'migration provenance');
const versions = new Map();
for (const file of files) {
  const version = versionOf(file);
  if (!version) continue;
  versions.set(version, [...(versions.get(version) ?? []), file]);
}
const duplicateVersions = new Map(
  [...versions].filter(([, candidates]) => candidates.length !== 1),
);
for (const [version, candidates] of duplicateVersions) {
  error(`duplicate migration version ${version}: ${candidates.join(', ')}`);
}

if (contracts) {
  const actualDigest = inventoryDigest(files);
  const inventoryMatches =
    files.length === contracts.migration_count && actualDigest === contracts.inventory_sha256;
  if (files.length !== contracts.migration_count) {
    error(`migration count mismatch: expected ${contracts.migration_count}, found ${files.length}`);
  }
  if (actualDigest !== contracts.inventory_sha256) {
    error('migration inventory digest mismatch');
  }
  checkClassifications(contracts, files, inventoryMatches);

  const approvedLegacy = Array.isArray(contracts.approved_legacy_secret_literals)
    ? contracts.approved_legacy_secret_literals
    : [];
  const matchedLegacy = new Set();
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    if (/\b(?:public\.)?organizer_receivables\b/i.test(stripSqlComments(sql))) {
      error(`${file}: executable SQL touches organizer_receivables, which is blocked pending Liz rules`);
    }
    for (const literal of secretLiterals(sql)) {
      const fingerprint = sha256(literal);
      const approved = approvedLegacy.find(
        (entry) => entry.file === file && entry.sha256 === fingerprint,
      );
      const occurrences = sql.split(literal).length - 1;
      if (!approved || approved.occurrences !== occurrences) {
        error(`${file}: unapproved secret-shaped literal (${fingerprint})`);
      } else {
        matchedLegacy.add(`${file}:${fingerprint}`);
      }
    }
  }
  for (const approved of approvedLegacy) {
    const key = `${approved.file}:${approved.sha256}`;
    if (!matchedLegacy.has(key)) error(`approved legacy secret exception is stale: ${key}`);
  }
}

checkVaultFunctionLiterals(files);
checkPgcryptoQualification(files);
checkNotificationHandlers(files);
checkPayoutContracts();
checkProvenance(provenance, duplicateVersions);
const inventoryMatches = contracts
  ? files.length === contracts.migration_count && inventoryDigest(files) === contracts.inventory_sha256
  : false;
checkReleaseInventory(files, inventoryMatches, provenance, contracts);
checkPrivateHarness();

if (diagnostics.length) {
  for (const message of diagnostics) console.error(`FAIL: ${message}`);
  process.exitCode = 1;
} else {
  console.log(`PASS: ${files.length} migration files satisfy static contracts`);
}
