const fs = require('fs');
const path = require('path');

const manifestPath = path.join(__dirname, 'requirements.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const classes = new Set(['green', 'yellow', 'red']);
const privateScopes = new Set(['build_and_test', 'foundation_and_test', 'hold_for_liz']);
const verifications = new Set(['unverified', 'verified', 'blocked']);
const visualParityStates = new Set(['verified', 'unverified', 'not_applicable']);
const gates = new Set([
  'all_releases',
  'architecture_pre_b',
  'block_a',
  'block_b',
  'block_c',
  'block_d',
  'block_e',
  'block_f',
  'post_10k',
]);
const expectedIds = Array.from(
  { length: 51 },
  (_, index) => `R${String(index + 1).padStart(2, '0')}`,
);
const maintenanceStatuses = new Set(['verified', 'open', 'blocked']);
const maintenanceOwners = new Set(['none', 'codex', 'josh', 'liz']);
const expectedMaintenanceIds = Array.from(
  { length: 10 },
  (_, index) => `M${String(index + 1).padStart(2, '0')}`,
);
const deferExternalEvidence = process.env.TRACEABILITY_EXTERNAL_EVIDENCE === 'defer';
const externalEvidenceRoots = ['../washedup-web/', '../washedup-world/'];
let deferredExternalEvidence = 0;

function fail(message) {
  process.stderr.write(`Traceability check failed: ${message}\n`);
  process.exitCode = 1;
}

function checkEvidence(requirement) {
  if (!Array.isArray(requirement.evidence)) return;
  for (const evidence of requirement.evidence) {
    if (typeof evidence !== 'string' || evidence.trim().length === 0) {
      fail(`${requirement.id} has an invalid evidence path`);
      continue;
    }
    const resolved = path.resolve(__dirname, '..', evidence);
    const isExternalEvidence = externalEvidenceRoots.some((root) => evidence.startsWith(root));
    if (deferExternalEvidence && isExternalEvidence) {
      deferredExternalEvidence += 1;
      continue;
    }
    if (!fs.existsSync(resolved)) fail(`${requirement.id} evidence is missing: ${evidence}`);
  }
}

if (manifest.source?.pages !== 39) {
  fail('binding source must remain the 39-page package');
}
for (const scopeClass of classes) {
  if (typeof manifest.source?.classificationRule?.[scopeClass] !== 'string') {
    fail(`binding source needs a ${scopeClass} classification rule`);
  }
}

if (!Array.isArray(manifest.maintenanceRequirements)) {
  fail('maintenanceRequirements must be an array');
} else {
  const seenMaintenance = new Set();
  for (const requirement of manifest.maintenanceRequirements) {
    if (!expectedMaintenanceIds.includes(requirement.id)) {
      fail(`unknown maintenance id ${String(requirement.id)}`);
    }
    if (seenMaintenance.has(requirement.id)) fail(`duplicate maintenance id ${requirement.id}`);
    seenMaintenance.add(requirement.id);
    if (typeof requirement.title !== 'string' || requirement.title.trim().length === 0) {
      fail(`${requirement.id} needs a title`);
    }
    if (!maintenanceStatuses.has(requirement.status)) {
      fail(`${requirement.id} has an invalid maintenance status`);
    }
    if (!maintenanceOwners.has(requirement.owner)) {
      fail(`${requirement.id} has an invalid maintenance owner`);
    }
    if (!Array.isArray(requirement.evidence)) fail(`${requirement.id} evidence must be an array`);
    checkEvidence(requirement);
    if (requirement.status === 'verified' && requirement.evidence.length === 0) {
      fail(`${requirement.id} is verified without evidence`);
    }
    if (requirement.status === 'verified' && requirement.owner !== 'none') {
      fail(`${requirement.id} is verified but still has an owner`);
    }
    if (requirement.status === 'open' && requirement.owner !== 'codex') {
      fail(`${requirement.id} open work must remain assigned to Codex`);
    }
    if (
      requirement.status === 'blocked' &&
      (requirement.owner === 'none' || typeof requirement.blocker !== 'string' || !requirement.blocker.trim())
    ) {
      fail(`${requirement.id} blocked work needs an owner and blocker`);
    }
  }
  for (const id of expectedMaintenanceIds) {
    if (!seenMaintenance.has(id)) fail(`missing ${id}`);
  }
}

if (!Array.isArray(manifest.requirements)) {
  fail('requirements must be an array');
} else {
  const seen = new Set();
  const seenTitles = new Set();
  for (const requirement of manifest.requirements) {
    if (!requirement || typeof requirement !== 'object') {
      fail('each requirement must be an object');
      continue;
    }
    if (!expectedIds.includes(requirement.id)) fail(`unknown id ${String(requirement.id)}`);
    if (seen.has(requirement.id)) fail(`duplicate id ${requirement.id}`);
    seen.add(requirement.id);
    if (typeof requirement.title !== 'string' || requirement.title.trim().length === 0) {
      fail(`${requirement.id} needs a title`);
    }
    if (seenTitles.has(requirement.title)) fail(`duplicate title ${requirement.title}`);
    seenTitles.add(requirement.title);
    if (!classes.has(requirement.scopeClass)) fail(`${requirement.id} has an invalid scope class`);
    if (!privateScopes.has(requirement.privateScope)) fail(`${requirement.id} has an invalid private scope`);
    if (!verifications.has(requirement.verification)) fail(`${requirement.id} has an invalid verification`);
    if (!gates.has(requirement.releaseGate)) fail(`${requirement.id} has an invalid release gate`);
    if (
      !Array.isArray(requirement.sourcePages) ||
      requirement.sourcePages.length === 0 ||
      requirement.sourcePages.some(
        (page) => !Number.isInteger(page) || page < 1 || page > manifest.source.pages,
      )
    ) {
      fail(`${requirement.id} needs valid source pages`);
    }
    if (!Array.isArray(requirement.evidence)) fail(`${requirement.id} evidence must be an array`);
    checkEvidence(requirement);
    if (requirement.verification === 'verified' && requirement.evidence.length === 0) {
      fail(`${requirement.id} is verified without evidence`);
    }
    if (requirement.scopeClass === 'red' && requirement.privateScope !== 'hold_for_liz') {
      fail(`${requirement.id} must remain held for Liz`);
    }
    if (requirement.scopeClass === 'red' && requirement.verification !== 'blocked') {
      fail(`${requirement.id} must remain blocked pending Liz`);
    }
    if (requirement.scopeClass !== 'red' && requirement.privateScope === 'hold_for_liz') {
      fail(`${requirement.id} is incorrectly held from private work`);
    }
    if (requirement.scopeClass !== 'red' && requirement.verification === 'blocked') {
      fail(`${requirement.id} has an unexplained private-work blocker`);
    }
    if (requirement.id === 'R45') {
      if (!Array.isArray(requirement.subrequirements) || requirement.subrequirements.length !== 6) {
        fail('R45 must keep six individually named expansion directions');
      }
    }
    if (requirement.visualParity !== undefined) {
      if (!visualParityStates.has(requirement.visualParity)) {
        fail(`${requirement.id} has an invalid visualParity state`);
      }
      if (!Array.isArray(requirement.visualParityEvidence)) {
        fail(`${requirement.id} visualParityEvidence must be an array`);
      } else {
        checkEvidence({ id: requirement.id, evidence: requirement.visualParityEvidence });
      }
      if (requirement.visualParity === 'verified' && (requirement.visualParityEvidence || []).length === 0) {
        fail(`${requirement.id} is visualParity verified without evidence`);
      }
    }
  }
  for (const id of expectedIds) {
    if (!seen.has(id)) fail(`missing ${id}`);
  }
}

if (!process.exitCode) {
  const counts = manifest.requirements.reduce((result, requirement) => {
    result[requirement.scopeClass] = (result[requirement.scopeClass] || 0) + 1;
    return result;
  }, {});
  process.stdout.write(
    `Traceability check passed: ${manifest.requirements.length} requirements, ` +
      `${counts.green} green, ${counts.yellow} yellow, ${counts.red} red; ` +
      `${manifest.maintenanceRequirements.length} maintenance gates; ` +
      `${deferredExternalEvidence} external evidence path(s) deferred.\n`,
  );
}
