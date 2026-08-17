export const ACCESS_CAPABILITIES = [
  'plans.use',
  'community.view',
  'community.chat',
  'tickets.buy',
] as const;

export type AccessCapability = (typeof ACCESS_CAPABILITIES)[number];
export type EntitlementSource = 'incumbent' | 'subscription' | 'community_invite';
export type EntitlementScope =
  | { kind: 'global' }
  | { kind: 'community'; communityId: string };

export interface AccessRequest {
  subjectId: string;
  capability: AccessCapability;
  scope: EntitlementScope;
}

export interface EntitlementGrant {
  id: string;
  subjectId: string;
  capability: Exclude<AccessCapability, 'tickets.buy'>;
  scope: EntitlementScope;
  source: EntitlementSource;
  grantedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

export type EntitlementDecision =
  | { decision: 'allow'; grantId: string }
  | { decision: 'deny'; reason: 'invalid_request' | 'no_matching_grant' }
  | { decision: 'not_applicable'; reason: 'ticket_access_is_outside_plan_entitlements' };

const CAPABILITIES = new Set<string>(ACCESS_CAPABILITIES);
const GRANT_SOURCES = new Set<string>(['incumbent', 'subscription', 'community_invite']);
const REQUEST_KEYS = new Set(['subjectId', 'capability', 'scope']);
const GRANT_KEYS = new Set([
  'id',
  'subjectId',
  'capability',
  'scope',
  'source',
  'grantedAt',
  'expiresAt',
  'revokedAt',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseScope(value: unknown): EntitlementScope | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null;
  if (value.kind === 'global' && Object.keys(value).length === 1) return { kind: 'global' };
  if (
    value.kind === 'community' &&
    Object.keys(value).length === 2 &&
    isIdentifier(value.communityId)
  ) {
    return { kind: 'community', communityId: value.communityId };
  }
  return null;
}

function parseRequest(value: unknown): AccessRequest | null {
  if (!isRecord(value) || !hasOnlyKeys(value, REQUEST_KEYS)) return null;
  if (!isIdentifier(value.subjectId) || !isIdentifier(value.capability) || !CAPABILITIES.has(value.capability)) {
    return null;
  }
  const scope = parseScope(value.scope);
  if (!scope) return null;
  return {
    subjectId: value.subjectId,
    capability: value.capability as AccessCapability,
    scope,
  };
}

function parseTimestamp(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return undefined;
  return value;
}

function parseGrant(value: unknown): EntitlementGrant | null {
  if (!isRecord(value) || !hasOnlyKeys(value, GRANT_KEYS)) return null;
  if (!isIdentifier(value.id) || !isIdentifier(value.subjectId)) return null;
  if (!isIdentifier(value.capability) || value.capability === 'tickets.buy' || !CAPABILITIES.has(value.capability)) {
    return null;
  }
  if (!isIdentifier(value.source) || !GRANT_SOURCES.has(value.source)) return null;
  const scope = parseScope(value.scope);
  const grantedAt = parseTimestamp(value.grantedAt);
  const expiresAt = parseTimestamp(value.expiresAt);
  const revokedAt = parseTimestamp(value.revokedAt);
  if (!scope || grantedAt === undefined || grantedAt === null || expiresAt === undefined || revokedAt === undefined) {
    return null;
  }
  return {
    id: value.id,
    subjectId: value.subjectId,
    capability: value.capability as EntitlementGrant['capability'],
    scope,
    source: value.source as EntitlementSource,
    grantedAt,
    expiresAt,
    revokedAt,
  };
}

function scopesMatch(left: EntitlementScope, right: EntitlementScope): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'global') return true;
  return right.kind === 'community' && left.communityId === right.communityId;
}

function grantShapeMatchesSource(grant: EntitlementGrant): boolean {
  if (grant.source === 'incumbent') {
    return grant.capability === 'plans.use' &&
      grant.scope.kind === 'global' &&
      grant.expiresAt === null &&
      grant.revokedAt === null;
  }
  if (grant.source === 'subscription') {
    return grant.capability === 'plans.use' && grant.scope.kind === 'global';
  }
  return (
    (grant.capability === 'community.view' || grant.capability === 'community.chat') &&
    grant.scope.kind === 'community'
  );
}

export function evaluateEntitlement(
  rawRequest: unknown,
  rawGrants: readonly unknown[],
  nowMs: number,
): EntitlementDecision {
  const request = parseRequest(rawRequest);
  if (!request || !Number.isFinite(nowMs)) return { decision: 'deny', reason: 'invalid_request' };
  if (request.capability === 'tickets.buy') {
    return { decision: 'not_applicable', reason: 'ticket_access_is_outside_plan_entitlements' };
  }

  for (const rawGrant of rawGrants) {
    const grant = parseGrant(rawGrant);
    if (!grant || !grantShapeMatchesSource(grant)) continue;
    if (grant.subjectId !== request.subjectId || grant.capability !== request.capability) continue;
    if (!scopesMatch(grant.scope, request.scope)) continue;
    if (grant.revokedAt !== null && Date.parse(grant.revokedAt) <= nowMs) continue;
    if (grant.expiresAt !== null && Date.parse(grant.expiresAt) <= nowMs) continue;
    if (Date.parse(grant.grantedAt) > nowMs) continue;
    return { decision: 'allow', grantId: grant.id };
  }

  return { decision: 'deny', reason: 'no_matching_grant' };
}
