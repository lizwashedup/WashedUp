export const ACTIVITY_DRAFT_CONTEXTS = [
  'plan',
  'organization_event',
  'community_event',
] as const;
export const ACTIVITY_DRAFT_FIELDS = [
  'title',
  'categoryId',
  'startsAt',
  'endsAt',
  'locationText',
] as const;

export type ActivityDraftContext = (typeof ACTIVITY_DRAFT_CONTEXTS)[number];
export type ActivityDraftField = (typeof ACTIVITY_DRAFT_FIELDS)[number];

export interface ActivityDraftSuggestion {
  field: ActivityDraftField;
  value: string;
  confidence: number;
  evidence: string;
}

export interface ActivityDraftSuggestionBatch {
  context: ActivityDraftContext;
  suggestions: ActivityDraftSuggestion[];
}

export interface PartitionedDraftSuggestions {
  autoApplyEligible: ActivityDraftSuggestion[];
  reviewRequired: ActivityDraftSuggestion[];
}

const CONTEXTS = new Set<string>(ACTIVITY_DRAFT_CONTEXTS);
const FIELDS = new Set<string>(ACTIVITY_DRAFT_FIELDS);
const BATCH_KEYS = new Set(['context', 'suggestions']);
const SUGGESTION_KEYS = new Set(['field', 'value', 'confidence', 'evidence']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseSuggestion(
  value: unknown,
  allowedCategoryIds: ReadonlySet<string>,
): ActivityDraftSuggestion | null {
  if (!isRecord(value) || !hasOnlyKeys(value, SUGGESTION_KEYS)) return null;
  if (!isNonEmptyString(value.field) || !FIELDS.has(value.field)) return null;
  if (!isNonEmptyString(value.value) || !isNonEmptyString(value.evidence)) return null;
  if (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence)) return null;
  if (value.confidence < 0 || value.confidence > 1) return null;

  if (value.field === 'categoryId' && !allowedCategoryIds.has(value.value)) return null;
  if (
    (value.field === 'startsAt' || value.field === 'endsAt') &&
    !Number.isFinite(Date.parse(value.value))
  ) {
    return null;
  }

  return value as unknown as ActivityDraftSuggestion;
}

export function parseActivityDraftSuggestionBatch(
  value: unknown,
  allowedCategoryIds: ReadonlySet<string>,
): ActivityDraftSuggestionBatch | null {
  if (!isRecord(value) || !hasOnlyKeys(value, BATCH_KEYS)) return null;
  if (!isNonEmptyString(value.context) || !CONTEXTS.has(value.context)) return null;
  if (!Array.isArray(value.suggestions)) return null;

  const suggestions: ActivityDraftSuggestion[] = [];
  const seenFields = new Set<ActivityDraftField>();
  for (const rawSuggestion of value.suggestions) {
    const suggestion = parseSuggestion(rawSuggestion, allowedCategoryIds);
    if (!suggestion) return null;
    if (seenFields.has(suggestion.field)) return null;
    seenFields.add(suggestion.field);
    suggestions.push(suggestion);
  }

  const startsAt = suggestions.find((suggestion) => suggestion.field === 'startsAt');
  const endsAt = suggestions.find((suggestion) => suggestion.field === 'endsAt');
  if (startsAt && endsAt && Date.parse(endsAt.value) < Date.parse(startsAt.value)) return null;
  return { context: value.context as ActivityDraftContext, suggestions };
}

export function partitionDraftSuggestions(
  batch: ActivityDraftSuggestionBatch,
  minimumConfidence: number,
): PartitionedDraftSuggestions | null {
  if (!Number.isFinite(minimumConfidence) || minimumConfidence < 0 || minimumConfidence > 1) return null;
  return batch.suggestions.reduce<PartitionedDraftSuggestions>(
    (result, suggestion) => {
      if (suggestion.confidence >= minimumConfidence) result.autoApplyEligible.push(suggestion);
      else result.reviewRequired.push(suggestion);
      return result;
    },
    { autoApplyEligible: [], reviewRequired: [] },
  );
}
