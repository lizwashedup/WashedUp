import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATION_PREFIX = 'supabase/migrations/';

export function scanMigrationSql(sql) {
  const withoutComments = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
  const rules = [
    ['DROP TABLE', /\bdrop\s+table\b/i],
    ['DROP SCHEMA', /\bdrop\s+schema\b/i],
    ['DROP TYPE', /\bdrop\s+type\b/i],
    ['TRUNCATE', /\btruncate(?:\s+table)?\b/i],
    ['DROP COLUMN', /\balter\s+table[\s\S]*?\bdrop\s+column\b/i],
    ['DELETE WITHOUT WHERE', /\bdelete\s+from\s+[\w."-]+\s*;/i],
  ];
  return rules.filter(([, pattern]) => pattern.test(withoutComments)).map(([label]) => label);
}

export function parseNameStatus(output) {
  return output
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const fields = line.split('\t');
      const status = fields[0];
      const path = status.startsWith('R') || status.startsWith('C') ? fields[2] : fields[1];
      return { status, path };
    })
    .filter(({ path }) => path?.startsWith(MIGRATION_PREFIX));
}

function changedMigrations(repoRoot) {
  const base = process.env.RELEASE_BASE_SHA?.trim();
  const diffArgs = base
    ? ['diff', '--name-status', `${base}...HEAD`, '--', MIGRATION_PREFIX]
    : ['diff', '--name-status', 'HEAD', '--', MIGRATION_PREFIX];
  const tracked = parseNameStatus(execFileSync('git', diffArgs, { cwd: repoRoot, encoding: 'utf8' }));
  if (base) return tracked;
  const untracked = execFileSync(
    'git',
    ['ls-files', '--others', '--exclude-standard', '--', MIGRATION_PREFIX],
    { cwd: repoRoot, encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((path) => ({ status: 'A', path }));
  const unique = new Map([...tracked, ...untracked].map((entry) => [entry.path, entry]));
  return [...unique.values()];
}

export function evaluateMigrationChanges(changes, repoRoot) {
  const failures = [];
  for (const change of changes) {
    if (change.status !== 'A' && change.status !== '??') {
      failures.push(`${change.path}: existing migration history is immutable (${change.status})`);
      continue;
    }
    const fullPath = resolve(repoRoot, change.path);
    if (!existsSync(fullPath)) {
      failures.push(`${change.path}: added migration is missing`);
      continue;
    }
    for (const violation of scanMigrationSql(readFileSync(fullPath, 'utf8'))) {
      failures.push(`${change.path}: destructive operation blocked (${violation})`);
    }
  }
  return failures;
}

export function runMigrationPolicy(repoRoot = process.cwd()) {
  const changes = changedMigrations(repoRoot);
  const failures = evaluateMigrationChanges(changes, repoRoot);
  if (failures.length) {
    throw new Error(`Migration release policy failed:\n- ${failures.join('\n- ')}`);
  }
  return `PASS: ${changes.length} changed migration(s) are new, forward-only, and non-destructive`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(runMigrationPolicy());
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
