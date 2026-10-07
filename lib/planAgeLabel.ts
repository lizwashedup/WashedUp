/** Existing plan restrictions, preserved without treating unloaded bounds as null. */
export interface PlanAgeParameters {
  target_age_min?: number | null;
  target_age_max?: number | null;
  age_range?: string | null;
}

/** Presentation only; eligibility continues to use the original saved bounds. */
export function planAgeLabel(plan: PlanAgeParameters): string | null {
  const min = plan.target_age_min;
  const max = plan.target_age_max;

  if (min === undefined && max === undefined) {
    // The old text column is not used by current plan creation. Only explicit
    // unrestricted labels are safe to show when no numeric bounds were loaded.
    const legacy = typeof plan.age_range === 'string' ? plan.age_range.trim().toLowerCase() : '';
    return ['everyone', 'all ages', 'any age', 'unrestricted'].includes(legacy) ? 'Any age' : null;
  }

  // A missing side is not an open side: only a stored null means no bound.
  if (min === undefined || max === undefined) return null;
  const valid = (age: number | null) => age === null || (Number.isSafeInteger(age) && age >= 0);
  if (!valid(min) || !valid(max)) return null;
  if (min === null && max === null) return 'Any age';
  if (min !== null && max !== null && min > max) return null;
  if (min === null) return `Up to ${max}`;
  // Current PlanComposerV2 stores its plus choices with 99 as the upper sentinel.
  if (max === null || max === 99) return `${min}+`;
  if (min === max) return `${min}`;

  // Decade wording is exact only when both saved endpoints cover full decades.
  if (min >= 10 && min % 10 === 0 && max % 10 === 9) {
    const lastDecade = max - 9;
    return min === lastDecade ? `${min}s` : `${min}s–${lastDecade}s`;
  }
  return `${min}–${max}`;
}
